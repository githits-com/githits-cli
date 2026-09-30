import { describe, expect, it } from "bun:test";
import { buildMcpQuickStart, type McpToolServices } from "@githits/mcp";
import { getMcpToolDefinitions } from "@githits/mcp/internal";
import { EXTERNAL_CONTENT_POSTURE } from "../../packages/mcp/src/tools/guardrails.js";
import {
  createMockCodeNavigationService,
  createMockGitHitsService,
  createMockListService,
  createMockPackageIntelligenceService,
  createMockReadService,
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
    ...overrides,
  };
}

const KNOWN_TOOLS = [
  "search",
  "get_example",
  "search_status",
  "list",
  "read",
  "code_grep",
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
      "Choose the route below, then discover the tool and read its arguments",
    );
    expect(instructions).toContain(
      "Find a known literal or regex in a public repository/package | `code_grep`",
    );
    expect(instructions).toContain(
      "Browse files or documentation pages in a known package, repository, or site | `list`",
    );
    expect(instructions).not.toContain("`code_files`");
    expect(instructions).not.toContain("`docs_list`");
    expect(instructions).toContain(
      "Compare current and target dependency versions for an upgrade | `pkg_upgrade_review`",
    );
    expect(instructions).toContain(
      "selected tools own call syntax and exceptions",
    );
  });

  it("preserves output, scope, provenance and evidence limits", () => {
    const instructions = buildMcpQuickStart();
    expect(instructions).toContain(
      "model-read summaries, comparisons, and follow-ups use text",
    );
    expect(instructions).toContain("Omit `format`");
    expect(instructions).toContain(
      "JSON is only for code consuming the raw response or required fields absent",
    );
    expect(instructions).toContain(
      "Public OSS only; never send local/private/proprietary source",
    );
    expect(instructions).toContain("Never infer a provider");
    expect(instructions).toMatch(
      /Cite\s+tool-owned\s+provenance, including example source repositories/,
    );
    expect(instructions).toMatch(
      /report\s+coverage,\s+truncation, and other evidence limits/,
    );
    expect(instructions).toMatch(/never invent\s+them/);
    expect(instructions).toContain("read focused lines");
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
      "Read a source file, code symbol, or documentation section | `read`",
    );
    expect(instructions).not.toContain("`code_read`");
    expect(instructions).not.toContain("`docs_read`");
    expect(instructions).toContain("never probe\ndirectories with `read`");
    expect(instructions).toContain("pass it as\n`selector` to `read`");
    expect(instructions).toContain(
      "Reuse returned targets, paths, locators, references, and ranges",
    );
    expect(instructions).toMatch(
      /For hosted package docs, search the package with\s+`source:"docs"`, then pass the explicit `site:` target from a `\[docs page\]`\s+search header to `list`/,
    );
    expect(instructions).toContain(
      "`list` is for a known target when you need its structure or an exact path",
    );
    expect(instructions).not.toContain("`code_files`");
    expect(instructions).not.toContain("`docs_list`");
    expect(instructions).toContain(
      "returned HTTP(S) page target unchanged to `read`",
    );
    expect(instructions).toContain(
      "its `followUp` unchanged, including supplied `selector` and bounds",
    );
    expect(instructions).toContain(
      "A `site:` read requires a\nseparate exact page `path`",
    );
    expect(instructions).toContain(
      "Hosted/crawled HTTP(S) docs locators address mutable current content",
    );
    expect(instructions).toContain(
      "Repository docs are snapshot-addressed and keep returned ranges",
    );
    const reader = getMcpToolDefinitions(createTestServices()).find(
      (tool) => tool.name === "read",
    );
    expect(reader?.description).toContain(
      "A docs URL fragment needs no bounds",
    );
    expect(reader?.description).toContain("page-relative range");
    expect(reader?.schema.wait_timeout_ms?.description).toContain(
      "backend applies it when relevant",
    );
  });

  it("retains comparative examples and selected-tool language recovery", () => {
    const instructions = buildMcpQuickStart();
    expect(instructions).toContain(
      "Find canonical implementation examples across projects | `get_example`",
    );
    const example = getMcpToolDefinitions(createTestServices()).find(
      (tool) => tool.name === "get_example",
    );
    expect(example?.schema.language?.description).toContain(
      "suggested language from the error",
    );
    expect(instructions).not.toContain("`search_language`");
    expect(instructions).toContain(
      "For comparisons, combine relevant package/source evidence with examples as needed",
    );
  });

  it("keeps mentioned package/code tools aligned with registration", () => {
    const services = createTestServices();
    const mentioned = mentionedTools(buildMcpQuickStart());
    const registered = registeredTools(services);

    expect(registered.size).toBe(12);
    expect(mentioned).toEqual(new Set(KNOWN_TOOLS));
    for (const name of mentioned) {
      expect(registered.has(name)).toBe(true);
    }

    const packageAndCodeTools = [
      "search",
      "search_status",
      "list",
      "read",
      "code_grep",
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
    expect(descriptions.get("code_grep")).toStartWith(
      "Find text, regex, or identifier matches in a public repo or package",
    );
    expect(descriptions.get("pkg_vulns")).toStartWith(
      "Check current package advisories. Do not trust your memory for vulnerabilities.",
    );
  });
});
