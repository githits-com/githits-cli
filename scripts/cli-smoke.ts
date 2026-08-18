import { createIsolatedSmokeEnvironment } from "./smoke-environment.ts";
import {
  appendCliArgs,
  type CliLaunchTarget,
  formatCliLaunchTarget,
  forwardedCliEntryArgs,
  parseCliLaunchTarget,
  SOURCE_CLI_LAUNCH_TARGET,
} from "./smoke-launch-target.ts";
import {
  formatCliCommand,
  mapWithConcurrency,
  printSmokeTimingSummary,
  trackSmokeStep,
} from "./smoke-telemetry.ts";

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
  details?: Record<string, unknown>;
}

export interface CliSmokeOptions {
  mode: "live" | "unauthenticated";
  target: CliLaunchTarget;
}

interface JsonParityFixture {
  name: string;
  cliArgs: string[];
  mcpTool: string;
  mcpArgs: Record<string, unknown>;
}

const DEFAULT_TEXT_LIMIT = 20_000;
const JSON_PARITY_CONCURRENCY = 2;
const SMOKE_PACKAGE_SPEC = "npm:express@5.2.1";
let cliLaunchTarget = SOURCE_CLI_LAUNCH_TARGET;

export const EXPECTED_TOP_LEVEL_COMMANDS = [
  "init",
  "login",
  "logout",
  "mcp",
  "example",
  "languages",
  "feedback",
  "doctor",
  "resolve",
  "settings",
  "search",
  "search-status",
  "code",
  "pkg",
  "docs",
  "auth",
] as const;

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
    name: "pkg_upgrade_review",
    cliArgs: [
      "pkg",
      "upgrade-review",
      "npm:express@5.0.0",
      "--to",
      "5.2.1",
      "--no-transitive-security",
      "--json",
    ],
    mcpTool: "pkg_upgrade_review",
    mcpArgs: {
      registry: "npm",
      package_name: "express",
      current_version: "5.0.0",
      target_version: "5.2.1",
      skip_transitive_security: true,
      format: "json",
    },
  },
  {
    name: "docs_list",
    cliArgs: ["docs", "list", SMOKE_PACKAGE_SPEC, "--limit", "2", "--json"],
    mcpTool: "docs_list",
    mcpArgs: {
      registry: "npm",
      package_name: "express",
      version: "5.2.1",
      limit: 2,
      format: "json",
    },
  },
  {
    name: "code_files",
    cliArgs: [
      "code",
      "files",
      SMOKE_PACKAGE_SPEC,
      "package.json",
      "--limit",
      "1",
      "--json",
    ],
    mcpTool: "code_files",
    mcpArgs: {
      target: { registry: "npm", package_name: "express", version: "5.2.1" },
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
      SMOKE_PACKAGE_SPEC,
      "package.json",
      "--lines",
      "1-5",
      "--json",
    ],
    mcpTool: "code_read",
    mcpArgs: {
      target: { registry: "npm", package_name: "express", version: "5.2.1" },
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
      SMOKE_PACKAGE_SPEC,
      "express",
      "package.json",
      "--limit",
      "1",
      "--json",
    ],
    mcpTool: "code_grep",
    mcpArgs: {
      target: { registry: "npm", package_name: "express", version: "5.2.1" },
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

export function parseCliSmokeArgs(
  argv: readonly string[],
  cwd = process.cwd(),
): CliSmokeOptions {
  const parsed = parseCliLaunchTarget(argv, cwd);
  let mode: CliSmokeOptions["mode"] = "live";
  let modeSpecified = false;

  for (let index = 0; index < parsed.remainingArgs.length; index += 1) {
    const value = parsed.remainingArgs[index];
    if (value !== "--mode") {
      throw new Error(`Unknown CLI smoke option: ${value}`);
    }
    if (modeSpecified) throw new Error("--mode may only be specified once");
    const requestedMode = parsed.remainingArgs[index + 1];
    if (requestedMode !== "live" && requestedMode !== "unauthenticated") {
      throw new Error("--mode must be live or unauthenticated");
    }
    mode = requestedMode;
    modeSpecified = true;
    index += 1;
  }

  return { mode, target: parsed.target };
}

export function buildMcpParityCommand(
  target: CliLaunchTarget,
  toolName: string,
  args: Record<string, unknown>,
): string[] {
  return [
    "bun",
    "run",
    "scripts/mcp-call.ts",
    ...forwardedCliEntryArgs(target),
    toolName,
    JSON.stringify(args),
  ];
}

export function parseRootHelpCommands(helpText: string): string[] {
  const commands: string[] = [];
  let inCommands = false;
  for (const line of helpText.split(/\r?\n/)) {
    if (!inCommands) {
      inCommands = line.trim() === "Commands:";
      continue;
    }
    if (line.trim() === "") break;
    const match = /^ {2}(\S+)/.exec(line);
    const command = match?.[1];
    if (command && command !== "help") commands.push(command);
  }
  return commands;
}

export function assertRootHelpStructure(helpText: string): void {
  const actual = new Set(parseRootHelpCommands(helpText));
  const expected = new Set<string>(EXPECTED_TOP_LEVEL_COMMANDS);
  const missing = [...expected].filter((command) => !actual.has(command));
  const unexpected = [...actual].filter((command) => !expected.has(command));
  assert(
    missing.length === 0 && unexpected.length === 0,
    `root help command mismatch; missing: ${missing.join(", ") || "none"}; unexpected: ${unexpected.join(", ") || "none"}`,
  );
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
  return trackSmokeStep(`cli ${formatCliCommand(args)}`, async () => {
    const proc = Bun.spawn(appendCliArgs(cliLaunchTarget, args), {
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
  });
}

async function runMcpJson(
  toolName: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  return trackSmokeStep(`mcp parity ${toolName}`, async () => {
    const proc = Bun.spawn(
      buildMcpParityCommand(cliLaunchTarget, toolName, args),
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
  });
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

function jsonContractShape(value: unknown): unknown {
  if (value === null) return "null";
  if (Array.isArray(value)) {
    const uniqueShapes = new Map<string, unknown>();
    for (const item of value) {
      const shape = jsonContractShape(item);
      uniqueShapes.set(JSON.stringify(shape), shape);
    }
    return [...uniqueShapes.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([, shape]) => shape);
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      out[key] = jsonContractShape(record[key]);
    }
    return out;
  }
  return typeof value;
}

async function assertJsonParity(): Promise<void> {
  await mapWithConcurrency(
    JSON_PARITY_FIXTURES,
    JSON_PARITY_CONCURRENCY,
    async (fixture) => {
      await trackSmokeStep(`json parity ${fixture.name}`, async () => {
        const [cliPayload, mcpPayload] = await Promise.all([
          runCli(fixture.cliArgs).then((result) =>
            assertJsonOutput(result, `${fixture.name} CLI parity`),
          ),
          runMcpJson(fixture.mcpTool, fixture.mcpArgs),
        ]);
        // Dev endpoints may return stale cached data first and refresh in the
        // background, so concurrent CLI/MCP calls can legitimately see different
        // values. Parity still verifies both surfaces expose the same JSON contract.
        assertDeepEqual(
          jsonContractShape(mcpPayload),
          jsonContractShape(cliPayload),
          `${fixture.name} CLI/MCP JSON shape`,
        );
      });
    },
  );
}

async function assertUnauthenticatedBehavior(): Promise<void> {
  const isolated = createIsolatedSmokeEnvironment("githits-cli-smoke-home-");
  const { env } = isolated;
  try {
    const helpResult = await runCliWithEnv(["--help"], env);
    assert(helpResult.exitCode === 0, "root help should succeed");
    assert(
      helpResult.stdout.trim().length > 0,
      "root help should produce stdout",
    );
    assertRootHelpStructure(helpResult.stdout);
    assert(
      helpResult.stdout.includes("githits resolve express"),
      "root help should include resolve in Getting started",
    );

    const resolveHelp = await runCliWithEnv(["resolve", "--help"], env);
    assert(resolveHelp.exitCode === 0, "resolve help should succeed");
    assert(
      resolveHelp.stdout.includes("--query and --intent-hint") &&
        resolveHelp.stdout.includes("Do not") &&
        resolveHelp.stdout.includes("include credentials"),
      "resolve help should disclose query privacy guidance",
    );

    const codeDiffHelp = await runCliWithEnv(["code", "diff", "--help"], env);
    assert(codeDiffHelp.exitCode === 0, "code diff help should succeed");
    assert(
      codeDiffHelp.stdout.includes("<from>..<to>") &&
        codeDiffHelp.stdout.includes("repository-relative") &&
        codeDiffHelp.stdout.includes("--name-status") &&
        !codeDiffHelp.stdout.includes("--git-ref"),
      "code diff help should expose the bounded dogfood contract",
    );

    for (const command of ["init", "login"] as const) {
      const commandHelp = await runCliWithEnv([command, "--help"], env);
      assert(commandHelp.exitCode === 0, `${command} help should succeed`);
      assert(
        commandHelp.stdout.includes("--port <port>"),
        `${command} help should expose the callback port option`,
      );
      assert(
        commandHelp.stdout.includes("--no-browser"),
        `${command} help should expose the manual browser option`,
      );

      const invalidPort = await runCliWithEnv(
        [command, "--port", "8765extra"],
        env,
      );
      assert(
        invalidPort.exitCode !== 0,
        `${command} should reject a partially numeric callback port`,
      );
      assert(
        `${invalidPort.stderr}\n${invalidPort.stdout}`.includes(
          "Port must be an integer between 1 and 65535.",
        ),
        `${command} should explain the valid callback port range`,
      );
    }

    const result = await runCliWithEnv(["languages", "python", "--json"], env);
    assert(result.exitCode !== 0, "unauthenticated languages should fail");
    assert(
      result.stdout.trim() === "",
      "unauthenticated JSON probe should keep stdout clean",
    );
    const payload = assertCleanErrorEnvelope(
      result.stderr,
      "unauthenticated languages",
    );
    assertDeepEqual(
      payload,
      {
        error: "No local GitHits authentication token found.",
        code: "AUTH_REQUIRED",
        retryable: false,
        details: { authSource: "local" },
      },
      "unauthenticated languages JSON envelope",
    );

    const codeDiffAuth = await runCliWithEnv(
      ["code", "diff", "npm:express", "5.2.0..5.2.1", "--json"],
      env,
    );
    assert(
      codeDiffAuth.exitCode !== 0 && codeDiffAuth.stdout.trim() === "",
      "unauthenticated code diff JSON should fail with clean stdout",
    );
    const codeDiffAuthPayload = assertCleanErrorEnvelope(
      codeDiffAuth.stderr,
      "unauthenticated code diff",
    );
    assert(
      codeDiffAuthPayload.code === "AUTH_REQUIRED",
      "unauthenticated code diff should preserve the shared auth envelope",
    );

    const resolveJson = await runCliWithEnv(
      ["resolve", "express", "--json"],
      env,
    );
    assert(resolveJson.exitCode !== 0, "unauthenticated resolve should fail");
    assert(
      resolveJson.stdout.trim() === "",
      "unauthenticated resolve JSON should keep stdout clean",
    );
    assert(
      assertCleanErrorEnvelope(resolveJson.stderr, "unauthenticated resolve")
        .code === "AUTH_REQUIRED",
      "unauthenticated resolve should return AUTH_REQUIRED",
    );

    const terminalResult = await runCliWithEnv(["languages", "python"], env);
    assert(
      terminalResult.exitCode !== 0,
      "unauthenticated terminal probe should fail",
    );
    const authGuidance = `${terminalResult.stderr}\n${terminalResult.stdout}`;
    assertNotJson(
      authGuidance.trim(),
      "unauthenticated terminal auth guidance",
    );
    assert(
      authGuidance.includes("No local GitHits authentication token found"),
      "unauthenticated terminal probe missing auth guidance",
    );
    assert(
      authGuidance.includes("githits login"),
      "unauthenticated terminal probe missing login guidance",
    );
    assert(
      !authGuidance.includes("tool call"),
      "unauthenticated terminal probe used MCP-style auth guidance",
    );

    const resolveTerminal = await runCliWithEnv(["resolve", "express"], env);
    const resolveGuidance = `${resolveTerminal.stderr}\n${resolveTerminal.stdout}`;
    assert(
      resolveTerminal.exitCode !== 0,
      "unauthenticated resolve should fail",
    );
    assert(
      resolveGuidance.includes("githits login"),
      "unauthenticated resolve should include login guidance",
    );
  } finally {
    isolated.cleanup();
  }
}

async function assertLiveOrAuthRequired(): Promise<boolean> {
  const languagesResult = await runCli(["languages", "python", "--json"]);
  if (languagesResult.exitCode !== 0) {
    const jsonAuthPayload = assertCleanErrorEnvelope(
      languagesResult.stderr,
      "languages auth probe",
    );
    if (jsonAuthPayload.code === "AUTH_REQUIRED") {
      console.log("AUTH_REQUIRED: live CLI smoke skipped");
      return false;
    }

    // Non-JSON auth guidance currently comes from requireAuth(), which writes
    // friendly instructions to stdout before throwing. Accept either stream so
    // this smoke gate validates guidance without forcing a broader CLI
    // stream-policy change.
    const authGuidance =
      `${languagesResult.stderr}\n${languagesResult.stdout}`.trim();
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

  const languagesPayload = parseJson(
    languagesResult.stdout,
    "languages auth probe",
  );
  assert(
    Array.isArray(languagesPayload),
    "languages auth probe: expected array",
  );

  const packageResult = await runCli(["pkg", "info", "npm:express", "--json"]);
  if (packageResult.exitCode === 0) {
    const payload = parseJson(packageResult.stdout, "package auth probe");
    assertRecord(payload, "package auth probe");
    assert(payload.name === "express", "package auth probe: expected express");
    return true;
  }

  assert(
    packageResult.exitCode !== 0,
    "package auth probe: expected non-zero auth failure",
  );
  const jsonAuthPayload = assertCleanErrorEnvelope(
    packageResult.stderr,
    "package auth probe",
  );
  if (jsonAuthPayload.code === "AUTH_REQUIRED") {
    console.log("AUTH_REQUIRED: live CLI smoke skipped");
    return false;
  }

  const authGuidance =
    `${packageResult.stderr}\n${packageResult.stdout}`.trim();
  assert(
    authGuidance.includes("Authentication required"),
    "package auth probe missing authentication guidance",
  );
  assert(
    authGuidance.includes("githits login"),
    "package auth probe missing login guidance",
  );
  console.log("AUTH_REQUIRED: live CLI smoke skipped");
  return false;
}

async function runLiveSmoke(): Promise<void> {
  const resolveText = assertTerminalOutput(
    await runCli(["resolve", "express"]),
    "resolve terminal",
  );
  assert(
    resolveText.includes("Candidates:") &&
      /\n\s+\d+\. npm:express/.test(resolveText),
    "resolve terminal missing numbered express candidate",
  );

  const resolveJson = assertJsonOutput(
    await runCli([
      "resolve",
      "express",
      "--registry",
      "npm",
      "--prefer-kind",
      "package",
      "--intent-hint",
      "web server",
      "--query",
      "web framework",
      "--limit",
      "3",
      "--json",
    ]),
    "resolve json",
  );
  assertRecord(resolveJson, "resolve json");
  assert(
    typeof resolveJson.best === "string" && resolveJson.best === "npm:express",
    "resolve json missing best npm target",
  );
  assert(
    Array.isArray(resolveJson.candidates),
    "resolve json missing candidates",
  );
  assert(
    Array.isArray(resolveJson.protectedMatches),
    "resolve json missing protected matches",
  );

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

  const upgradeReviewText = assertTerminalOutput(
    await runCli([
      "pkg",
      "upgrade-review",
      "npm:express@5.0.0",
      "--to",
      "5.2.1",
      "--no-transitive-security",
    ]),
    "pkg upgrade-review terminal",
  );
  assert(
    upgradeReviewText.includes("pkg_upgrade_review") &&
      upgradeReviewText.includes("vulnerabilities") &&
      upgradeReviewText.includes("changes"),
    "pkg upgrade-review terminal missing evidence sections",
  );
  assert(
    !upgradeReviewText.includes("recommendation") &&
      !upgradeReviewText.includes("risk level"),
    "pkg upgrade-review terminal leaked assessment language",
  );

  const upgradeReviewJson = assertJsonOutput(
    await runCli([
      "pkg",
      "upgrade-review",
      "npm:express@5.0.0",
      "--to",
      "5.2.1",
      "--no-transitive-security",
      "--json",
    ]),
    "pkg upgrade-review json",
  );
  assertRecord(upgradeReviewJson, "pkg upgrade-review json");
  assertRecord(upgradeReviewJson.summary, "pkg upgrade-review json summary");
  assert(
    Array.isArray(upgradeReviewJson.reviews),
    "pkg upgrade-review json missing reviews array",
  );
  const firstUpgradeReview = upgradeReviewJson.reviews[0] as
    | Record<string, unknown>
    | undefined;
  assert(firstUpgradeReview, "pkg upgrade-review json missing first review");
  for (const forbidden of [
    "risk",
    "riskLevel",
    "recommendation",
    "findings",
    "verification",
  ]) {
    assert(
      !(forbidden in firstUpgradeReview),
      `pkg upgrade-review json leaked judgment field ${forbidden}`,
    );
  }

  const docsText = assertTerminalOutput(
    await runCli(["docs", "list", SMOKE_PACKAGE_SPEC, "--limit", "2"]),
    "docs list terminal",
  );
  assert(
    docsText.includes("docs") || docsText.includes("page"),
    "docs list terminal missing docs context",
  );

  const docsJson = assertJsonOutput(
    await runCli([
      "docs",
      "list",
      SMOKE_PACKAGE_SPEC,
      "--limit",
      "2",
      "--json",
    ]),
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
      SMOKE_PACKAGE_SPEC,
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
      SMOKE_PACKAGE_SPEC,
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
      SMOKE_PACKAGE_SPEC,
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
      SMOKE_PACKAGE_SPEC,
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

  const codeReadInvalid = await runCli([
    "code",
    "read",
    SMOKE_PACKAGE_SPEC,
    "lib/",
    "--json",
  ]);
  const codeReadInvalidEnvelope = assertCleanErrorEnvelope(
    codeReadInvalid.stderr,
    "code read invalid json",
  );
  assert(
    codeReadInvalid.exitCode !== 0 &&
      codeReadInvalidEnvelope.code === "INVALID_ARGUMENT" &&
      codeReadInvalidEnvelope.error.includes("githits code files") &&
      codeReadInvalidEnvelope.error.includes("githits code read") &&
      !codeReadInvalidEnvelope.error.includes("code_files"),
    "code read invalid json missing CLI-native recovery",
  );

  const codeGrepText = assertTerminalOutput(
    await runCli([
      "code",
      "grep",
      SMOKE_PACKAGE_SPEC,
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
      SMOKE_PACKAGE_SPEC,
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

  const codeGrepInvalid = await runCli([
    "code",
    "grep",
    SMOKE_PACKAGE_SPEC,
    " ",
    "--json",
  ]);
  const codeGrepInvalidEnvelope = assertCleanErrorEnvelope(
    codeGrepInvalid.stderr,
    "code grep invalid json",
  );
  assert(
    codeGrepInvalid.exitCode !== 0 &&
      codeGrepInvalidEnvelope.code === "INVALID_ARGUMENT" &&
      codeGrepInvalidEnvelope.error.includes("<pattern>") &&
      codeGrepInvalidEnvelope.error.includes("githits code files") &&
      !codeGrepInvalidEnvelope.error.includes("code_files"),
    "code grep invalid json missing CLI-native recovery",
  );

  const codeDiffJson = assertJsonOutput(
    await runCli([
      "code",
      "diff",
      "npm:express",
      "5.2.0..5.2.1",
      "--name-only",
      "--max-files",
      "2",
      "--json",
      "--",
      "**/*.js",
    ]),
    "code diff json",
  );
  assertRecord(codeDiffJson, "code diff json");
  assert(
    codeDiffJson.view === "name-only" &&
      Array.isArray(codeDiffJson.files) &&
      typeof codeDiffJson.from === "object" &&
      typeof codeDiffJson.to === "object",
    "code diff json missing selected view or exact resolutions",
  );

  const codeDiffPatchText = assertTerminalOutput(
    await runCli([
      "code",
      "diff",
      "npm:express",
      "5.2.0..5.2.1",
      "--",
      "lib/utils.js",
    ]),
    "code diff patch",
  );
  assert(
    codeDiffPatchText.startsWith("--- a/lib/utils.js\n+++ b/lib/utils.js\n") &&
      !codeDiffPatchText.includes("--- a/file\n+++ b/file\n"),
    "code diff patch should bind headers to the authoritative file path",
  );

  const codeDiffInvalid = await runCli([
    "code",
    "diff",
    "npm:express",
    "5.2.0...5.2.1",
    "--json",
  ]);
  const codeDiffInvalidEnvelope = assertCleanErrorEnvelope(
    codeDiffInvalid.stderr,
    "code diff invalid json",
  );
  assert(
    codeDiffInvalid.exitCode !== 0 &&
      codeDiffInvalidEnvelope.code === "INVALID_ARGUMENT" &&
      codeDiffInvalidEnvelope.error.includes("not `...`"),
    "code diff invalid JSON should explain the two-dot range",
  );

  const codeDiffBareGlob = await runCli([
    "code",
    "diff",
    "npm:express",
    "5.2.0..5.2.1",
    "**/*.js",
    "--json",
  ]);
  const codeDiffBareGlobEnvelope = assertCleanErrorEnvelope(
    codeDiffBareGlob.stderr,
    "code diff bare glob JSON",
  );
  assert(
    codeDiffBareGlob.exitCode !== 0 &&
      codeDiffBareGlobEnvelope.code === "INVALID_ARGUMENT" &&
      codeDiffBareGlobEnvelope.error.includes("after `--`"),
    "code diff should require the Git-style glob delimiter",
  );

  const searchText = assertTerminalOutput(
    await runCli([
      "search",
      "router",
      "--in",
      SMOKE_PACKAGE_SPEC,
      "--limit",
      "1",
    ]),
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
      SMOKE_PACKAGE_SPEC,
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
      await runCli([
        "search-status",
        searchJson.searchRef,
        "--wait",
        "0",
        "--json",
      ]),
      "search-status json",
    );
    assertRecord(statusJson, "search-status json");
    assert(
      "completed" in statusJson || "progress" in statusJson,
      "search-status json missing status data",
    );
  } else {
    assertJsonErrorCode(
      await runCli([
        "search-status",
        "smoke-invalid-search-ref",
        "--wait",
        "0",
        "--json",
      ]),
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

  assertJsonErrorCode(
    await runCli(["resolve", " ", "--json"]),
    "resolve empty name json error",
    "INVALID_ARGUMENT",
  );
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const options = parseCliSmokeArgs(argv);
  cliLaunchTarget = options.target;
  process.stderr.write(
    `[smoke] CLI launch target: ${formatCliLaunchTarget(options.target)}\n`,
  );
  await assertUnauthenticatedBehavior();
  if (options.mode === "unauthenticated") {
    console.log("CLI unauthenticated smoke passed");
    return;
  }
  if (await assertLiveOrAuthRequired()) {
    await runLiveSmoke();
    await assertJsonParity();
    console.log("CLI smoke passed");
  }
}

if (import.meta.main) {
  try {
    await main();
  } finally {
    printSmokeTimingSummary();
  }
}
