import { mock } from "bun:test";
import type {
  AuthService,
  CallbackResult,
  OAuthMetadata,
  PkceParams,
  TokenResponse,
} from "./auth-service.js";
import type {
  AuthStorage,
  ClientRegistration,
  TokenData,
} from "./auth-storage.js";
import type { BrowserService } from "./browser-service.js";
import type { ExecResult, ExecService } from "./exec-service.js";
import type { FileSystemService } from "./filesystem-service.js";
import type { GitHitsService } from "./githits-service.js";
import type { KeyringService } from "./keyring-service.js";
import type {
  CheckboxChoice,
  ConfirmChoice,
  PromptService,
} from "./prompt-service.js";
import type { TokenProvider } from "./token-manager.js";

/**
 * Default OAuth metadata for testing.
 */
export const defaultOAuthMetadata: OAuthMetadata = {
  authorizationEndpoint: "https://auth.example.com/oauth/authorize",
  tokenEndpoint: "https://auth.example.com/oauth/token",
  registrationEndpoint: "https://auth.example.com/oauth/register",
};

/**
 * Default PKCE params for testing.
 */
export const defaultPkceParams: PkceParams = {
  verifier: "test-verifier",
  challenge: "test-challenge",
  state: "test-state",
};

/**
 * Default callback result for testing.
 */
export const defaultCallbackResult: CallbackResult = {
  type: "success",
  code: "test-code",
  state: defaultPkceParams.state,
};

/**
 * Default token response for testing.
 */
export const defaultTokenResponse: TokenResponse = {
  accessToken: "eyJ-test-access-token",
  refreshToken: "test-refresh-token",
  expiresIn: 3600,
};

/**
 * Default client registration for testing.
 */
export const defaultClientRegistration: ClientRegistration = {
  clientId: "test-client-id",
  clientSecret: "test-client-secret",
  redirectUri: "http://127.0.0.1:8080/callback",
  registeredAt: "2025-01-15T10:30:00Z",
};

/**
 * Creates a mock AuthService with default implementations.
 */
export function createMockAuthService(
  impl: Partial<AuthService> = {},
): AuthService {
  return {
    discoverEndpoints: mock(() => Promise.resolve(defaultOAuthMetadata)),
    registerClient: mock(() =>
      Promise.resolve({
        clientId: "test-client-id",
        clientSecret: "test-client-secret",
      }),
    ),
    generatePkceParams: mock(() => defaultPkceParams),
    buildAuthUrl: mock(() => "http://example.com/auth"),
    startCallbackServer: mock(() => Promise.resolve(defaultCallbackResult)),
    exchangeCodeForTokens: mock(() => Promise.resolve(defaultTokenResponse)),
    refreshAccessToken: mock(() => Promise.resolve(defaultTokenResponse)),
    ...impl,
  };
}

/**
 * Creates a mock AuthStorage with default implementations.
 */
export function createMockAuthStorage(
  impl: Partial<AuthStorage> = {},
): AuthStorage {
  return {
    loadTokens: mock(() => Promise.resolve(null)),
    saveTokens: mock(() => Promise.resolve()),
    clearTokens: mock(() => Promise.resolve()),
    loadClient: mock(() => Promise.resolve(null)),
    saveClient: mock(() => Promise.resolve()),
    clearClient: mock(() => Promise.resolve()),
    getStorageLocation: mock(() => "/mock/.githits"),
    ...impl,
  };
}

/**
 * Creates a mock BrowserService with default implementations.
 */
export function createMockBrowserService(
  impl: Partial<BrowserService> = {},
): BrowserService {
  return {
    open: mock(() => Promise.resolve()),
    ...impl,
  };
}

/**
 * Creates a mock FileSystemService with default implementations.
 */
export function createMockFileSystemService(
  impl: Partial<FileSystemService> = {},
): FileSystemService {
  return {
    readFile: mock(() => Promise.reject(new Error("File not found"))),
    writeFile: mock(() => Promise.resolve()),
    deleteFile: mock(() => Promise.resolve()),
    exists: mock(() => Promise.resolve(false)),
    ensureDir: mock(() => Promise.resolve()),
    getHomeDir: mock(() => "/home/test"),
    joinPath: mock((...segments: string[]) => segments.join("/")),
    getCwd: mock(() => "/current/dir"),
    getDirname: mock(
      (path: string) => path.split("/").slice(0, -1).join("/") || "/",
    ),
    readdir: mock(() => Promise.resolve([])),
    isDirectory: mock(() => Promise.resolve(false)),
    atomicWriteFile: mock(() => Promise.resolve()),
    ...impl,
  };
}

/**
 * Creates a mock GitHitsService with default implementations.
 */
export function createMockGitHitsService(
  impl: Partial<GitHitsService> = {},
): GitHitsService {
  return {
    search: mock(() =>
      Promise.resolve("# Example\n```js\nconsole.log('hi')\n```"),
    ),
    getLanguages: mock(() =>
      Promise.resolve([
        {
          id: "1",
          name: "javascript",
          display_name: "JavaScript",
          aliases: ["js"],
        },
        {
          id: "2",
          name: "typescript",
          display_name: "TypeScript",
          aliases: ["ts"],
        },
        {
          id: "3",
          name: "python",
          display_name: "Python",
          aliases: ["py"],
        },
      ]),
    ),
    submitFeedback: mock(() =>
      Promise.resolve({
        success: true,
        message: "Feedback submitted successfully",
      }),
    ),
    ...impl,
  };
}

/**
 * Creates a mock KeyringService with default implementations.
 */
export function createMockKeyringService(
  impl: Partial<KeyringService> = {},
): KeyringService {
  return {
    getPassword: mock(() => null),
    setPassword: mock(() => {}),
    deletePassword: mock(() => false),
    ...impl,
  };
}

/**
 * Creates a mock TokenProvider with default implementations.
 */
export function createMockTokenProvider(
  impl: Partial<TokenProvider> = {},
): TokenProvider {
  return {
    getToken: mock(() => Promise.resolve("mock-access-token")),
    forceRefresh: mock(() => Promise.resolve("mock-refreshed-token")),
    ...impl,
  };
}

/**
 * Creates valid TokenData for testing.
 */
export function createValidTokenData(
  overrides: Partial<TokenData> = {},
): TokenData {
  return {
    accessToken: "eyJ-test-access-token",
    refreshToken: "test-refresh-token",
    createdAt: "2025-01-15T10:30:00Z",
    expiresAt: null,
    ...overrides,
  };
}

/**
 * Creates a mock PromptService with default implementations.
 */
export function createMockPromptService(
  impl: Partial<PromptService> = {},
): PromptService {
  return {
    checkbox: mock(() => Promise.resolve([])) as PromptService["checkbox"],
    confirm3: mock(() => Promise.resolve("yes" as ConfirmChoice)),
    ...impl,
  };
}

/**
 * Creates a mock ExecService with default implementations.
 */
export function createMockExecService(
  impl: Partial<ExecService> = {},
): ExecService {
  return {
    exec: mock(() =>
      Promise.resolve({ exitCode: 0, stdout: "", stderr: "" } as ExecResult),
    ),
    ...impl,
  };
}
