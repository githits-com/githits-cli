import type { Command } from "commander";
import { createAuthCommandDependencies } from "../container.js";
import type {
  AuthService,
  AuthStorage,
  BrowserService,
} from "../services/index.js";

export interface LoginOptions {
  browser?: boolean;
  port?: number;
  force?: boolean;
}

/** Result of the login flow, used by init to handle outcomes without process.exit */
export interface LoginFlowResult {
  status: "success" | "already_authenticated" | "failed";
  message: string;
}

const TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

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
    await authStorage.saveClient(probeUrl, probeClient);
    await authStorage.saveTokens(probeUrl, probeTokens);
    await authStorage.clearTokens(probeUrl);
    await authStorage.clearClient(probeUrl);
    return null;
  } catch (error) {
    await authStorage.clearTokens(probeUrl).catch(() => {});
    await authStorage.clearClient(probeUrl).catch(() => {});
    const message = error instanceof Error ? error.message : String(error);
    return {
      status: "failed",
      message: `Cannot persist OAuth credentials: ${message}`,
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
): Promise<LoginFlowResult> {
  const { authService, authStorage, browserService, mcpUrl } = deps;

  // Validate port if provided
  if (
    options.port !== undefined &&
    (Number.isNaN(options.port) || options.port < 1 || options.port > 65535)
  ) {
    return {
      status: "failed",
      message: "Invalid port number. Must be between 1 and 65535.",
    };
  }

  // Check if already logged in
  const existing = await authStorage.loadTokens(mcpUrl);
  if (existing && !options.force) {
    const isExpired =
      existing.expiresAt && new Date(existing.expiresAt) < new Date();
    if (!isExpired) {
      return { status: "already_authenticated", message: "Already logged in." };
    }
    console.log("Token expired. Starting new login...\n");
  } else if (existing && options.force) {
    console.log("Re-authenticating (--force flag)...\n");
  }

  // If tokens were cleared (expired+refreshFailed or never existed) but a stale
  // client registration remains, clear it so we get a fresh DCR registration.
  if (!existing) {
    await authStorage.clearClient(mcpUrl);
  }

  const persistenceError = await preflightAuthPersistence(authStorage, mcpUrl);
  if (persistenceError) return persistenceError;

  // Step 1: Discover OAuth endpoints
  console.log("Discovering OAuth endpoints...");
  const metadata = await authService.discoverEndpoints(mcpUrl);

  // Step 2: Load or register client via DCR
  let client = await authStorage.loadClient(mcpUrl);
  let port: number;
  let redirectUri: string;

  if (client) {
    // Reuse the stored redirect URI to match the DCR registration.
    // If user specified --port, use that and re-register if needed.
    if (options.port) {
      redirectUri = `http://127.0.0.1:${options.port}/callback`;
      if (redirectUri !== client.redirectUri) {
        // Port changed - need to re-register
        console.log("Registering CLI client with new port...");
        const registration = await authService.registerClient({
          registrationEndpoint: metadata.registrationEndpoint,
          redirectUri,
        });
        client = {
          clientId: registration.clientId,
          clientSecret: registration.clientSecret,
          redirectUri,
          registeredAt: new Date().toISOString(),
        };
        await authStorage.saveClient(mcpUrl, client);
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
    console.log("Registering CLI client...");
    const registration = await authService.registerClient({
      registrationEndpoint: metadata.registrationEndpoint,
      redirectUri,
    });
    client = {
      clientId: registration.clientId,
      clientSecret: registration.clientSecret,
      redirectUri,
      registeredAt: new Date().toISOString(),
    };
    await authStorage.saveClient(mcpUrl, client);
  }

  // Step 3: Generate PKCE parameters
  const { verifier, challenge, state } = authService.generatePkceParams();

  // Step 4: Build auth URL
  const authUrl = authService.buildAuthUrl({
    authorizationEndpoint: metadata.authorizationEndpoint,
    clientId: client.clientId,
    redirectUri,
    state,
    codeChallenge: challenge,
  });

  // Step 5: Start callback server
  const serverPromise = authService.startCallbackServer(port, state);

  // Step 6: Open browser or show URL
  if (options.browser === false) {
    console.log("Open this URL in your browser:\n");
    console.log(`  ${authUrl}\n`);
  } else {
    console.log("Opening browser...");
    await browserService.open(authUrl);
  }

  console.log("Waiting for authentication...\n");

  // Wait for callback with timeout
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(
      () => reject(new Error("Authentication timed out")),
      TIMEOUT_MS,
    );
  });

  let callback: Awaited<typeof serverPromise>;
  try {
    callback = await Promise.race([serverPromise, timeoutPromise]);
    if (timeoutId) clearTimeout(timeoutId);
  } catch (error) {
    if (timeoutId) clearTimeout(timeoutId);
    const msg =
      error instanceof Error ? error.message : "Authentication failed";
    return { status: "failed", message: `${msg}.` };
  }

  // Step 7: Handle callback outcome
  if (callback.type !== "success") {
    // Let the callback server finish sending the error page to the browser
    await new Promise((r) => setTimeout(r, 2000));
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
      redirectUri,
    });
  } catch (error) {
    // Best-effort: clear potentially stale client so next login starts fresh.
    try {
      await authStorage.clearClient(mcpUrl);
    } catch {
      // Ignore -- client cleanup is best-effort
    }
    const msg = error instanceof Error ? error.message : String(error);
    return {
      status: "failed",
      message: `Failed to complete authentication: ${msg}`,
    };
  }

  // Step 9: Save tokens
  const expiresAt = new Date(
    Date.now() + tokenResponse.expiresIn * 1000,
  ).toISOString();
  await authStorage.saveTokens(mcpUrl, {
    accessToken: tokenResponse.accessToken,
    refreshToken: tokenResponse.refreshToken,
    expiresAt,
    createdAt: new Date().toISOString(),
  });

  // Success message
  const hours = Math.round(tokenResponse.expiresIn / 3600);
  return {
    status: "success",
    message: `Logged in successfully. Token expires in ${hours} hour${hours !== 1 ? "s" : ""}.`,
  };
}

/**
 * Standalone login command action.
 * Wraps loginFlow with console output and process.exit on failure.
 */
export async function loginAction(
  options: LoginOptions,
  deps: LoginDependencies,
): Promise<void> {
  const result = await loginFlow(options, deps);

  if (result.status === "already_authenticated") {
    console.log("Already logged in.\n");
    console.log(`  Environment: ${deps.mcpUrl}\n`);
    console.log("To re-authenticate, use `githits login --force`.");
    return;
  }

  if (result.status === "failed") {
    console.error(`${result.message}\n`);
    console.log("Run `githits login` to try again.");
    process.exit(1);
  }

  // success
  console.log("Logged in successfully.\n");
  console.log(`  Environment: ${deps.mcpUrl}`);
  console.log(result.message.replace("Logged in successfully. ", "  "));
  console.log("\nYou're ready to use githits with your AI assistant.");
}

const LOGIN_DESCRIPTION = `Authenticate with your GitHits account via browser.

Opens your browser to complete authentication securely using OAuth.
OAuth credentials are stored in the system keychain by default. If your
machine has no usable keychain, use GITHITS_API_TOKEN or explicitly configure
auth.storage = "file". File storage is plaintext on disk.

Use --no-browser in environments without a display (CI, SSH sessions)
to get a URL you can open on another device.`;

/**
 * Register the login command on the given program.
 * Uses lazy container creation so `--help` doesn't trigger auth.
 */
export function registerLoginCommand(program: Command) {
  program
    .command("login")
    .summary("Authenticate with your GitHits account")
    .description(LOGIN_DESCRIPTION)
    .option("--no-browser", "Print URL instead of opening browser")
    .option("--port <port>", "Port for local callback server", parseInt)
    .option("--force", "Re-authenticate even if already logged in")
    .action(async (options: LoginOptions) => {
      const deps = await createAuthCommandDependencies();
      await loginAction(options, deps);
    });
}
