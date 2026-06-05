import { LOCAL_AUTHENTICATION_MISSING_MESSAGE } from "@githits/core-internal";

/**
 * Error thrown when authentication is required but no valid token is available.
 * Caught at the CLI boundary to trigger process.exit(1).
 */
export class AuthRequiredError extends Error {
  readonly mcpUrl: string;

  constructor(message: string, mcpUrl: string) {
    super(message);
    this.name = "AuthRequiredError";
    this.mcpUrl = mcpUrl;
  }
}

export interface AuthRequiredErrorPayload {
  error: string;
  code: "AUTH_REQUIRED";
  retryable: false;
  details: { authSource: "local" };
}

/**
 * Throw AuthRequiredError when auth is missing.
 * Rendering belongs to the CLI/MCP boundary so JSON callers never receive
 * terminal prose on stdout.
 *
 * @param context - Optional context appended to the message (e.g., "to start MCP server")
 * @throws AuthRequiredError - Always throws when hasValidToken is false
 */
export function requireAuth(
  deps: {
    hasValidToken: boolean;
    mcpUrl: string;
  },
  context?: string,
): void {
  if (deps.hasValidToken) return;

  const suffix = context ? ` ${context}` : "";
  throw new AuthRequiredError(
    `${LOCAL_AUTHENTICATION_MISSING_MESSAGE.slice(0, -1)}${suffix}.`,
    deps.mcpUrl,
  );
}

export function buildAuthRequiredErrorPayload(
  error: AuthRequiredError,
): AuthRequiredErrorPayload {
  return {
    error: error.message,
    code: "AUTH_REQUIRED",
    retryable: false,
    details: { authSource: "local" },
  };
}

export function formatAuthRequiredForTerminal(
  error: AuthRequiredError,
): string {
  const lines = [`${error.message}\n`];

  if (error.mcpUrl !== "https://mcp.githits.com") {
    lines.push(`  Environment: ${error.mcpUrl}`);
    lines.push("  You're using a custom environment.\n");
  }

  lines.push("To authenticate:");
  lines.push("  githits login\n");
  lines.push("Or set GITHITS_API_TOKEN environment variable.");
  lines.push("\nNeed help? support@githits.com");
  return lines.join("\n");
}
