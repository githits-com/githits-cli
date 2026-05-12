import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

interface CommandResult {
  command: string[];
  exitCode: number;
  stdout: string;
  stderr: string;
}

interface ErrorEnvelope {
  error: string;
  code: string;
  retryable: boolean;
}

interface JsonParityFixture {
  name: string;
  cliArgs: string[];
  mcpTool: string;
  mcpArgs: Record<string, unknown>;
}

const DEFAULT_TEXT_LIMIT = 20_000;
const AUTH_ENV_KEYS = ["GITHITS_API_TOKEN", "GITHITS_TOKEN"] as const;
const JSON_PARITY_FIXTURES: JsonParityFixture[] = [
  {
    name: "pkg_info",
    cliArgs: ["pkg", "info", "npm:express", "--json"],
    mcpTool: "pkg_info",
    mcpArgs: { registry: "npm", package_name: "express", format: "json" },
  },
  {
    name: "pkg_deps",
    cliArgs: ["pkg", "deps", "npm:express", "--json"],
    mcpTool: "pkg_deps",
    mcpArgs: { registry: "npm", package_name: "express", format: "json" },
  },
  {
    name: "pkg_vulns",
    cliArgs: ["pkg", "vulns", "npm:express", "--json"],
    mcpTool: "pkg_vulns",
    mcpArgs: { registry: "npm", package_name: "express", format: "json" },
  },
  {
    name: "pkg_changelog",
    cliArgs: ["pkg", "changelog", "npm:express", "--limit", "1", "--json"],
    mcpTool: "pkg_changelog",
    mcpArgs: {
      registry: "npm",
      package_name: "express",
      limit: 1,
      format: "json",
    },
  },
  {
    name: "docs_list",
    cliArgs: ["docs", "list", "npm:express", "--limit", "2", "--json"],
    mcpTool: "docs_list",
    mcpArgs: {
      registry: "npm",
      package_name: "express",
      limit: 2,
      format: "json",
    },
  },
  {
    name: "code_files",
    cliArgs: [
      "code",
      "files",
      "npm:express",
      "package.json",
      "--limit",
      "1",
      "--json",
    ],
    mcpTool: "code_files",
    mcpArgs: {
      target: { registry: "npm", package_name: "express" },
      path_prefix: "package.json",
      limit: 1,
      format: "json",
    },
  },
  {
    name: "code_read",
    cliArgs: [
      "code",
      "read",
      "npm:express",
      "package.json",
      "--lines",
      "1-5",
      "--json",
    ],
    mcpTool: "code_read",
    mcpArgs: {
      target: { registry: "npm", package_name: "express" },
      path: "package.json",
      start_line: 1,
      end_line: 5,
      format: "json",
    },
  },
  {
    name: "code_grep",
    cliArgs: [
      "code",
      "grep",
      "npm:express",
      "express",
      "package.json",
      "--limit",
      "1",
      "--json",
    ],
    mcpTool: "code_grep",
    mcpArgs: {
      target: { registry: "npm", package_name: "express" },
      pattern: "express",
      path_prefix: "package.json",
      max_matches: 1,
      format: "json",
    },
  },
];

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

function assertRecord(
  value: unknown,
  context: string,
): asserts value is Record<string, unknown> {
  assert(
    value !== null && typeof value === "object" && !Array.isArray(value),
    `${context}: expected object`,
  );
}

function assertNotJson(text: string, context: string): void {
  try {
    JSON.parse(text);
  } catch {
    return;
  }
  throw new Error(`${context}: terminal output unexpectedly parsed as JSON`);
}

function assertCleanErrorEnvelope(
  text: string,
  context: string,
): ErrorEnvelope {
  const jsonLine = text
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.startsWith("{") && line.endsWith("}"));
  assert(jsonLine, `${context}: missing JSON error envelope`);
  const payload = parseJson(jsonLine, context);
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

function assertTerminalOutput(result: CommandResult, context: string): string {
  assert(
    result.exitCode === 0,
    `${context}: command failed (${result.exitCode})\n${result.stderr}`,
  );
  const text = result.stdout.trim();
  assert(text.length > 0, `${context}: expected stdout`);
  assert(
    text.length < DEFAULT_TEXT_LIMIT,
    `${context}: terminal output too large (${text.length} chars)`,
  );
  assertNotJson(text, context);
  return text;
}

function assertJsonOutput(result: CommandResult, context: string): unknown {
  assert(
    result.exitCode === 0,
    `${context}: command failed (${result.exitCode})\n${result.stderr}`,
  );
  assert(result.stdout.trim().length > 0, `${context}: expected stdout`);
  return parseJson(result.stdout, context);
}

function assertJsonErrorCode(
  result: CommandResult,
  context: string,
  code: string,
): void {
  assert(result.exitCode !== 0, `${context}: expected command failure`);
  const envelope = assertCleanErrorEnvelope(result.stderr, context);
  assert(
    envelope.code === code,
    `${context}: expected ${code}, got ${envelope.code}`,
  );
}

async function runCli(args: string[]): Promise<CommandResult> {
  return runCliWithEnv(args, process.env);
}

async function runCliWithEnv(
  args: string[],
  baseEnv: NodeJS.ProcessEnv | Record<string, string | undefined>,
): Promise<CommandResult> {
  const proc = Bun.spawn(["bun", "run", "dev", ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...baseEnv,
      NO_COLOR: "1",
    },
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { command: args, exitCode, stdout, stderr };
}

async function runMcpJson(
  toolName: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const proc = Bun.spawn(
    ["bun", "run", "scripts/mcp-call.ts", toolName, JSON.stringify(args)],
    {
      stdout: "pipe",
      stderr: "pipe",
      env: process.env,
    },
  );
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  assert(
    exitCode === 0,
    `${toolName} MCP parity call failed (${exitCode})\n${stderr}`,
  );
  return parseJson(stdout, `${toolName} MCP parity`);
}

function assertDeepEqual(
  actual: unknown,
  expected: unknown,
  context: string,
): void {
  const actualText = JSON.stringify(actual);
  const expectedText = JSON.stringify(expected);
  assert(
    actualText === expectedText,
    `${context}: JSON parity mismatch\nCLI: ${expectedText}\nMCP: ${actualText}`,
  );
}

async function assertJsonParity(): Promise<void> {
  for (const fixture of JSON_PARITY_FIXTURES) {
    const cliPayload = assertJsonOutput(
      await runCli(fixture.cliArgs),
      `${fixture.name} CLI parity`,
    );
    const mcpPayload = await runMcpJson(fixture.mcpTool, fixture.mcpArgs);
    assertDeepEqual(mcpPayload, cliPayload, `${fixture.name} CLI/MCP`);
  }
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
  const dir = mkdtempSync(join(tmpdir(), "githits-cli-smoke-home-"));
  env.HOME = dir;
  env.USERPROFILE = dir;
  env.XDG_CONFIG_HOME = `${dir}/.config`;
  env.APPDATA = `${dir}/AppData/Roaming`;
  env.GITHITS_AUTH_STORAGE = "file";
  return env;
}

async function assertUnauthenticatedBehavior(): Promise<void> {
  const env = isolatedUnauthenticatedEnv();
  try {
    const result = await runCliWithEnv(["languages", "python", "--json"], env);
    assert(result.exitCode !== 0, "unauthenticated languages should fail");
    const output = `${result.stdout}\n${result.stderr}`;
    assert(
      output.includes("Authentication required"),
      "unauthenticated probe missing authentication guidance",
    );
    assert(
      output.includes("githits login"),
      "unauthenticated probe missing login guidance",
    );
  } finally {
    if (env.HOME) {
      rmSync(env.HOME, { recursive: true, force: true });
    }
  }
}

async function assertLiveOrAuthRequired(): Promise<boolean> {
  const result = await runCli(["languages", "python", "--json"]);
  if (result.exitCode === 0) {
    const payload = parseJson(result.stdout, "languages auth probe");
    assert(Array.isArray(payload), "languages auth probe: expected array");
    return true;
  }

  assert(
    result.exitCode !== 0,
    "languages auth probe: expected non-zero auth failure",
  );
  // Auth guidance currently comes from requireAuth(), which writes friendly
  // instructions to stdout before throwing. Accept either stream so this smoke
  // gate validates guidance without forcing a broader CLI stream-policy change.
  const authGuidance = `${result.stderr}\n${result.stdout}`.trim();
  assert(
    authGuidance.includes("Authentication required"),
    "auth probe missing authentication guidance",
  );
  assert(
    authGuidance.includes("githits login"),
    "auth probe missing login guidance",
  );
  console.log("AUTH_REQUIRED: live CLI smoke skipped");
  return false;
}

async function runLiveSmoke(): Promise<void> {
  const languagesText = assertTerminalOutput(
    await runCli(["languages", "python"]),
    "languages terminal",
  );
  assert(languagesText.includes("python"), "languages terminal missing python");
  assert(
    languagesText.includes("Python"),
    "languages terminal missing display name",
  );

  const languagesJson = assertJsonOutput(
    await runCli(["languages", "python", "--json"]),
    "languages json",
  );
  assert(Array.isArray(languagesJson), "languages json: expected array");

  const exampleText = assertTerminalOutput(
    await runCli(["example", "express hello world", "--lang", "javascript"]),
    "example terminal",
  );
  assert(exampleText.length > 20, "example terminal unexpectedly short");

  const exampleJson = assertJsonOutput(
    await runCli([
      "example",
      "express hello world",
      "--lang",
      "javascript",
      "--json",
    ]),
    "example json",
  );
  assertRecord(exampleJson, "example json");
  assert(typeof exampleJson.result === "string", "example json missing result");

  const pkgInfoText = assertTerminalOutput(
    await runCli(["pkg", "info", "npm:express"]),
    "pkg info terminal",
  );
  assert(
    pkgInfoText.includes("express"),
    "pkg info terminal missing package name",
  );
  assert(
    pkgInfoText.includes("Repository") && pkgInfoText.includes("stars"),
    "pkg info terminal missing repository popularity",
  );
  assert(
    pkgInfoText.includes("Vulnerabilities"),
    "pkg info terminal missing vulnerability status",
  );
  assert(
    !pkgInfoText.includes("Install") && !pkgInfoText.includes("Usage"),
    "pkg info terminal should not include quickstart fields",
  );

  const pkgInfoJson = assertJsonOutput(
    await runCli(["pkg", "info", "npm:express", "--json"]),
    "pkg info json",
  );
  assertRecord(pkgInfoJson, "pkg info json");
  assert(pkgInfoJson.registry === "npm", "pkg info json registry mismatch");
  assert(pkgInfoJson.name === "express", "pkg info json name mismatch");
  assert(
    typeof pkgInfoJson.version === "string",
    "pkg info json missing version",
  );
  assert(
    !("install" in pkgInfoJson) && !("usage" in pkgInfoJson),
    "pkg info json should not include quickstart fields",
  );

  const depsText = assertTerminalOutput(
    await runCli(["pkg", "deps", "npm:express"]),
    "pkg deps terminal",
  );
  assert(
    depsText.includes("Runtime dependencies:"),
    "pkg deps terminal missing runtime deps",
  );

  const depsAllText = assertTerminalOutput(
    await runCli(["pkg", "deps", "npm:express", "--lifecycle", "all"]),
    "pkg deps lifecycle all terminal",
  );
  assert(
    depsAllText.includes("Dependency groups:"),
    "pkg deps lifecycle all terminal missing groups heading",
  );
  assert(
    depsAllText.includes("development") ||
      depsAllText.includes("peer") ||
      depsAllText.includes("optional"),
    "pkg deps lifecycle all terminal missing non-runtime groups",
  );

  const depsJson = assertJsonOutput(
    await runCli(["pkg", "deps", "npm:express", "--json"]),
    "pkg deps json",
  );
  assertRecord(depsJson, "pkg deps json");
  assertRecord(depsJson.runtime, "pkg deps json runtime");

  const vulnsText = assertTerminalOutput(
    await runCli(["pkg", "vulns", "npm:express"]),
    "pkg vulns terminal",
  );
  assert(
    vulnsText.includes("express") || vulnsText.includes("vulnerab"),
    "pkg vulns terminal missing context",
  );

  const filteredVulnsText = assertTerminalOutput(
    await runCli(["pkg", "vulns", "npm:lodash@4.17.20", "--severity", "high"]),
    "pkg vulns filtered terminal",
  );
  assert(
    filteredVulnsText.includes("Filter  severity >= high"),
    "pkg vulns filtered terminal missing filter echo",
  );

  const vulnsJson = assertJsonOutput(
    await runCli(["pkg", "vulns", "npm:express", "--json"]),
    "pkg vulns json",
  );
  assertRecord(vulnsJson, "pkg vulns json");
  assert(
    "summary" in vulnsJson || "advisories" in vulnsJson,
    "pkg vulns json missing vulnerability data",
  );

  const filteredVulnsJson = assertJsonOutput(
    await runCli([
      "pkg",
      "vulns",
      "npm:lodash@4.17.20",
      "--severity",
      "high",
      "--json",
    ]),
    "pkg vulns filtered json",
  );
  assertRecord(filteredVulnsJson, "pkg vulns filtered json");
  assertRecord(filteredVulnsJson.filter, "pkg vulns filtered json filter");
  assert(
    filteredVulnsJson.filter.minSeverity === "high",
    "pkg vulns filtered json missing severity filter echo",
  );

  const scopedVulnsText = assertTerminalOutput(
    await runCli(["pkg", "vulns", "npm:express", "--scope", "non_affecting"]),
    "pkg vulns scoped terminal",
  );
  assert(
    scopedVulnsText.includes("Scope   historical advisories only"),
    "pkg vulns scoped terminal missing scope echo",
  );
  assert(
    scopedVulnsText.includes("No active vulnerabilities affect this version"),
    "pkg vulns scoped terminal missing current-risk statement",
  );

  const scopedVulnsJson = assertJsonOutput(
    await runCli([
      "pkg",
      "vulns",
      "npm:express",
      "--scope",
      "non_affecting",
      "--json",
    ]),
    "pkg vulns scoped json",
  );
  assertRecord(scopedVulnsJson, "pkg vulns scoped json");
  assertRecord(scopedVulnsJson.filter, "pkg vulns scoped json filter");
  assert(
    scopedVulnsJson.filter.advisoryScope === "non_affecting",
    "pkg vulns scoped json missing advisory scope echo",
  );

  const changelogText = assertTerminalOutput(
    await runCli(["pkg", "changelog", "npm:express", "--limit", "1"]),
    "pkg changelog terminal",
  );
  assert(
    changelogText.includes("express") || changelogText.includes("changelog"),
    "pkg changelog terminal missing context",
  );
  assert(
    !/[·…—–→]/.test(changelogText),
    "pkg changelog terminal contains non-ASCII punctuation",
  );

  const changelogJson = assertJsonOutput(
    await runCli(["pkg", "changelog", "npm:express", "--limit", "1", "--json"]),
    "pkg changelog json",
  );
  assertRecord(changelogJson, "pkg changelog json");
  assertRecord(changelogJson.entries, "pkg changelog json entries");

  const docsText = assertTerminalOutput(
    await runCli(["docs", "list", "npm:express", "--limit", "2"]),
    "docs list terminal",
  );
  assert(
    docsText.includes("docs") || docsText.includes("page"),
    "docs list terminal missing docs context",
  );

  const docsJson = assertJsonOutput(
    await runCli(["docs", "list", "npm:express", "--limit", "2", "--json"]),
    "docs list json",
  );
  assertRecord(docsJson, "docs list json");
  assert(Array.isArray(docsJson.pages), "docs list json missing pages array");
  const firstPage = docsJson.pages[0] as Record<string, unknown> | undefined;
  assert(
    firstPage && typeof firstPage.pageId === "string",
    "docs list json missing readable page id",
  );

  const docsReadText = assertTerminalOutput(
    await runCli(["docs", "read", firstPage.pageId, "--lines", "1-5"]),
    "docs read terminal",
  );
  assert(docsReadText.length > 0, "docs read terminal missing content");

  const docsReadJson = assertJsonOutput(
    await runCli([
      "docs",
      "read",
      firstPage.pageId,
      "--lines",
      "1-5",
      "--json",
    ]),
    "docs read json",
  );
  assertRecord(docsReadJson, "docs read json");
  assert(
    typeof docsReadJson.content === "string",
    "docs read json missing content",
  );

  const codeFilesText = assertTerminalOutput(
    await runCli([
      "code",
      "files",
      "npm:express",
      "package.json",
      "--limit",
      "1",
    ]),
    "code files terminal",
  );
  assert(
    codeFilesText.includes("package.json"),
    "code files terminal missing package.json",
  );

  const codeFilesJson = assertJsonOutput(
    await runCli([
      "code",
      "files",
      "npm:express",
      "package.json",
      "--limit",
      "1",
      "--json",
    ]),
    "code files json",
  );
  assertRecord(codeFilesJson, "code files json");
  assert(
    Array.isArray(codeFilesJson.files),
    "code files json missing files array",
  );

  const codeReadText = assertTerminalOutput(
    await runCli([
      "code",
      "read",
      "npm:express",
      "package.json",
      "--lines",
      "1-5",
    ]),
    "code read terminal",
  );
  assert(
    codeReadText.includes('"name"'),
    "code read terminal missing file content",
  );

  const codeReadJson = assertJsonOutput(
    await runCli([
      "code",
      "read",
      "npm:express",
      "package.json",
      "--lines",
      "1-5",
      "--json",
    ]),
    "code read json",
  );
  assertRecord(codeReadJson, "code read json");
  assert(codeReadJson.path === "package.json", "code read json path mismatch");
  assert(
    typeof codeReadJson.content === "string",
    "code read json missing content",
  );

  const codeGrepText = assertTerminalOutput(
    await runCli([
      "code",
      "grep",
      "npm:express",
      "express",
      "package.json",
      "--limit",
      "1",
    ]),
    "code grep terminal",
  );
  assert(
    codeGrepText.includes("package.json"),
    "code grep terminal missing package.json",
  );

  const codeGrepJson = assertJsonOutput(
    await runCli([
      "code",
      "grep",
      "npm:express",
      "express",
      "package.json",
      "--limit",
      "1",
      "--json",
    ]),
    "code grep json",
  );
  assertRecord(codeGrepJson, "code grep json");
  assert(
    "matches" in codeGrepJson || "totalMatches" in codeGrepJson,
    "code grep json missing matches",
  );

  const searchText = assertTerminalOutput(
    await runCli(["search", "router", "--in", "npm:express", "--limit", "1"]),
    "search terminal",
  );
  assert(
    searchText.includes("search") || searchText.includes("result"),
    "search terminal missing result context",
  );

  const searchJson = assertJsonOutput(
    await runCli([
      "search",
      "router",
      "--in",
      "npm:express",
      "--limit",
      "1",
      "--json",
    ]),
    "search json",
  );
  assertRecord(searchJson, "search json");
  assert(
    "results" in searchJson || "searchRef" in searchJson,
    "search json missing results/searchRef",
  );
  if (typeof searchJson.searchRef === "string") {
    const statusJson = assertJsonOutput(
      await runCli(["search-status", searchJson.searchRef, "--json"]),
      "search-status json",
    );
    assertRecord(statusJson, "search-status json");
    assert(
      "completed" in statusJson || "progress" in statusJson,
      "search-status json missing status data",
    );
  } else {
    assertJsonErrorCode(
      await runCli(["search-status", "smoke-invalid-search-ref", "--json"]),
      "search-status invalid json error",
      "NOT_FOUND",
    );
  }

  const feedbackValidation = await runCli([
    "feedback",
    "smoke-solution-id",
    "--json",
  ]);
  assert(
    feedbackValidation.exitCode !== 0,
    "feedback validation should fail before submitting",
  );
  assert(
    feedbackValidation.stderr.includes("Specify either --accept or --reject"),
    "feedback validation missing action guidance",
  );

  const invalidJson = await runCli([
    "pkg",
    "info",
    "npm:express@4.18.0",
    "--json",
  ]);
  assertJsonErrorCode(
    invalidJson,
    "pkg info invalid json error",
    "INVALID_ARGUMENT",
  );
}

async function main(): Promise<void> {
  await assertUnauthenticatedBehavior();
  if (await assertLiveOrAuthRequired()) {
    await runLiveSmoke();
    await assertJsonParity();
    console.log("CLI smoke passed");
  }
}

await main();
