import type { ExecService } from "../../services/exec-service.js";
import type { FileSystemService } from "../../services/filesystem-service.js";
import type { CliSetup, ConfigFileSetup } from "./agent-definitions.js";

/** Result of merging server config into an existing config file */
export type MergeResult =
  | { status: "added"; content: string }
  | { status: "already_configured" }
  | { status: "parse_error"; error: string };

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
  // Strip BOM if present
  let content = existingContent;
  if (content.charCodeAt(0) === 0xfeff) {
    content = content.slice(1);
  }

  // Handle empty content
  const trimmed = content.trim();
  if (trimmed === "") {
    content = "{}";
  }

  // Parse existing JSON
  let config: Record<string, unknown>;
  try {
    config = JSON.parse(content);
  } catch (err) {
    return {
      status: "parse_error",
      error: `Invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // Ensure it's an object
  if (typeof config !== "object" || config === null || Array.isArray(config)) {
    return {
      status: "parse_error",
      error: "Config file root is not a JSON object",
    };
  }

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
  if (serverName in serversObj) {
    return { status: "already_configured" };
  }

  // Add server entry
  serversObj[serverName] = serverConfig;

  return {
    status: "added",
    content: `${JSON.stringify(config, null, 2)}\n`,
  };
}

/**
 * Format a setup config for display to the user before confirmation.
 * Returns human-readable description of what will happen.
 */
export function formatSetupPreview(config: CliSetup | ConfigFileSetup): string {
  if (config.method === "cli") {
    return `Will run: ${config.command} ${config.args.join(" ")}`;
  }
  const snippet = JSON.stringify(
    { [config.serverName]: config.serverConfig },
    null,
    2,
  );
  return `Will add to ${config.configPath}:\n\n${snippet}`;
}

/** Patterns in CLI output that indicate the server was already configured */
const ALREADY_EXISTS_PATTERNS = [
  /already exists/i,
  /already configured/i,
  /already added/i,
];

/** Check if CLI output indicates the server is already configured */
function isAlreadyConfiguredOutput(output: string): boolean {
  return ALREADY_EXISTS_PATTERNS.some((pattern) => pattern.test(output));
}

/**
 * Execute a CLI-based setup (e.g., `claude mcp add`).
 * Returns a result object — does not throw on failure.
 *
 * Handles idempotency: `claude mcp add` exits 1 with "already exists" on
 * duplicate, while `codex mcp add` exits 0. Both are detected and mapped
 * to "already_configured".
 */
export async function executeCliSetup(
  setup: CliSetup,
  execService: ExecService,
): Promise<SetupResult> {
  try {
    const result = await execService.exec(setup.command, setup.args);
    const combined = `${result.stdout} ${result.stderr}`;

    // Check for "already exists" in output regardless of exit code
    if (isAlreadyConfiguredOutput(combined)) {
      return {
        status: "already_configured",
        message: `GitHits already configured via ${setup.command}`,
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
        message: `"${setup.command}" not found on PATH. Install it or configure manually.`,
      };
    }
    return {
      status: "failed",
      message: `Failed to run command: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
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

    // Atomic write — result.status is "added" here (other statuses returned above)
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
