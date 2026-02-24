import type { Command } from "commander";
import { createContainer } from "../container.js";
import type { AuthStorage } from "../services/index.js";

export interface LogoutDependencies {
  authStorage: AuthStorage;
  mcpUrl: string;
}

/**
 * Core logout logic, separated for testability.
 *
 * Always clears both tokens and client registration independently before
 * reporting status. This ensures orphaned client registrations are cleaned up
 * even when tokens are already absent (e.g. after a partial logout or expired
 * token clear). Both clear operations are idempotent and error-isolated so a
 * failure in one does not prevent the other from running.
 */
export async function logoutAction(deps: LogoutDependencies): Promise<void> {
  const { authStorage, mcpUrl } = deps;

  const auth = await authStorage.loadTokens(mcpUrl);

  // Clear both independently — a failure in one must not prevent the other.
  let firstError: unknown;
  try {
    await authStorage.clearTokens(mcpUrl);
  } catch (error) {
    firstError = error;
  }
  try {
    await authStorage.clearClient(mcpUrl);
  } catch (error) {
    firstError ??= error;
  }

  if (!auth) {
    console.log("Not currently logged in.\n");
    console.log(`  Environment: ${mcpUrl}`);
  } else {
    console.log("Logged out.\n");
    console.log(`  Environment: ${mcpUrl}`);
  }

  if (firstError) throw firstError;
}

const LOGOUT_DESCRIPTION = `Remove stored credentials.

Clears all locally stored authentication data including tokens and
client registrations. OAuth tokens expire naturally; this
removes the local copies from the keychain (or fallback file storage).`;

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
      const deps = await createContainer();
      await logoutAction(deps);
    });
}
