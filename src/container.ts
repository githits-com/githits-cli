import type { GitHitsService } from "./services/index.js";
import {
  type AuthService,
  AuthServiceImpl,
  type AuthStorage,
  AuthStorageImpl,
  type BrowserService,
  BrowserServiceImpl,
  ChunkingKeyringService,
  type CodeNavigationService,
  CodeNavigationServiceImpl,
  type FileSystemService,
  FileSystemServiceImpl,
  GitHitsServiceImpl,
  getApiUrl,
  getCodeNavigationUrl,
  getEnvApiToken,
  getMcpUrl,
  KeychainAuthStorage,
  KeychainUnavailableError,
  KeyringServiceImpl,
  MigratingAuthStorage,
  type PackageIntelligenceService,
  PackageIntelligenceServiceImpl,
  RefreshingGitHitsService,
  TokenManager,
  type TokenProvider,
  WINDOWS_MAX_ENTRY_SIZE,
} from "./services/index.js";
import {
  withTelemetrySpan,
  withTelemetrySpanSync,
} from "./shared/telemetry.js";

/**
 * Create an AuthStorage instance, preferring keychain with file-based fallback.
 * Falls back to file storage only if a real keychain operation fails.
 */
function createAuthStorage(fileSystemService: FileSystemService): AuthStorage {
  return withTelemetrySpanSync("container.create-auth-storage", () => {
    const fileStorage = new AuthStorageImpl(fileSystemService);

    const rawKeyring = new KeyringServiceImpl();
    // Windows Credential Manager limits entries to 2560 UTF-16 chars.
    // Wrap with chunking decorator to split large values across multiple entries.
    const keyring =
      process.platform === "win32"
        ? new ChunkingKeyringService(rawKeyring, WINDOWS_MAX_ENTRY_SIZE)
        : rawKeyring;
    const keychainStorage = new KeychainAuthStorage(keyring);
    return new MigratingAuthStorage(keychainStorage, fileStorage, (error) => {
      if (!(error instanceof KeychainUnavailableError)) return;
      console.error(
        "Warning: System keychain unavailable. Falling back to file-based credential storage.",
      );
    });
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
    const authStorage = createAuthStorage(fileSystemService);
    const authService = new AuthServiceImpl();
    const browserService = new BrowserServiceImpl();

    // Check for env API token first
    const envToken = getEnvApiToken();
    if (envToken) {
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
