import { describe, expect, it, mock } from "bun:test";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, win32 } from "node:path";
import { GITHITS_SKILL_SOURCE_PATHS } from "../commands/init/guidance-assets.js";
import {
  type FileSystemService,
  FileSystemServiceImpl,
} from "./filesystem-service.js";
import history from "./fixtures/mcp-skill-history.json";
import {
  inspectSkillContent,
  renderManagedSkillContent,
} from "./mcp-skill-content.js";
import {
  getMcpSkillRoots,
  updateInstalledMcpSkill,
} from "./mcp-skill-update.js";
import { createMockFileSystemService, withTestEnvVar } from "./test-helpers.js";

const bundled = "---\nname: githits-mcp\n---\n\n# Current guide\n";
const old = history[0]?.content ?? "";
const source = GITHITS_SKILL_SOURCE_PATHS["githits-mcp"].sourcePath;
const root = "/home/test/.agents/skills";
const destination = `${root}/githits-mcp/SKILL.md`;

interface TestState {
  fs: FileSystemService;
  files: Map<string, string>;
  warnings: string[];
  update: (env?: Record<string, string | undefined>) => Promise<void>;
}

function missing(): Error {
  return Object.assign(new Error("sensitive error detail"), { code: "ENOENT" });
}

function setup(
  content?: string,
  overrides: Partial<FileSystemService> = {},
): TestState {
  const files = new Map<string, string>([[source, bundled]]);
  if (content !== undefined) files.set(destination, content);
  const warnings: string[] = [];
  const fs = createMockFileSystemService({
    realpath: mock(async (path: string) => {
      if (path === root || files.has(path)) return path;
      throw missing();
    }),
    isFile: mock(async (path: string) => files.has(path)),
    readFile: mock(async (path: string) => {
      const content = files.get(path);
      if (content === undefined) throw missing();
      return content;
    }),
    atomicWriteFile: mock(async (path: string, content: string) => {
      files.set(path, content);
    }),
    ...overrides,
  });
  return {
    fs,
    files,
    warnings,
    update: (env = {}) =>
      updateInstalledMcpSkill({
        fs,
        version: "0.26.0",
        env,
        warn: (message) => warnings.push(message),
      }),
  };
}

describe("installed MCP skill maintenance", () => {
  it("upgrades a known legacy file atomically and repeated startup writes nothing", async () => {
    const state = setup(old);
    await state.update();
    expect(inspectSkillContent(state.files.get(destination) ?? "")).toEqual({
      kind: "managed",
      content: bundled,
      version: "0.26.0",
    });
    expect(state.fs.atomicWriteFile).toHaveBeenCalledTimes(1);
    await state.update();
    expect(state.fs.atomicWriteFile).toHaveBeenCalledTimes(1);
    expect(state.warnings).toEqual([]);
    expect(state.fs.ensureDir).not.toHaveBeenCalled();
  });

  it.each([
    undefined,
    bundled,
    `${old}edited`,
    `${renderManagedSkillContent(old, "0.25.0")}edited`,
  ])(
    "preserves missing, current, unknown, and edited files without writes",
    async (content) => {
      const state = setup(content);
      await state.update();
      expect(state.files.get(destination)).toBe(content);
      expect(state.fs.atomicWriteFile).not.toHaveBeenCalled();
      expect(state.warnings).toEqual([]);
    },
  );

  it("preserves a newer mismatched marked guide and warns without leaking content", async () => {
    const newer = renderManagedSkillContent(old, "0.27.0");
    const state = setup(newer);
    await state.update();
    expect(state.files.get(destination)).toBe(newer);
    expect(state.warnings).toHaveLength(1);
    expect(state.warnings[0]).toContain("0.26.0");
    expect(state.warnings[0]).toContain("0.27.0");
    expect(state.warnings[0]).not.toContain(old);
  });

  it.each(["1", "false"])(
    "environment opt-out %s skips config and skill inspection",
    async (value) => {
      const state = setup(old);
      await state.update({ GITHITS_DISABLE_SKILL_UPDATE: value });
      expect(state.fs.exists).not.toHaveBeenCalled();
      expect(state.fs.readFile).not.toHaveBeenCalled();
      expect(state.fs.realpath).not.toHaveBeenCalled();
      expect(state.fs.atomicWriteFile).not.toHaveBeenCalled();
    },
  );

  it("an empty environment value defers to config and allows enabled maintenance", async () => {
    const state = setup(old);
    await state.update({ GITHITS_DISABLE_SKILL_UPDATE: "" });
    expect(state.fs.atomicWriteFile).toHaveBeenCalledTimes(1);
  });

  it("persistent config false skips all skill inspection and warnings", async () => {
    const state = setup(old, {
      exists: mock(async () => true),
      readFile: mock(async () => "[skills]\nauto_update = false\n"),
    });
    await state.update();
    expect(state.fs.realpath).not.toHaveBeenCalled();
    expect(state.fs.readFile).toHaveBeenCalledTimes(1);
    expect(state.warnings).toEqual([]);
  });

  it("invalid policy and TOML warn safely and never write or fail maintenance", async () => {
    for (const config of [
      '[skills]\nauto_update = "sensitive-value"\n',
      "[skills\n",
    ]) {
      const state = setup(old, {
        exists: mock(async () => true),
        readFile: mock(async () => config),
      });
      await expect(state.update()).resolves.toBeUndefined();
      expect(state.fs.realpath).not.toHaveBeenCalled();
      expect(state.fs.atomicWriteFile).not.toHaveBeenCalled();
      expect(state.warnings).toHaveLength(1);
      expect(state.warnings.join(" ")).not.toContain("sensitive-value");
    }
  });

  it("a final-reread edit remains untouched", async () => {
    let reads = 0;
    const state = setup(old, {
      readFile: mock(async (path: string) =>
        path === source ? bundled : ++reads === 1 ? old : `${old}edit`,
      ),
    });
    await state.update();
    expect(state.fs.atomicWriteFile).not.toHaveBeenCalled();
    expect(reads).toBe(2);
  });

  it("source failures and target failures remain non-fatal and sanitized", async () => {
    for (const override of [
      {
        readFile: mock(async () => {
          throw new Error("sensitive source detail");
        }),
      },
      {
        atomicWriteFile: mock(async () => {
          throw new Error("sensitive target detail");
        }),
      },
    ]) {
      const state = setup(old, override);
      await expect(state.update()).resolves.toBeUndefined();
      expect(state.warnings.length).toBeGreaterThan(0);
      expect(state.warnings.join(" ")).not.toContain("sensitive");
    }
  });

  it("skips non-regular targets before reading them", async () => {
    const state = setup(old, { isFile: mock(async () => false) });
    await state.update();
    expect(state.fs.readFile).toHaveBeenCalledTimes(1);
    expect(state.fs.atomicWriteFile).not.toHaveBeenCalled();
    expect(state.warnings).toEqual([]);
  });

  it("a failed target does not prevent another eligible update", async () => {
    const secondRoot = "/home/test/.claude/skills";
    const second = `${secondRoot}/githits-mcp/SKILL.md`;
    const state = setup(old, {
      realpath: mock(async (path: string) => {
        if ([root, destination, secondRoot, second].includes(path)) return path;
        throw missing();
      }),
      isFile: mock(async () => true),
      readFile: mock(async (path: string) => {
        if (path === source) return bundled;
        if (path === destination) throw new Error("private failure text");
        if (path === second) return old;
        throw missing();
      }),
    });
    await state.update();
    expect(state.fs.atomicWriteFile).toHaveBeenCalledWith(
      second,
      renderManagedSkillContent(bundled, "0.26.0"),
    );
    expect(state.warnings).toHaveLength(1);
    expect(state.warnings[0]).not.toContain("private");
  });

  it("identical newer guidance stays silent", async () => {
    const state = setup(renderManagedSkillContent(bundled, "99.0.0"));
    await state.update();
    expect(state.fs.atomicWriteFile).not.toHaveBeenCalled();
    expect(state.warnings).toEqual([]);
  });

  it("a deleted cwd does not fail maintenance or prevent a user skill update", async () => {
    const state = setup(old, {
      getCwd: mock(() => {
        throw missing();
      }),
    });
    await expect(state.update()).resolves.toBeUndefined();
    expect(state.fs.atomicWriteFile).toHaveBeenCalledWith(
      destination,
      renderManagedSkillContent(bundled, "0.26.0"),
    );
    expect(state.warnings).toHaveLength(1);
    expect(state.warnings[0]).not.toContain("sensitive");
    expect(state.fs.getCwd).toHaveBeenCalledTimes(1);
  });

  it.each(["user", "project"] as const)(
    "a failed %s base preserves root discovery for the other scope",
    (scope) => {
      const fs = createMockFileSystemService({
        [scope === "user" ? "getHomeDir" : "getCwd"]: () => {
          throw missing();
        },
      });
      const warnings: string[] = [];
      const roots = getMcpSkillRoots(fs, (message) => warnings.push(message));
      expect(roots).toHaveLength(scope === "user" ? 4 : 6);
      expect(roots).toContain(
        `${scope === "user" ? "/current/dir" : "/home/test"}/.agents/skills`,
      );
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).not.toContain("sensitive");
    },
  );

  it("uses Windows path semantics for user and project root enumeration", () => {
    const fs = createMockFileSystemService({
      getHomeDir: () => "C:\\Users\\me",
      getCwd: () => "D:\\project",
      joinPath: win32.join,
    });
    const warn = mock();
    const roots = getMcpSkillRoots(fs, warn);
    expect(roots).toHaveLength(10);
    expect(roots).toContain("C:\\Users\\me\\.agents\\skills");
    expect(roots).toContain("D:\\project\\.claude\\skills");
    expect(roots.every((path) => !path.includes("/"))).toBe(true);
    expect(
      roots.some((path) => path.includes(".cline") || path.includes(".junie")),
    ).toBe(false);
    expect(warn).not.toHaveBeenCalled();
  });

  it("updates shared aliases once, supports symlinked roots, and skips escaping aliases", async () => {
    if (process.platform === "win32") return;
    const temporary = await mkdtemp(join(tmpdir(), "githits-skill-update-"));
    try {
      const home = join(temporary, "home");
      const homeAlias = join(temporary, "home-alias");
      const cwd = join(temporary, "project");
      const dotfiles = join(temporary, "dotfiles");
      const skillDir = join(dotfiles, "skills", "githits-mcp");
      const projectDir = join(cwd, ".agents", "skills", "githits-mcp");
      await mkdir(skillDir, { recursive: true });
      await mkdir(join(home, ".claude", "skills"), { recursive: true });
      const fileAliasDir = join(home, ".factory", "skills", "githits-mcp");
      await mkdir(fileAliasDir, { recursive: true });
      await symlink(home, homeAlias, "dir");
      await mkdir(join(cwd, ".kiro", "skills"), { recursive: true });
      await mkdir(projectDir, { recursive: true });
      await writeFile(join(skillDir, "SKILL.md"), old);
      await writeFile(join(projectDir, "SKILL.md"), old);
      await symlink(dotfiles, join(home, ".agents"), "dir");
      await symlink(
        skillDir,
        join(home, ".claude", "skills", "githits-mcp"),
        "dir",
      );
      await symlink(
        join(skillDir, "SKILL.md"),
        join(fileAliasDir, "SKILL.md"),
        "file",
      );
      const outside = join(temporary, "outside");
      await mkdir(outside);
      await writeFile(join(outside, "SKILL.md"), old);
      await symlink(
        outside,
        join(cwd, ".kiro", "skills", "githits-mcp"),
        "dir",
      );
      const real = new FileSystemServiceImpl();
      const write = mock(real.atomicWriteFile.bind(real));
      const fs = Object.assign(real, {
        getHomeDir: () => homeAlias,
        getCwd: () => cwd,
        atomicWriteFile: write,
      });
      const warnings: string[] = [];
      await withTestEnvVar("XDG_CONFIG_HOME", join(home, ".config"), () =>
        updateInstalledMcpSkill({
          fs,
          version: "0.26.0",
          env: {},
          warn: (message) => warnings.push(message),
        }),
      );
      expect(write).toHaveBeenCalledTimes(2);
      expect(
        (await lstat(join(fileAliasDir, "SKILL.md"))).isSymbolicLink(),
      ).toBe(true);
      expect(
        (
          await lstat(join(home, ".claude", "skills", "githits-mcp"))
        ).isSymbolicLink(),
      ).toBe(true);
      expect(
        inspectSkillContent(await readFile(join(skillDir, "SKILL.md"), "utf8")),
      ).toMatchObject({ kind: "managed", version: "0.26.0" });
      expect(await readFile(join(outside, "SKILL.md"), "utf8")).toBe(old);
      expect(warnings).toEqual([]);
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  });
});
