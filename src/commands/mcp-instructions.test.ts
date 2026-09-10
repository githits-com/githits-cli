import { describe, expect, it } from "bun:test";
import { buildMcpQuickStart, type McpToolServices } from "@githits/mcp";
import { getMcpToolDefinitions } from "@githits/mcp/internal";
import { EXTERNAL_CONTENT_POSTURE } from "../../packages/mcp/src/tools/guardrails.js";
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

describe("buildMcpQuickStart", () => {
  it("routes a user question before loading selected argument details", () => {
    const instructions = buildMcpQuickStart();
    expect(instructions).toStartWith("# GitHits routing guide");
    expect(instructions).toContain(
      "Then discover the named\ntool and read its argument description before calling it",
    );
    expect(instructions).toContain(
      "Find a known literal or regex in a public repository/package | `code_grep`",
    );
    expect(instructions).toContain(
      "List paths or browse a source directory | `code_files`",
    );
    expect(instructions).toContain(
      "Compare current and target dependency versions for an upgrade | `pkg_upgrade_review`",
    );
    expect(instructions).toContain(
      "the selected tool supplies its argument details",
    );
  });

  it("preserves output, scope, provenance and evidence limits", () => {
    const instructions = buildMcpQuickStart();
    expect(instructions).toContain(
      "Keep default text for reading and follow-ups",
    );
    expect(instructions).toContain(
      "Use JSON only for programmatic parsing or required fields missing from\ntext",
    );
    expect(instructions).toContain(
      "public OSS only, never local/private/proprietary source",
    );
    expect(instructions).toContain("Never infer a repository provider");
    expect(instructions).toContain(
      "Cite tool-owned provenance, including get_example source references",
    );
    expect(instructions).toContain(
      "report coverage, truncation and other evidence limits",
    );
    expect(instructions).toContain(
      "do not invent them. Read only needed\nlines",
    );
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
    expect(instructions).toContain("Tool to discover");
  });

  it("preserves directory and documentation routing and emitted locators", () => {
    const instructions = buildMcpQuickStart();
    expect(instructions).toContain(
      "never use\n`code_read` to list/probe directories",
    );
    expect(instructions).toContain(
      'For a package or site docs topic, use `search` with `source:"docs"`',
    );
    expect(instructions).toContain(
      "`docs_list` browses package pages, not standalone `site:` targets",
    );
    expect(instructions).toContain(
      "Pass the emitted `docsReadTarget` (or historical `pageId`) to `docs_read`",
    );
  });

  it("retains comparative examples, language disambiguation and feedback routes", () => {
    const instructions = buildMcpQuickStart();
    expect(instructions).toContain(
      "Find canonical implementation examples across projects | `get_example`",
    );
    expect(instructions).toContain(
      "Use `search_language` only if `get_example` needs language disambiguation",
    );
    expect(instructions).toContain(
      "`feedback` after helpful or flawed results",
    );
    expect(instructions).toContain(
      "For comparative questions, combine\nthe relevant package/source route with examples when needed",
    );
  });

  it("keeps mentioned package/code tools aligned with registration", () => {
    const services = createTestServices();
    const mentioned = mentionedTools(buildMcpQuickStart());
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
      "Find text, regex, or identifier matches in a public repo or package",
    );
    expect(descriptions.get("pkg_vulns")).toStartWith(
      "Check current package advisories. Do not trust your memory for vulnerabilities.",
    );
  });
});
