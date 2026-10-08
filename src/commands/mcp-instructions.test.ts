import { describe, expect, it } from "bun:test";
import { buildMcpQuickStart, type McpToolServices } from "@githits/mcp";
import { getMcpToolDefinitions } from "@githits/mcp/internal";
import { EXTERNAL_CONTENT_POSTURE } from "../../packages/mcp/src/tools/guardrails.js";
import {
  createMockCodeNavigationService,
  createMockGitHitsService,
  createMockGrepService,
  createMockListService,
  createMockPackageIntelligenceService,
  createMockReadService,
  createMockResolveTargetService,
} from "../services/test-helpers.js";

function createTestServices(
  overrides: Partial<McpToolServices> = {},
): McpToolServices {
  return {
    codeNavigationService: createMockCodeNavigationService(),
    packageIntelligenceService: createMockPackageIntelligenceService(),
    githitsService: createMockGitHitsService(),
    listService: createMockListService(),
    readService: createMockReadService(),
    grepService: createMockGrepService(),
    resolveTargetService: createMockResolveTargetService(),
    ...overrides,
  };
}

const KNOWN_TOOLS = [
  "search",
  "get_example",
  "search_status",
  "list",
  "read",
  "grep",
  "resolve_target",
  "code_diff",
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

describe("buildMcpQuickStart", () => {
  it("routes every evidence tool from one question row", () => {
    const instructions = buildMcpQuickStart();
    expect(instructions).toStartWith("# GitHits\n");
    for (const name of KNOWN_TOOLS) {
      expect(instructions).toMatch(
        new RegExp(`^\\| .+ \\| \`${name}\` \\|$`, "m"),
      );
    }
    expect(instructions).not.toContain("`code_files`");
    expect(instructions).not.toContain("`docs_list`");
    expect(instructions).not.toContain("`code_read`");
    expect(instructions).not.toContain("`docs_read`");
    expect(instructions).not.toContain("`search_language`");
  });

  it("includes the external-content posture unchanged by default", () => {
    const instructions = buildMcpQuickStart();
    expect(instructions).toEndWith(EXTERNAL_CONTENT_POSTURE);
    expect(instructions).toContain("untrusted third-party evidence");
    expect(instructions).toContain("host safeguards");
  });

  it("omits only the external-content posture for controlled guardrail evals", () => {
    const instructions = buildMcpQuickStart({
      includeExternalContentPosture: false,
    });
    expect(buildMcpQuickStart()).toBe(
      `${instructions}\n\n${EXTERNAL_CONTENT_POSTURE}`,
    );
    expect(instructions).not.toContain("External-content posture");
    expect(instructions).toContain("## Choose a tool");
  });

  it("leaves per-tool mechanics to the selected tool descriptions", () => {
    const tools = new Map(
      getMcpToolDefinitions(createTestServices()).map((tool) => [
        tool.name,
        tool,
      ]),
    );
    const description = (name: string): string =>
      tools.get(name)?.description ?? "";

    for (const phrase of [
      "EXACT or HIGH best with CLEAR or NOT_APPLICABLE",
      "CLEAR is not a vulnerability-free claim",
      "never auto-select an ambiguous result",
      "A selected `site:` is docs-only",
    ]) {
      expect(description("resolve_target")).toContain(phrase);
    }
    for (const phrase of [
      "Package targets still return repository-wide diffs",
      "default `name-status` view",
      "Raw diffs never prove compatibility or upgrade safety",
    ]) {
      expect(description("code_diff")).toContain(phrase);
    }
    expect(description("search")).toContain(
      "replay its complete emitted read action or generated `followUp` unchanged",
    );
    expect(description("list")).toContain(
      "a path without trailing `/` is a page",
    );
    expect(description("read")).toContain("It does not list directories");
    expect(description("read")).toContain(
      "A docs URL fragment needs no bounds",
    );
    expect(description("read")).toContain("page-relative range");
    expect(description("grep")).toContain("read locators");
    expect(tools.get("read")?.schema.wait_timeout_ms?.description).toContain(
      "backend applies it when relevant",
    );
    expect(tools.get("get_example")?.schema.language?.description).toContain(
      "suggested language from the error",
    );
  });

  it("keeps mentioned package/code tools aligned with registration", () => {
    const services = createTestServices();
    const mentioned = mentionedTools(buildMcpQuickStart());
    const registered = registeredTools(services);

    expect(registered.size).toBe(14);
    expect(mentioned).toEqual(new Set(KNOWN_TOOLS));
    for (const name of mentioned) {
      expect(registered.has(name)).toBe(true);
    }

    const packageAndCodeTools = [
      "search",
      "search_status",
      "list",
      "read",
      "grep",
      "code_diff",
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
      "Discover relevant docs, code, and symbols in a known public target",
    );
    expect(descriptions.get("list")).toStartWith(
      "List files and documentation paths in a known package, repository, or site.",
    );
    expect(descriptions.get("grep")).toStartWith(
      "Find regex or literal matches across source and documentation.",
    );
    expect(descriptions.get("pkg_vulns")).toStartWith(
      "Check current package advisories. Do not trust your memory for vulnerabilities.",
    );
  });
});
