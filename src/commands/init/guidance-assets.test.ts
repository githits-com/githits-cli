import { describe, expect, it, mock } from "bun:test";
import { fileURLToPath } from "node:url";
import { createMockFileSystemService } from "../../services/test-helpers.js";
import type { SkillSetup } from "./agent-definitions.js";
import {
  GITHITS_MCP_SKILL_NAME,
  GITHITS_SKILL_CATALOG,
  GITHITS_SKILL_SOURCE_PATHS,
  GUIDANCE_SKILL_TARGETS,
  HISTORICAL_GUIDANCE_SKILL_TARGETS,
  readSkillSourceContent,
} from "./guidance-assets.js";

function uniqueRoots(
  targets: typeof GUIDANCE_SKILL_TARGETS,
  scope: "user" | "project",
): string[] {
  return [
    ...new Set(
      Object.values(targets).flatMap((target) =>
        (target[scope] ?? []).map((root) => root.join("/")),
      ),
    ),
  ].sort();
}

describe("guidance assets", () => {
  it("retains the unique active user and project skill roots", () => {
    expect(uniqueRoots(GUIDANCE_SKILL_TARGETS, "user")).toEqual([
      ".agents/skills",
      ".claude/skills",
      ".factory/skills",
      ".gemini/config/skills",
      ".hermes/skills",
      ".kiro/skills",
    ]);
    expect(uniqueRoots(GUIDANCE_SKILL_TARGETS, "project")).toEqual([
      ".agents/skills",
      ".claude/skills",
      ".factory/skills",
      ".kiro/skills",
    ]);
  });

  it("keeps Cline and Junie in separate historical skill roots", () => {
    expect(uniqueRoots(HISTORICAL_GUIDANCE_SKILL_TARGETS, "user")).toEqual([
      ".cline/skills",
      ".junie/skills",
    ]);
    expect(uniqueRoots(HISTORICAL_GUIDANCE_SKILL_TARGETS, "project")).toEqual([
      ".cline/skills",
      ".junie/skills",
    ]);
    expect(uniqueRoots(GUIDANCE_SKILL_TARGETS, "user")).not.toContain(
      ".cline/skills",
    );
    expect(uniqueRoots(GUIDANCE_SKILL_TARGETS, "user")).not.toContain(
      ".junie/skills",
    );
  });

  it("retains the canonical skill source and bundled candidate offsets", () => {
    const skill = GITHITS_SKILL_CATALOG.find(
      (candidate) => candidate.name === GITHITS_MCP_SKILL_NAME,
    );
    expect(skill?.relativePath).toEqual(["skills", "githits-mcp", "SKILL.md"]);
    expect(GITHITS_SKILL_SOURCE_PATHS[GITHITS_MCP_SKILL_NAME]).toEqual({
      sourcePath: fileURLToPath(
        new URL("../../../skills/githits-mcp/SKILL.md", import.meta.url),
      ),
      sourcePathCandidates: [
        fileURLToPath(
          new URL("../skills/githits-mcp/SKILL.md", import.meta.url),
        ),
        fileURLToPath(
          new URL("../../skills/githits-mcp/SKILL.md", import.meta.url),
        ),
      ],
    });
  });

  it("falls through unique source candidates and preserves exact bytes", async () => {
    const sourcePath = "/package/skills/githits-mcp/SKILL.md";
    const fallbackPath = "/bundled/skills/githits-mcp/SKILL.md";
    const exactContents = "\uFEFF---\r\nname: githits-mcp\r\n---\r\nbody\r\n";
    const setup: SkillSetup = {
      method: "skill",
      skillName: GITHITS_MCP_SKILL_NAME,
      sourcePath,
      sourcePathCandidates: [
        sourcePath,
        fallbackPath,
        fallbackPath,
        "/unused/skills/githits-mcp/SKILL.md",
      ],
      targetPath: "/tmp/skills/githits-mcp/SKILL.md",
    };
    const readFile = mock(async (path: string): Promise<string> => {
      if (path === sourcePath) throw new Error("source unavailable");
      if (path === fallbackPath) return exactContents;
      throw new Error("unexpected source path");
    });
    const fs = createMockFileSystemService({ readFile });

    await expect(readSkillSourceContent(setup, fs)).resolves.toBe(
      exactContents,
    );
    expect(readFile.mock.calls.map(([path]) => path)).toEqual([
      sourcePath,
      fallbackPath,
    ]);
  });
});
