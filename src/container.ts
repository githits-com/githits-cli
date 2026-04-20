import type { GitHitsService } from "./services/index.js";
import {
  type AuthService,
  AuthServiceImpl,
  type AuthStorage,
  AuthStorageImpl,
  type BrowserService,
  BrowserServiceImpl,
  ChunkingKeyringService,
  type CodeNavigationCapability,
  type CodeNavigationService,
  CodeNavigationServiceImpl,
  type FileSystemService,
  FileSystemServiceImpl,
  GitHitsServiceImpl,
  getApiUrl,
  getCodeNavigationCapability,
  getCodeNavigationUrl,
  getEnvApiToken,
  getMcpUrl,
  isCodeNavigationCliOverrideEnabled,
  KeychainAuthStorage,
  KeychainUnavailableError,
  KeyringServiceImpl,
  MigratingAuthStorage,
  RefreshingGitHitsService,
  type TokenData,
  TokenManager,
  type TokenProvider,
  WINDOWS_MAX_ENTRY_SIZE,
} from "./services/index.js";

/**
 * Create an AuthStorage instance, preferring keychain with file-based fallback.
 * Probes keychain availability with a write+delete test. If the keychain is
 * unavailable (no daemon, access denied), falls back to file storage with a warning.
 */
function createAuthStorage(fileSystemService: FileSystemService): AuthStorage {
  const fileStorage = new AuthStorageImpl(fileSystemService);

  try {
    const rawKeyring = new KeyringServiceImpl();
    // Windows Credential Manager limits entries to 2560 UTF-16 chars.
    // Wrap with chunking decorator to split large values across multiple entries.
    const keyring =
      process.platform === "win32"
        ? new ChunkingKeyringService(rawKeyring, WINDOWS_MAX_ENTRY_SIZE)
        : rawKeyring;
    // Probe keychain availability with a write+delete cycle.
    // Use timestamp + random suffix to avoid probe key collisions.
    // Probe value "probe" is 5 chars, passes through the chunking wrapper unchanged.
    const probeKey = `__probe_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    keyring.setPassword("githits", probeKey, "probe");
    try {
      keyring.deletePassword("githits", probeKey);
    } catch {
      // Orphaned probe entry — keychain is operational (write succeeded)
      // but delete failed. The tiny entry is harmless; proceed with keychain.
    }

    const keychainStorage = new KeychainAuthStorage(keyring);
    return new MigratingAuthStorage(keychainStorage, fileStorage);
  } catch (error) {
    if (!(error instanceof KeychainUnavailableError)) throw error;
    console.error(
      "Warning: System keychain unavailable. Falling back to file-based credential storage.",
    );
    return fileStorage;
  }
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
  /** Code navigation capability derived from the startup token snapshot */
  codeNavigationCapability: CodeNavigationCapability;
  /** Whether GITHITS_CODE_NAVIGATION is set to force-expose the code CLI commands locally */
  codeNavigationCliOverrideEnabled: boolean;
  /** Code navigation backend URL when configured */
  codeNavigationUrl: string | undefined;
  /** Optional code navigation service used by gated CLI/MCP paths */
  codeNavigationService: CodeNavigationService | undefined;
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
  const mcpUrl = getMcpUrl();
  const apiUrl = getApiUrl();
  const codeNavigationUrl = getCodeNavigationUrl();
  const codeNavigationCliOverrideEnabled = isCodeNavigationCliOverrideEnabled();
  const fileSystemService = new FileSystemServiceImpl();
  const authStorage = createAuthStorage(fileSystemService);
  const authService = new AuthServiceImpl();
  const browserService = new BrowserServiceImpl();

  // Check for env API token first
  const envToken = getEnvApiToken();
  if (envToken) {
    const codeNavigationService = codeNavigationUrl
      ? new CodeNavigationServiceImpl(
          codeNavigationUrl,
          createStaticTokenProvider(envToken),
        )
      : undefined;

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
      codeNavigationCapability: getCodeNavigationCapability(envToken),
      codeNavigationCliOverrideEnabled,
      codeNavigationUrl,
      codeNavigationService,
      githitsService: new GitHitsServiceImpl(apiUrl, envToken),
    };
  }

  // Create token manager for stored auth with auto-refresh
  const tokenManager = new TokenManager({ authService, authStorage, mcpUrl });
  const apiToken = await tokenManager.getToken();
  const codeNavigationService = codeNavigationUrl
    ? new CodeNavigationServiceImpl(codeNavigationUrl, tokenManager)
    : undefined;

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
    codeNavigationCapability: getCodeNavigationCapability(apiToken),
    codeNavigationCliOverrideEnabled,
    codeNavigationUrl,
    codeNavigationService,
    githitsService: new RefreshingGitHitsService(apiUrl, tokenManager),
  };
}

/**
 * Resolves the startup capability snapshot without triggering token refresh.
 */
export async function resolveStartupCodeNavigationCapability(): Promise<CodeNavigationCapability> {
  const state = await resolveStartupCodeNavigationRegistrationState();
  return state.capability;
}

export interface StartupCodeNavigationRegistrationState {
  capability: CodeNavigationCapability;
  expiredStoredAuth: boolean;
}

/**
 * Resolves CLI registration state without triggering token refresh.
 */
export async function resolveStartupCodeNavigationRegistrationState(): Promise<StartupCodeNavigationRegistrationState> {
  const envToken = getEnvApiToken();
  if (envToken) {
    return {
      capability: getCodeNavigationCapability(envToken),
      expiredStoredAuth: false,
    };
  }

  const tokens = await loadStartupTokens(getMcpUrl());
  if (tokens?.expiresAt && new Date(tokens.expiresAt) < new Date()) {
    return { capability: "unknown", expiredStoredAuth: true };
  }

  return {
    capability: getCodeNavigationCapability(tokens?.accessToken),
    expiredStoredAuth: false,
  };
}

async function loadStartupTokens(mcpUrl: string): Promise<TokenData | null> {
  const fileSystemService = new FileSystemServiceImpl();
  const fileStorage = new AuthStorageImpl(fileSystemService);

  try {
    // Avoid createAuthStorage() here: command registration/help should stay read-only
    // and must not trigger the keychain probe write+delete cycle or migration writes.
    const rawKeyring = new KeyringServiceImpl();
    const keyring =
      process.platform === "win32"
        ? new ChunkingKeyringService(rawKeyring, WINDOWS_MAX_ENTRY_SIZE)
        : rawKeyring;
    const keychainStorage = new KeychainAuthStorage(keyring);
    const keychainTokens = await keychainStorage.loadTokens(mcpUrl);
    if (keychainTokens) {
      return keychainTokens;
    }
  } catch (error) {
    if (!(error instanceof KeychainUnavailableError)) {
      throw error;
    }
  }

  return fileStorage.loadTokens(mcpUrl);
}
