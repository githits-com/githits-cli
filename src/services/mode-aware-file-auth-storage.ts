import type { AuthStorageMode } from "./auth-config.js";
import type {
  AuthStorage,
  ClientRegistration,
  TokenData,
} from "./auth-storage.js";

export class AuthStoragePolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthStoragePolicyError";
  }
}

export function createFileAuthStorageGuidance(configPath: string): string {
  return `OAuth credentials were not saved to plaintext file storage.

Options:
  1. Unlock or fix your system keychain.
  2. Use GITHITS_API_TOKEN for CI/automation.
  3. If you accept storing OAuth credentials unencrypted on disk, set:

     [auth]
     storage = "file"

     in ${configPath}, or run with GITHITS_AUTH_STORAGE=file.

Warning: file storage is plaintext. Use it only on machines where local file access is trusted.`;
}

/**
 * Enforces the auth.storage policy at the plaintext file boundary.
 * Reads and clears stay available for migration/logout; writes require file mode.
 */
export class ModeAwareFileAuthStorage implements AuthStorage {
  constructor(
    private readonly storage: AuthStorage,
    private readonly mode: AuthStorageMode,
    private readonly configPath = "your GitHits config.toml",
  ) {}

  loadTokens(baseUrl: string): Promise<TokenData | null> {
    return this.storage.loadTokens(baseUrl);
  }

  async saveTokens(baseUrl: string, data: TokenData): Promise<void> {
    this.assertFileMode();
    await this.storage.saveTokens(baseUrl, data);
  }

  clearTokens(baseUrl: string): Promise<void> {
    return this.storage.clearTokens(baseUrl);
  }

  loadClient(baseUrl: string): Promise<ClientRegistration | null> {
    return this.storage.loadClient(baseUrl);
  }

  async saveClient(baseUrl: string, data: ClientRegistration): Promise<void> {
    this.assertFileMode();
    await this.storage.saveClient(baseUrl, data);
  }

  clearClient(baseUrl: string): Promise<void> {
    return this.storage.clearClient(baseUrl);
  }

  getStorageLocation(): string {
    return this.storage.getStorageLocation();
  }

  private assertFileMode(): void {
    if (this.mode === "file") return;
    throw new AuthStoragePolicyError(
      createFileAuthStorageGuidance(this.configPath),
    );
  }
}
