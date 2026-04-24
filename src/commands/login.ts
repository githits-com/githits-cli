import type { Command } from "commander";
import { createContainer } from "../container.js";
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

export interface PerformLoginOptions {
  browser?: boolean;
  port?: number;
}

/**
 * Core OAuth PKCE login flow. Returns true on success, false on failure.
 * Does not call process.exit — callers decide how to handle failure.
 */
export async function performLogin(
  deps: LoginDependencies,
  options: PerformLoginOptions = {},
): Promise<boolean> {
  const { authService, authStorage, browserService, mcpUrl } = deps;

  // Step 1: Discover OAuth endpoints
  console.log("Discovering OAuth endpoints...");
  const metadata = await authService.discoverEndpoints(mcpUrl);

  // Step 2: Load or register client via DCR
  let client = await authStorage.loadClient(mcpUrl);
  let port: number;
  let redirectUri: string;

  if (client) {
    if (options.port) {
      redirectUri = `http://127.0.0.1:${options.port}/callback`;
      if (redirectUri !== client.redirectUri) {
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
    if (error instanceof Error) {
      console.error(`${error.message}.`);
    }
    return false;
  }

  // Step 7: Handle callback outcome
  if (callback.type !== "success") {
    console.error(callback.message);
    // Let the callback server finish sending the error page to the browser
    await new Promise((r) => setTimeout(r, 2000));
    return false;
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
    console.error(
      `Failed to complete authentication: ${error instanceof Error ? error.message : error}`,
    );
    return false;
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

  const hours = Math.round(tokenResponse.expiresIn / 3600);
  console.log("Logged in successfully.\n");
  console.log(`  Environment: ${mcpUrl}`);
  console.log(`  Token expires in: ${hours} hour${hours !== 1 ? "s" : ""}\n`);

  return true;
}

/**
 * Core login command logic, separated for testability.
 * Wraps performLogin with CLI-specific behavior (already-logged-in check, process.exit).
 */
export async function loginAction(
  options: LoginOptions,
  deps: LoginDependencies,
): Promise<void> {
  const { authStorage, mcpUrl } = deps;

  // Validate port if provided
  if (
    options.port !== undefined &&
    (Number.isNaN(options.port) || options.port < 1 || options.port > 65535)
  ) {
    console.error("Invalid port number. Must be between 1 and 65535.");
    process.exit(1);
  }

  // Check if already logged in
  const existing = await authStorage.loadTokens(mcpUrl);
  if (existing && !options.force) {
    const isExpired =
      existing.expiresAt && new Date(existing.expiresAt) < new Date();
    if (!isExpired) {
      console.log("Already logged in.\n");
      console.log(`  Environment: ${mcpUrl}\n`);
      console.log("To re-authenticate, use `githits login --force`.");
      return;
    }
    console.log("Token expired. Starting new login...\n");
  } else if (existing && options.force) {
    console.log("Re-authenticating (--force flag)...\n");
  }

  const success = await performLogin(deps, {
    browser: options.browser,
    port: options.port,
  });

  if (!success) {
    console.log("\nRun `githits login` to try again.");
    process.exit(1);
  }

  console.log("You're ready to use githits with your AI assistant.");
}

const LOGIN_DESCRIPTION = `Authenticate with your GitHits account via browser.

Opens your browser to complete authentication securely using OAuth.
The CLI receives tokens stored locally and used for API requests.

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
      const deps = await createContainer();
      await loginAction(options, deps);
    });
}
