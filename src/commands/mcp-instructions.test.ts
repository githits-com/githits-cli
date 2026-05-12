import { describe, expect, it } from "bun:test";
import type { Dependencies } from "../container.js";
import {
  createMockAuthService,
  createMockAuthStorage,
  createMockBrowserService,
  createMockCodeNavigationService,
  createMockFileSystemService,
  createMockGitHitsService,
  createMockPackageIntelligenceService,
} from "../services/test-helpers.js";
import { getMcpToolDefinitions } from "./mcp.js";
import { buildMcpInstructions } from "./mcp-instructions.js";

function createTestDeps(overrides: Partial<Dependencies> = {}): Dependencies {
  return {
    authStorage: createMockAuthStorage(),
    authService: createMockAuthService(),
    browserService: createMockBrowserService(),
    fileSystemService: createMockFileSystemService(),
    mcpUrl: "https://mcp.githits.com",
    apiUrl: "https://api.githits.com",
    apiToken: "test-token",
    hasValidToken: true,
    envApiToken: undefined,
    codeNavigationUrl: "https://pkgseer.dev",
    codeNavigationService: createMockCodeNavigationService(),
    packageIntelligenceService: createMockPackageIntelligenceService(),
    githitsService: createMockGitHitsService(),
    ...overrides,
  };
}

const KNOWN_TOOLS = [
  "search",
  "get_example",
  "search_language",
  "feedback",
  "search_status",
  "code_files",
  "code_read",
  "code_grep",
  "docs_list",
  "docs_read",
  "pkg_info",
  "pkg_vulns",
  "pkg_deps",
  "pkg_changelog",
] as const;

function mentionedTools(instructions: string): Set<string> {
  const mentioned = new Set<string>();
  for (const name of KNOWN_TOOLS) {
    if (instructions.includes(`\`${name}\``)) {
      mentioned.add(name);
    }
  }
  return mentioned;
}

function registeredTools(deps: Dependencies): Set<string> {
  return new Set(getMcpToolDefinitions(deps).map((tool) => tool.name));
}

describe("buildMcpInstructions", () => {
  it("returns core + package/code tools section by default", () => {
    const deps = createTestDeps();
    const instructions = buildMcpInstructions(deps);

    expect(instructions).toContain("GitHits provides verified");
    expect(instructions).toContain("Indexed package/source tools");
    expect(instructions).toContain("`pkg_info`");
    expect(instructions).toContain("`docs_list`");
    expect(instructions).toContain("`docs_read`");
    expect(instructions).toContain("`pkg_vulns`");
    expect(instructions).toContain("`pkg_deps`");
    expect(instructions).toContain("`pkg_changelog`");
    expect(instructions).toContain("`search`");
    expect(instructions).toContain("`search_status`");
    expect(instructions).toContain("reference-first");
    expect(instructions).toContain("Delegate multi-call work to a sub-agent");
  });

  it("includes the external-content posture by default", () => {
    const deps = createTestDeps();
    const instructions = buildMcpInstructions(deps);

    expect(instructions).toContain("External-content posture");
  });

  it("omits the external-content posture when explicitly opted out", () => {
    // The eval mock MCP server opts out so it can control whether the
    // shared block is included per cell, comparing baseline vs
    // guardrailed cohorts cleanly. Production never opts out.
    const deps = createTestDeps();
    const instructions = buildMcpInstructions(deps, {
      includeExternalContentPosture: false,
    });

    expect(instructions).not.toContain("External-content posture");
    // Still has the core block and package section.
    expect(instructions).toContain("GitHits provides verified");
    expect(instructions).toContain("Indexed package/source tools");
  });

  it("steers file enumeration to code_files instead of directory probes", () => {
    const deps = createTestDeps();
    const instructions = buildMcpInstructions(deps);

    expect(instructions).toContain(
      "First choice for file-listing/path-enumeration tasks",
    );
    expect(instructions).toContain(
      "do not use `code_read` to probe directories",
    );
    expect(instructions).toContain(
      "never test directory paths with `code_read`",
    );
    expect(instructions).toContain('path_prefix: "lib/"');
  });

  it("expands core trigger criteria to cover comparative cross-OSS questions", () => {
    const deps = createTestDeps();
    const instructions = buildMcpInstructions(deps);
    expect(instructions).toContain("comparative across OSS projects");
    expect(instructions).toContain("how a real codebase implements");
  });

  it("keeps the core block first", () => {
    const deps = createTestDeps();
    const instructions = buildMcpInstructions(deps);

    const coreIdx = instructions.indexOf("GitHits provides verified");
    const packageToolsIdx = instructions.indexOf(
      "Indexed package/source tools",
    );
    expect(coreIdx).toBeGreaterThanOrEqual(0);
    expect(packageToolsIdx).toBeGreaterThan(coreIdx);
  });

  it("keeps mentioned package/code tools aligned with registration", () => {
    const deps = createTestDeps();
    const mentioned = mentionedTools(buildMcpInstructions(deps));
    const registered = registeredTools(deps);

    for (const name of mentioned) {
      expect(registered.has(name)).toBe(true);
    }

    const packageAndCodeTools = [
      "search",
      "search_status",
      "code_files",
      "code_read",
      "code_grep",
      "docs_list",
      "docs_read",
      "pkg_info",
      "pkg_vulns",
      "pkg_deps",
      "pkg_changelog",
    ];
    for (const name of packageAndCodeTools) {
      expect(registered.has(name)).toBe(true);
      expect(mentioned.has(name)).toBe(true);
    }
  });

  it("ships a decision tree mentioning all three workflow tools in the core block", () => {
    const deps = createTestDeps();
    const instructions = buildMcpInstructions(deps);
    const coreEnd = instructions.indexOf("Indexed package/source tools");
    const coreSection = instructions.slice(0, coreEnd);

    expect(coreSection).toContain("`get_example`");
    expect(coreSection).toContain("`search`");
    expect(coreSection).toContain("`feedback`");
    expect(coreSection).toContain("`search_language`");
  });

  it("orders package-section bullets by agent decision flow", () => {
    const deps = createTestDeps();
    const instructions = buildMcpInstructions(deps);

    const positions = {
      search: instructions.indexOf("- `search` —"),
      searchStatus: instructions.indexOf("- `search_status`"),
      codeGrep: instructions.indexOf("- `code_grep`"),
      codeRead: instructions.indexOf("- `code_read`"),
      codeFiles: instructions.indexOf("- `code_files`"),
      docsList: instructions.indexOf("- `docs_list`"),
      docsRead: instructions.indexOf("- `docs_read`"),
      pkgInfo: instructions.indexOf("- `pkg_info`"),
      pkgVulns: instructions.indexOf("- `pkg_vulns`"),
      pkgDeps: instructions.indexOf("- `pkg_deps`"),
      pkgChangelog: instructions.indexOf("- `pkg_changelog`"),
    };

    for (const [name, idx] of Object.entries(positions)) {
      expect(idx).toBeGreaterThan(-1);
      expect(`${name}=${idx}`).not.toContain("=-1");
    }

    // Discovery first, then file/path enumeration, then code grep/read,
    // docs, then package metadata.
    expect(positions.search).toBeLessThan(positions.searchStatus);
    expect(positions.searchStatus).toBeLessThan(positions.codeFiles);
    expect(positions.codeFiles).toBeLessThan(positions.codeGrep);
    expect(positions.codeGrep).toBeLessThan(positions.codeRead);
    expect(positions.codeRead).toBeLessThan(positions.docsList);
    expect(positions.docsList).toBeLessThan(positions.docsRead);
    expect(positions.docsRead).toBeLessThan(positions.pkgInfo);
    expect(positions.pkgInfo).toBeLessThan(positions.pkgVulns);
    expect(positions.pkgVulns).toBeLessThan(positions.pkgDeps);
    expect(positions.pkgDeps).toBeLessThan(positions.pkgChangelog);
  });

  it("places the strategy tip after the bullets and the delegation tip before them", () => {
    const deps = createTestDeps();
    const instructions = buildMcpInstructions(deps);

    const delegationIdx = instructions.indexOf(
      "Delegate multi-call work to a sub-agent",
    );
    const firstBulletIdx = instructions.indexOf("- `search` —");
    const lastBulletIdx = instructions.indexOf("- `pkg_changelog`");
    const strategyIdx = instructions.indexOf("Strategy — reference-first");

    expect(delegationIdx).toBeLessThan(firstBulletIdx);
    expect(strategyIdx).toBeGreaterThan(lastBulletIdx);
  });
});
