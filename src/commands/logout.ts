import type { Command } from "commander";
import { createAuthCommandDependencies } from "../container.js";
import type { AuthStorage } from "../services/index.js";

export interface LogoutDependencies {
  authStorage: AuthStorage;
  mcpUrl: string;
}

/**
 * Core logout logic, separated for testability.
 *
 * Clears both tokens and client registration as one auth-session update so
 * concurrent MCP servers and login/logout commands cannot observe split state.
 */
export async function logoutAction(deps: LogoutDependencies): Promise<void> {
  const { authStorage, mcpUrl } = deps;

  await authStorage.clearAuthSession(mcpUrl);

  console.log("Logged out.\n");
  console.log(`  Environment: ${mcpUrl}`);
}

const LOGOUT_DESCRIPTION = `Remove stored credentials.

Clears all locally stored authentication data including tokens and
client registrations. OAuth tokens expire naturally; this
removes local copies from the keychain, explicit file storage, and
legacy auth file storage.`;

/**
 * Register the logout command on the given program.
 * Uses lazy container creation so `--help` doesn't trigger auth.
 */
export function registerLogoutCommand(program: Command) {
  program
    .command("logout")
    .summary("Remove stored credentials")
    .description(LOGOUT_DESCRIPTION)
    .action(async () => {
      const deps = await createAuthCommandDependencies();
      await logoutAction(deps);
    });
}
