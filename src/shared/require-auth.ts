/**
 * Error thrown when authentication is required but no valid token is available.
 * Caught at the CLI boundary to trigger process.exit(1).
 */
export class AuthRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthRequiredError";
  }
}

export function printAuthInstructions(): void {
  console.log("To authenticate:");
  console.log("  githits login");
  console.log("  npx githits@latest login\n");
  console.log("Or set GITHITS_API_TOKEN environment variable.");
}

/**
 * Print friendly message when auth is missing and throw AuthRequiredError.
 * Used for non-interactive contexts (MCP server) where auto-login is not possible.
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
  console.log(`Authentication required${suffix}.\n`);

  if (deps.mcpUrl !== "https://mcp.githits.com") {
    console.log(`  Environment: ${deps.mcpUrl}`);
    console.log("  You're using a custom environment.\n");
  }

  printAuthInstructions();

  throw new AuthRequiredError(`Authentication required${suffix}`);
}
