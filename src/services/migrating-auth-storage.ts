import type { AuthStorageMode } from "./auth-config.js";
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

type CredentialKind = "tokens" | "client";

interface Candidate<T> {
  data: T;
  source: "file" | "legacy" | "keychain";
  timestamp: string;
  ambiguous: boolean;
}

/**
 * AuthStorage implementation that coordinates the configured active store with
 * legacy plaintext locations so credentials migrate without silent downgrades.
 */
export class MigratingAuthStorage implements AuthStorage {
  private warnedFileModeKeychainExport = false;
  private warnedAmbiguousPlaintext = false;

  constructor(
    private readonly primary: AuthStorage,
    private readonly file: AuthStorage,
    private readonly legacy: AuthStorage,
    private readonly mode: AuthStorageMode,
    private readonly configPath = "your GitHits config.toml",
    private readonly onWarning: (message: string) => void = () => {},
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
      return;
    }
    try {
      await this.primary.saveTokens(baseUrl, data);
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
    if (primaryError && !(primaryError instanceof KeychainUnavailableError)) {
      throw primaryError;
    }
  }

  async saveAuthSession(
    baseUrl: string,
    client: ClientRegistration,
    tokens: TokenData,
  ): Promise<void> {
    if (this.mode === "file") {
      await this.file.saveAuthSession(baseUrl, client, tokens);
      return;
    }
    try {
      await this.primary.saveAuthSession(baseUrl, client, tokens);
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
      if (primaryTokens) return primaryTokens;
    } catch (error) {
      if (!(error instanceof KeychainUnavailableError)) throw error;
    }

    const candidate = await this.selectPlaintextTokenCandidate(baseUrl);
    if (!candidate) return null;

    try {
      await this.primary.saveTokens(baseUrl, candidate.data);
    } catch (error) {
      if (error instanceof KeychainUnavailableError) return candidate.data;
      throw error;
    }

    await this.clearMigratedPlaintext(
      baseUrl,
      "tokens",
      candidate.source,
      candidate.ambiguous,
    );
    return candidate.data;
  }

  private async loadTokensFileMode(baseUrl: string): Promise<TokenData | null> {
    const candidate = await this.selectPlaintextTokenCandidate(baseUrl);
    if (candidate) {
      if (candidate.source === "legacy") {
        await this.file.saveTokens(baseUrl, candidate.data);
        await this.clearBestEffort(() => this.legacy.clearTokens(baseUrl));
      }
      return candidate.data;
    }

    let primaryTokens: TokenData | null = null;
    try {
      primaryTokens = await this.primary.loadTokens(baseUrl);
    } catch (error) {
      if (!(error instanceof KeychainUnavailableError)) throw error;
    }
    if (!primaryTokens) return null;

    this.warnKeychainExport();
    await this.file.saveTokens(baseUrl, primaryTokens);
    return primaryTokens;
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

    const candidate = await this.selectPlaintextClientCandidate(baseUrl);
    if (!candidate) return null;

    try {
      await this.primary.saveClient(baseUrl, candidate.data);
    } catch (error) {
      if (error instanceof KeychainUnavailableError) return candidate.data;
      throw error;
    }

    await this.clearMigratedPlaintext(
      baseUrl,
      "client",
      candidate.source,
      candidate.ambiguous,
    );
    return candidate.data;
  }

  private async loadClientFileMode(
    baseUrl: string,
  ): Promise<ClientRegistration | null> {
    const candidate = await this.selectPlaintextClientCandidate(baseUrl);
    if (candidate) {
      if (candidate.source === "legacy") {
        await this.file.saveClient(baseUrl, candidate.data);
        await this.clearBestEffort(() => this.legacy.clearClient(baseUrl));
      }
      return candidate.data;
    }

    let primaryClient: ClientRegistration | null = null;
    try {
      primaryClient = await this.primary.loadClient(baseUrl);
    } catch (error) {
      if (!(error instanceof KeychainUnavailableError)) throw error;
    }
    if (!primaryClient) return null;

    this.warnKeychainExport();
    await this.file.saveClient(baseUrl, primaryClient);
    return primaryClient;
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
        timestamp: fileTokens.createdAt,
        ambiguous: false,
      });
    }
    const legacyTokens = await this.legacy.loadTokens(baseUrl);
    if (legacyTokens) {
      candidates.push({
        data: legacyTokens,
        source: "legacy",
        timestamp: legacyTokens.createdAt,
        ambiguous: false,
      });
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
        timestamp: fileClient.registeredAt,
        ambiguous: false,
      });
    }
    const legacyClient = await this.legacy.loadClient(baseUrl);
    if (legacyClient) {
      candidates.push({
        data: legacyClient,
        source: "legacy",
        timestamp: legacyClient.registeredAt,
        ambiguous: false,
      });
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
        candidates.find((candidate) => candidate.source === "file") ??
        candidates[0] ??
        null;
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
        candidates.find((candidate) => candidate.source === "file") ??
        first.candidate;
      selected.ambiguous = true;
      return selected;
    }
    return first.candidate;
  }

  private async clearMigratedPlaintext(
    baseUrl: string,
    kind: CredentialKind,
    source: "file" | "legacy" | "keychain",
    ambiguous = false,
  ): Promise<void> {
    if (!ambiguous) {
      await this.clearPlaintextSource(this.file, baseUrl, kind);
      await this.clearPlaintextSource(this.legacy, baseUrl, kind);
      return;
    }
    if (source === "file") {
      await this.clearPlaintextSource(this.file, baseUrl, kind);
      return;
    }
    if (source === "legacy") {
      await this.clearPlaintextSource(this.legacy, baseUrl, kind);
    }
  }

  private async clearPlaintextSource(
    storage: AuthStorage,
    baseUrl: string,
    kind: CredentialKind,
  ): Promise<void> {
    await this.clearBestEffort(() =>
      kind === "tokens"
        ? storage.clearTokens(baseUrl)
        : storage.clearClient(baseUrl),
    );
  }

  private async clearBestEffort(fn: () => Promise<void>): Promise<unknown> {
    try {
      await fn();
      return undefined;
    } catch (error) {
      return error;
    }
  }

  private toPolicyError(error: unknown): unknown {
    if (!(error instanceof KeychainUnavailableError)) return error;
    return new AuthStoragePolicyError(
      `System keychain is unavailable. ${createFileAuthStorageGuidance(this.configPath)}`,
    );
  }

  private warnKeychainExport(): void {
    if (this.warnedFileModeKeychainExport) return;
    this.warnedFileModeKeychainExport = true;
    this.onWarning(
      "Warning: auth.storage=file is exporting existing keychain credentials to plaintext file storage.",
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
