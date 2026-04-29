import type { GitHitsService } from "./services/index.js";
import {
  type AuthService,
  AuthServiceImpl,
  type AuthStorage,
  AuthStorageImpl,
  type AuthStorageMode,
  type BrowserService,
  BrowserServiceImpl,
  ChunkingKeyringService,
  type CodeNavigationService,
  CodeNavigationServiceImpl,
  type FileSystemService,
  FileSystemServiceImpl,
  GitHitsServiceImpl,
  getApiUrl,
  getAuthFileStorageDir,
  getCodeNavigationUrl,
  getEnvApiToken,
  getLegacyAuthStorageDir,
  getMcpUrl,
  KeychainAuthStorage,
  KeyringServiceImpl,
  LockedAuthStorage,
  loadAuthConfig,
  MigratingAuthStorage,
  ModeAwareFileAuthStorage,
  type PackageIntelligenceService,
  PackageIntelligenceServiceImpl,
  RefreshingGitHitsService,
  TokenManager,
  type TokenProvider,
  WINDOWS_MAX_ENTRY_SIZE,
} from "./services/index.js";
import { withTelemetrySpan } from "./shared/telemetry.js";

/**
 * Create an AuthStorage instance using the configured auth storage mode.
 * Keychain mode never silently downgrades writes to plaintext files.
 */
async function createAuthStorage(
  fileSystemService: FileSystemService,
): Promise<AuthStorage> {
  return withTelemetrySpan("container.create-auth-storage", async () => {
    const authConfig = await loadAuthConfig(fileSystemService);
    return createAuthStorageForMode(
      fileSystemService,
      authConfig.storage,
      authConfig.configPath,
    );
  });
}

function createAuthStorageForMode(
  fileSystemService: FileSystemService,
  mode: AuthStorageMode,
  configPath = "your GitHits config.toml",
): AuthStorage {
  const fileStorage = new ModeAwareFileAuthStorage(
    new AuthStorageImpl(
      fileSystemService,
      getAuthFileStorageDir(fileSystemService),
    ),
    mode,
    configPath,
  );
  const legacyStorage = new AuthStorageImpl(
    fileSystemService,
    getLegacyAuthStorageDir(fileSystemService),
  );

  const rawKeyring = new KeyringServiceImpl();
  // Windows Credential Manager limits entries to 2560 UTF-16 chars.
  // Wrap with chunking decorator to split large values across multiple entries.
  const keyring =
    process.platform === "win32"
      ? new ChunkingKeyringService(rawKeyring, WINDOWS_MAX_ENTRY_SIZE)
      : rawKeyring;
  const keychainStorage = new KeychainAuthStorage(keyring);

  return new LockedAuthStorage(
    new MigratingAuthStorage(
      keychainStorage,
      fileStorage,
      legacyStorage,
      mode,
      configPath,
      (message) => console.error(message),
    ),
    fileSystemService,
  );
}

export interface AuthCommandDependencies {
  authStorage: AuthStorage;
  authService: AuthService;
  browserService: BrowserService;
  fileSystemService: FileSystemService;
  mcpUrl: string;
  apiUrl: string;
  envApiToken: string | undefined;
}

export async function createAuthCommandDependencies(): Promise<AuthCommandDependencies> {
  return withTelemetrySpan("container.create-auth-command", async () => {
    const fileSystemService = new FileSystemServiceImpl();
    return {
      authStorage: await createAuthStorage(fileSystemService),
      authService: new AuthServiceImpl(),
      browserService: new BrowserServiceImpl(),
      fileSystemService,
      mcpUrl: getMcpUrl(),
      apiUrl: getApiUrl(),
      envApiToken: getEnvApiToken(),
    };
  });
}

export async function createAuthStatusDependencies(): Promise<AuthCommandDependencies> {
  return withTelemetrySpan("container.create-auth-status", async () => {
    const fileSystemService = new FileSystemServiceImpl();
    const envApiToken = getEnvApiToken();
    return {
      authStorage: envApiToken
        ? createAuthStorageForMode(fileSystemService, "keychain")
        : await createAuthStorage(fileSystemService),
      authService: new AuthServiceImpl(),
      browserService: new BrowserServiceImpl(),
      fileSystemService,
      mcpUrl: getMcpUrl(),
      apiUrl: getApiUrl(),
      envApiToken,
    };
  });
}

/**
 * Dependencies required by the application.
 */
export interface Dependencies {
  authStorage: AuthStorage;
  authService: AuthService;
  browserService: BrowserService;
  fileSystemService: FileSystemService;
  mcpUrl: string;
  apiUrl: string;
  /** Resolved API token (OAuth JWT or env API token) */
  apiToken: string | undefined;
  /** Whether a valid (non-expired) API token is available */
  hasValidToken: boolean;
  /** Raw GITHITS_API_TOKEN env var value (for auth status display) */
  envApiToken: string | undefined;
  /** Code navigation backend URL */
  codeNavigationUrl: string;
  /** Code navigation service used by CLI/MCP paths */
  codeNavigationService: CodeNavigationService;
  /**
   * Package intelligence service — reads registry metadata,
   * vulnerabilities, dependencies, and changelogs from the pkgseer
   * endpoint shared with the code-navigation service.
   */
  packageIntelligenceService: PackageIntelligenceService;
  /** GitHits REST API service */
  githitsService: GitHitsService;
}

function createStaticTokenProvider(token: string): TokenProvider {
  return {
    getToken: async () => token,
    forceRefresh: async () => undefined,
  };
}

/**
 * Creates the production dependency container.
 * Async because token resolution requires reading stored auth.
 */
export async function createContainer(): Promise<Dependencies> {
  return withTelemetrySpan("container.create", async () => {
    const mcpUrl = getMcpUrl();
    const apiUrl = getApiUrl();
    const codeNavigationUrl = getCodeNavigationUrl();
    const fileSystemService = new FileSystemServiceImpl();
    const authService = new AuthServiceImpl();
    const browserService = new BrowserServiceImpl();

    // Check for env API token first
    const envToken = getEnvApiToken();
    if (envToken) {
      const authStorage = createAuthStorageForMode(
        fileSystemService,
        "keychain",
      );
      const tokenProvider = createStaticTokenProvider(envToken);
      const codeNavigationService = new CodeNavigationServiceImpl(
        codeNavigationUrl,
        tokenProvider,
      );
      const packageIntelligenceService = new PackageIntelligenceServiceImpl(
        codeNavigationUrl,
        tokenProvider,
      );

      return {
        authStorage,
        authService,
        browserService,
        fileSystemService,
        mcpUrl,
        apiUrl,
        apiToken: envToken,
        hasValidToken: true,
        envApiToken: envToken,
        codeNavigationUrl,
        codeNavigationService,
        packageIntelligenceService,
        githitsService: new GitHitsServiceImpl(apiUrl, envToken),
      };
    }

    // Create token manager for stored auth with auto-refresh
    const authStorage = await createAuthStorage(fileSystemService);
    const tokenManager = new TokenManager({ authService, authStorage, mcpUrl });
    const apiToken = await withTelemetrySpan("container.token.get", () =>
      tokenManager.getToken(),
    );
    const codeNavigationService = new CodeNavigationServiceImpl(
      codeNavigationUrl,
      tokenManager,
    );
    const packageIntelligenceService = new PackageIntelligenceServiceImpl(
      codeNavigationUrl,
      tokenManager,
    );

    return {
      authStorage,
      authService,
      browserService,
      fileSystemService,
      mcpUrl,
      apiUrl,
      apiToken,
      hasValidToken: apiToken !== undefined,
      envApiToken: undefined,
      codeNavigationUrl,
      codeNavigationService,
      packageIntelligenceService,
      githitsService: new RefreshingGitHitsService(apiUrl, tokenManager),
    };
  });
}
