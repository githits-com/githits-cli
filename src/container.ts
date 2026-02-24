import type { GitHitsService } from "./services/index.js";
import {
  type AuthService,
  AuthServiceImpl,
  type AuthStorage,
  AuthStorageImpl,
  type BrowserService,
  BrowserServiceImpl,
  type FileSystemService,
  FileSystemServiceImpl,
  GitHitsServiceImpl,
  getApiUrl,
  getEnvApiToken,
  getMcpUrl,
  KeychainAuthStorage,
  KeychainUnavailableError,
  KeyringServiceImpl,
  MigratingAuthStorage,
  RefreshingGitHitsService,
  TokenManager,
} from "./services/index.js";

/**
 * Create an AuthStorage instance, preferring keychain with file-based fallback.
 * Probes keychain availability with a write+delete test. If the keychain is
 * unavailable (no daemon, access denied), falls back to file storage with a warning.
 */
function createAuthStorage(fileSystemService: FileSystemService): AuthStorage {
  const fileStorage = new AuthStorageImpl(fileSystemService);

  try {
    const keyring = new KeyringServiceImpl();
    // Probe keychain availability with a write+delete cycle.
    // Use timestamp + random suffix to avoid probe key collisions.
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
  /** GitHits REST API service */
  githitsService: GitHitsService;
}

/**
 * Creates the production dependency container.
 * Async because token resolution requires reading stored auth.
 */
export async function createContainer(): Promise<Dependencies> {
  const mcpUrl = getMcpUrl();
  const apiUrl = getApiUrl();
  const fileSystemService = new FileSystemServiceImpl();
  const authStorage = createAuthStorage(fileSystemService);
  const authService = new AuthServiceImpl();
  const browserService = new BrowserServiceImpl();

  // Check for env API token first
  const envToken = getEnvApiToken();
  if (envToken) {
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
      githitsService: new GitHitsServiceImpl(apiUrl, envToken),
    };
  }

  // Create token manager for stored auth with auto-refresh
  const tokenManager = new TokenManager({ authService, authStorage, mcpUrl });
  const apiToken = await tokenManager.getToken();

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
    githitsService: new RefreshingGitHitsService(apiUrl, tokenManager),
  };
}
