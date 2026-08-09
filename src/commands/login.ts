import {
  isFetchTimeoutError,
  normalizeSingleLineText,
} from "@githits/core-internal";
import type { Command } from "commander";
import { createAuthCommandDependencies } from "../container.js";
import type { AuthService } from "../services/auth-service.js";
import type { AuthStorage } from "../services/auth-storage.js";
import type { BrowserService } from "../services/browser-service.js";
import { withCliAuthAttribution } from "../shared/oauth-attribution.js";
import {
  addOAuthCallbackOptions,
  CALLBACK_PORT_REQUIREMENT,
  formatRemoteCallbackInstructions,
  isValidOAuthCallbackPort,
  type OAuthCallbackOptions,
} from "./oauth-callback-options.js";

export interface LoginOptions extends OAuthCallbackOptions {
  force?: boolean;
}

/** Result of the login flow, used by init to handle outcomes without process.exit */
export interface LoginFlowResult {
  status: "success" | "already_authenticated" | "failed";
  message: string;
}

export interface LoginOutput {
  write(message: string): void;
}

export const stdoutLoginOutput: LoginOutput = {
  write: (message: string) => {
    console.log(message);
  },
};

export const stderrLoginOutput: LoginOutput = {
  write: (message: string) => {
    console.error(message);
  },
};

export const silentLoginOutput: LoginOutput = {
  write: () => {},
};

const TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const AUTH_TIMEOUT_MESSAGE =
  "Authentication timed out after 5 minutes. The browser link has expired, so it will not work anymore. Run the same command again to try signing in again.";

function randomPort(): number {
  return Math.floor(Math.random() * 2000) + 8000; // 8000-9999
}

export interface LoginDependencies {
  authService: AuthService;
  authStorage: AuthStorage;
  browserService: BrowserService;
  mcpUrl: string;
}

async function preflightAuthPersistence(
  authStorage: AuthStorage,
  mcpUrl: string,
): Promise<LoginFlowResult | null> {
  const probeUrl = `${mcpUrl.replace(/\/+$/, "")}/__githits_storage_probe__`;
  const probeClient = {
    clientId: "__githits_storage_probe__",
    clientSecret: "__githits_storage_probe__",
    redirectUri: "http://127.0.0.1:1/callback",
    registeredAt: new Date(0).toISOString(),
  };
  const probeTokens = {
    accessToken: "__githits_storage_probe__",
    refreshToken: "__githits_storage_probe__",
    expiresAt: new Date(0).toISOString(),
    createdAt: new Date(0).toISOString(),
  };
  try {
    await authStorage.saveAuthSession(probeUrl, probeClient, probeTokens);
    await authStorage.clearAuthSession(probeUrl);
    return null;
  } catch (error) {
    await authStorage.clearAuthSession(probeUrl).catch(() => {});
    return {
      status: "failed",
      message: `Cannot persist OAuth credentials: ${errorMessage(error)}`,
    };
  }
}

/**
 * Core login logic that returns a result instead of calling process.exit.
 * Used by both the standalone `login` command and the `init` command.
 */
export async function loginFlow(
  options: LoginOptions,
  deps: LoginDependencies,
  output: LoginOutput = stdoutLoginOutput,
): Promise<LoginFlowResult> {
  const { authService, authStorage, browserService, mcpUrl } = deps;

  if (options.port !== undefined && !isValidOAuthCallbackPort(options.port)) {
    return {
      status: "failed",
      message: `Invalid port number. ${CALLBACK_PORT_REQUIREMENT}`,
    };
  }

  let existing: Awaited<ReturnType<typeof authStorage.loadTokens>>;
  try {
    existing = await authStorage.loadTokens(mcpUrl);
  } catch (error) {
    return storageFailure(error);
  }

  // Check if already logged in
  if (existing && !options.force) {
    const isExpired =
      existing.expiresAt && new Date(existing.expiresAt) < new Date();
    if (!isExpired) {
      return { status: "already_authenticated", message: "Already logged in." };
    }
    output.write("Starting sign-in...\n");
  } else if (existing && options.force) {
    output.write("Signing in again...\n");
  }

  // If tokens were cleared (expired+refreshFailed or never existed) but a stale
  // client registration remains, clear it so we get a fresh DCR registration.
  if (!existing) {
    try {
      await authStorage.clearActiveClient(mcpUrl);
    } catch (error) {
      return storageFailure(error);
    }
  }

  const persistenceError = await preflightAuthPersistence(authStorage, mcpUrl);
  if (persistenceError) return persistenceError;

  // Step 1: Discover OAuth endpoints
  let metadata: Awaited<ReturnType<typeof authService.discoverEndpoints>>;
  try {
    metadata = await authService.discoverEndpoints(mcpUrl);
  } catch (error) {
    return signInStartFailure(error);
  }

  // Step 2: Load or register client via DCR
  let client: Awaited<ReturnType<typeof authStorage.loadClient>>;
  try {
    client = await authStorage.loadClient(mcpUrl);
  } catch (error) {
    return storageFailure(error);
  }
  const hadStoredClient = client !== null;
  let shouldClearClientOnFailedAttempt = false;
  let port: number;
  let redirectUri: string;

  if (client) {
    // Reuse the stored redirect URI to match the DCR registration.
    // If user specified --port, use that and re-register if needed.
    if (options.port) {
      redirectUri = `http://127.0.0.1:${options.port}/callback`;
      if (redirectUri !== client.redirectUri) {
        // Port changed - need to re-register
        let registration: Awaited<
          ReturnType<typeof authService.registerClient>
        >;
        try {
          registration = await authService.registerClient({
            registrationEndpoint: metadata.registrationEndpoint,
            redirectUris: [redirectUri, withCliAuthAttribution(redirectUri)],
          });
        } catch (error) {
          return signInStartFailure(error);
        }
        client = {
          clientId: registration.clientId,
          clientSecret: registration.clientSecret,
          redirectUri,
          registeredAt: new Date().toISOString(),
        };
        shouldClearClientOnFailedAttempt = !hadStoredClient;
      }
      port = options.port;
    } else {
      // Extract port from stored redirect URI
      redirectUri = client.redirectUri;
      const storedUrl = new URL(redirectUri);
      port = Number(storedUrl.port) || randomPort();
    }
  } else {
    port = options.port ?? randomPort();
    redirectUri = `http://127.0.0.1:${port}/callback`;
    let registration: Awaited<ReturnType<typeof authService.registerClient>>;
    try {
      registration = await authService.registerClient({
        registrationEndpoint: metadata.registrationEndpoint,
        redirectUris: [redirectUri, withCliAuthAttribution(redirectUri)],
      });
    } catch (error) {
      return signInStartFailure(error);
    }
    client = {
      clientId: registration.clientId,
      clientSecret: registration.clientSecret,
      redirectUri,
      registeredAt: new Date().toISOString(),
    };
    shouldClearClientOnFailedAttempt = !hadStoredClient;
  }

  const authRedirectUri = withCliAuthAttribution(redirectUri);

  // Step 3: Generate PKCE parameters
  const { verifier, challenge, state } = authService.generatePkceParams();

  // Step 4: Build auth URL
  const authUrl = authService.buildAuthUrl({
    authorizationEndpoint: metadata.authorizationEndpoint,
    clientId: client.clientId,
    redirectUri: authRedirectUri,
    state,
    codeChallenge: challenge,
  });

  // Step 5: Start callback server
  let callbackServer: Awaited<
    ReturnType<typeof authService.startCallbackServer>
  >;
  try {
    callbackServer = await authService.startCallbackServer(port, state);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { status: "failed", message: msg };
  }

  // Step 6: Open browser or show URL
  if (options.browser === false) {
    output.write("Open this URL in your browser:\n");
    output.write(`  ${authUrl}\n`);
    output.write(formatRemoteCallbackInstructions(port));
  } else {
    output.write("Opening browser for GitHits sign-in...\n");
    try {
      await browserService.open(authUrl);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      output.write(`Could not open browser automatically: ${msg}\n`);
    }
    output.write("If the browser did not open, open this URL:\n");
    output.write(`  ${authUrl}\n`);
  }

  output.write("Waiting for sign-in to finish...\n");

  // Wait for callback with timeout
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(
      () => reject(new Error(AUTH_TIMEOUT_MESSAGE)),
      TIMEOUT_MS,
    );
  });

  let callback: Awaited<typeof callbackServer.result>;
  try {
    callback = await Promise.race([callbackServer.result, timeoutPromise]);
    if (timeoutId) clearTimeout(timeoutId);
    void callbackServer.close().catch(() => {});
  } catch (error) {
    if (timeoutId) clearTimeout(timeoutId);
    void callbackServer.close().catch(() => {});
    if (shouldClearClientOnFailedAttempt) {
      await authStorage.clearActiveClient(mcpUrl).catch(() => {});
    }
    const msg =
      error instanceof Error ? error.message : "Authentication failed";
    return { status: "failed", message: ensureTerminalPeriod(msg) };
  }

  output.write("Sign-in callback received. Completing authentication...\n");

  // Step 7: Handle callback outcome
  if (callback.type !== "success") {
    if (shouldClearClientOnFailedAttempt) {
      await authStorage.clearActiveClient(mcpUrl).catch(() => {});
    }
    return {
      status: "failed",
      message: callback.message ?? "Authentication callback failed.",
    };
  }

  // Step 8: Exchange code for tokens
  let tokenResponse: Awaited<
    ReturnType<typeof authService.exchangeCodeForTokens>
  >;
  try {
    tokenResponse = await authService.exchangeCodeForTokens({
      tokenEndpoint: metadata.tokenEndpoint,
      clientId: client.clientId,
      clientSecret: client.clientSecret,
      code: callback.code,
      codeVerifier: verifier,
      redirectUri: authRedirectUri,
    });
  } catch (error) {
    // Best-effort: clear potentially stale client so next login starts fresh.
    try {
      await authStorage.clearActiveClient(mcpUrl);
    } catch {
      // Ignore -- client cleanup is best-effort
    }
    const msg = error instanceof Error ? error.message : String(error);
    return {
      status: "failed",
      message: `Failed to complete authentication: ${msg}`,
    };
  }

  // Step 9: Save auth session
  const expiresAt = new Date(
    Date.now() + tokenResponse.expiresIn * 1000,
  ).toISOString();
  try {
    await authStorage.saveAuthSession(mcpUrl, client, {
      accessToken: tokenResponse.accessToken,
      refreshToken: tokenResponse.refreshToken,
      expiresAt,
      createdAt: new Date().toISOString(),
    });
  } catch (error) {
    return storageFailure(error);
  }

  return {
    status: "success",
    message: "Logged in successfully.",
  };
}

function signInStartFailure(error: unknown): LoginFlowResult {
  if (isFetchTimeoutError(error) || isAbortError(error)) {
    return {
      status: "failed",
      message:
        "GitHits timed out while starting sign-in. Check your connection and proxy settings, then try again.",
    };
  }
  if (error instanceof TypeError) {
    return {
      status: "failed",
      message:
        "Could not reach GitHits to start sign-in. Check your connection and proxy settings, then try again.",
    };
  }
  return {
    status: "failed",
    message: `Could not start sign-in: ${errorMessage(error)}`,
  };
}

function storageFailure(error: unknown): LoginFlowResult {
  return {
    status: "failed",
    message: `Cannot persist OAuth credentials: ${errorMessage(error)}`,
  };
}

function errorMessage(error: unknown): string {
  if (!(error instanceof Error)) return "Unexpected error.";
  const normalized = normalizeSingleLineText(error.message);
  if (!normalized) return "Unexpected error.";
  return normalized.length <= 500
    ? normalized
    : `${normalized.slice(0, 497)}...`;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

/**
 * Standalone login command action.
 * Wraps loginFlow with console output and process.exit on failure.
 */
export async function loginAction(
  options: LoginOptions,
  deps: LoginDependencies,
): Promise<void> {
  const result = await loginFlow(options, deps, stdoutLoginOutput);

  if (result.status === "already_authenticated") {
    console.log("Already logged in.\n");
    console.log("You're ready to use GitHits.");
    return;
  }

  if (result.status === "failed") {
    console.error(`${result.message}\n`);
    printLoginRecoveryHint(result.message);
    process.exit(1);
  }

  console.log(`${result.message}\n`);
  console.log("You're ready to use GitHits.");
}

function printLoginRecoveryHint(message: string): void {
  console.log("Recovery steps:");
  if (message.includes("Authentication timed out")) {
    console.log("  Run the same command again to open a fresh sign-in link.");
    console.log(
      "  githits login --no-browser  # if the browser did not open or you are on SSH",
    );
    console.log(
      "  githits logout && githits login  # if sign-in keeps failing after a retry",
    );
    return;
  }
  console.log("  githits auth status");
  console.log("  githits login --force");
  if (message.includes("Cannot persist OAuth credentials")) {
    console.log(
      "If your system keychain is locked or unavailable, unlock it and retry.",
    );
    console.log("For CI/automation, set GITHITS_API_TOKEN.");
    console.log(
      "As a last resort, set GITHITS_AUTH_STORAGE=file to use plaintext file storage.",
    );
  }
}

export function printAutoLoginRecoveryHint(message: string): void {
  if (message.includes("Authentication timed out")) {
    console.error("Run the same command again to open a fresh sign-in link.");
    console.error(
      "If the browser did not open, run `githits login --no-browser` and follow the printed link.",
    );
    console.error(
      "If sign-in keeps failing after a retry, run `githits logout` and then run your command again.",
    );
    return;
  }

  console.error("Run the same command again to try signing in again.");
  console.error(
    "Run `githits auth status` to check whether you are signed in.",
  );
  if (message.includes("Cannot persist OAuth credentials")) {
    console.error(
      "If your system keychain is locked or unavailable, unlock it and try again.",
    );
    console.error("For CI/automation, set GITHITS_API_TOKEN.");
  }
}

function ensureTerminalPeriod(message: string): string {
  return /[.!?]$/.test(message) ? message : `${message}.`;
}

const LOGIN_DESCRIPTION = `Authenticate with your GitHits account via browser.

Opens your browser to complete authentication securely using OAuth.
OAuth credentials are stored in the system keychain by default. If your
machine has no usable keychain, use GITHITS_API_TOKEN or explicitly configure
auth.storage = "file". File storage is plaintext on disk.

Use --no-browser to print the sign-in URL instead of launching a browser.
The callback still listens on this machine. If the browser is on another
computer, choose a fixed --port and forward that port over SSH.
For non-interactive automation, use GITHITS_API_TOKEN instead.`;

/**
 * Register the login command on the given program.
 * Uses lazy container creation so `--help` doesn't trigger auth.
 */
export function registerLoginCommand(program: Command) {
  const command = program
    .command("login")
    .summary("Sign in to your GitHits account")
    .description(LOGIN_DESCRIPTION);

  addOAuthCallbackOptions(command)
    .option("--force", "Re-authenticate even if already logged in")
    .action(async (options: LoginOptions) => {
      const deps = await createAuthCommandDependencies();
      await loginAction(options, deps);
    });
}
