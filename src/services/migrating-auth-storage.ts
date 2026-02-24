import type {
  AuthStorage,
  ClientRegistration,
  TokenData,
} from "./auth-storage.js";

/**
 * AuthStorage decorator that migrates credentials from a legacy (file-based)
 * backend to a primary (keychain) backend transparently on first load per URL.
 *
 * Migration flow per credential:
 * 1. Check primary → if found, return it
 * 2. Check legacy → if found, write to primary → delete from legacy → return it
 * 3. Both empty → return null
 *
 * Ordering guarantee: primary write must succeed before legacy entry is deleted.
 * If primary write fails, legacy entry is kept intact and the error propagates.
 *
 * Saves always go to primary only. Clears hit both (idempotent).
 */
export class MigratingAuthStorage implements AuthStorage {
  constructor(
    private readonly primary: AuthStorage,
    private readonly legacy: AuthStorage,
  ) {}

  async loadTokens(baseUrl: string): Promise<TokenData | null> {
    const tokens = await this.primary.loadTokens(baseUrl);
    if (tokens) return tokens;

    const legacyTokens = await this.legacy.loadTokens(baseUrl);
    if (legacyTokens) {
      // Primary write must succeed before we attempt to remove from legacy.
      // If primary write fails, the error propagates and legacy stays intact.
      await this.primary.saveTokens(baseUrl, legacyTokens);
      try {
        await this.legacy.clearTokens(baseUrl);
      } catch {
        // Non-fatal: legacy entry persists but primary is now authoritative.
        // Next load will return from primary, skipping migration entirely.
      }
      return legacyTokens;
    }

    return null;
  }

  async saveTokens(baseUrl: string, data: TokenData): Promise<void> {
    await this.primary.saveTokens(baseUrl, data);
  }

  async clearTokens(baseUrl: string): Promise<void> {
    let primaryError: unknown;
    try {
      await this.primary.clearTokens(baseUrl);
    } catch (error) {
      primaryError = error;
    }
    // Always attempt legacy clear regardless of primary result.
    // Legacy failure is non-fatal — the primary error (if any) takes precedence.
    try {
      await this.legacy.clearTokens(baseUrl);
    } catch {
      // Best-effort legacy cleanup
    }
    if (primaryError) throw primaryError;
  }

  async loadClient(baseUrl: string): Promise<ClientRegistration | null> {
    const client = await this.primary.loadClient(baseUrl);
    if (client) return client;

    const legacyClient = await this.legacy.loadClient(baseUrl);
    if (legacyClient) {
      await this.primary.saveClient(baseUrl, legacyClient);
      try {
        await this.legacy.clearClient(baseUrl);
      } catch {
        // Non-fatal: legacy entry persists but primary is now authoritative.
        // Next load will return from primary, skipping migration entirely.
      }
      return legacyClient;
    }

    return null;
  }

  async saveClient(baseUrl: string, data: ClientRegistration): Promise<void> {
    await this.primary.saveClient(baseUrl, data);
  }

  async clearClient(baseUrl: string): Promise<void> {
    let primaryError: unknown;
    try {
      await this.primary.clearClient(baseUrl);
    } catch (error) {
      primaryError = error;
    }
    // Always attempt legacy clear regardless of primary result.
    // Legacy failure is non-fatal — the primary error (if any) takes precedence.
    try {
      await this.legacy.clearClient(baseUrl);
    } catch {
      // Best-effort legacy cleanup
    }
    if (primaryError) throw primaryError;
  }

  getStorageLocation(): string {
    return this.primary.getStorageLocation();
  }
}
