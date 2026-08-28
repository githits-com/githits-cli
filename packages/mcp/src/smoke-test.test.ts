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
  });

  it("rejects search action references outside a Next line", async () => {
    const caller = createCaller(async (name, args) => {
      if (name === "search" && args.format !== "json") {
        return textResult(
          'Indexing - no result snapshot returned yet\nNext: search_status search_ref="smoke-ref" wait_timeout_ms=20000\nsearch_ref=leaked',
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
            "- npm:express@5.2.1\n  Indexing: code | Available now: versions 5.2.1",
            "  Using: 5.1.0 while 5.2.1 indexes",
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
            "  Indexing: code | Available now: versions 5.2.1",
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
            "Indexing - no result snapshot yet",
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
      "1 result\n\n[1] npm:express@5.2.1 location unavailable [repo code]\n" +
        "  ordinary title\n" +
        '  code_read target="npm:express@5.2.1" path="index.js"',
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

  it("rejects duplicate lifecycle outcome lines", async () => {
    const caller = createCaller(async (name, args) => {
      if (name === "search" && args.format !== "json") {
        return textResult(
          `${smokeSearchText()}\nIndexing - no result snapshot yet`,
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
      return textResult("express\nRepository 1 stars\nVulnerabilities none");
    case "pkg_deps":
      return textResult(
        args.lifecycle === "all"
          ? "Dependency groups: runtime, development"
          : 'Runtime dependencies:\npass lifecycle="all"',
      );
    case "pkg_vulns":
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
      return textResult("pkg_upgrade_review vulnerabilities changes");
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
        "Indexing - no result snapshot yet\n\n" +
          "- npm:express@5.2.1\n" +
          "  Indexing: code | Available now: versions 5.2.1\n\n" +
          "Search smoke-ref | 0/1 target ready\n" +
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
      return jsonResult({ registry: "npm", name: "express", version: "1.0.0" });
    case "pkg_deps":
      return jsonResult({ runtime: {} });
    case "pkg_vulns":
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
