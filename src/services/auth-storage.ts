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

  /** Clear tokens for a specific base URL */
  clearTokens(baseUrl: string): Promise<void>;

  /** Load client registration for a specific base URL */
  loadClient(baseUrl: string): Promise<ClientRegistration | null>;

  /** Save client registration for a specific base URL */
  saveClient(baseUrl: string, data: ClientRegistration): Promise<void>;

  /** Clear client registration for a specific base URL */
  clearClient(baseUrl: string): Promise<void>;

  /** Get a human-readable description of where credentials are stored */
  getStorageLocation(): string;
}

const CONFIG_DIR = ".githits";
const AUTH_FILE = "auth.json";
const CLIENT_FILE = "client.json";
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

/**
 * File-based auth storage implementation.
 * Stores auth in ~/.githits/ with secure permissions.
 */
export class AuthStorageImpl implements AuthStorage {
  private readonly configDir: string;
  private readonly authPath: string;
  private readonly clientPath: string;

  constructor(
    private readonly fs: FileSystemService,
    configDir?: string,
  ) {
    this.configDir = configDir ?? fs.joinPath(fs.getHomeDir(), CONFIG_DIR);
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
    await this.fs.writeFile(
      this.authPath,
      JSON.stringify(stored, null, 2),
      FILE_MODE,
    );
  }

  async clearTokens(baseUrl: string): Promise<void> {
    const stored = await this.loadAuthFile();
    if (!stored) return;

    delete stored.tokens[normalizeBaseUrl(baseUrl)];

    if (Object.keys(stored.tokens).length === 0) {
      await this.fs.deleteFile(this.authPath);
    } else {
      await this.fs.writeFile(
        this.authPath,
        JSON.stringify(stored, null, 2),
        FILE_MODE,
      );
    }
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
      await this.fs.writeFile(
        this.clientPath,
        JSON.stringify(stored, null, 2),
        FILE_MODE,
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
    await this.fs.writeFile(
      this.clientPath,
      JSON.stringify(stored, null, 2),
      FILE_MODE,
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
