import { join } from "node:path";
import { isResolveDirectTargetUnwarned } from "./resolve-smoke-guidance.ts";
import {
  createIsolatedSmokeEnvironment,
  createScopedSmokeEnvironment,
  writeSmokeConfig,
} from "./smoke-environment.ts";
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

export type CliLiveCohortStatus = "passed" | "skipped";

export function formatCliLiveCohortSummary(
  stable: CliLiveCohortStatus,
  experimental: CliLiveCohortStatus,
): string {
  if (stable === "passed" && experimental === "passed") {
    return "CLI smoke passed: stable and experimental live cohorts passed";
  }
  if (stable === "skipped" && experimental === "skipped") {
    return "CLI smoke skipped: stable and experimental live cohorts skipped (AUTH_REQUIRED)";
  }
  return `CLI smoke partial pass: stable live cohort ${stable}; experimental live cohort ${experimental}`;
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

export const EXPECTED_STABLE_TOP_LEVEL_COMMANDS = [
  "init",
  "uninstall",
  "login",
  "logout",
  "mcp",
  "example",
  "languages",
  "feedback",
  "doctor",
  "settings",
  "search",
  "search-status",
  "code",
  "pkg",
  "docs",
  "auth",
] as const;

export const EXPECTED_EXPERIMENTAL_TOP_LEVEL_COMMANDS = [
  ...EXPECTED_STABLE_TOP_LEVEL_COMMANDS,
  "resolve",
] as const;

/** Backwards-compatible name for the exact stable baseline command set. */
export const EXPECTED_TOP_LEVEL_COMMANDS = EXPECTED_STABLE_TOP_LEVEL_COMMANDS;

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

export function assertRootHelpStructure(
  helpText: string,
  expectedCommands: readonly string[] = EXPECTED_STABLE_TOP_LEVEL_COMMANDS,
): void {
  const actual = new Set(parseRootHelpCommands(helpText));
  const expected = new Set<string>(expectedCommands);
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

export function assertSearchTerminalText(text: string, context: string): void {
  const lines = text.split("\n");
  const formatterLines = searchFormatterLines(lines);
  const formatterText = formatterLines.join("\n");
  const firstLine = lines[0]?.trim() ?? "";
  assert(firstLine.length > 0, `${context}: missing outcome first line`);
  assert(
    !firstLine.startsWith("Warning:") &&
      !firstLine.startsWith("search |") &&
      !firstLine.startsWith("search_status |"),
    `${context}: non-outcome text precedes search outcome`,
  );
  assert(
    /^(?:Preparing|Indexing|Searching)\b|^No results returned\b|^\d+ results?\b|^[A-Z_]+ - /.test(
      firstLine,
    ),
    `${context}: missing outcome headline`,
  );
  assert(
    !formatterLines.some((line) => /^status\s*:/i.test(line.trim())),
    `${context}: duplicated lifecycle status line`,
  );
  const lifecycleOutcomeLines = formatterLines.filter((line) =>
    /^(?:Preparing|Indexing|Searching)\b/.test(line),
  );
  assert(
    lifecycleOutcomeLines.length <= 1,
    `${context}: duplicate lifecycle outcome lines`,
  );
  assert(
    !formatterText.includes("searchRef:") &&
      !formatterText.includes("searchRef="),
    `${context}: leaked searchRef detail`,
  );
  assert(
    !formatterText.includes("indexingRef"),
    `${context}: leaked indexingRef`,
  );
  assert(
    !formatterText.includes("freshnessReason"),
    `${context}: leaked freshnessReason`,
  );

  const forbiddenSections = [
    "Ready:",
    "Waiting:",
    "Available but not searched:",
    "Indexed alternatives:",
  ];
  for (const section of forbiddenSections) {
    assert(
      !formatterLines.some((line) => line.startsWith(section)),
      `${context}: legacy flat section ${section}`,
    );
  }
  assert(
    !formatterLines.some((line) => line === "Evidence may change."),
    `${context}: vague evidence policy prose`,
  );
  assert(
    !formatterLines.some((line) => line.startsWith("Do not repeat")),
    `${context}: repeat policy prose`,
  );
  assert(
    !formatterLines.some((line) => line.startsWith("Do not poll")),
    `${context}: poll policy prose`,
  );

  const hasReadinessText = formatterLines.some((line) =>
    /^ {2}(?! {2}).*(?:Indexing|Searched|Available now|Unavailable|Using|Status):/.test(
      line,
    ),
  );
  if (hasReadinessText) {
    assert(
      formatterLines.some((line) => /^-\s+\S/.test(line)),
      `${context}: readiness details must be grouped under a target`,
    );
  }

  const nextLines = formatterLines.filter((line) => line.startsWith("Next:"));
  assert(
    nextLines.length <= 1,
    `${context}: multiple Next actions are not allowed`,
  );
  const statusActions = nextLines.filter((line) =>
    line.startsWith("Next: githits search-status "),
  );
  assert(
    statusActions.length <= 1,
    `${context}: expected at most one search-status action`,
  );
  const summaryLines = formatterLines.filter((line) =>
    /^Search\s+\S+\s+\|/.test(line),
  );
  assert(
    summaryLines.length <= 1,
    `${context}: expected at most one Search <ref> session summary`,
  );
  if (statusActions.length > 0) {
    assert(
      summaryLines.length === 1,
      `${context}: expected one Search <ref> session summary`,
    );
  }
  if (statusActions.length === 1) {
    const searchRef = statusActions[0]?.match(
      /^Next: githits search-status (\S+) /,
    )?.[1];
    assert(
      searchRef !== undefined &&
        summaryLines[0]?.startsWith(`Search ${searchRef} |`),
      `${context}: session summary does not match search-status action`,
    );
  }
  assert(
    !formatterText.includes("search_ref="),
    `${context}: MCP search_ref syntax leaked into CLI output`,
  );
  assert(
    hasHumanSearchHitLocator(lines) || nextLines.length > 0,
    `${context}: missing result follow-up or next action`,
  );
}

function hasHumanSearchHitLocator(lines: string[]): boolean {
  return lines.some((line, index) => {
    const docsMatch = /^\[\d+\]\s+(\S+)\s+\[docs page\]\s+(.+)$/.exec(line);
    if (docsMatch) {
      const pageId = docsMatch[1];
      const docsDetails = docsMatch[2];
      if (!pageId || pageId === "page ID unavailable" || !docsDetails) {
        return false;
      }
      const firstDivider = docsDetails.indexOf(" - ");
      if (firstDivider <= 0) return false;
      const sourceAndTitle = docsDetails.slice(firstDivider + 3);
      const secondDivider = sourceAndTitle.indexOf(" - ");
      if (secondDivider > 0) {
        const source = sourceAndTitle.slice(0, secondDivider).trim();
        const title = sourceAndTitle.slice(secondDivider + 3).trim();
        return (
          source.length > 0 &&
          (title.length > 0 || hasWrappedHitTitle(lines, index))
        );
      }
      if (!sourceAndTitle.endsWith(" -")) return false;
      const source = sourceAndTitle.slice(0, -2).trim();
      return source.length > 0 && hasWrappedHitTitle(lines, index);
    }
    const match =
      /^\[\d+\]\s+(.+?)\s+\[(repo doc|repo code|repo symbol)\](?: -(?: (.*))?)?$/.exec(
        line,
      );
    if (!match) return false;
    const locatorText = match[1];
    if (!locatorText) return false;
    const locator = locatorText.trim().split(/\s+/);
    if (
      locator.length >= 2 &&
      !locatorText.trim().endsWith("location unavailable") &&
      locator.every((part) => part.length > 0)
    ) {
      const title = match[3];
      return title === undefined
        ? !line.endsWith(" -") || hasWrappedHitTitle(lines, index)
        : title.trim().length > 0 || hasWrappedHitTitle(lines, index);
    }
    return false;
  });
}

function hasWrappedHitTitle(lines: string[], index: number): boolean {
  const titleLine = lines[index + 1];
  return titleLine?.startsWith("  ") === true && titleLine.trim().length > 0;
}

function searchFormatterLines(lines: string[]): string[] {
  let inHit = false;
  return lines.filter((line) => {
    if (/^\[\d+\]\s/.test(line)) {
      inHit = true;
      return true;
    }
    if (inHit && line.length > 0 && !line.startsWith("  ")) inHit = false;
    return !inHit;
  });
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

async function assertJsonParity(
  env: Record<string, string> = inheritedEnv(),
): Promise<void> {
  const runCli = (args: string[]): Promise<CommandResult> =>
    runCliWithEnv(args, env);
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
    writeSmokeConfig(env, "[experimental]\ntools = false\n");
    const helpResult = await runCliWithEnv(["--help"], env);
    assert(helpResult.exitCode === 0, "root help should succeed");
    assert(
      helpResult.stdout.trim().length > 0,
      "root help should produce stdout",
    );
    assertRootHelpStructure(
      helpResult.stdout,
      EXPECTED_STABLE_TOP_LEVEL_COMMANDS,
    );
    assert(
      !helpResult.stdout.includes("resolve"),
      "stable root help should omit resolve",
    );

    const codeHelp = await runCliWithEnv(["code", "--help"], env);
    assert(
      codeHelp.exitCode === 0 && !codeHelp.stdout.includes("diff"),
      "stable code help should omit diff",
    );

    const configHome = env.XDG_CONFIG_HOME;
    assert(configHome, "isolated smoke environment missing config home");
    const configPath = join(configHome, "githits", "config.toml");
    const disabledResolve = await runCliWithEnv(["resolve", "express"], env);
    assert(
      disabledResolve.exitCode !== 0 &&
        `${disabledResolve.stderr}\n${disabledResolve.stdout}`.includes(
          `Experimental CLI command "resolve" is disabled. Enable it in ${configPath} by adding:\n[experimental]\ntools = true`,
        ),
      "disabled resolve should expose the exact config path and snippet",
    );

    const disabledResolveJson = await runCliWithEnv(
      ["resolve", "express", "--json"],
      env,
    );
    assertJsonErrorCode(
      disabledResolveJson,
      "disabled resolve JSON",
      "INVALID_ARGUMENT",
    );
    assert(
      disabledResolveJson.stdout.trim() === "",
      "disabled resolve JSON should keep stdout empty",
    );
    assert(
      assertCleanErrorEnvelope(
        disabledResolveJson.stderr,
        "disabled resolve JSON",
      ).error.includes(`[experimental]\ntools = true`),
      "disabled resolve JSON should retain the enable snippet",
    );

    const disabledCodeDiff = await runCliWithEnv(
      ["code", "diff", "npm:express", "5.2.0..5.2.1"],
      env,
    );
    assert(
      disabledCodeDiff.exitCode !== 0 &&
        `${disabledCodeDiff.stderr}\n${disabledCodeDiff.stdout}`.includes(
          `Experimental CLI command "code diff" is disabled. Enable it in ${configPath} by adding:\n[experimental]\ntools = true`,
        ),
      "disabled code diff should expose the exact config path and snippet",
    );

    const disabledCodeDiffJson = await runCliWithEnv(
      ["code", "diff", "npm:express", "5.2.0..5.2.1", "--json"],
      env,
    );
    assertJsonErrorCode(
      disabledCodeDiffJson,
      "disabled code diff JSON",
      "INVALID_ARGUMENT",
    );
    assert(
      disabledCodeDiffJson.stdout.trim() === "",
      "disabled code diff JSON should keep stdout empty",
    );
    assert(
      assertCleanErrorEnvelope(
        disabledCodeDiffJson.stderr,
        "disabled code diff JSON",
      ).error.includes(`[experimental]\ntools = true`),
      "disabled code diff JSON should retain the enable snippet",
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
  } finally {
    isolated.cleanup();
  }
}

async function assertExperimentalUnauthenticatedBehavior(): Promise<void> {
  const isolated = createIsolatedSmokeEnvironment(
    "githits-cli-experimental-smoke-home-",
  );
  const { env } = isolated;
  try {
    writeSmokeConfig(env, "[experimental]\ntools = true\n");
    const helpResult = await runCliWithEnv(["--help"], env);
    assert(helpResult.exitCode === 0, "experimental root help should succeed");
    assertRootHelpStructure(
      helpResult.stdout,
      EXPECTED_EXPERIMENTAL_TOP_LEVEL_COMMANDS,
    );
    assert(
      helpResult.stdout.includes("githits resolve express"),
      "experimental root help should include resolve in Getting started",
    );

    const codeHelp = await runCliWithEnv(["code", "--help"], env);
    assert(
      codeHelp.exitCode === 0 && codeHelp.stdout.includes("diff"),
      "experimental code help should expose diff",
    );
    const resolveHelp = await runCliWithEnv(["resolve", "--help"], env);
    assert(
      resolveHelp.exitCode === 0 &&
        resolveHelp.stdout.includes("credentials") &&
        resolveHelp.stdout.includes("private code"),
      "experimental resolve help should expose privacy guidance",
    );
    const codeDiffHelp = await runCliWithEnv(["code", "diff", "--help"], env);
    assert(
      codeDiffHelp.exitCode === 0 &&
        codeDiffHelp.stdout.includes("<from>..<to>") &&
        codeDiffHelp.stdout.includes("--name-status"),
      "experimental code diff help should expose the bounded contract",
    );

    const resolveJson = await runCliWithEnv(
      ["resolve", "express", "--json"],
      env,
    );
    assertJsonErrorCode(
      resolveJson,
      "experimental unauthenticated resolve",
      "AUTH_REQUIRED",
    );
    const codeDiffJson = await runCliWithEnv(
      ["code", "diff", "npm:express", "5.2.0..5.2.1", "--json"],
      env,
    );
    assertJsonErrorCode(
      codeDiffJson,
      "experimental unauthenticated code diff",
      "AUTH_REQUIRED",
    );
  } finally {
    isolated.cleanup();
  }
}

async function assertLiveOrAuthRequired(
  env: Record<string, string> = inheritedEnv(),
): Promise<boolean> {
  const languagesResult = await runCliWithEnv(
    ["languages", "python", "--json"],
    env,
  );
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

  const packageResult = await runCliWithEnv(
    ["pkg", "info", "npm:express", "--json"],
    env,
  );
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

export function assertExperimentalCliResolveText(resolveText: string): void {
  assert(
    (resolveText.includes("Targets:") ||
      resolveText.includes("Unconfirmed ranked targets:")) &&
      /\n\s+\d+\. (?:npm|github|site):\S+/.test(resolveText),
    "experimental resolve text should include canonical target groups",
  );
  const directTarget = resolveText.match(
    /Next: githits search .+ --in '((?:npm|github|site):[^']+)'/,
  )?.[1];
  if (directTarget) {
    assert(
      isResolveDirectTargetUnwarned(resolveText, directTarget),
      "experimental direct resolve action should target a listed direct candidate without a warning",
    );
    return;
  }
  if (resolveText.includes("Warning:")) {
    assert(
      !resolveText.includes("Next:") &&
        !resolveText.includes("Next after choosing:"),
      "experimental malicious-blocked resolve text should omit the normal next action",
    );
  } else if (resolveText.includes("Unconfirmed ranked targets:")) {
    assert(
      resolveText.includes("explicitly choose a candidate") &&
        resolveText.includes("--in '<target>'"),
      "experimental unconfirmed resolve text should require an explicit choice",
    );
  } else if (resolveText.includes("Ambiguous:")) {
    assert(
      resolveText.includes("Next after choosing:"),
      "experimental ambiguous resolve text should require an explicit choice",
    );
  } else {
    assert(false, "experimental resolve text missing continuation guidance");
  }
}

async function runExperimentalLiveSmoke(
  env: Record<string, string>,
): Promise<void> {
  const resolveText = assertTerminalOutput(
    await runCliWithEnv(["resolve", "express"], env),
    "experimental resolve terminal",
  );
  assertExperimentalCliResolveText(resolveText);
  for (const expected of [
    "npm:express",
    "github:expressjs/express",
    "site:expressjs.com",
    "Related targets:",
  ]) {
    assert(
      resolveText.includes(expected),
      `experimental express resolution missing ${expected}`,
    );
  }

  const siteResolveText = assertTerminalOutput(
    await runCliWithEnv(["resolve", "expressjs"], env),
    "experimental site resolve terminal",
  );
  assertExperimentalCliResolveText(siteResolveText);
  assert(
    /\n {2}1\. site:expressjs\.com \[(?:exact|high)\] · site/.test(
      siteResolveText,
    ) &&
      siteResolveText.includes("Related targets:") &&
      siteResolveText.includes("npm:express · related package") &&
      siteResolveText.includes("github:expressjs/express · related repository"),
    "experimental expressjs resolution should directly match the site and group related package/repository targets",
  );

  const fuzzyResolveText = assertTerminalOutput(
    await runCliWithEnv(["resolve", "lodahs", "--prefer-kind", "package"], env),
    "experimental fuzzy resolve terminal",
  );
  assert(
    /\d+% name similarity/.test(fuzzyResolveText) &&
      fuzzyResolveText.includes(
        "Name similarity is coarse lexical support; candidate order follows broader backend policy.",
      ) &&
      fuzzyResolveText.includes("indexed package snapshot") &&
      fuzzyResolveText.includes(
        "code commands do so only when they resolve and serve a commit SHA",
      ),
    "experimental fuzzy resolve text should qualify lexical and indexed-snapshot evidence",
  );

  const resolveJson = assertJsonOutput(
    await runCliWithEnv(
      [
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
      ],
      env,
    ),
    "experimental resolve json",
  );
  assertRecord(resolveJson, "experimental resolve json");
  assert(
    typeof resolveJson.best === "string" &&
      resolveJson.best === "npm:express" &&
      Array.isArray(resolveJson.candidates) &&
      resolveJson.candidates.some(
        (candidate) =>
          candidate !== null &&
          typeof candidate === "object" &&
          candidate.target === "npm:express" &&
          typeof candidate.latestVersionMaliciousStatus === "string",
      ) &&
      Array.isArray(resolveJson.protectedMatches) &&
      typeof resolveJson.targetsTruncated === "boolean",
    "experimental resolve JSON missing structured candidate facts",
  );

  const fuzzyResolveJson = assertJsonOutput(
    await runCliWithEnv(
      ["resolve", "lodahs", "--prefer-kind", "package", "--json"],
      env,
    ),
    "experimental fuzzy resolve json",
  );
  assertRecord(fuzzyResolveJson, "experimental fuzzy resolve json");
  assert(
    Array.isArray(fuzzyResolveJson.candidates) &&
      fuzzyResolveJson.candidates.some(
        (candidate) =>
          candidate !== null &&
          typeof candidate === "object" &&
          candidate.target === "npm:lodash" &&
          typeof candidate.nameSimilarity === "number",
      ),
    "experimental fuzzy resolve JSON should preserve numeric name similarity for npm:lodash",
  );

  const codeDiffText = assertTerminalOutput(
    await runCliWithEnv(
      [
        "code",
        "diff",
        "npm:express",
        "5.2.0..5.2.1",
        "--name-status",
        "--max-files",
        "2",
      ],
      env,
    ),
    "experimental code diff terminal",
  );
  assert(
    /^[AMDRT?]\t\S.+$/m.test(codeDiffText),
    "experimental code diff text should include CLI-native status/path evidence",
  );

  const codeDiffJson = assertJsonOutput(
    await runCliWithEnv(
      [
        "code",
        "diff",
        "npm:express",
        "5.2.0..5.2.1",
        "--name-status",
        "--max-files",
        "2",
        "--json",
      ],
      env,
    ),
    "experimental code diff json",
  );
  assertRecord(codeDiffJson, "experimental code diff json");
  assert(
    codeDiffJson.view === "name-status" &&
      Array.isArray(codeDiffJson.files) &&
      typeof codeDiffJson.from === "object" &&
      typeof codeDiffJson.to === "object",
    "experimental code diff JSON missing exact resolutions",
  );
}

async function runLiveSmoke(env: Record<string, string>): Promise<void> {
  const runCli = (args: string[]): Promise<CommandResult> =>
    runCliWithEnv(args, env);
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
  const upgradeReviewFirstLine = upgradeReviewText.split("\n")[0]?.trim();
  assert(
    upgradeReviewFirstLine === "Upgrade review - 1 package",
    "pkg upgrade-review terminal missing outcome headline",
  );
  assert(
    upgradeReviewText.includes("npm:express 5.0.0 -> 5.2.1") &&
      upgradeReviewText.includes("\nSecurity\n") &&
      upgradeReviewText.includes("\nChanges\n"),
    "pkg upgrade-review terminal missing grouped evidence",
  );
  assert(
    !upgradeReviewText.includes("pkg_upgrade_review") &&
      !/\b(?:recommendation|risk level|assessment)\b/i.test(upgradeReviewText),
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
  assertSearchTerminalText(searchText, "search terminal");

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
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const options = parseCliSmokeArgs(argv);
  cliLaunchTarget = options.target;
  process.stderr.write(
    `[smoke] CLI launch target: ${formatCliLaunchTarget(options.target)}\n`,
  );
  await assertUnauthenticatedBehavior();
  await assertExperimentalUnauthenticatedBehavior();
  if (options.mode === "unauthenticated") {
    console.log("CLI stable + experimental unauthenticated smoke passed");
    return;
  }
  const stableLive = createScopedSmokeEnvironment(
    "githits-cli-live-stable-home-",
  );
  let stableStatus: CliLiveCohortStatus = "skipped";
  try {
    writeSmokeConfig(stableLive.env, "[experimental]\ntools = false\n");
    if (await assertLiveOrAuthRequired(stableLive.env)) {
      await runLiveSmoke(stableLive.env);
      await assertJsonParity(stableLive.env);
      stableStatus = "passed";
    }
  } finally {
    stableLive.cleanup();
  }

  const experimentalLive = createScopedSmokeEnvironment(
    "githits-cli-live-experimental-home-",
  );
  let experimentalStatus: CliLiveCohortStatus = "skipped";
  try {
    writeSmokeConfig(experimentalLive.env, "[experimental]\ntools = true\n");
    if (await assertLiveOrAuthRequired(experimentalLive.env)) {
      await runExperimentalLiveSmoke(experimentalLive.env);
      experimentalStatus = "passed";
    }
  } finally {
    experimentalLive.cleanup();
  }
  console.log(formatCliLiveCohortSummary(stableStatus, experimentalStatus));
}

function inheritedEnv(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
}

if (import.meta.main) {
  try {
    await main();
  } finally {
    printSmokeTimingSummary();
  }
}
