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
});
