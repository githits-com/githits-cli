import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

interface TextContent {
  type: "text";
  text: string;
}

interface ToolCallResult {
  content?: unknown;
  isError?: boolean;
}

interface ErrorEnvelope {
  error: string;
  code: string;
  retryable: boolean;
}

const EXPECTED_TOOLS = [
  "get_example",
  "search_language",
  "pkg_info",
  "pkg_deps",
  "pkg_vulns",
  "pkg_changelog",
  "docs_list",
  "docs_read",
  "code_files",
  "code_read",
  "code_grep",
  "search",
  "search_status",
  "feedback",
] as const;

const DEFAULT_TEXT_LIMIT = 12_000;
const AUTH_ENV_KEYS = ["GITHITS_API_TOKEN", "GITHITS_TOKEN"] as const;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function parseJson(text: string, context: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    throw new Error(`${context}: expected parseable JSON (${message})`);
  }
}

function assertNotJson(text: string, context: string): void {
  try {
    JSON.parse(text);
  } catch {
    return;
  }
  throw new Error(`${context}: default response unexpectedly parsed as JSON`);
}

function assertRecord(
  value: unknown,
  context: string,
): asserts value is Record<string, unknown> {
  assert(
    value !== null && typeof value === "object" && !Array.isArray(value),
    `${context}: expected object`,
  );
}

function resultText(result: ToolCallResult, context: string): string {
  assert(Array.isArray(result.content), `${context}: expected content array`);
  const first = result.content[0] as Partial<TextContent> | undefined;
  assert(first?.type === "text", `${context}: expected text content`);
  assert(typeof first.text === "string", `${context}: expected text string`);
  return first.text;
}

function assertCleanErrorEnvelope(
  result: ToolCallResult,
  context: string,
): ErrorEnvelope {
  assert(result.isError === true, `${context}: expected MCP error result`);
  const payload = parseJson(resultText(result, context), context);
  assertRecord(payload, context);
  assert(
    typeof payload.error === "string" && payload.error.length > 0,
    `${context}: missing error`,
  );
  assert(
    typeof payload.code === "string" && payload.code.length > 0,
    `${context}: missing code`,
  );
  assert(
    typeof payload.retryable === "boolean",
    `${context}: missing retryable`,
  );
  return payload as unknown as ErrorEnvelope;
}

function assertDefaultText(result: ToolCallResult, context: string): string {
  assert(result.isError !== true, `${context}: expected success`);
  const text = resultText(result, context);
  assert(text.length > 0, `${context}: expected non-empty text`);
  assert(
    text.length < DEFAULT_TEXT_LIMIT,
    `${context}: default text too large (${text.length} chars)`,
  );
  assertNotJson(text, context);
  assert(
    !text.includes("--lifecycle"),
    `${context}: leaked CLI lifecycle flag`,
  );
  assert(!text.includes("--verbose"), `${context}: leaked CLI verbose flag`);
  return text;
}

function assertJsonResult(result: ToolCallResult, context: string): unknown {
  assert(result.isError !== true, `${context}: expected success`);
  return parseJson(resultText(result, context), context);
}

function assertErrorCode(
  result: ToolCallResult,
  context: string,
  code: string,
): void {
  const envelope = assertCleanErrorEnvelope(result, context);
  assert(
    envelope.code === code,
    `${context}: expected ${code}, got ${envelope.code}`,
  );
}

async function callTool(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolCallResult> {
  return (await client.callTool({ name, arguments: args })) as ToolCallResult;
}

function isolatedUnauthenticatedEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (
      value !== undefined &&
      !AUTH_ENV_KEYS.includes(key as (typeof AUTH_ENV_KEYS)[number])
    ) {
      env[key] = value;
    }
  }
  const home = mkdtempSync(join(tmpdir(), "githits-mcp-smoke-home-"));
  env.HOME = home;
  env.USERPROFILE = home;
  env.XDG_CONFIG_HOME = join(home, ".config");
  env.APPDATA = join(home, "AppData", "Roaming");
  env.GITHITS_AUTH_STORAGE = "file";
  return env;
}

async function withMcpClient<T>(
  env: Record<string, string> | undefined,
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  const transport = new StdioClientTransport({
    command: "bun",
    args: ["run", "dev", "mcp", "start"],
    env,
  });
  const client = new Client({ name: "githits-mcp-smoke", version: "0.1.0" });
  try {
    await client.connect(transport);
    return await fn(client);
  } finally {
    await client.close();
  }
}

async function assertUnauthenticatedBehavior(): Promise<void> {
  const env = isolatedUnauthenticatedEnv();
  const home = env.HOME;
  try {
    await withMcpClient(env, async (client) => {
      const toolsResponse = await client.listTools();
      assert(
        toolsResponse.tools.length > 0,
        "unauthenticated listTools returned no tools",
      );
      const result = await callTool(client, "search_language", {
        query: "python",
      });
      const envelope = assertCleanErrorEnvelope(
        result,
        "search_language unauthenticated",
      );
      assert(
        envelope.code === "AUTH_REQUIRED",
        `unauthenticated probe returned unexpected code ${envelope.code}`,
      );
    });
  } finally {
    if (home) rmSync(home, { recursive: true, force: true });
  }
}

async function assertLiveOrAuthRequired(client: Client): Promise<boolean> {
  const result = await callTool(client, "search_language", { query: "python" });
  if (result.isError === true) {
    const envelope = assertCleanErrorEnvelope(
      result,
      "search_language auth probe",
    );
    assert(
      envelope.code === "AUTH_REQUIRED",
      `auth probe returned unexpected code ${envelope.code}`,
    );
    console.log("AUTH_REQUIRED: live smoke skipped");
    return false;
  }

  const text = assertDefaultText(result, "search_language default");
  assert(
    text.includes("python (Python)"),
    "search_language default missing Python display name",
  );
  assert(text.includes("aliases:"), "search_language default missing aliases");
  return true;
}

async function runLiveSmoke(client: Client): Promise<void> {
  const languageJson = assertJsonResult(
    await callTool(client, "search_language", {
      query: "python",
      format: "json",
    }),
    "search_language json",
  );
  assert(Array.isArray(languageJson), "search_language json: expected array");

  const exampleText = assertDefaultText(
    await callTool(client, "get_example", {
      query: "express hello world",
      language: "javascript",
    }),
    "get_example default",
  );
  assert(
    exampleText.includes("solution_id:"),
    "get_example default missing solution_id hint",
  );

  const exampleJson = assertJsonResult(
    await callTool(client, "get_example", {
      query: "express hello world",
      language: "javascript",
      format: "json",
    }),
    "get_example json",
  );
  assertRecord(exampleJson, "get_example json");
  assert(
    typeof exampleJson.result === "string",
    "get_example json missing result",
  );

  const pkgInfoText = assertDefaultText(
    await callTool(client, "pkg_info", {
      registry: "npm",
      package_name: "express",
    }),
    "pkg_info default",
  );
  assert(
    pkgInfoText.includes("express"),
    "pkg_info default missing package name",
  );

  const pkgInfoJson = assertJsonResult(
    await callTool(client, "pkg_info", {
      registry: "npm",
      package_name: "express",
      format: "json",
    }),
    "pkg_info json",
  );
  assertRecord(pkgInfoJson, "pkg_info json");
  assert(pkgInfoJson.registry === "npm", "pkg_info json registry mismatch");
  assert(pkgInfoJson.name === "express", "pkg_info json name mismatch");
  assert(
    typeof pkgInfoJson.version === "string",
    "pkg_info json missing version",
  );

  const depsText = assertDefaultText(
    await callTool(client, "pkg_deps", {
      registry: "npm",
      package_name: "express",
    }),
    "pkg_deps default",
  );
  assert(
    depsText.includes('pass lifecycle="all"'),
    "pkg_deps default missing MCP-native lifecycle hint",
  );

  const depsAllText = assertDefaultText(
    await callTool(client, "pkg_deps", {
      registry: "npm",
      package_name: "express",
      lifecycle: "all",
    }),
    "pkg_deps lifecycle all",
  );
  assert(
    !depsAllText.includes("Hidden groups:"),
    "pkg_deps lifecycle all still hides groups",
  );

  const depsJson = assertJsonResult(
    await callTool(client, "pkg_deps", {
      registry: "npm",
      package_name: "express",
      format: "json",
    }),
    "pkg_deps json",
  );
  assertRecord(depsJson, "pkg_deps json");
  assertRecord(depsJson.runtime, "pkg_deps json runtime");

  const vulnsText = assertDefaultText(
    await callTool(client, "pkg_vulns", {
      registry: "npm",
      package_name: "express",
    }),
    "pkg_vulns default",
  );
  assert(
    vulnsText.includes("express") || vulnsText.includes("vulnerab"),
    "pkg_vulns default missing context",
  );

  const vulnsJson = assertJsonResult(
    await callTool(client, "pkg_vulns", {
      registry: "npm",
      package_name: "express",
      format: "json",
    }),
    "pkg_vulns json",
  );
  assertRecord(vulnsJson, "pkg_vulns json");
  assert(
    "summary" in vulnsJson || "advisories" in vulnsJson,
    "pkg_vulns json missing vulnerability data",
  );

  const changelogText = assertDefaultText(
    await callTool(client, "pkg_changelog", {
      registry: "npm",
      package_name: "express",
      limit: 1,
    }),
    "pkg_changelog default",
  );
  assert(
    !changelogText.includes("--verbose"),
    "pkg_changelog default leaked CLI verbose flag",
  );
  if (
    changelogText.includes("truncated") ||
    changelogText.includes("full bodies")
  ) {
    assert(
      changelogText.includes('pass format="json" for full bodies'),
      "pkg_changelog truncation hint is not MCP-native",
    );
  }

  const changelogJson = assertJsonResult(
    await callTool(client, "pkg_changelog", {
      registry: "npm",
      package_name: "express",
      limit: 1,
      format: "json",
    }),
    "pkg_changelog json",
  );
  assertRecord(changelogJson, "pkg_changelog json");
  assertRecord(changelogJson.entries, "pkg_changelog json entries");

  const docsText = assertDefaultText(
    await callTool(client, "docs_list", {
      registry: "npm",
      package_name: "express",
      limit: 2,
    }),
    "docs_list default",
  );
  assert(
    docsText.includes("docs_read page_id="),
    "docs_list default missing docs_read follow-up",
  );

  const docsJson = assertJsonResult(
    await callTool(client, "docs_list", {
      registry: "npm",
      package_name: "express",
      limit: 2,
      format: "json",
    }),
    "docs_list json",
  );
  assertRecord(docsJson, "docs_list json");
  assert(Array.isArray(docsJson.pages), "docs_list json missing pages array");
  const firstPage = docsJson.pages[0] as Record<string, unknown> | undefined;
  assert(
    firstPage && typeof firstPage.pageId === "string",
    "docs_list json missing readable page id",
  );

  const docReadText = assertDefaultText(
    await callTool(client, "docs_read", {
      page_id: firstPage.pageId,
      start_line: 1,
      end_line: 5,
    }),
    "docs_read default",
  );
  assert(docReadText.length > 0, "docs_read default missing content");

  const docReadJson = assertJsonResult(
    await callTool(client, "docs_read", {
      page_id: firstPage.pageId,
      start_line: 1,
      end_line: 5,
      format: "json",
    }),
    "docs_read json",
  );
  assertRecord(docReadJson, "docs_read json");
  assert(
    typeof docReadJson.content === "string",
    "docs_read json missing content",
  );

  const codeFilesText = assertDefaultText(
    await callTool(client, "code_files", {
      target: { registry: "npm", package_name: "express" },
      path_prefix: "package.json",
      limit: 1,
    }),
    "code_files default",
  );
  assert(
    codeFilesText.includes("package.json"),
    "code_files default missing package.json",
  );

  const codeFilesJson = assertJsonResult(
    await callTool(client, "code_files", {
      target: { registry: "npm", package_name: "express" },
      path_prefix: "package.json",
      limit: 1,
      format: "json",
    }),
    "code_files json",
  );
  assertRecord(codeFilesJson, "code_files json");
  assert(
    Array.isArray(codeFilesJson.files),
    "code_files json missing files array",
  );

  const codeReadText = assertDefaultText(
    await callTool(client, "code_read", {
      target: { registry: "npm", package_name: "express" },
      path: "package.json",
      start_line: 1,
      end_line: 5,
    }),
    "code_read default",
  );
  assert(/^1\s+/m.test(codeReadText), "code_read default missing line numbers");

  const codeReadJson = assertJsonResult(
    await callTool(client, "code_read", {
      target: { registry: "npm", package_name: "express" },
      path: "package.json",
      start_line: 1,
      end_line: 5,
      format: "json",
    }),
    "code_read json",
  );
  assertRecord(codeReadJson, "code_read json");
  assert(codeReadJson.path === "package.json", "code_read json path mismatch");

  const codeGrepText = assertDefaultText(
    await callTool(client, "code_grep", {
      target: { registry: "npm", package_name: "express" },
      pattern: "express",
      path: "package.json",
      max_matches: 1,
    }),
    "code_grep default",
  );
  assert(
    codeGrepText.includes("package.json"),
    "code_grep default missing package.json",
  );

  const codeGrepJson = assertJsonResult(
    await callTool(client, "code_grep", {
      target: { registry: "npm", package_name: "express" },
      pattern: "express",
      path: "package.json",
      max_matches: 1,
      format: "json",
    }),
    "code_grep json",
  );
  assertRecord(codeGrepJson, "code_grep json");
  assert(
    "matches" in codeGrepJson || "totalMatches" in codeGrepJson,
    "code_grep json missing matches",
  );

  const searchText = assertDefaultText(
    await callTool(client, "search", {
      target: { registry: "npm", package_name: "express" },
      query: "router",
      limit: 1,
    }),
    "search default",
  );
  assert(
    searchText.includes("code_read") ||
      searchText.includes("docs_read") ||
      searchText.includes("search_status"),
    "search default missing ready-to-call follow-up",
  );

  const searchJson = assertJsonResult(
    await callTool(client, "search", {
      target: { registry: "npm", package_name: "express" },
      query: "router",
      limit: 1,
      format: "json",
    }),
    "search json",
  );
  assertRecord(searchJson, "search json");
  const searchRef =
    typeof searchJson.searchRef === "string" ? searchJson.searchRef : undefined;
  if (searchRef) {
    const statusJson = assertJsonResult(
      await callTool(client, "search_status", {
        search_ref: searchRef,
        format: "json",
      }),
      "search_status json",
    );
    assertRecord(statusJson, "search_status json");
    assert(
      "completed" in statusJson || "progress" in statusJson,
      "search_status json missing status data",
    );
  } else {
    assertErrorCode(
      await callTool(client, "search_status", {
        search_ref: "smoke-invalid-search-ref",
      }),
      "search_status invalid ref",
      "NOT_FOUND",
    );
  }

  const feedbackValidation = await callTool(client, "feedback", {
    solution_id: "",
    accepted: true,
  });
  assert(
    feedbackValidation.isError === true,
    "feedback validation should fail before submitting",
  );
  assert(
    resultText(feedbackValidation, "feedback validation").includes("MCP error"),
    "feedback validation missing protocol error text",
  );
}

async function main(): Promise<void> {
  await assertUnauthenticatedBehavior();
  await withMcpClient(undefined, async (client) => {
    const toolsResponse = await client.listTools();
    const toolNames = new Set(toolsResponse.tools.map((tool) => tool.name));
    for (const expected of EXPECTED_TOOLS) {
      assert(toolNames.has(expected), `listTools missing ${expected}`);
    }

    if (await assertLiveOrAuthRequired(client)) {
      await runLiveSmoke(client);
      console.log("MCP smoke passed");
    }
  });
}

await main();
