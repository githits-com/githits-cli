import { describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { detectFixtureTool, formatFixtureOutput } from "./mock-cli/githits.js";
import { writeState } from "./mock-mcp/state.js";
import { prepareSkillsFixtureWorkspace } from "./skills-workspace.js";

describe("security eval skills surface", () => {
  it("maps GitHits CLI commands to fixture tools", () => {
    expect(detectFixtureTool(["pkg", "vulns", "npm:lodash"])).toBe("pkg_vulns");
    expect(detectFixtureTool(["pkg", "changelog", "npm:express"])).toBe(
      "pkg_changelog",
    );
    expect(detectFixtureTool(["pkg", "info", "npm:express"])).toBe("pkg_info");
    expect(detectFixtureTool(["search", "router", "--in", "npm:express"])).toBe(
      "search",
    );
    expect(detectFixtureTool(["search-status", "ref-123"])).toBe(
      "search_status",
    );
    expect(detectFixtureTool(["code", "files", "npm:express"])).toBe(
      "code_files",
    );
    expect(detectFixtureTool(["code", "grep", "npm:express", "Router"])).toBe(
      "code_grep",
    );
    expect(detectFixtureTool(["code", "read", "npm:express", "index.js"])).toBe(
      "code_read",
    );
    expect(detectFixtureTool(["docs", "list", "npm:express"])).toBe(
      "docs_list",
    );
    expect(detectFixtureTool(["docs", "read", "readme"])).toBe("docs_read");
    expect(detectFixtureTool(["pkg", "deps", "npm:express"])).toBeUndefined();
  });

  it("lets discovery commands guide agents toward expected fixture tools", () => {
    expect(
      formatFixtureOutput(
        ["code", "files", "npm:@example/widget-kit"],
        "code_files",
        "code_read",
        "fixture text",
      ),
    ).toContain("src/index.ts");
    expect(
      formatFixtureOutput(
        ["docs", "list", "npm:@example/widget-kit"],
        "docs_list",
        "docs_read",
        "fixture text",
      ),
    ).toContain("githits docs read readme");
  });

  it("formats mock CLI output as JSON when requested", () => {
    expect(
      JSON.parse(
        formatFixtureOutput(
          ["pkg", "vulns", "npm:lodash", "--json"],
          "pkg_vulns",
          "pkg_vulns",
          "fixture text",
        ),
      ),
    ).toEqual({ tool: "pkg_vulns", content: "fixture text" });
  });

  it("prepares a workspace with skills and mock githits on PATH", () => {
    const workspaceDir = mkdtempSync(join(tmpdir(), "security-skills-test-"));
    const prepared = prepareSkillsFixtureWorkspace({
      repoRoot: resolve("."),
      workspaceDir,
      mockCliScriptPath: resolve("eval/mock-cli/githits.ts"),
    });

    expect(prepared.installedDirs).toContain(join(workspaceDir, "skills"));
    expect(
      existsSync(join(workspaceDir, "skills", "githits-package", "SKILL.md")),
    ).toBe(true);
    expect(readFileSync(prepared.shimPath, "utf8")).toContain(
      "eval/mock-cli/githits.ts",
    );
  });

  it("mock CLI reads the shared eval state file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "security-cli-test-"));
    const stateFile = join(dir, "state.json");
    writeState(stateFile, {
      attackId: "test",
      variantId: "plain",
      expectedTool: "pkg_vulns",
      content: "INJECTION_FIXTURE",
    });

    const proc = Bun.spawn(
      [
        "bun",
        "run",
        resolve("eval/mock-cli/githits.ts"),
        "pkg",
        "vulns",
        "npm:x",
      ],
      {
        env: { ...process.env, EVAL_MCP_STATE_FILE: stateFile },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    writeFileSync(join(dir, "stderr.txt"), stderr);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("INJECTION_FIXTURE");
  });
});
