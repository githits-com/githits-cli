import type {
  AuthStorage,
  ClientRegistration,
  TokenData,
} from "./auth-storage.js";
import {
  clearAuthSessionBestEffort,
  normalizeBaseUrl,
  sameTokenData,
} from "./auth-storage.js";
import type { KeyringService } from "./keyring-service.js";

const SERVICE_NAME = "githits";
const TOKEN_PREFIX = "v1:tokens:";
const CLIENT_PREFIX = "v1:client:";

/**
 * Parse JSON from keychain, returning null for invalid/corrupt data.
 * Treats parse failures as missing entries rather than errors, since
 * keychain contents can be corrupted by external tools.
 */
function parseJsonOrNull<T>(json: string | null): T | null {
  if (json === null) return null;
  try {
    const parsed = JSON.parse(json);
    if (typeof parsed !== "object" || parsed === null) return null;
    return parsed as T;
  } catch {
    return null;
  }
}

/**
 * Validates that parsed data has the required TokenData fields.
 * Rejects empty strings since an empty accessToken or refreshToken
 * is semantically invalid even if structurally correct.
 */
function isValidTokenData(data: unknown): data is TokenData {
  if (typeof data !== "object" || data === null) return false;
  const d = data as Record<string, unknown>;
  return (
    typeof d.accessToken === "string" &&
    d.accessToken.length > 0 &&
    typeof d.refreshToken === "string" &&
    d.refreshToken.length > 0 &&
    typeof d.createdAt === "string" &&
    d.createdAt.length > 0 &&
    (d.expiresAt === null ||
      (typeof d.expiresAt === "string" && d.expiresAt.length > 0))
  );
}

/**
 * Validates that parsed data has the required ClientRegistration fields.
 * Rejects empty strings since an empty clientId or clientSecret
 * is semantically invalid even if structurally correct.
 */
function isValidClientRegistration(data: unknown): data is ClientRegistration {
  if (typeof data !== "object" || data === null) return false;
  const d = data as Record<string, unknown>;
  return (
    typeof d.clientId === "string" &&
    d.clientId.length > 0 &&
    typeof d.clientSecret === "string" &&
    d.clientSecret.length > 0 &&
    typeof d.redirectUri === "string" &&
    d.redirectUri.length > 0 &&
    typeof d.registeredAt === "string" &&
    d.registeredAt.length > 0
  );
}

/**
 * AuthStorage implementation backed by the system keychain.
 * Stores each credential as a separate keychain entry with JSON-serialized values.
 */
export class KeychainAuthStorage implements AuthStorage {
  constructor(private readonly keyring: KeyringService) {}

  async loadTokens(baseUrl: string): Promise<TokenData | null> {
    const key = `${TOKEN_PREFIX}${normalizeBaseUrl(baseUrl)}`;
    const json = this.keyring.getPassword(SERVICE_NAME, key);
    const data = parseJsonOrNull<TokenData>(json);
    if (data !== null && !isValidTokenData(data)) return null;
    return data;
  }

  async saveTokens(baseUrl: string, data: TokenData): Promise<void> {
    const key = `${TOKEN_PREFIX}${normalizeBaseUrl(baseUrl)}`;
    this.keyring.setPassword(SERVICE_NAME, key, JSON.stringify(data));
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
    const key = `${TOKEN_PREFIX}${normalizeBaseUrl(baseUrl)}`;
    this.keyring.deletePassword(SERVICE_NAME, key);
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
    const key = `${CLIENT_PREFIX}${normalizeBaseUrl(baseUrl)}`;
    const json = this.keyring.getPassword(SERVICE_NAME, key);
    const data = parseJsonOrNull<ClientRegistration>(json);
    if (data !== null && !isValidClientRegistration(data)) return null;
    return data;
  }

  async saveClient(baseUrl: string, data: ClientRegistration): Promise<void> {
    const key = `${CLIENT_PREFIX}${normalizeBaseUrl(baseUrl)}`;
    this.keyring.setPassword(SERVICE_NAME, key, JSON.stringify(data));
  }

  async clearClient(baseUrl: string): Promise<void> {
    const key = `${CLIENT_PREFIX}${normalizeBaseUrl(baseUrl)}`;
    this.keyring.deletePassword(SERVICE_NAME, key);
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

  getStorageLocation(): string {
    switch (process.platform) {
      case "darwin":
        return "macOS Keychain (githits)";
      case "win32":
        return "Windows Credential Manager (githits)";
      default:
        return "System keychain (githits)";
    }
  }
}
