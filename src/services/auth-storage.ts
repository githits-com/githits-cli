import { getAuthFileStorageDir } from "./app-config-paths.js";
import type { FileSystemService } from "./filesystem-service.js";

/**
 * Token data for a single environment.
 */
export interface TokenData {
  accessToken: string;
  refreshToken: string;
  expiresAt: string | null;
  createdAt: string;
}

/**
 * Stored authentication data structure.
 * Supports multiple tokens keyed by MCP server base URL.
 */
export interface StoredAuth {
  version: 1;
  tokens: Record<string, TokenData>;
}

/**
 * OAuth client registration from DCR.
 */
export interface ClientRegistration {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  registeredAt: string;
}

/**
 * Stored client registrations.
 * Keyed by MCP server base URL.
 */
export interface StoredClients {
  version: 1;
  clients: Record<string, ClientRegistration>;
}

/**
 * Interface for authentication storage operations.
 * Abstraction allows for easy testing with mock implementations.
 */
export interface AuthStorage {
  /** Load tokens for a specific base URL, returns null if not found */
  loadTokens(baseUrl: string): Promise<TokenData | null>;

  /** Save tokens for a specific base URL */
  saveTokens(baseUrl: string, data: TokenData): Promise<void>;

  /** Save tokens only when the currently stored token still matches expected */
  saveTokensIfUnchanged(
    baseUrl: string,
    expected: TokenData | null,
    data: TokenData,
  ): Promise<boolean>;

  /** Clear tokens for a specific base URL */
  clearTokens(baseUrl: string): Promise<void>;

  /** Clear tokens only when the currently stored token still matches expected */
  clearTokensIfUnchanged(
    baseUrl: string,
    expected: TokenData | null,
  ): Promise<boolean>;

  /** Load client registration for a specific base URL */
  loadClient(baseUrl: string): Promise<ClientRegistration | null>;

  /** Save client registration for a specific base URL */
  saveClient(baseUrl: string, data: ClientRegistration): Promise<void>;

  /** Clear client registration for a specific base URL */
  clearClient(baseUrl: string): Promise<void>;

  /** Save client registration and tokens as one auth session update */
  saveAuthSession(
    baseUrl: string,
    client: ClientRegistration,
    tokens: TokenData,
  ): Promise<void>;

  /** Clear client registration and tokens as one auth session update */
  clearAuthSession(baseUrl: string): Promise<void>;

  /** Get a human-readable description of where credentials are stored */
  getStorageLocation(): string;
}

const AUTH_FILE = "auth.json";
const CLIENT_FILE = "client.json";
const DIR_MODE = 0o700;

/**
 * File-based auth storage implementation.
 * Stores auth under the platform config directory with secure permissions.
 */
export class AuthStorageImpl implements AuthStorage {
  private readonly configDir: string;
  private readonly authPath: string;
  private readonly clientPath: string;

  constructor(
    private readonly fs: FileSystemService,
    configDir?: string,
  ) {
    this.configDir = configDir ?? getAuthFileStorageDir(fs);
    this.authPath = fs.joinPath(this.configDir, AUTH_FILE);
    this.clientPath = fs.joinPath(this.configDir, CLIENT_FILE);
  }

  getStorageLocation(): string {
    return this.configDir;
  }

  async loadTokens(baseUrl: string): Promise<TokenData | null> {
    const stored = await this.loadAuthFile();
    if (!stored) return null;
    return stored.tokens[normalizeBaseUrl(baseUrl)] ?? null;
  }

  async saveTokens(baseUrl: string, data: TokenData): Promise<void> {
    const stored = (await this.loadAuthFile()) ?? {
      version: 1 as const,
      tokens: {},
    };
    stored.tokens[normalizeBaseUrl(baseUrl)] = data;

    await this.fs.ensureDir(this.configDir, DIR_MODE);
    await this.fs.atomicWriteFile(
      this.authPath,
      JSON.stringify(stored, null, 2),
    );
  }

  async saveTokensIfUnchanged(
    baseUrl: string,
    expected: TokenData | null,
    data: TokenData,
  ): Promise<boolean> {
    const current = await this.loadTokens(baseUrl);
    if (!sameTokenData(current, expected)) return false;
    await this.saveTokens(baseUrl, data);
    return true;
  }

  async clearTokens(baseUrl: string): Promise<void> {
    const stored = await this.loadAuthFile();
    if (!stored) return;

    delete stored.tokens[normalizeBaseUrl(baseUrl)];

    if (Object.keys(stored.tokens).length === 0) {
      await this.fs.deleteFile(this.authPath);
    } else {
      await this.fs.atomicWriteFile(
        this.authPath,
        JSON.stringify(stored, null, 2),
      );
    }
  }

  async clearTokensIfUnchanged(
    baseUrl: string,
    expected: TokenData | null,
  ): Promise<boolean> {
    const current = await this.loadTokens(baseUrl);
    if (!sameTokenData(current, expected)) return false;
    await this.clearTokens(baseUrl);
    return true;
  }

  async loadClient(baseUrl: string): Promise<ClientRegistration | null> {
    const stored = await this.loadClientFile();
    if (!stored) return null;
    return stored.clients[normalizeBaseUrl(baseUrl)] ?? null;
  }

  async clearClient(baseUrl: string): Promise<void> {
    const stored = await this.loadClientFile();
    if (!stored) return;

    delete stored.clients[normalizeBaseUrl(baseUrl)];

    if (Object.keys(stored.clients).length === 0) {
      await this.fs.deleteFile(this.clientPath);
    } else {
      await this.fs.atomicWriteFile(
        this.clientPath,
        JSON.stringify(stored, null, 2),
      );
    }
  }

  async saveClient(baseUrl: string, data: ClientRegistration): Promise<void> {
    const stored = (await this.loadClientFile()) ?? {
      version: 1 as const,
      clients: {},
    };
    stored.clients[normalizeBaseUrl(baseUrl)] = data;

    await this.fs.ensureDir(this.configDir, DIR_MODE);
    await this.fs.atomicWriteFile(
      this.clientPath,
      JSON.stringify(stored, null, 2),
    );
  }

  async saveAuthSession(
    baseUrl: string,
    client: ClientRegistration,
    tokens: TokenData,
  ): Promise<void> {
    await this.saveClient(baseUrl, client);
    await this.saveTokens(baseUrl, tokens);
  }

  async clearAuthSession(baseUrl: string): Promise<void> {
    await clearAuthSessionBestEffort(
      () => this.clearTokens(baseUrl),
      () => this.clearClient(baseUrl),
    );
  }

  private async loadAuthFile(): Promise<StoredAuth | null> {
    if (!(await this.fs.exists(this.authPath))) return null;
    try {
      const content = await this.fs.readFile(this.authPath);
      const data = JSON.parse(content);
      if (data.version !== 1 || !data.tokens) return null;
      return data as StoredAuth;
    } catch {
      return null;
    }
  }

  private async loadClientFile(): Promise<StoredClients | null> {
    if (!(await this.fs.exists(this.clientPath))) return null;
    try {
      const content = await this.fs.readFile(this.clientPath);
      const data = JSON.parse(content);
      if (data.version !== 1 || !data.clients) return null;
      return data as StoredClients;
    } catch {
      return null;
    }
  }
}

/**
 * Normalize base URL for consistent key storage.
 * Strips trailing slashes so the same server URL always produces
 * the same storage key regardless of how the user typed it.
 */
export function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

export function sameTokenData(
  a: TokenData | null,
  b: TokenData | null,
): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.accessToken === b.accessToken &&
    a.refreshToken === b.refreshToken &&
    a.expiresAt === b.expiresAt &&
    a.createdAt === b.createdAt
  );
}

export async function clearAuthSessionBestEffort(
  clearTokens: () => Promise<void>,
  clearClient: () => Promise<void>,
): Promise<void> {
  let firstError: unknown;
  try {
    await clearTokens();
  } catch (error) {
    firstError = error;
  }
  try {
    await clearClient();
  } catch (error) {
    firstError ??= error;
  }
  if (firstError) throw firstError;
}
