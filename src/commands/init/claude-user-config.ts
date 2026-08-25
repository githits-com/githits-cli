import type { FileSystemService } from "../../services/filesystem-service.js";

const CLAUDE_USER_CONFIG_FILE = ".claude.json";
const CANONICAL_COMMAND = "npx";
const CANONICAL_ARGS = ["-y", "githits@latest", "mcp", "start"] as const;

/** Bounded diagnostics for Claude user-config inspection. */
export type ClaudeUserMcpStateReason =
  | "missing_file"
  | "missing_mcp_servers"
  | "missing_server"
  | "invalid_json"
  | "invalid_root"
  | "invalid_mcp_servers"
  | "invalid_server"
  | "unreadable"
  | "non_canonical";

export type ClaudeUserMcpStateStatus =
  | "configured"
  | "non_canonical"
  | "not_configured"
  | "probe_failed";

export type ClaudeUserMcpParseResult =
  | {
      status: "configured";
    }
  | {
      status: "non_canonical";
      reason: "non_canonical";
    }
  | {
      status: "not_configured";
      reason: "missing_mcp_servers" | "missing_server";
    }
  | {
      status: "probe_failed";
      reason:
        | "invalid_json"
        | "invalid_root"
        | "invalid_mcp_servers"
        | "invalid_server";
    };

export type ClaudeUserMcpState =
  | {
      status: "configured";
      path: string;
    }
  | {
      status: "non_canonical";
      reason: "non_canonical";
      path: string;
    }
  | {
      status: "not_configured";
      reason: "missing_file" | "missing_mcp_servers" | "missing_server";
      path: string;
    }
  | {
      status: "probe_failed";
      reason:
        | "unreadable"
        | "invalid_json"
        | "invalid_root"
        | "invalid_mcp_servers"
        | "invalid_server";
      path: string;
    };

/** Resolve Claude's user-scoped MCP configuration file. */
export function resolveClaudeUserConfigPath(
  fileSystem: FileSystemService,
  environment: NodeJS.ProcessEnv = process.env,
): string {
  const configDir = environment.CLAUDE_CONFIG_DIR;
  return fileSystem.joinPath(
    configDir === undefined || configDir === ""
      ? fileSystem.getHomeDir()
      : configDir,
    CLAUDE_USER_CONFIG_FILE,
  );
}

/** Classify Claude's user-scoped GitHits MCP entry without exposing its data. */
export function parseClaudeUserMcpState(
  contents: string,
): ClaudeUserMcpParseResult {
  let document: unknown;
  try {
    document = JSON.parse(contents) as unknown;
  } catch {
    return { status: "probe_failed", reason: "invalid_json" };
  }

  if (!isRecord(document)) {
    return { status: "probe_failed", reason: "invalid_root" };
  }

  if (!("mcpServers" in document)) {
    return { status: "not_configured", reason: "missing_mcp_servers" };
  }

  const mcpServers = document.mcpServers;
  if (!isRecord(mcpServers)) {
    return { status: "probe_failed", reason: "invalid_mcp_servers" };
  }

  if (!("githits" in mcpServers)) {
    return { status: "not_configured", reason: "missing_server" };
  }

  const githits = mcpServers.githits;
  if (!isRecord(githits) || !isStructurallyValidServerEntry(githits)) {
    return { status: "probe_failed", reason: "invalid_server" };
  }

  const effectiveType = githits.type === undefined ? "stdio" : githits.type;
  const isCanonical =
    effectiveType === "stdio" &&
    githits.command === CANONICAL_COMMAND &&
    hasCanonicalArgs(githits.args);

  return isCanonical
    ? { status: "configured" }
    : { status: "non_canonical", reason: "non_canonical" };
}

/** Read and classify Claude's user-scoped GitHits MCP entry. */
export async function readClaudeUserMcpState(
  fileSystem: FileSystemService,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<ClaudeUserMcpState> {
  const path = resolveClaudeUserConfigPath(fileSystem, environment);
  let contents: string;
  try {
    contents = await fileSystem.readFile(path);
  } catch (error) {
    if (getErrorCode(error) === "ENOENT") {
      return { status: "not_configured", reason: "missing_file", path };
    }
    return { status: "probe_failed", reason: "unreadable", path };
  }

  return addPath(parseClaudeUserMcpState(contents), path);
}

function addPath(
  result: ClaudeUserMcpParseResult,
  path: string,
): ClaudeUserMcpState {
  if (result.status === "configured") {
    return { status: "configured", path };
  }
  return { ...result, path };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStructurallyValidServerEntry(
  entry: Record<string, unknown>,
): boolean {
  if ("type" in entry && typeof entry.type !== "string") return false;
  if ("command" in entry && typeof entry.command !== "string") return false;
  if (
    "args" in entry &&
    (!Array.isArray(entry.args) ||
      entry.args.some((argument) => typeof argument !== "string"))
  ) {
    return false;
  }
  return true;
}

function hasCanonicalArgs(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length === CANONICAL_ARGS.length &&
    value.every((argument, index) => argument === CANONICAL_ARGS[index])
  );
}

function getErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}
