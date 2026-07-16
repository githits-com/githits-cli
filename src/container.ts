import {
  type AgentInfo,
  type CodeNavigationService,
  CodeNavigationServiceImpl,
  createClientHeaderBuilder,
  createStaticTokenProvider,
  endTelemetrySpan,
  type GitHitsService,
  GitHitsServiceImpl,
  getApiUrl,
  getCodeNavigationUrl,
  getEnvApiToken,
  getMcpStorageKeyUrl,
  getMcpUrl,
  type PackageIntelligenceService,
  PackageIntelligenceServiceImpl,
  RefreshingGitHitsService,
  startTelemetrySpan,
  withTelemetrySpan,
} from "@githits/core-internal";
import { version } from "../package.json";
import {
  getAuthFileStorageDir,
  getLegacyAuthStorageDir,
  getLegacyMacAuthFileStorageDir,
} from "./services/app-config-paths.js";
import {
  type AuthStorageMode,
  loadAuthConfig,
} from "./services/auth-config.js";
import {
  AuthDiagnosticsStorage,
  type AuthDiagnosticsStore,
} from "./services/auth-diagnostics-storage.js";
import { type AuthService, AuthServiceImpl } from "./services/auth-service.js";
import {
  type AuthSessionMetadata,
  AuthSessionMetadataStorage,
} from "./services/auth-session-metadata-storage.js";
import { AuthStorageImpl } from "./services/auth-storage.js";
import {
  type BrowserService,
  BrowserServiceImpl,
} from "./services/browser-service.js";
import {
  ChunkingKeyringService,
  WINDOWS_MAX_ENTRY_SIZE,
} from "./services/chunking-keyring-service.js";
import {
  type FileSystemService,
  FileSystemServiceImpl,
} from "./services/filesystem-service.js";
import { KeychainAuthStorage } from "./services/keychain-auth-storage.js";
import { KeyringServiceImpl } from "./services/keyring-service.js";
import {
  LockedAuthStorage,
  type LockingAuthStorage,
} from "./services/locked-auth-storage.js";
import { MigratingAuthStorage } from "./services/migrating-auth-storage.js";
import { ModeAwareFileAuthStorage } from "./services/mode-aware-file-auth-storage.js";
import { createCliFetch, createLazyCliFetch } from "./services/proxy-fetch.js";
import { TokenManager } from "./services/token-manager.js";

const BASE_CLIENT_NAME = "githits-cli";
const USER_AGENT = `${BASE_CLIENT_NAME}/${version}`;

/**
 * Create an AuthStorage instance using the configured auth storage mode.
 * Keychain mode never silently downgrades writes to plaintext files.
 */
async function createAuthStorage(
  fileSystemService: FileSystemService,
): Promise<LockingAuthStorage> {
  return withTelemetrySpan("container.create-auth-storage", async () => {
    const authConfig = await loadAuthConfig(fileSystemService);
    recordAuthFingerprint(authConfig.storage);
    return createAuthStorageForMode(
      fileSystemService,
      authConfig.storage,
      authConfig.configPath,
    );
  });
}

/**
 * Emit a one-shot telemetry fingerprint of the resolved auth configuration so
 * lockout reports can be segmented by storage mode and config-scope divergence.
 *
 * Records only the storage mode, platform, and which scope-determining env vars
 * are set — never their values, paths, usernames, or credentials. Does not probe
 * the keychain, so it cannot trigger an OS unlock prompt on startup.
 */
export function recordAuthFingerprint(
  mode: AuthStorageMode,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const handle = startTelemetrySpan("auth.fingerprint", {
    mode,
    platform: process.platform,
    homeSet: Boolean(env.HOME),
    xdgConfigHomeSet: Boolean(env.XDG_CONFIG_HOME),
    appDataSet: Boolean(env.APPDATA),
    userProfileSet: Boolean(env.USERPROFILE),
  });
  endTelemetrySpan(handle);
}

function createAuthStorageForMode(
  fileSystemService: FileSystemService,
  mode: AuthStorageMode,
  configPath = "your GitHits config.toml",
): LockingAuthStorage {
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
  const additionalLegacyStores =
    process.platform === "darwin"
      ? [
          new AuthStorageImpl(
            fileSystemService,
            getLegacyMacAuthFileStorageDir(fileSystemService),
          ),
        ]
      : [];

  const rawKeyring = new KeyringServiceImpl();
  // Windows Credential Manager limits entries to 2560 UTF-16 chars.
  // Wrap with chunking decorator to split large values across multiple entries.
  const keyring =
    process.platform === "win32"
      ? new ChunkingKeyringService(rawKeyring, WINDOWS_MAX_ENTRY_SIZE)
      : rawKeyring;
  const keychainStorage = new KeychainAuthStorage(keyring);
  const metadataStorage = new AuthSessionMetadataStorage(fileSystemService);

  return new LockedAuthStorage(
    new MigratingAuthStorage(
      keychainStorage,
      fileStorage,
      legacyStorage,
      mode,
      configPath,
      (message) => console.error(message),
      metadataStorage,
      additionalLegacyStores,
    ),
    fileSystemService,
  );
}

export async function loadAutoLoginAuthSessionMetadata(): Promise<AuthSessionMetadata | null> {
  const envToken = getEnvApiToken();
  if (envToken) {
    const now = new Date().toISOString();
    return { createdAt: now, expiresAt: null, updatedAt: now };
  }

  const fileSystemService = new FileSystemServiceImpl();
  const metadataStorage = new AuthSessionMetadataStorage(fileSystemService);
  return metadataStorage.load(getMcpStorageKeyUrl());
}

export async function clearAutoLoginAuthSessionMetadata(): Promise<void> {
  const fileSystemService = new FileSystemServiceImpl();
  const metadataStorage = new AuthSessionMetadataStorage(fileSystemService);
  await metadataStorage.clear(getMcpStorageKeyUrl());
}

export interface AuthCommandDependencies {
  authStorage: LockingAuthStorage;
  authService: AuthService;
  browserService: BrowserService;
  fileSystemService: FileSystemService;
  authDiagnostics: AuthDiagnosticsStore;
  mcpUrl: string;
  envApiToken: string | undefined;
}

export async function createAuthCommandDependencies(): Promise<AuthCommandDependencies> {
  return withTelemetrySpan("container.create-auth-command", async () => {
    const fileSystemService = new FileSystemServiceImpl();
    return {
      authStorage: await createAuthStorage(fileSystemService),
      authService: new AuthServiceImpl(createLazyCliFetch()),
      browserService: new BrowserServiceImpl(),
      fileSystemService,
      authDiagnostics: new AuthDiagnosticsStorage(fileSystemService),
      mcpUrl: getMcpStorageKeyUrl(),
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
      authService: new AuthServiceImpl(createLazyCliFetch()),
      browserService: new BrowserServiceImpl(),
      fileSystemService,
      authDiagnostics: new AuthDiagnosticsStorage(fileSystemService),
      mcpUrl: getMcpStorageKeyUrl(),
      envApiToken,
    };
  });
}

/**
 * Dependencies required by the application.
 */
export interface Dependencies {
  authStorage: LockingAuthStorage;
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
   * vulnerabilities, dependencies, and changelogs from the
   * package/source service endpoint shared with the code-navigation
   * service.
   */
  packageIntelligenceService: PackageIntelligenceService;
  /** GitHits REST API service */
  githitsService: GitHitsService;
}

export interface CreateContainerOptions {
  /** Resolve stored OAuth immediately. Disable for MCP startup to avoid keychain prompts until first tool use. */
  resolveStoredToken?: boolean;
  /** Client name for telemetry headers. Defaults to direct CLI mode. */
  clientName?: string;
  /** Optional per-request/client agent identity provider. */
  agentProvider?: () => AgentInfo | undefined;
}

/**
 * Creates the production dependency container.
 * Async because token resolution requires reading stored auth.
 */
export async function createContainer(
  options: CreateContainerOptions = {},
): Promise<Dependencies> {
  return withTelemetrySpan("container.create", async () => {
    const resolveStoredToken = options.resolveStoredToken ?? true;
    const mcpUrl = getMcpUrl();
    const apiUrl = getApiUrl();
    const codeNavigationUrl = getCodeNavigationUrl();
    const fileSystemService = new FileSystemServiceImpl();
    const fetchFn = createCliFetch();
    const authService = new AuthServiceImpl(fetchFn);
    const browserService = new BrowserServiceImpl();
    const clientHeaders = createClientHeaderBuilder({
      clientName: options.clientName ?? BASE_CLIENT_NAME,
      clientVersion: version,
      agentProvider: options.agentProvider,
    });
    const serviceRuntime = {
      clientHeaders,
      userAgent: USER_AGENT,
      clientVersion: version,
    };

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
        fetchFn,
        serviceRuntime,
      );
      const packageIntelligenceService = new PackageIntelligenceServiceImpl(
        codeNavigationUrl,
        tokenProvider,
        fetchFn,
        serviceRuntime,
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
        githitsService: new GitHitsServiceImpl(
          apiUrl,
          envToken,
          fetchFn,
          undefined,
          serviceRuntime,
        ),
      };
    }

    // Create token manager for stored auth with auto-refresh
    const authStorage = await createAuthStorage(fileSystemService);
    const tokenManager = new TokenManager({
      authService,
      authStorage,
      mcpUrl,
      authDiagnostics: new AuthDiagnosticsStorage(fileSystemService),
    });
    const apiToken = resolveStoredToken
      ? await withTelemetrySpan("container.token.get", () =>
          tokenManager.getToken(),
        )
      : undefined;
    if (resolveStoredToken && apiToken === undefined) {
      await new AuthSessionMetadataStorage(fileSystemService).clear(mcpUrl);
    }
    const codeNavigationService = new CodeNavigationServiceImpl(
      codeNavigationUrl,
      tokenManager,
      fetchFn,
      serviceRuntime,
    );
    const packageIntelligenceService = new PackageIntelligenceServiceImpl(
      codeNavigationUrl,
      tokenManager,
      fetchFn,
      serviceRuntime,
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
      githitsService: new RefreshingGitHitsService(
        apiUrl,
        tokenManager,
        (innerApiUrl, token) =>
          new GitHitsServiceImpl(
            innerApiUrl,
            token,
            fetchFn,
            undefined,
            serviceRuntime,
          ),
        serviceRuntime,
      ),
    };
  });
}
