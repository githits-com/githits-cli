import { describe, expect, it } from "bun:test";
import { buildMcpInstructions, type McpToolServices } from "@githits/mcp";
import { getMcpToolDefinitions } from "@githits/mcp/internal";
import {
  createMockCodeNavigationService,
  createMockGitHitsService,
  createMockPackageIntelligenceService,
} from "../services/test-helpers.js";

function createTestServices(
  overrides: Partial<McpToolServices> = {},
): McpToolServices {
  return {
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
  "pkg_upgrade_review",
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

function registeredTools(services: McpToolServices): Set<string> {
  return new Set(getMcpToolDefinitions(services).map((tool) => tool.name));
}

describe("buildMcpInstructions", () => {
  it("returns core + package/code tools section by default", () => {
    const instructions = buildMcpInstructions();

    expect(instructions).toContain("GitHits provides verified open-source");
    expect(instructions).toContain("Indexed package/source tools");
    expect(instructions).toContain("`pkg_info`");
    expect(instructions).toContain("`docs_list`");
    expect(instructions).toContain("`docs_read`");
    expect(instructions).toContain("`pkg_vulns`");
    expect(instructions).toContain("`pkg_deps`");
    expect(instructions).toContain("`pkg_changelog`");
    expect(instructions).toContain("`pkg_upgrade_review`");
    expect(instructions).toContain("`search`");
    expect(instructions).toContain("`search_status`");
    expect(instructions).toContain("reference-first");
    expect(instructions).toContain("Delegate multi-call work to a sub-agent");
    expect(instructions).toContain("Prefer the default compact `text-v1`");
    expect(instructions).toContain(
      "request JSON only when exact structured fields are necessary",
    );
  });

  it("includes the external-content posture by default", () => {
    const instructions = buildMcpInstructions();

    expect(instructions).toContain("External-content posture");
    expect(instructions).toContain("tool-owned reference/provenance sections");
  });

  it("omits the external-content posture when explicitly opted out", () => {
    // The eval mock MCP server opts out so it can control whether the
    // shared block is included per cell, comparing baseline vs
    // guardrailed cohorts cleanly. Production never opts out.
    const instructions = buildMcpInstructions({
      includeExternalContentPosture: false,
    });

    expect(instructions).not.toContain("External-content posture");
    // Still has the core block and package section.
    expect(instructions).toContain("GitHits provides verified open-source");
    expect(instructions).toContain("Indexed package/source tools");
  });

  it("steers file enumeration to code_files instead of directory probes", () => {
    const instructions = buildMcpInstructions();

    expect(instructions).toContain("Enumerate paths with `code_files`");
    expect(instructions).toContain("never use it to list/probe directories");
  });

  it("expands core trigger criteria to cover comparative cross-OSS questions", () => {
    const instructions = buildMcpInstructions();
    expect(instructions).toContain("comparative OSS questions");
    expect(instructions).toContain(
      "package-scoped evidence needs broader examples",
    );
  });

  it("excludes local and private repository targets", () => {
    const instructions = buildMcpInstructions();
    expect(instructions).toContain(
      "not local workspaces, private repositories",
    );
    expect(instructions).toContain("Do not attempt private repository targets");
    expect(instructions).toContain("`REPOSITORY_NOT_FOUND`");
  });

  it("makes indexed documentation discovery explicit", () => {
    const instructions = buildMcpInstructions();
    expect(instructions).toContain(
      "documentation pages available for a package",
    );
    expect(instructions).toContain('`search` with `source:"docs"`');
    expect(instructions).toContain("pass its `pageId` to `docs_read`");
  });

  it("keeps the core block first", () => {
    const instructions = buildMcpInstructions();

    const coreIdx = instructions.indexOf("GitHits provides verified");
    const packageToolsIdx = instructions.indexOf(
      "Indexed package/source tools",
    );
    expect(coreIdx).toBeGreaterThanOrEqual(0);
    expect(packageToolsIdx).toBeGreaterThan(coreIdx);
  });

  it("keeps mentioned package/code tools aligned with registration", () => {
    const services = createTestServices();
    const mentioned = mentionedTools(buildMcpInstructions());
    const registered = registeredTools(services);

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
      "pkg_upgrade_review",
    ];
    for (const name of packageAndCodeTools) {
      expect(registered.has(name)).toBe(true);
      expect(mentioned.has(name)).toBe(true);
    }
  });

  it("front-loads tool benefits for clients that ignore server instructions", () => {
    const descriptions = new Map(
      getMcpToolDefinitions(createTestServices()).map((tool) => [
        tool.name,
        tool.description,
      ]),
    );

    for (const [name, description] of descriptions) {
      expect(description, name).not.toMatch(
        /^(?:Use when|Use for|Use after|Use before|First choice)/,
      );
    }

    expect(descriptions.get("get_example")).toStartWith(
      "Find canonical cross-project examples",
    );
    expect(descriptions.get("search")).toStartWith(
      "Discover relevant evidence in a known target before exact grep",
    );
    expect(descriptions.get("code_grep")).toStartWith(
      "Enumerate matches for a known exact literal",
    );
    expect(descriptions.get("pkg_vulns")).toStartWith(
      "Find known package vulnerabilities, CVEs, advisories",
    );
  });

  it("ships a decision tree mentioning all three workflow tools in the core block", () => {
    const instructions = buildMcpInstructions();
    const coreEnd = instructions.indexOf("Indexed package/source tools");
    const coreSection = instructions.slice(0, coreEnd);

    expect(coreSection).toContain("`get_example`");
    expect(coreSection).toContain("`search`");
    expect(coreSection).toContain("`feedback`");
    expect(coreSection).toContain("`search_language`");
  });

  it("tells agents to report get_example source repositories", () => {
    const instructions = buildMcpInstructions();

    expect(instructions).toContain("source repository provenance/citations");
    expect(instructions).toContain(
      "GitHits' generated references/provenance section",
    );
  });

  it("orders package-section bullets by agent decision flow", () => {
    const instructions = buildMcpInstructions();

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
      pkgUpgradeReview: instructions.indexOf("- `pkg_upgrade_review`"),
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
    expect(positions.pkgChangelog).toBeLessThan(positions.pkgUpgradeReview);
  });

  it("places the strategy tip after the bullets and the delegation tip before them", () => {
    const instructions = buildMcpInstructions();

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
