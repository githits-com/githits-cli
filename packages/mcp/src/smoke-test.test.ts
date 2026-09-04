import { describe, expect, it } from "bun:test";
import {
  assertCleanErrorEnvelope,
  assertDefaultText,
  assertHttpUnauthorizedChallenge,
  callToolText,
  EXPECTED_MCP_TOOLS,
  type McpSmokeCaller,
  type McpSmokeToolResult,
  resultText,
  runMcpSmoke,
} from "./smoke-test.js";

function textResult(text: string): McpSmokeToolResult {
  return { content: [{ type: "text", text }] };
}

function jsonResult(payload: unknown): McpSmokeToolResult {
  return textResult(JSON.stringify(payload));
}

function errorResult(code: string, text?: string): McpSmokeToolResult {
  return {
    content: [
      {
        type: "text",
        text:
          text ??
          JSON.stringify({
            error: `${code} error`,
            code,
            retryable: false,
          }),
      },
    ],
    isError: true,
  };
}

function createCaller(callTool: McpSmokeCaller["callTool"]): McpSmokeCaller {
  return {
    listTools: async () => ({
      tools: EXPECTED_MCP_TOOLS.map((name) => ({ name })),
    }),
    callTool,
  };
}

describe("MCP smoke-test helpers", () => {
  it("extracts successful tool text and throws MCP error text", async () => {
    const successCaller = createCaller(async () => textResult("ok"));
    await expect(
      callToolText(successCaller, "search_language", {}),
    ).resolves.toBe("ok");

    const failingCaller = createCaller(async () =>
      errorResult("AUTH_REQUIRED", "auth required"),
    );
    await expect(
      callToolText(failingCaller, "search_language", {}),
    ).rejects.toThrow("auth required");
  });

  it("validates clean error envelopes", () => {
    expect(assertCleanErrorEnvelope(errorResult("NOT_FOUND"), "probe")).toEqual(
      {
        error: "NOT_FOUND error",
        code: "NOT_FOUND",
        retryable: false,
      },
    );
  });

  it("rejects default text that looks like JSON", () => {
    expect(() => assertDefaultText(textResult('{"ok":true}'), "probe")).toThrow(
      "default response unexpectedly parsed as JSON",
    );
  });

  it("validates remote HTTP bearer challenges", () => {
    expect(() =>
      assertHttpUnauthorizedChallenge({
        status: 401,
        headers: { "WWW-Authenticate": 'Bearer realm="GitHits"' },
      }),
    ).not.toThrow();

    expect(() =>
      assertHttpUnauthorizedChallenge({
        status: 401,
        headers: new Headers({ "www-authenticate": "Basic" }),
      }),
    ).toThrow("expected Bearer challenge");
  });
});

describe("runMcpSmoke", () => {
  it("can verify registration and quick_start without live evidence calls", async () => {
    const caller = createCaller(async (name) => {
      if (name === "quick_start") return smokeResponse(name, {});
      throw new Error("live evidence call should not run");
    });

    await expect(
      runMcpSmoke(caller, { includeLiveTools: false }),
    ).resolves.toBeUndefined();
  });

  it("fails registration smoke when an expected tool is missing", async () => {
    const caller = createCaller(async () => {
      throw new Error("live tool call should not run");
    });
    caller.listTools = async () => ({
      tools: EXPECTED_MCP_TOOLS.filter((name) => name !== "search_status").map(
        (name) => ({ name }),
      ),
    });

    await expect(
      runMcpSmoke(caller, { includeLiveTools: false }),
    ).rejects.toThrow("listTools missing search_status");
  });

  it("skips the live corpus when the auth probe returns AUTH_REQUIRED", async () => {
    const logs: string[] = [];
    const caller = createCaller(async (name) => {
      if (name === "quick_start") return smokeResponse(name, {});
      expect(name).toBe("search_language");
      return errorResult("AUTH_REQUIRED");
    });

    await runMcpSmoke(caller, {
      logger: { log: (message: string) => logs.push(message), error: () => {} },
    });

    expect(logs).toEqual(["AUTH_REQUIRED: live smoke skipped"]);
  });

  it("runs the shared live corpus without submitting stateful feedback", async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const logs: string[] = [];
    const caller = createCaller(async (name, args) => {
      calls.push({ name, args });
      return smokeResponse(name, args);
    });

    await runMcpSmoke(caller, {
      logger: { log: (message: string) => logs.push(message), error: () => {} },
    });

    expect(logs).toEqual(["MCP smoke passed"]);
    expect(new Set(calls.map((call) => call.name))).toEqual(
      new Set(EXPECTED_MCP_TOOLS),
    );
    expect(calls).toContainEqual({
      name: "feedback",
      args: { solution_id: "", accepted: true },
    });
    expect(calls).toContainEqual({
      name: "pkg_deps",
      args: {
        registry: "npm",
        package_name: "express",
        include_issues: true,
      },
    });
    expect(calls).toContainEqual({
      name: "pkg_deps",
      args: {
        registry: "npm",
        package_name: "express",
        include_issues: true,
        format: "json",
      },
    });
    expect(calls).toContainEqual({
      name: "pkg_vulns",
      args: {
        registry: "npm",
        package_name: "express",
        version: "4.17.1",
        include_transitive: true,
      },
    });
    expect(calls).toContainEqual({
      name: "pkg_vulns",
      args: {
        registry: "npm",
        package_name: "express",
        version: "4.17.1",
        include_transitive: true,
        format: "json",
      },
    });
  });

  it("rejects search action references outside a Next line", async () => {
    const caller = createCaller(async (name, args) => {
      if (name === "search" && args.format !== "json") {
        return textResult(
          'No result snapshot yet | indexing | 0/1 ready\nNext: search_status search_ref="smoke-ref" wait_timeout_ms=20000\nsearch_ref=leaked',
        );
      }
      return smokeResponse(name, args);
    });

    await expect(runMcpSmoke(caller)).rejects.toThrow(
      "search default: search_ref= must appear at most once",
    );
  });

  it.each([
    ["status: indexing", "duplicated lifecycle status line"],
    ["searchRef=leaked", "leaked searchRef="],
    ["indexingRef=leaked", "leaked indexingRef"],
  ])(
    "rejects top-level formatter diagnostic %s",
    async (diagnostic, message) => {
      const caller = createCaller(async (name, args) => {
        if (name === "search" && args.format !== "json") {
          return textResult(`${smokeSearchText()}\n${diagnostic}`);
        }
        return smokeResponse(name, args);
      });

      await expect(runMcpSmoke(caller)).rejects.toThrow(
        `search default: ${message}`,
      );
    },
  );

  it.each([
    "Next: githits search-status smoke-ref --wait 20",
    "Next: githits code read npm:express index.js",
    "Next: githits docs read page-1 --offset 10",
  ])("rejects CLI syntax leaked into MCP search text: %s", async (action) => {
    const caller = createCaller(async (name, args) => {
      if (name === "search" && args.format !== "json") {
        return textResult(
          smokeSearchText().replace(
            'Next: search_status search_ref="smoke-ref" wait_timeout_ms=20000',
            action,
          ),
        );
      }
      return smokeResponse(name, args);
    });

    await expect(runMcpSmoke(caller)).rejects.toThrow(
      "search default: CLI command syntax leaked into MCP output",
    );
  });

  it("requires Using details to remain grouped under a target", async () => {
    const caller = createCaller(async (name, args) => {
      if (name === "search" && args.format !== "json") {
        return textResult(
          smokeSearchText().replace(
            "- npm:express@5.2.1\n  indexing: code; available: versions 5.2.1",
            "  using: 5.1.0 while 5.2.1 indexes",
          ),
        );
      }
      return smokeResponse(name, args);
    });

    await expect(runMcpSmoke(caller)).rejects.toThrow(
      "search default: readiness details must be grouped under a target",
    );
  });

  it.each([
    ["Ready:", "legacy flat section Ready:"],
    ["Waiting:", "legacy flat section Waiting:"],
    [
      "Available but not searched:",
      "legacy flat section Available but not searched:",
    ],
    ["Indexed alternatives:", "legacy flat section Indexed alternatives:"],
  ])("rejects legacy flat search section %s", async (section, message) => {
    const caller = createCaller(async (name, args) => {
      if (name === "search" && args.format !== "json") {
        return textResult(
          smokeSearchText().replace(
            "  indexing: code; available: versions 5.2.1",
            `${section} 0/1 targets`,
          ),
        );
      }
      return smokeResponse(name, args);
    });

    await expect(runMcpSmoke(caller)).rejects.toThrow(
      `search default: ${message}`,
    );
  });

  it.each([
    ["Evidence may change.", "vague evidence policy prose"],
    ["Do not repeat search.", "repeat policy prose"],
    ["Do not poll this session.", "poll policy prose"],
  ])("rejects superseded search prose %s", async (prose, message) => {
    const caller = createCaller(async (name, args) => {
      if (name === "search" && args.format !== "json") {
        return textResult(`${smokeSearchText()}\n${prose}`);
      }
      return smokeResponse(name, args);
    });

    await expect(runMcpSmoke(caller)).rejects.toThrow(
      `search default: ${message}`,
    );
  });

  it("requires readiness details to be grouped under a target", async () => {
    const caller = createCaller(async (name, args) => {
      if (name === "search" && args.format !== "json") {
        return textResult(
          smokeSearchText().replace("\n- npm:express@5.2.1", ""),
        );
      }
      return smokeResponse(name, args);
    });

    await expect(runMcpSmoke(caller)).rejects.toThrow(
      "search default: readiness details must be grouped under a target",
    );
  });

  it("requires an outcome headline before search details", async () => {
    const caller = createCaller(async (name, args) => {
      if (name === "search" && args.format !== "json") {
        return textResult(
          smokeSearchText().replace(
            "No result snapshot yet | indexing | 0/1 ready",
            "Warnings:",
          ),
        );
      }
      return smokeResponse(name, args);
    });

    await expect(runMcpSmoke(caller)).rejects.toThrow(
      "search default: missing outcome headline",
    );
  });

  it("ignores formatter-like words inside indented hit content", async () => {
    const caller = createCaller(async (name, args) => {
      if (name === "search" && args.format !== "json") {
        return textResult(
          "1 result\n\n[1] npm:express@5.2.1 index.js [repo code]\n" +
            "  Ready: payload text\n" +
            "  Waiting: payload text\n" +
            "  Available but not searched: payload text\n" +
            "  Indexed alternatives: payload text\n" +
            "  Evidence may change.\n" +
            "  Do not repeat this payload.\n" +
            "  Do not poll this payload.\n" +
            "  Next: payload text\n" +
            "  Indexing: payload text\n" +
            "  status: payload text\n" +
            "  searchRef=payload text\n" +
            "  indexingRef payload text\n" +
            "  search_ref=payload text",
        );
      }
      return smokeResponse(name, args);
    });

    await expect(runMcpSmoke(caller)).resolves.toBeUndefined();
  });

  it("keeps multiline hit-body diagnostics opaque after a blank line", async () => {
    const caller = createCaller(async (name, args) => {
      if (name === "search" && args.format !== "json") {
        return textResult(
          "1 result | 1 repo code hit\n\n[1] npm:express@5.2.1 index.js [repo code]\n" +
            "  First summary paragraph.\n\n" +
            "  status: payload text\n" +
            "  searchRef=payload text\n" +
            "  indexingRef payload text\n" +
            "  search_ref=payload text",
        );
      }
      return smokeResponse(name, args);
    });

    await expect(runMcpSmoke(caller)).resolves.toBeUndefined();
  });

  it("allows completed hit text without a target group", async () => {
    const caller = createCaller(async (name, args) => {
      if (name === "search" && args.format !== "json") {
        return textResult(
          "1 result\n\n[1] npm:express@5.2.1 index.js [repo code]",
        );
      }
      return smokeResponse(name, args);
    });

    await expect(runMcpSmoke(caller)).resolves.toBeUndefined();
  });

  it("allows completed documentation hit text without a target group", async () => {
    const caller = createCaller(async (name, args) => {
      if (name === "search" && args.format !== "json") {
        return textResult(
          "1 result\n\n[1] page-1 [docs page] npm:express - docs.example.com/readme - README | API - section",
        );
      }
      return smokeResponse(name, args);
    });

    await expect(runMcpSmoke(caller)).resolves.toBeUndefined();
  });

  it("allows documentation hits that disclose a missing source URL", async () => {
    const caller = createCaller(async (name, args) => {
      if (name === "search" && args.format !== "json") {
        return textResult(
          "1 result | 1 docs page\n\n[1] page-1 [docs page] npm:express - source URL unavailable - README",
        );
      }
      return smokeResponse(name, args);
    });

    await expect(runMcpSmoke(caller)).resolves.toBeUndefined();
  });

  it("allows wrapped documentation and repository title tails", async () => {
    const caller = createCaller(async (name, args) => {
      if (name === "search" && args.format !== "json") {
        return textResult(
          "2 results | 1 repo code hit, 1 docs page\n\n" +
            "[1] page-1 [docs page] npm:express - docs.example.com/readme -\n" +
            "  A long documentation title\n\n" +
            "[2] npm:express@5.2.1 lib/application.js [repo code] -\n" +
            "  A long repository title",
        );
      }
      return smokeResponse(name, args);
    });

    await expect(runMcpSmoke(caller)).resolves.toBeUndefined();
  });

  it("allows a wrapped repository title without a documentation hit", async () => {
    const caller = createCaller(async (name, args) => {
      if (name === "search" && args.format !== "json") {
        return textResult(
          "1 result | 1 repo code hit\n\n" +
            "[1] npm:express@5.2.1 lib/application.js [repo code] -\n" +
            "  A long repository title",
        );
      }
      return smokeResponse(name, args);
    });

    await expect(runMcpSmoke(caller)).resolves.toBeUndefined();
  });

  it.each([
    [
      "focused evidence",
      "1 result | 1 repo code hit\n\n" +
        "[1] github:owner/repo#abc123 packages/pkg/src/compact.ts:920-930 [repo code] - compact (function at lines 858-964)\n" +
        "  // Merge into single summary",
    ],
    [
      "equal evidence",
      "1 result | 1 repo symbol\n\n" +
        "[1] github:owner/repo#abc123 packages/pkg/src/compact.ts:858-964 [repo symbol] - compact (function)",
    ],
  ])("allows a unified repository hit with %s", async (_name, searchText) => {
    const caller = createCaller(async (name, args) => {
      if (name === "search" && args.format !== "json") {
        return textResult(searchText);
      }
      return smokeResponse(name, args);
    });

    await expect(runMcpSmoke(caller)).resolves.toBeUndefined();
  });

  it.each([
    [
      "1 result\n\n[1] npm:express@5.2.1 location unavailable [repo code]\n" +
        "  This payload mentions code_read but has no locator",
    ],
    [
      "1 result\n\n[1] npm:express@5.2.1 location unavailable [repo code]\n" +
        '  code_read target="npm:express@5.2.1"',
    ],
    ["1 result\n\n[1] page-1 [docs page] npm:express - README"],
    [
      "1 result\n\n[1] page-1 [docs page] npm:express -\n" +
        "  README without a source locator",
    ],
    [
      "1 result\n\n[1] page ID unavailable [docs page] npm:express - docs.example.com/readme -\n" +
        "  Wrapped title without a page locator",
    ],
    [
      "1 result\n\n[1] npm:express@5.2.1 location unavailable [repo code]\n" +
        "  ordinary title\n" +
        '  code_read target="npm:express@5.2.1" path="index.js"',
    ],
    [
      "1 result\n\n[1] npm:express@5.2.1 location unavailable [repo code] -\n" +
        "  Wrapped title without a locator",
    ],
    ["1 result\n\n[1] npm:express@5.2.1 lib/application.js [repo code] -"],
    [
      "1 result\n\n[1] compact - function defined at packages/pkg/src/compact.ts:858-964",
    ],
    [
      "1 result\n\n" +
        "[1] compact - function defined at packages/pkg/src/compact.ts:858-964\n" +
        "  github:owner/repo#abc123 evidence at 920-930 [repo code]",
    ],
    [
      "1 result\n\n[1] compact - function defined at location unavailable\n" +
        "  github:owner/repo#abc123 evidence at 920-930 [repo code]",
    ],
  ])("rejects incomplete or prose-only hit follow-ups", async (searchText) => {
    const caller = createCaller(async (name, args) => {
      if (name === "search" && args.format !== "json") {
        return textResult(searchText);
      }
      return smokeResponse(name, args);
    });

    await expect(runMcpSmoke(caller)).rejects.toThrow(
      "search default: missing usable result locator or status follow-up",
    );
  });

  it.each([
    [
      "Fix",
      "No results\n\n- npm:missing@1.0.0\n  Fix: verify the package coordinate.",
    ],
    ["Try", "No results\n\n- npm:missing latest\n  Try: npm:missing@1.0.0"],
  ])(
    "accepts target-local %s recovery without a hit or Next",
    async (_kind, searchText) => {
      const caller = createCaller(async (name, args) => {
        if (name === "search" && args.format !== "json") {
          return textResult(searchText);
        }
        return smokeResponse(name, args);
      });

      await expect(runMcpSmoke(caller)).resolves.toBeUndefined();
    },
  );

  it("accepts terminal target rows with a global rerun action", async () => {
    const caller = createCaller(async (name, args) => {
      if (name === "search" && args.format !== "json") {
        return textResult(
          "No results | failed | 0/1 ready\n\n" +
            "- npm:express@4.18.2\n" +
            "  searched: code; not found: symbols\n\n" +
            "Next: rerun search later.",
        );
      }
      return smokeResponse(name, args);
    });

    await expect(runMcpSmoke(caller)).resolves.toBeUndefined();
  });

  it.each([
    "ready",
    "pending",
    "provisional",
    "older snapshot",
    "package not found: code",
  ])("recognizes grouped target state detail: %s", async (detail) => {
    const caller = createCaller(async (name, args) => {
      if (name === "search" && args.format !== "json") {
        return textResult(
          `No results\n\n- npm:express@4.18.2\n  ${detail}\n\nNext: rerun search later.`,
        );
      }
      return smokeResponse(name, args);
    });

    await expect(runMcpSmoke(caller)).resolves.toBeUndefined();
  });

  it.each([
    "ready",
    "pending",
    "provisional",
    "older snapshot",
    "package not found: code",
  ])("rejects ungrouped target state detail: %s", async (detail) => {
    const caller = createCaller(async (name, args) => {
      if (name === "search" && args.format !== "json") {
        return textResult(
          `No results\n  ${detail}\n\nNext: rerun search later.`,
        );
      }
      return smokeResponse(name, args);
    });

    await expect(runMcpSmoke(caller)).rejects.toThrow(
      "search default: readiness details must be grouped under a target",
    );
  });

  it("rejects duplicate lifecycle outcome lines", async () => {
    const caller = createCaller(async (name, args) => {
      if (name === "search" && args.format !== "json") {
        return textResult(
          `${smokeSearchText()}\nNo result snapshot yet | indexing | 0/1 ready`,
        );
      }
      return smokeResponse(name, args);
    });

    await expect(runMcpSmoke(caller)).rejects.toThrow(
      "search default: duplicate lifecycle outcome lines",
    );
  });
});

function smokeResponse(
  name: string,
  args: Record<string, unknown>,
): McpSmokeToolResult {
  if (args.format === "json") return smokeJsonResponse(name, args);

  switch (name) {
    case "quick_start":
      return textResult(
        "GitHits provides routing for `search` and `code_grep`",
      );
    case "search_language":
      return textResult("python (Python)\naliases: py");
    case "get_example":
      return textResult("example\nsolution_id: smoke");
    case "pkg_info":
      return textResult(
        "express\nRepository 1 stars\n" +
          "Vulnerabilities  Latest: none affected\n                 History: 5 known advisories across all versions",
      );
    case "pkg_deps":
      if (args.include_issues === true) {
        return textResult("Dependency issues: 0 issues across the full graph");
      }
      return textResult(
        args.lifecycle === "all"
          ? "Dependency groups: runtime, development"
          : 'Runtime dependencies:\npass lifecycle="all"',
      );
    case "pkg_vulns":
      if (args.include_transitive === true) {
        return textResult(
          "express vulnerabilities\n\n" +
            "Resolved dependencies\n" +
            "1 affected advisory occurrence in 1 dependency package; " +
            "6 resolved package versions checked\n" +
            "  high  body-parser@1.19.0  GHSA-body-parser\n" +
            "    matched       < 2.0.0\n" +
            "    nearest fix   2.0.0\n" +
            "  high  cookie@0.7.0  GHSA-cookie\n" +
            "  high  qs@6.5.2  GHSA-qs\n" +
            "  high  path-to-regexp@0.1.12  GHSA-path\n" +
            "  high  set-function-length@1.2.2  GHSA-set-length\n" +
            "... (+1 more; use verbose=true or format=json)",
        );
      }
      if (args.min_severity === "high") {
        return textResult("Filter  severity >= high\nvulnerabilities");
      }
      if (args.advisory_scope === "non_affecting") {
        return textResult(
          "Scope   historical advisories only\nNo active vulnerabilities affect this version",
        );
      }
      return textResult("express vulnerabilities");
    case "pkg_changelog":
      return textResult(
        args.body_lines === 3
          ? 'truncated; pass verbose=true, body_lines=<n>, or format="json"'
          : "compact changelog timeline",
      );
    case "pkg_upgrade_review":
      return textResult(
        "Upgrade review - 1 package\n\n" +
          "npm:express 5.0.0 -> 5.2.1 (patch)\n\n" +
          "Security\n" +
          "  Direct: 0 affected -> 0 affected | 0 fixed | 0 added | 0 still present\n" +
          "  Transitive: not checked\n\n" +
          "Changes\n" +
          "  Repository releases | 1 entry | 1 with release notes",
      );
    case "docs_list":
      return textResult("docs_read page_id=page-1");
    case "docs_read":
      return textResult("documentation content");
    case "code_files":
      return textResult("package.json");
    case "code_read":
      return textResult('1  {"name":"express"}');
    case "code_grep":
      return textResult("package.json: express");
    case "search":
      return textResult(
        "No result snapshot yet | indexing | 0/1 ready\n\n" +
          "- npm:express@5.2.1\n" +
          "  indexing: code; available: versions 5.2.1\n\n" +
          'Next: search_status search_ref="smoke-ref" wait_timeout_ms=20000',
      );
    case "search_status":
      return errorResult("NOT_FOUND");
    case "feedback":
      return {
        content: [{ type: "text", text: "MCP error: solution_id required" }],
        isError: true,
      };
    default:
      throw new Error(`unexpected smoke tool ${name}`);
  }
}

function smokeSearchText(): string {
  return resultText(smokeResponse("search", {}), "search fixture");
}

function smokeJsonResponse(
  name: string,
  args: Record<string, unknown>,
): McpSmokeToolResult {
  switch (name) {
    case "search_language":
      return jsonResult([]);
    case "get_example":
      return jsonResult({ result: "example" });
    case "pkg_info":
      return jsonResult({
        registry: "npm",
        name: "express",
        version: "1.0.0",
        versionCount: 42,
        downloads: { refreshedAt: "2024-06-15" },
        advisoryHistory: { total: 5 },
      });
    case "pkg_deps":
      if (args.include_issues === true) {
        return jsonResult({
          issues: {
            total: 0,
            scope: { mode: "full" },
            deprecated: { count: 0, items: [] },
            outdated: { count: 0, items: [] },
            duplicates: { count: 0, items: [] },
            conflicts: { count: 0, items: [] },
          },
        });
      }
      return jsonResult({ runtime: {} });
    case "pkg_vulns":
      if (args.include_transitive === true) {
        return jsonResult({
          summary: { total: 0 },
          transitive: {
            scope: "resolved_dependencies",
            withdrawnAdvisoriesIncluded: false,
            summary: {
              totalPackagesAnalyzed: 6,
              affectedPackageCount: 1,
              affectedOccurrenceCount: 1,
            },
            packages: [
              {
                registry: "npm",
                name: "body-parser",
                affectedOccurrenceCount: 1,
                occurrences: [
                  {
                    resolvedVersion: "1.19.0",
                    id: "GHSA-body-parser",
                    matchedAffectedVersionRanges: ["< 2.0.0"],
                    fixVersionsAboveResolved: ["2.0.0"],
                    nearestFixedVersion: "2.0.0",
                  },
                ],
              },
            ],
          },
        });
      }
      return jsonResult({
        summary: {},
        filter: {
          minSeverity: args.min_severity,
          advisoryScope: args.advisory_scope,
        },
      });
    case "pkg_changelog":
      return jsonResult({ entries: {} });
    case "pkg_upgrade_review":
      return jsonResult({ summary: {}, reviews: [{}] });
    case "docs_list":
      return jsonResult({ pages: [{ pageId: "page-1" }] });
    case "docs_read":
      return jsonResult({ content: "documentation content" });
    case "code_files":
      return jsonResult({ files: [{ path: "package.json" }] });
    case "code_read":
      return jsonResult({ path: "package.json" });
    case "code_grep":
      return jsonResult({ matches: [] });
    case "search":
      return jsonResult({
        completed: false,
        searchRef: "smoke-ref",
        progress: { status: "INDEXING", targetsReady: 0, targetsTotal: 1 },
      });
    case "search_status":
      return jsonResult({ completed: true });
    default:
      throw new Error(`unexpected smoke JSON tool ${name}`);
  }
}
