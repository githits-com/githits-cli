import type { FileSystemService } from "../../services/filesystem-service.js";

const CLAUDE_USER_CONFIG_FILE = ".claude.json";

/** Invocation shape used to identify the configured GitHits MCP server. */
export interface ClaudeMcpInvocation {
  command: string;
  args: readonly string[];
}

export type ClaudeUserMcpParseResult =
  | {
      status: "configured";
    }
  | {
      status: "non_canonical";
    }
  | {
      status: "not_configured";
    }
  | {
      status: "probe_failed";
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
  expectedInvocation: ClaudeMcpInvocation,
): ClaudeUserMcpParseResult {
  let document: unknown;
  try {
    document = JSON.parse(contents) as unknown;
  } catch {
    return { status: "probe_failed" };
  }

  if (!isRecord(document)) {
    return { status: "probe_failed" };
  }

  if (!("mcpServers" in document)) {
    return { status: "not_configured" };
  }

  const mcpServers = document.mcpServers;
  if (!isRecord(mcpServers)) {
    return { status: "probe_failed" };
  }

  if (!("githits" in mcpServers)) {
    return { status: "not_configured" };
  }

  const githits = mcpServers.githits;
  if (!isRecord(githits) || !isStructurallyValidServerEntry(githits)) {
    return { status: "probe_failed" };
  }

  const effectiveType = githits.type === undefined ? "stdio" : githits.type;
  const isCanonical =
    effectiveType === "stdio" &&
    githits.command === expectedInvocation.command &&
    hasExpectedArgs(githits.args, expectedInvocation.args);

  return isCanonical ? { status: "configured" } : { status: "non_canonical" };
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

function hasExpectedArgs(
  value: unknown,
  expectedArgs: readonly string[],
): boolean {
  return (
    Array.isArray(value) &&
    value.length === expectedArgs.length &&
    value.every((argument, index) => argument === expectedArgs[index])
  );
}
