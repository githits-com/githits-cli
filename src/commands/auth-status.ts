import type { Command } from "commander";
import { createAuthStatusDependencies } from "../container.js";
import type { AuthService, AuthStorage } from "../services/index.js";
import { refreshExpiredToken } from "../services/index.js";

export interface AuthStatusDependencies {
  authStorage: AuthStorage;
  authService: AuthService;
  mcpUrl: string;
  envApiToken: string | undefined;
}

/**
 * Display token expiry information.
 */
function displayExpiry(expiresAt: string | null): void {
  if (!expiresAt) {
    console.log("  Expires: never");
    return;
  }

  const expiresAtDate = new Date(expiresAt);
  const minutesLeft = Math.ceil(
    (expiresAtDate.getTime() - Date.now()) / (1000 * 60),
  );
  if (minutesLeft > 60) {
    const hoursLeft = Math.round(minutesLeft / 60);
    console.log(`  Expires: in ${hoursLeft} hour${hoursLeft !== 1 ? "s" : ""}`);
  } else {
    console.log(
      `  Expires: in ${minutesLeft} minute${minutesLeft !== 1 ? "s" : ""}`,
    );
  }
}

/**
 * Core auth status logic, separated for testability.
 */
export async function authStatusAction(
  deps: AuthStatusDependencies,
): Promise<void> {
  const { authStorage, authService, mcpUrl, envApiToken } = deps;

  // Check for env API token
  if (envApiToken) {
    console.log("Authenticated via environment variable.\n");
    console.log(`  Source: GITHITS_API_TOKEN`);
    return;
  }

  const auth = await authStorage.loadTokens(mcpUrl);

  if (!auth) {
    console.log("Not authenticated.\n");
    console.log(`  Environment: ${mcpUrl}\n`);
    console.log(`  Storage: ${authStorage.getStorageLocation()}\n`);
    printAuthTroubleshooting();
    return;
  }

  // Check if token is expired — attempt refresh before reporting
  if (auth.expiresAt && new Date(auth.expiresAt) < new Date()) {
    const refreshed = await refreshExpiredToken(
      authService,
      authStorage,
      mcpUrl,
    );
    if (refreshed) {
      // Reload tokens to get updated expiry
      const refreshedAuth = await authStorage.loadTokens(mcpUrl);
      console.log("Authenticated (token refreshed).\n");
      console.log(`  Environment: ${mcpUrl}`);
      displayExpiry(refreshedAuth?.expiresAt ?? null);
      console.log(`\n  Storage: ${authStorage.getStorageLocation()}`);
      return;
    }

    console.log("Token expired.\n");
    console.log(`  Environment: ${mcpUrl}`);
    console.log(
      `  Expired: ${new Date(auth.expiresAt).toLocaleDateString()}\n`,
    );
    console.log(`  Storage: ${authStorage.getStorageLocation()}\n`);
    printAuthTroubleshooting("expired");
    return;
  }

  console.log("Authenticated.\n");
  console.log(`  Environment: ${mcpUrl}`);
  displayExpiry(auth.expiresAt);
  console.log(`\n  Storage: ${authStorage.getStorageLocation()}`);
}

function printAuthTroubleshooting(reason: "missing" | "expired" = "missing") {
  const loginCommand =
    reason === "expired" ? "githits login --force" : "githits login";
  console.log("Recovery steps:");
  console.log(`  ${loginCommand}`);
  console.log("  githits auth status");
  console.log("For CI/automation, set GITHITS_API_TOKEN.");
  console.log(
    "If your system keychain is locked or unavailable, unlock it and retry.",
  );
  console.log(
    "As a last resort, set GITHITS_AUTH_STORAGE=file to use plaintext file storage.",
  );
}

const STATUS_DESCRIPTION = `Show current authentication status.

Displays details about the stored token including environment
and expiration. If GITHITS_API_TOKEN is set, reports that source
without reading local OAuth storage. Useful for debugging authentication issues.`;

/**
 * Register the auth status command on the given program.
 * Uses lazy container creation so \`--help\` doesn't trigger auth.
 */
export function registerAuthStatusCommand(program: Command) {
  program
    .command("status")
    .summary("Show authentication status")
    .description(STATUS_DESCRIPTION)
    .action(async () => {
      const deps = await createAuthStatusDependencies();
      await authStatusAction(deps);
    });
}
