import { afterEach, describe, expect, it } from "bun:test";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileSystemServiceImpl } from "./filesystem-service.js";

describe("FileSystemServiceImpl.atomicWriteFile", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      tempDirs
        .splice(0)
        .map((dir) => rm(dir, { recursive: true, force: true })),
    );
  });

  it("caps an existing file at the requested maximum mode", async () => {
    const path = await createExistingFile(0o644);

    await new FileSystemServiceImpl().atomicWriteFile(path, "updated", 0o600);

    expect(await readFile(path, "utf8")).toBe("updated");
    await expectMode(path, 0o600);
  });

  it("does not broaden an existing restrictive mode", async () => {
    // Windows maps 0400 to a read-only attribute that prevents rename-based
    // replacement; POSIX permission-bit narrowing is not meaningful there.
    const path = await createExistingFile(
      process.platform === "win32" ? 0o600 : 0o400,
    );

    await new FileSystemServiceImpl().atomicWriteFile(path, "updated", 0o600);

    expect(await readFile(path, "utf8")).toBe("updated");
    await expectMode(path, 0o400);
  });

  it("uses the maximum mode for a new file", async () => {
    const dir = await createTempDir();
    const path = join(dir, "new.json");

    await new FileSystemServiceImpl().atomicWriteFile(path, "created", 0o600);

    expect(await readFile(path, "utf8")).toBe("created");
    await expectMode(path, 0o600);
  });

  it("preserves an existing mode when no maximum is provided", async () => {
    const path = await createExistingFile(0o644);

    await new FileSystemServiceImpl().atomicWriteFile(path, "updated");

    expect(await readFile(path, "utf8")).toBe("updated");
    await expectMode(path, 0o644);
  });

  async function createTempDir(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "githits-filesystem-"));
    tempDirs.push(dir);
    return dir;
  }

  async function createExistingFile(mode: number): Promise<string> {
    const dir = await createTempDir();
    const path = join(dir, "existing.json");
    await writeFile(path, "original", { mode });
    if (process.platform !== "win32") await chmod(path, mode);
    return path;
  }

  async function expectMode(path: string, expected: number): Promise<void> {
    if (process.platform === "win32") return;
    expect((await stat(path)).mode & 0o777).toBe(expected);
  }
});

describe("FileSystemServiceImpl.createTempDir", () => {
  it("creates unique directories under the OS temp directory", async () => {
    const service = new FileSystemServiceImpl();
    const first = await service.createTempDir("githits-init-probe-");
    const second = await service.createTempDir("githits-init-probe-");
    try {
      expect(first).not.toBe(second);
      expect(first.toLowerCase()).toStartWith(tmpdir().toLowerCase());
      expect(second.toLowerCase()).toStartWith(tmpdir().toLowerCase());
    } finally {
      await Promise.all([
        rm(first, { recursive: true, force: true }),
        rm(second, { recursive: true, force: true }),
      ]);
    }
  });
});

describe("FileSystemServiceImpl.deleteDirIfEmpty", () => {
  it("removes a file through a skill symlink without removing the symlink", async () => {
    if (process.platform === "win32") return;

    const root = await mkdtemp(join(tmpdir(), "githits-filesystem-"));
    try {
      const sharedSkillDir = join(root, ".agents", "skills", "githits-mcp");
      const claudeSkillsDir = join(root, ".claude", "skills");
      const claudeSkillDir = join(claudeSkillsDir, "githits-mcp");
      const skillPath = join(claudeSkillDir, "SKILL.md");

      await mkdir(sharedSkillDir, { recursive: true });
      await mkdir(claudeSkillsDir, { recursive: true });
      await writeFile(join(sharedSkillDir, "SKILL.md"), "shared skill");
      await symlink(sharedSkillDir, claudeSkillDir, "dir");

      const service = new FileSystemServiceImpl();
      await service.deleteFile(skillPath);
      await service.deleteDirIfEmpty(claudeSkillDir);

      expect(await service.exists(skillPath)).toBe(false);
      expect((await lstat(claudeSkillDir)).isSymbolicLink()).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
