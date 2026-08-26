import type { Command } from "commander";
import { createLogoutCommandDependencies } from "../container.js";
import type { AuthDiagnosticsStore } from "../services/auth-diagnostics-storage.js";
import type { AuthStorage } from "../services/auth-storage.js";
import { withTelemetrySpan } from "../shared/telemetry.js";

export interface LogoutDependencies {
  authStorage: AuthStorage;
  mcpUrl: string;
  authDiagnostics?: AuthDiagnosticsStore;
}

/**
 * Core logout logic, separated for testability.
 *
 * Clears both tokens and client registration as one auth-session update so
 * concurrent MCP servers and login/logout commands cannot observe split state.
 */
export async function logoutAction(deps: LogoutDependencies): Promise<void> {
  const { authStorage, mcpUrl, authDiagnostics } = deps;

  await withTelemetrySpan(
    "auth.clear",
    () => authStorage.clearAuthSession(mcpUrl),
    { reason: "logout" },
  );
  await authDiagnostics?.recordClear(mcpUrl, "logout");

  console.log("Logged out.");
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
      const deps = await createLogoutCommandDependencies();
      await logoutAction(deps);
    });
}
