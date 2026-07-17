import { describe, expect, it } from "bun:test";
import {
  assertCleanErrorEnvelope,
  assertDefaultText,
  assertHttpUnauthorizedChallenge,
  callToolText,
  EXPECTED_MCP_TOOLS,
  type McpSmokeCaller,
  type McpSmokeToolResult,
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
  it("can verify tool registration without live tool calls", async () => {
    const caller = createCaller(async () => {
      throw new Error("live tool call should not run");
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
});

function smokeResponse(
  name: string,
  args: Record<string, unknown>,
): McpSmokeToolResult {
  if (args.format === "json") return smokeJsonResponse(name, args);

  switch (name) {
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
      return textResult("code_read target=express path=package.json");
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
      return jsonResult({ hits: [] });
    case "search_status":
      return jsonResult({ completed: true });
    default:
      throw new Error(`unexpected smoke JSON tool ${name}`);
  }
}
