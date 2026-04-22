import type {
  AuthStorage,
  ClientRegistration,
  TokenData,
} from "./auth-storage.js";
import { KeychainUnavailableError } from "./keyring-service.js";

/**
 * AuthStorage decorator that migrates credentials from a legacy (file-based)
 * backend to a primary (keychain) backend transparently on first load per URL.
 *
 * Migration flow per credential:
 * 1. Check primary → if found, return it
 * 2. Check legacy → if found, write to primary → delete from legacy → return it
 * 3. Both empty → return null
 *
 * If the primary keychain becomes unavailable at runtime, the storage falls back
 * to the legacy backend for the lifetime of the process and stops attempting
 * migrations.
 */
export class MigratingAuthStorage implements AuthStorage {
  private primaryAvailable = true;
  private warnedOnPrimaryFailure = false;

  constructor(
    private readonly primary: AuthStorage,
    private readonly legacy: AuthStorage,
    private readonly onPrimaryUnavailable: (
      error: KeychainUnavailableError,
    ) => void = () => {},
  ) {}

  async loadTokens(baseUrl: string): Promise<TokenData | null> {
    if (this.primaryAvailable) {
      try {
        const tokens = await this.primary.loadTokens(baseUrl);
        if (tokens) return tokens;
      } catch (error) {
        if (!this.handlePrimaryFailure(error)) throw error;
      }
    }

    const legacyTokens = await this.legacy.loadTokens(baseUrl);
    if (!legacyTokens) return null;
    if (!this.primaryAvailable) return legacyTokens;

    try {
      await this.primary.saveTokens(baseUrl, legacyTokens);
    } catch (error) {
      if (!this.handlePrimaryFailure(error)) throw error;
      return legacyTokens;
    }

    try {
      await this.legacy.clearTokens(baseUrl);
    } catch {
      // Non-fatal: legacy entry persists but primary is now authoritative.
      // Next load will return from primary, skipping migration entirely.
    }
    return legacyTokens;
  }

  async saveTokens(baseUrl: string, data: TokenData): Promise<void> {
    if (this.primaryAvailable) {
      try {
        await this.primary.saveTokens(baseUrl, data);
        return;
      } catch (error) {
        if (!this.handlePrimaryFailure(error)) throw error;
      }
    }

    await this.legacy.saveTokens(baseUrl, data);
  }

  async clearTokens(baseUrl: string): Promise<void> {
    let primaryError: unknown;
    if (this.primaryAvailable) {
      try {
        await this.primary.clearTokens(baseUrl);
      } catch (error) {
        if (!this.handlePrimaryFailure(error)) {
          primaryError = error;
        }
      }
    }

    try {
      await this.legacy.clearTokens(baseUrl);
    } catch {
      // Best-effort legacy cleanup
    }
    if (primaryError) throw primaryError;
  }

  async loadClient(baseUrl: string): Promise<ClientRegistration | null> {
    if (this.primaryAvailable) {
      try {
        const client = await this.primary.loadClient(baseUrl);
        if (client) return client;
      } catch (error) {
        if (!this.handlePrimaryFailure(error)) throw error;
      }
    }

    const legacyClient = await this.legacy.loadClient(baseUrl);
    if (!legacyClient) return null;
    if (!this.primaryAvailable) return legacyClient;

    try {
      await this.primary.saveClient(baseUrl, legacyClient);
    } catch (error) {
      if (!this.handlePrimaryFailure(error)) throw error;
      return legacyClient;
    }

    try {
      await this.legacy.clearClient(baseUrl);
    } catch {
      // Non-fatal: legacy entry persists but primary is now authoritative.
      // Next load will return from primary, skipping migration entirely.
    }
    return legacyClient;
  }

  async saveClient(baseUrl: string, data: ClientRegistration): Promise<void> {
    if (this.primaryAvailable) {
      try {
        await this.primary.saveClient(baseUrl, data);
        return;
      } catch (error) {
        if (!this.handlePrimaryFailure(error)) throw error;
      }
    }

    await this.legacy.saveClient(baseUrl, data);
  }

  async clearClient(baseUrl: string): Promise<void> {
    let primaryError: unknown;
    if (this.primaryAvailable) {
      try {
        await this.primary.clearClient(baseUrl);
      } catch (error) {
        if (!this.handlePrimaryFailure(error)) {
          primaryError = error;
        }
      }
    }

    try {
      await this.legacy.clearClient(baseUrl);
    } catch {
      // Best-effort legacy cleanup
    }
    if (primaryError) throw primaryError;
  }

  getStorageLocation(): string {
    return this.primaryAvailable
      ? this.primary.getStorageLocation()
      : this.legacy.getStorageLocation();
  }

  private handlePrimaryFailure(error: unknown): boolean {
    if (!(error instanceof KeychainUnavailableError)) {
      return false;
    }

    this.primaryAvailable = false;
    if (!this.warnedOnPrimaryFailure) {
      this.warnedOnPrimaryFailure = true;
      this.onPrimaryUnavailable(error);
    }
    return true;
  }
}
