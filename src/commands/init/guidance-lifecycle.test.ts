import { describe, expect, it } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileSystemServiceImpl } from "../../services/filesystem-service.js";
import { createMockExecService } from "../../services/test-helpers.js";
import type { ManagedBlockSetup, SkillSetup } from "./agent-definitions.js";
import { GITHITS_SKILL_CATALOG, getSkillFilePaths } from "./guidance-assets.js";
import {
  executeManagedBlockSetup,
  executeManagedBlockUninstall,
  executeSkillSetup,
  executeSkillUninstall,
  isSetupAlreadyConfigured,
} from "./setup-handlers.js";

describe("direct guidance lifecycle", () => {
  it("catalogs every packaged skill file", async () => {
    for (const skill of GITHITS_SKILL_CATALOG) {
      const directory = join(import.meta.dir, "../../..", "skills", skill.name);
      expect(
        (await readdir(directory, { recursive: true, withFileTypes: true }))
          .filter((entry) => entry.isFile())
          .map((entry) =>
            join(entry.parentPath, entry.name)
              .slice(directory.length + 1)
              .replaceAll("\\", "/"),
          )
          .sort(),
      ).toEqual([...getSkillFilePaths(skill.name)].sort());
    }
  });

  it.each([".claude/skills", "project/.agents/skills"])(
    "installs, repairs, and removes complete skills under %s",
    async (root) => {
      const temp = await mkdtemp(join(tmpdir(), "githits-guidance-"));
      const fs = new FileSystemServiceImpl();
      try {
        for (const skill of GITHITS_SKILL_CATALOG) {
          const source = join(
            import.meta.dir,
            "../../..",
            ...skill.relativePath,
          );
          const target = join(temp, root, skill.name);
          const setup: SkillSetup = {
            method: "skill",
            skillName: skill.name,
            sourcePath: join(temp, "unavailable", "SKILL.md"),
            sourcePathCandidates: [source],
            targetPath: join(target, "SKILL.md"),
          };
          expect((await executeSkillSetup(setup, fs)).status).toBe("success");
          for (const reference of skill.references) {
            expect(await fs.readFile(join(target, reference))).toBe(
              await fs.readFile(join(fs.getDirname(source), reference)),
            );
            for (const state of ["missing", "stale"]) {
              if (state === "missing")
                await fs.deleteFile(join(target, reference));
              else
                await fs.writeFile(join(target, reference), "stale reference");
              expect(
                await isSetupAlreadyConfigured(
                  setup,
                  fs,
                  createMockExecService(),
                ),
              ).toBe(false);
              expect((await executeSkillSetup(setup, fs)).status).toBe(
                "success",
              );
              expect(await fs.readFile(join(target, reference))).toBe(
                await fs.readFile(join(fs.getDirname(source), reference)),
              );
            }
          }
          expect(
            await isSetupAlreadyConfigured(setup, fs, createMockExecService()),
          ).toBe(true);
          expect((await executeSkillSetup(setup, fs)).status).toBe(
            "already_configured",
          );
          expect((await executeSkillUninstall(setup, fs)).status).toBe(
            "removed",
          );
          expect(await fs.exists(target)).toBe(false);

          if (skill.references.length > 0) {
            await executeSkillSetup(setup, fs);
            await fs.writeFile(
              join(target, "references", "user.md"),
              "Keep me\n",
            );
            await fs.deleteFile(setup.targetPath);
            expect((await executeSkillUninstall(setup, fs)).status).toBe(
              "removed",
            );
            expect(
              await fs.readFile(join(target, "references", "user.md")),
            ).toBe("Keep me\n");
            for (const reference of skill.references)
              expect(await fs.exists(join(target, reference))).toBe(false);
          }
          expect((await executeSkillUninstall(setup, fs)).status).toBe(
            "not_configured",
          );
        }
      } finally {
        await rm(temp, { recursive: true, force: true });
      }
    },
  );

  it.each([
    { existing: "", header: undefined, remaining: null },
    { existing: " \n", header: undefined, remaining: null },
    { existing: "", header: '---\napplyTo: "**"\n---', remaining: null },
    {
      existing: "User instructions\n",
      header: undefined,
      remaining: "User instructions\n",
    },
  ])(
    "removes empty instruction files and preserves user content: %j",
    async ({ existing, header, remaining }) => {
      const temp = await mkdtemp(join(tmpdir(), "githits-instructions-"));
      const fs = new FileSystemServiceImpl();
      const setup: ManagedBlockSetup = {
        method: "managed-block",
        targetPath: join(temp, "CLAUDE.md"),
        marker: "<!-- githits -->",
        blockContent: "Use GitHits first.",
        fileHeader: header,
      };
      try {
        await fs.writeFile(setup.targetPath, existing);
        expect((await executeManagedBlockSetup(setup, fs)).status).toBe(
          "success",
        );
        expect((await executeManagedBlockUninstall(setup, fs)).status).toBe(
          "removed",
        );
        if (remaining === null)
          expect(await fs.exists(setup.targetPath)).toBe(false);
        else expect(await fs.readFile(setup.targetPath)).toBe(remaining);
        expect((await executeManagedBlockUninstall(setup, fs)).status).toBe(
          "not_configured",
        );
      } finally {
        await rm(temp, { recursive: true, force: true });
      }
    },
  );
});

it("preserves an instruction symlink through install and empty-target uninstall", async () => {
  const { symlink, lstat } = await import("node:fs/promises");
  const temp = await mkdtemp(join(tmpdir(), "githits-linked-instructions-"));
  const fs = new FileSystemServiceImpl();
  const target = join(temp, "dotfile.md");
  const link = join(temp, "AGENTS.md");
  const setup: ManagedBlockSetup = {
    method: "managed-block",
    targetPath: link,
    marker: "<!-- githits -->",
    blockContent: "Use GitHits first.",
  };
  try {
    for (const initial of ["User instructions\n", ""]) {
      await fs.writeFile(target, initial);
      if (!(await fs.exists(link))) await symlink(target, link, "file");
      expect((await executeManagedBlockSetup(setup, fs)).status).toBe(
        "success",
      );
      expect((await lstat(link)).isSymbolicLink()).toBe(true);
      expect(await fs.readFile(target)).toContain("Use GitHits first.");
      expect((await executeManagedBlockUninstall(setup, fs)).status).toBe(
        "removed",
      );
      expect((await lstat(link)).isSymbolicLink()).toBe(true);
      expect((await fs.readFile(target)).trim()).toBe(initial.trim());
    }
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
