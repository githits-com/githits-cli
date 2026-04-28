import {
  type ParseError,
  parse as parseJsonc,
  printParseErrorCode,
} from "jsonc-parser";
import type { ExecService } from "../../services/exec-service.js";
import type { FileSystemService } from "../../services/filesystem-service.js";
import type {
  CliCommand,
  CliSetup,
  ConfigFileSetup,
} from "./agent-definitions.js";

/** A read-only command to check if a CLI agent is already configured. */
export interface CliCheckCommand {
  /** Command to execute (e.g., "claude") */
  command: string;
  /** Command arguments (e.g., ["plugin", "list"]) */
  args: string[];
  /**
   * Pattern to search for in combined stdout+stderr. If found, agent is configured.
   * Optional when using a negative-only check via notConfiguredPattern.
   */
  configuredPattern?: RegExp;
  /**
   * Pattern indicating the agent is definitely not configured.
   * Checked before configuredPattern.
   */
  notConfiguredPattern?: RegExp;
  /** Require exitCode=0 for the check command to be considered valid. */
  requireExitCodeZero?: boolean;
}

export type CliCheckStatus = "configured" | "not_configured" | "probe_failed";

/** Result of merging server config into an existing config file */
export type MergeResult =
  | { status: "added" | "updated"; content: string }
  | { status: "already_configured" }
  | { status: "parse_error"; error: string };

export type ConfigFormat = "json" | "jsonc" | "invalid";

type ParsedConfigResult =
  | {
      format: "json" | "jsonc";
      value: Record<string, unknown>;
    }
  | {
      format: "invalid";
      error: string;
    };

function parseConfigObject(content: string): ParsedConfigResult {
  let normalizedContent = content;
  if (normalizedContent.charCodeAt(0) === 0xfeff) {
    normalizedContent = normalizedContent.slice(1);
  }

  const trimmed = normalizedContent.trim();
  if (trimmed === "") {
    return {
      format: "json",
      value: {},
    };
  }

  try {
    const parsed = JSON.parse(normalizedContent);
    if (!isPlainObject(parsed)) {
      return {
        format: "invalid",
        error: "Config file root is not a JSON object",
      };
    }
    return {
      format: "json",
      value: parsed,
    };
  } catch (jsonError) {
    const parseErrors: ParseError[] = [];
    const parsed = parseJsonc(normalizedContent, parseErrors, {
      allowTrailingComma: true,
      disallowComments: false,
      allowEmptyContent: false,
    });

    if (parseErrors.length > 0) {
      const firstParseError = parseErrors[0];
      const strictErrorMessage =
        jsonError instanceof Error ? jsonError.message : String(jsonError);
      const jsoncDetail = firstParseError
        ? `${printParseErrorCode(firstParseError.error)} at offset ${firstParseError.offset}`
        : "Unknown parse error";
      return {
        format: "invalid",
        error: `Invalid JSON: ${strictErrorMessage}. JSONC parse error: ${jsoncDetail}`,
      };
    }

    if (!isPlainObject(parsed)) {
      return {
        format: "invalid",
        error: "Config file root is not a JSON object",
      };
    }

    return {
      format: "jsonc",
      value: parsed,
    };
  }
}

/**
 * Detect whether config content is strict JSON, JSONC, or invalid.
 *
 * Used by tests and diagnostics to assert parser behavior independently from
 * merge/check flows.
 */
export function detectConfigFormat(content: string): ConfigFormat {
  const parsed = parseConfigObject(content);
  return parsed.format;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true;
  }

  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) {
      return false;
    }
    for (let i = 0; i < left.length; i++) {
      if (!deepEqual(left[i], right[i])) {
        return false;
      }
    }
    return true;
  }

  if (isPlainObject(left) && isPlainObject(right)) {
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    if (!deepEqual(leftKeys, rightKeys)) {
      return false;
    }
    for (const key of leftKeys) {
      if (!deepEqual(left[key], right[key])) {
        return false;
      }
    }
    return true;
  }

  return false;
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

function isGitHitsPackageToken(token: string): boolean {
  return token.toLowerCase() === "githits@latest";
}

function isLocalGitHitsInvocation(invocation: string[]): boolean {
  if (invocation.length === 5) {
    const [command, yesFlag, packageToken, subcommand, action] = invocation;
    return (
      command === "npx" &&
      yesFlag === "-y" &&
      typeof packageToken === "string" &&
      isGitHitsPackageToken(packageToken) &&
      subcommand === "mcp" &&
      action === "start"
    );
  }

  return false;
}

function extractInvocation(config: unknown): string[] | null {
  if (!isPlainObject(config)) {
    return null;
  }

  const command = config.command;
  if (typeof command === "string") {
    const args = config.args;
    if (!isStringArray(args)) {
      return null;
    }
    return [command, ...args];
  }

  if (isStringArray(command)) {
    return [...command];
  }

  return null;
}

function nonCommandFieldsEqual(
  existing: Record<string, unknown>,
  expected: Record<string, unknown>,
): boolean {
  for (const [key, value] of Object.entries(expected)) {
    if (key === "command" || key === "args") {
      continue;
    }
    if (!deepEqual(existing[key], value)) {
      return false;
    }
  }
  return true;
}

function hasLegacyRemoteIndicators(
  existing: Record<string, unknown>,
  expected: Record<string, unknown>,
): boolean {
  if ("url" in existing || "serverUrl" in existing) {
    return true;
  }

  if (
    "type" in existing &&
    !("type" in expected) &&
    (existing.type === "http" || existing.type === "streamableHttp")
  ) {
    return true;
  }

  return false;
}

function isEquivalentConfiguredValue(
  existing: unknown,
  expected: Record<string, unknown>,
): boolean {
  if (deepEqual(existing, expected)) {
    return true;
  }

  if (!isPlainObject(existing)) {
    return false;
  }

  const expectedInvocation = extractInvocation(expected);
  const existingInvocation = extractInvocation(existing);
  if (!expectedInvocation || !existingInvocation) {
    return false;
  }

  if (
    !isLocalGitHitsInvocation(expectedInvocation) ||
    !isLocalGitHitsInvocation(existingInvocation)
  ) {
    return false;
  }

  if (hasLegacyRemoteIndicators(existing, expected)) {
    return false;
  }

  return nonCommandFieldsEqual(existing, expected);
}

function getMatchingServerKeys(
  servers: Record<string, unknown>,
  serverName: string,
): string[] {
  const normalizedTarget = serverName.toLowerCase();
  return Object.keys(servers).filter(
    (key) => key.toLowerCase() === normalizedTarget,
  );
}

/** Result of executing a setup operation */
export interface SetupResult {
  status: "success" | "already_configured" | "failed";
  /** Human-readable message describing the outcome */
  message: string;
}

/**
 * Merge a new MCP server entry into existing JSON config content.
 * Pure function — no IO, no side effects.
 *
 * Handles edge cases:
 * - Empty or missing content (starts from {})
 * - Existing config with other servers (preserves them)
 * - Server already configured (returns already_configured)
 * - Malformed JSON (returns parse_error, never destroys content)
 * - BOM prefix (strips before parsing)
 */
export function mergeServerConfig(
  existingContent: string,
  serversKey: string,
  serverName: string,
  serverConfig: Record<string, unknown>,
): MergeResult {
  const parsedConfig = parseConfigObject(existingContent);
  if (parsedConfig.format === "invalid") {
    return {
      status: "parse_error",
      error: parsedConfig.error,
    };
  }
  const config = parsedConfig.value;

  // Get or create the servers section
  if (!(serversKey in config)) {
    config[serversKey] = {};
  }

  const servers = config[serversKey];
  if (
    typeof servers !== "object" ||
    servers === null ||
    Array.isArray(servers)
  ) {
    return {
      status: "parse_error",
      error: `"${serversKey}" is not a JSON object`,
    };
  }

  // Check if already configured
  const serversObj = servers as Record<string, unknown>;
  const matchingKeys = getMatchingServerKeys(serversObj, serverName);
  if (
    matchingKeys.length === 1 &&
    matchingKeys[0] === serverName &&
    isEquivalentConfiguredValue(serversObj[serverName], serverConfig)
  ) {
    return { status: "already_configured" };
  }

  // Add or migrate server entry; collapse case-variant duplicates.
  for (const key of matchingKeys) {
    delete serversObj[key];
  }

  const hadExisting = matchingKeys.length > 0;
  serversObj[serverName] = serverConfig;

  return {
    status: hadExisting ? "updated" : "added",
    content: `${JSON.stringify(config, null, 2)}\n`,
  };
}

/**
 * Format a setup config for display to the user before confirmation.
 * Returns human-readable description of what will happen.
 */
export function formatSetupPreview(config: CliSetup | ConfigFileSetup): string {
  if (config.method === "cli") {
    return config.commands
      .map((cmd) => `Will run: ${cmd.command} ${cmd.args.join(" ")}`)
      .join("\n");
  }
  const snippet = JSON.stringify(
    { [config.serverName]: config.serverConfig },
    null,
    2,
  );
  return `Will add to ${config.configPath}:\n\n${snippet}`;
}

/**
 * Check if GitHits is already configured in a config file.
 * Read-only — never writes. Returns false on any error (file missing, parse failure).
 */
export async function isAlreadyConfigured(
  config: ConfigFileSetup,
  fs: FileSystemService,
): Promise<boolean> {
  try {
    const content = await fs.readFile(config.configPath);
    const parsedConfig = parseConfigObject(content);
    if (parsedConfig.format === "invalid") {
      return false;
    }
    const parsed = parsedConfig.value;

    const servers = parsed[config.serversKey];
    if (
      typeof servers !== "object" ||
      servers === null ||
      Array.isArray(servers)
    ) {
      return false;
    }

    const serversObj = servers as Record<string, unknown>;
    const matchingKeys = getMatchingServerKeys(serversObj, config.serverName);
    if (matchingKeys.length !== 1 || matchingKeys[0] !== config.serverName) {
      return false;
    }

    return isEquivalentConfiguredValue(
      serversObj[config.serverName],
      config.serverConfig,
    );
  } catch {
    return false;
  }
}

/**
 * Check if a CLI agent is already configured by running a read-only check command.
 * Checks pattern against combined stdout+stderr regardless of exit code.
 * Returns false on ENOENT or when pattern does not match.
 */
export async function isCliAlreadyConfigured(
  check: CliCheckCommand,
  execService: ExecService,
): Promise<boolean> {
  return (await getCliCheckStatus(check, execService)) === "configured";
}

/**
 * Check CLI configuration status with tri-state output so callers can
 * distinguish a definitive "not configured" from probe failures.
 */
export async function getCliCheckStatus(
  check: CliCheckCommand,
  execService: ExecService,
): Promise<CliCheckStatus> {
  try {
    const result = await execService.exec(check.command, check.args);
    if (check.requireExitCodeZero && result.exitCode !== 0) {
      return "probe_failed";
    }
    const combined = `${result.stdout} ${result.stderr}`;
    if (check.notConfiguredPattern?.test(combined)) {
      return "not_configured";
    }
    if (check.configuredPattern) {
      return check.configuredPattern.test(combined)
        ? "configured"
        : "not_configured";
    }
    if (check.notConfiguredPattern) {
      return "configured";
    }
    return "not_configured";
  } catch {
    return "probe_failed";
  }
}

/** Patterns in CLI output that indicate the server was already configured */
const ALREADY_EXISTS_PATTERNS = [
  /already exists/i,
  /already configured/i,
  /already added/i,
  /extension\s+"githits"\s+is\s+already\s+installed/i,
];

/** Check if CLI output indicates the server is already configured */
function isAlreadyConfiguredOutput(output: string): boolean {
  return ALREADY_EXISTS_PATTERNS.some((pattern) => pattern.test(output));
}

/**
 * Execute a single CLI command step.
 * Returns a result object — does not throw on failure.
 */
async function executeCliCommand(
  cmd: CliCommand,
  execService: ExecService,
): Promise<SetupResult> {
  try {
    const result = await execService.exec(cmd.command, cmd.args);
    const combined = `${result.stdout} ${result.stderr}`;

    // Check for "already exists" in output regardless of exit code
    if (isAlreadyConfiguredOutput(combined)) {
      return {
        status: "already_configured",
        message: `GitHits already configured via ${cmd.command}`,
      };
    }

    if (result.exitCode === 0) {
      return { status: "success", message: "Configured successfully" };
    }
    const detail = result.stderr.trim() || result.stdout.trim();
    return {
      status: "failed",
      message: `Command exited with code ${result.exitCode}${detail ? `: ${detail}` : ""}`,
    };
  } catch (err) {
    // ENOENT means the CLI binary is not installed/on PATH
    if (err instanceof Error && "code" in err && err.code === "ENOENT") {
      return {
        status: "failed",
        message: `"${cmd.command}" not found on PATH. Install it or configure manually.`,
      };
    }
    return {
      status: "failed",
      message: `Failed to run command: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Execute a CLI-based setup with one or more sequential commands.
 * Returns a result object — does not throw on failure.
 *
 * For multi-step setups (e.g., plugin marketplace add + plugin install),
 * commands run sequentially and stop on first failure.
 * If any step reports "already_configured", the overall result is "already_configured".
 */
export async function executeCliSetup(
  setup: CliSetup,
  execService: ExecService,
): Promise<SetupResult> {
  let anyAlreadyConfigured = false;

  for (const cmd of setup.commands) {
    const result = await executeCliCommand(cmd, execService);

    if (result.status === "failed") {
      return result;
    }
    if (result.status === "already_configured") {
      anyAlreadyConfigured = true;
    }
  }

  if (anyAlreadyConfigured) {
    return {
      status: "already_configured",
      message: `GitHits already configured via ${setup.commands[0]?.command}`,
    };
  }

  return { status: "success", message: "Configured successfully" };
}

/**
 * Execute a config-file-based setup (read/merge/atomic-write).
 * Returns a result object — does not throw on failure.
 */
export async function executeConfigFileSetup(
  setup: ConfigFileSetup,
  fs: FileSystemService,
): Promise<SetupResult> {
  try {
    // Ensure parent directory exists
    const parentDir = fs.getDirname(setup.configPath);
    await fs.ensureDir(parentDir);

    // Read existing content or start fresh
    let existingContent = "";
    try {
      existingContent = await fs.readFile(setup.configPath);
    } catch (err) {
      // ENOENT is expected for new files
      if (
        !(err instanceof Error) ||
        !("code" in err) ||
        err.code !== "ENOENT"
      ) {
        return {
          status: "failed",
          message: `Cannot read ${setup.configPath}: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    }

    // Merge config
    const result = mergeServerConfig(
      existingContent,
      setup.serversKey,
      setup.serverName,
      setup.serverConfig,
    );

    if (result.status === "already_configured") {
      return {
        status: "already_configured",
        message: `GitHits already configured in ${setup.configPath}`,
      };
    }

    if (result.status === "parse_error") {
      return {
        status: "failed",
        message: `Cannot parse ${setup.configPath}: ${result.error}. File left unchanged.`,
      };
    }

    // Atomic write — result.status is "added" or "updated" here
    await fs.atomicWriteFile(setup.configPath, result.content);

    return { status: "success", message: "Configured successfully" };
  } catch (err) {
    if (err instanceof Error && "code" in err && err.code === "EACCES") {
      return {
        status: "failed",
        message: `Permission denied writing to ${setup.configPath}. Check file permissions.`,
      };
    }
    return {
      status: "failed",
      message: `Failed to configure: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
