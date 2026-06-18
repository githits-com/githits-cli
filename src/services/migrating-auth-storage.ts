import type { AuthStorageMode } from "./auth-config.js";
import type { AuthSessionMetadataStore } from "./auth-session-metadata-storage.js";
import type {
  AuthStorage,
  ClientRegistration,
  TokenData,
} from "./auth-storage.js";
import { KeychainUnavailableError } from "./keyring-service.js";
import {
  AuthStoragePolicyError,
  createFileAuthStorageGuidance,
} from "./mode-aware-file-auth-storage.js";

interface Candidate<T> {
  data: T;
  source: "file" | "legacy";
  storage: AuthStorage;
  timestamp: string;
  ambiguous: boolean;
}

/**
 * AuthStorage implementation that coordinates the configured active store with
 * legacy plaintext locations. Switching between keychain and file storage is
 * intentionally not migrated; users must run `githits login` in the new mode.
 */
export class MigratingAuthStorage implements AuthStorage {
  private warnedAmbiguousPlaintext = false;

  constructor(
    private readonly primary: AuthStorage,
    private readonly file: AuthStorage,
    private readonly legacy: AuthStorage,
    private readonly mode: AuthStorageMode,
    private readonly configPath = "your GitHits config.toml",
    private readonly onWarning: (message: string) => void = () => {},
    private readonly metadata?: AuthSessionMetadataStore,
    private readonly additionalLegacyStores: AuthStorage[] = [],
  ) {}

  async loadTokens(baseUrl: string): Promise<TokenData | null> {
    if (this.mode === "file") {
      return this.loadTokensFileMode(baseUrl);
    }
    return this.loadTokensKeychainMode(baseUrl);
  }

  async saveTokens(baseUrl: string, data: TokenData): Promise<void> {
    if (this.mode === "file") {
      await this.file.saveTokens(baseUrl, data);
      await this.saveMetadataBestEffort(baseUrl, data);
      return;
    }
    try {
      await this.primary.saveTokens(baseUrl, data);
      await this.saveMetadataBestEffort(baseUrl, data);
    } catch (error) {
      throw this.toPolicyError(error);
    }
  }

  async saveTokensIfUnchanged(
    baseUrl: string,
    expected: TokenData | null,
    data: TokenData,
  ): Promise<boolean> {
    const current = await this.loadTokens(baseUrl);
    if (!this.sameTokenData(current, expected)) return false;
    await this.saveTokens(baseUrl, data);
    return true;
  }

  async clearTokens(baseUrl: string): Promise<void> {
    const primaryError = await this.clearBestEffort(() =>
      this.primary.clearTokens(baseUrl),
    );
    await this.clearBestEffort(() => this.file.clearTokens(baseUrl));
    await this.clearBestEffort(() => this.legacy.clearTokens(baseUrl));
    for (const legacy of this.additionalLegacyStores) {
      await this.clearBestEffort(() => legacy.clearTokens(baseUrl));
    }
    await this.clearBestEffort(
      () => this.metadata?.clear(baseUrl) ?? Promise.resolve(),
    );
    if (primaryError && !(primaryError instanceof KeychainUnavailableError)) {
      throw primaryError;
    }
  }

  async clearTokensIfUnchanged(
    baseUrl: string,
    expected: TokenData | null,
  ): Promise<boolean> {
    const current = await this.loadTokens(baseUrl);
    if (!this.sameTokenData(current, expected)) return false;
    await this.clearTokens(baseUrl);
    return true;
  }

  /**
   * Clear tokens from the active backend *class* only, when unchanged.
   *
   * The active class is everything the active-mode load reads: in keychain mode
   * just `primary`; in file mode `file` plus all legacy plaintext stores (a
   * file-source load does not clear legacy, so a leftover legacy copy would be
   * re-migrated on the next load and resurrect the just-cleared credential).
   * The genuinely inactive backend (keychain in file mode) is preserved — this
   * is what stops an automatic refresh failure from wiping a good credential in
   * the other storage mode.
   */
  async clearActiveTokensIfUnchanged(
    baseUrl: string,
    expected: TokenData | null,
  ): Promise<boolean> {
    // CAS against the newest active candidate so a concurrent re-login (a newer
    // token than the one that failed refresh) is never wiped.
    const current = await this.currentActiveTokens(baseUrl);
    if (!this.sameTokenData(current, expected)) return false;

    let firstError: unknown;
    for (const store of this.activeStores()) {
      const error = await this.clearBestEffort(() =>
        store.clearTokens(baseUrl),
      );
      firstError ??= error;
    }
    // metadata.json is mode-independent; clearing it on an active-session clear
    // prevents an orphaned-session record. Cross-mode tradeoff: this also drops
    // the other mode's session metadata, which self-heals on the next load.
    const metadataError = await this.clearBestEffort(
      () => this.metadata?.clear(baseUrl) ?? Promise.resolve(),
    );
    firstError ??= metadataError;
    if (firstError && !(firstError instanceof KeychainUnavailableError)) {
      throw firstError;
    }
    return true;
  }

  async loadClient(baseUrl: string): Promise<ClientRegistration | null> {
    if (this.mode === "file") {
      return this.loadClientFileMode(baseUrl);
    }
    return this.loadClientKeychainMode(baseUrl);
  }

  async saveClient(baseUrl: string, data: ClientRegistration): Promise<void> {
    if (this.mode === "file") {
      await this.file.saveClient(baseUrl, data);
      return;
    }
    try {
      await this.primary.saveClient(baseUrl, data);
    } catch (error) {
      throw this.toPolicyError(error);
    }
  }

  async clearClient(baseUrl: string): Promise<void> {
    const primaryError = await this.clearBestEffort(() =>
      this.primary.clearClient(baseUrl),
    );
    await this.clearBestEffort(() => this.file.clearClient(baseUrl));
    await this.clearBestEffort(() => this.legacy.clearClient(baseUrl));
    for (const legacy of this.additionalLegacyStores) {
      await this.clearBestEffort(() => legacy.clearClient(baseUrl));
    }
    if (primaryError && !(primaryError instanceof KeychainUnavailableError)) {
      throw primaryError;
    }
  }

  /**
   * Clear client registration from the active backend *class* only, mirroring
   * {@link clearActiveTokensIfUnchanged}: file + legacy in file mode, keychain
   * in keychain mode. Prevents a stale legacy client from re-migrating after an
   * active-mode clear.
   */
  async clearActiveClient(baseUrl: string): Promise<void> {
    let firstError: unknown;
    for (const store of this.activeStores()) {
      const error = await this.clearBestEffort(() =>
        store.clearClient(baseUrl),
      );
      firstError ??= error;
    }
    if (firstError && !(firstError instanceof KeychainUnavailableError)) {
      throw firstError;
    }
  }

  async saveAuthSession(
    baseUrl: string,
    client: ClientRegistration,
    tokens: TokenData,
  ): Promise<void> {
    if (this.mode === "file") {
      await this.file.saveAuthSession(baseUrl, client, tokens);
      await this.saveMetadataBestEffort(baseUrl, tokens);
      return;
    }
    try {
      await this.primary.saveAuthSession(baseUrl, client, tokens);
      await this.saveMetadataBestEffort(baseUrl, tokens);
    } catch (error) {
      throw this.toPolicyError(error);
    }
  }

  async clearAuthSession(baseUrl: string): Promise<void> {
    const primaryError = await this.clearBestEffort(() =>
      this.primary.clearAuthSession(baseUrl),
    );
    await this.clearBestEffort(() => this.file.clearAuthSession(baseUrl));
    await this.clearBestEffort(() => this.legacy.clearAuthSession(baseUrl));
    for (const legacy of this.additionalLegacyStores) {
      await this.clearBestEffort(() => legacy.clearAuthSession(baseUrl));
    }
    await this.clearBestEffort(
      () => this.metadata?.clear(baseUrl) ?? Promise.resolve(),
    );
    if (primaryError && !(primaryError instanceof KeychainUnavailableError)) {
      throw primaryError;
    }
  }

  getStorageLocation(): string {
    return this.mode === "file"
      ? this.file.getStorageLocation()
      : this.primary.getStorageLocation();
  }

  private async loadTokensKeychainMode(
    baseUrl: string,
  ): Promise<TokenData | null> {
    try {
      const primaryTokens = await this.primary.loadTokens(baseUrl);
      if (primaryTokens) {
        await this.saveMetadataBestEffort(baseUrl, primaryTokens);
        return primaryTokens;
      }
    } catch (error) {
      if (!(error instanceof KeychainUnavailableError)) throw error;
    }
    return null;
  }

  private async loadTokensFileMode(baseUrl: string): Promise<TokenData | null> {
    const candidate = await this.selectPlaintextTokenCandidate(baseUrl);
    if (candidate) {
      if (candidate.source === "legacy") {
        await this.file.saveTokens(baseUrl, candidate.data);
        await this.clearBestEffort(() =>
          candidate.storage.clearTokens(baseUrl),
        );
      }
      await this.saveMetadataBestEffort(baseUrl, candidate.data);
      return candidate.data;
    }

    return null;
  }

  private async loadClientKeychainMode(
    baseUrl: string,
  ): Promise<ClientRegistration | null> {
    try {
      const primaryClient = await this.primary.loadClient(baseUrl);
      if (primaryClient) return primaryClient;
    } catch (error) {
      if (!(error instanceof KeychainUnavailableError)) throw error;
    }
    return null;
  }

  private async loadClientFileMode(
    baseUrl: string,
  ): Promise<ClientRegistration | null> {
    const candidate = await this.selectPlaintextClientCandidate(baseUrl);
    if (candidate) {
      if (candidate.source === "legacy") {
        await this.file.saveClient(baseUrl, candidate.data);
        await this.clearBestEffort(() =>
          candidate.storage.clearClient(baseUrl),
        );
      }
      return candidate.data;
    }

    return null;
  }

  private async selectPlaintextTokenCandidate(
    baseUrl: string,
  ): Promise<Candidate<TokenData> | null> {
    const candidates: Array<Candidate<TokenData>> = [];
    const fileTokens = await this.file.loadTokens(baseUrl);
    if (fileTokens) {
      candidates.push({
        data: fileTokens,
        source: "file",
        storage: this.file,
        timestamp: fileTokens.createdAt,
        ambiguous: false,
      });
    }
    for (const legacy of this.getLegacyStores()) {
      const legacyTokens = await legacy.loadTokens(baseUrl);
      if (legacyTokens) {
        candidates.push({
          data: legacyTokens,
          source: "legacy",
          storage: legacy,
          timestamp: legacyTokens.createdAt,
          ambiguous: false,
        });
      }
    }
    return this.selectNewestCandidate(candidates);
  }

  private async selectPlaintextClientCandidate(
    baseUrl: string,
  ): Promise<Candidate<ClientRegistration> | null> {
    const candidates: Array<Candidate<ClientRegistration>> = [];
    const fileClient = await this.file.loadClient(baseUrl);
    if (fileClient) {
      candidates.push({
        data: fileClient,
        source: "file",
        storage: this.file,
        timestamp: fileClient.registeredAt,
        ambiguous: false,
      });
    }
    for (const legacy of this.getLegacyStores()) {
      const legacyClient = await legacy.loadClient(baseUrl);
      if (legacyClient) {
        candidates.push({
          data: legacyClient,
          source: "legacy",
          storage: legacy,
          timestamp: legacyClient.registeredAt,
          ambiguous: false,
        });
      }
    }
    return this.selectNewestCandidate(candidates);
  }

  private selectNewestCandidate<T>(
    candidates: Array<Candidate<T>>,
  ): Candidate<T> | null {
    if (candidates.length === 0) return null;
    if (candidates.length === 1) return candidates[0] ?? null;

    const parsed = candidates.map((candidate) => ({
      candidate,
      timestampMs: Date.parse(candidate.timestamp),
    }));
    if (parsed.some((entry) => Number.isNaN(entry.timestampMs))) {
      this.warnAmbiguousPlaintext();
      const selected =
        candidates.find((candidate) => candidate.source === "file") ?? null;
      if (selected) selected.ambiguous = true;
      return selected;
    }

    const sorted = [...parsed].sort((a, b) => b.timestampMs - a.timestampMs);
    const first = sorted[0];
    const second = sorted[1];
    if (!first) return candidates[0] ?? null;
    if (second && first.timestampMs === second.timestampMs) {
      this.warnAmbiguousPlaintext();
      const selected =
        candidates.find((candidate) => candidate.source === "file") ?? null;
      if (!selected) return null;
      selected.ambiguous = true;
      return selected;
    }
    return first.candidate;
  }

  private getLegacyStores(): AuthStorage[] {
    return [...this.additionalLegacyStores, this.legacy];
  }

  /**
   * The set of backends the active-mode load reads from. Clearing exactly this
   * set leaves the inactive backend untouched while ensuring no copy survives in
   * a legacy store to be re-migrated later.
   */
  private activeStores(): AuthStorage[] {
    return this.mode === "file"
      ? [this.file, ...this.getLegacyStores()]
      : [this.primary];
  }

  /**
   * Newest token from the active class WITHOUT migration side effects, used for
   * the active-clear compare-and-swap. Mirrors what the active-mode load would
   * select, but never writes (unlike `loadTokensFileMode`).
   */
  private async currentActiveTokens(
    baseUrl: string,
  ): Promise<TokenData | null> {
    if (this.mode === "file") {
      const candidate = await this.selectPlaintextTokenCandidate(baseUrl);
      return candidate?.data ?? null;
    }
    try {
      return await this.primary.loadTokens(baseUrl);
    } catch (error) {
      if (error instanceof KeychainUnavailableError) return null;
      throw error;
    }
  }

  private async clearBestEffort(fn: () => Promise<void>): Promise<unknown> {
    try {
      await fn();
      return undefined;
    } catch (error) {
      return error;
    }
  }

  private async saveMetadataBestEffort(
    baseUrl: string,
    tokens: TokenData,
  ): Promise<void> {
    await this.clearBestEffort(
      () => this.metadata?.saveFromTokens(baseUrl, tokens) ?? Promise.resolve(),
    );
  }

  private toPolicyError(error: unknown): unknown {
    if (!(error instanceof KeychainUnavailableError)) return error;
    return new AuthStoragePolicyError(
      `System keychain is unavailable. ${createFileAuthStorageGuidance(this.configPath)}`,
    );
  }

  private warnAmbiguousPlaintext(): void {
    if (this.warnedAmbiguousPlaintext) return;
    this.warnedAmbiguousPlaintext = true;
    this.onWarning(
      "Warning: multiple plaintext auth entries exist with ambiguous timestamps; using the new config auth path and leaving the other entry intact.",
    );
  }

  private sameTokenData(a: TokenData | null, b: TokenData | null): boolean {
    if (a === null || b === null) return a === b;
    return (
      a.accessToken === b.accessToken &&
      a.refreshToken === b.refreshToken &&
      a.expiresAt === b.expiresAt &&
      a.createdAt === b.createdAt
    );
  }
}
