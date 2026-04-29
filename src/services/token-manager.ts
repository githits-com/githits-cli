import { withTelemetrySpan } from "../shared/telemetry.js";
import type { AuthService, RefreshTokenResponse } from "./auth-service.js";
import type { AuthStorage, TokenData } from "./auth-storage.js";

/**
 * Ratio of token lifetime at which proactive refresh triggers.
 * At 0.9 (90%), a 1-hour token refreshes at ~54 minutes.
 */
const PROACTIVE_REFRESH_RATIO = 0.9;

/**
 * Provides a valid access token, refreshing if needed.
 */
export interface TokenProvider {
  /** Get a valid token, refreshing proactively or reactively as needed. */
  getToken(): Promise<string | undefined>;

  /** Force a refresh (called on 401 retry). */
  forceRefresh(): Promise<string | undefined>;
}

/**
 * Dependencies needed by TokenManager.
 */
export interface TokenManagerDeps {
  authService: AuthService;
  authStorage: AuthStorage;
  mcpUrl: string;
}

/**
 * Determine whether a token should be refreshed.
 * Pure function extracted for testability.
 */
export function shouldRefreshToken(
  token: TokenData,
  ratio: number,
  now: Date,
): { expired: boolean; shouldRefresh: boolean } {
  if (!token.expiresAt) {
    return { expired: false, shouldRefresh: false };
  }

  const expiresAt = new Date(token.expiresAt).getTime();
  const nowMs = now.getTime();

  if (nowMs >= expiresAt) {
    return { expired: true, shouldRefresh: true };
  }

  // Proactive refresh: check if we're past the threshold
  const createdAt = new Date(token.createdAt).getTime();
  const lifetime = expiresAt - createdAt;

  // Defensive: if createdAt >= expiresAt (invalid data), skip proactive refresh
  if (lifetime <= 0) {
    return { expired: false, shouldRefresh: false };
  }

  const threshold = createdAt + lifetime * ratio;
  return { expired: false, shouldRefresh: nowMs >= threshold };
}

/**
 * Single-shot refresh of an expired token.
 * Delegates to a temporary TokenManager instance to avoid logic duplication.
 * Returns the new access token on success, undefined on failure.
 */
export async function refreshExpiredToken(
  authService: AuthService,
  authStorage: AuthStorage,
  mcpUrl: string,
): Promise<string | undefined> {
  const manager = new TokenManager({ authService, authStorage, mcpUrl });
  return manager.forceRefresh();
}

/**
 * Manages token lifecycle for long-running processes.
 * Handles proactive refresh, concurrent-request coalescing, and error recovery.
 */
export class TokenManager implements TokenProvider {
  private readonly authService: AuthService;
  private readonly authStorage: AuthStorage;
  private readonly mcpUrl: string;
  private cachedToken: TokenData | null = null;
  private refreshPromise: Promise<string | undefined> | null = null;

  constructor(deps: TokenManagerDeps) {
    this.authService = deps.authService;
    this.authStorage = deps.authStorage;
    this.mcpUrl = deps.mcpUrl;
  }

  async getToken(): Promise<string | undefined> {
    return withTelemetrySpan("token-manager.get-token", async () => {
      // Load from storage on first call
      if (!this.cachedToken) {
        this.cachedToken = await withTelemetrySpan(
          "token-manager.load-tokens",
          () => this.authStorage.loadTokens(this.mcpUrl),
        );
        if (!this.cachedToken) return undefined;
      }

      const currentToken = this.cachedToken.accessToken;
      const { expired, shouldRefresh } = shouldRefreshToken(
        this.cachedToken,
        PROACTIVE_REFRESH_RATIO,
        new Date(),
      );

      if (!shouldRefresh) {
        return currentToken;
      }

      // Attempt refresh (coalesced if already in-flight)
      const refreshedToken = await this.doRefresh();

      if (refreshedToken) {
        return refreshedToken;
      }

      // Proactive refresh failed but token still valid — return current token
      if (!expired) {
        return currentToken;
      }

      // Token expired and refresh failed
      return undefined;
    });
  }

  async forceRefresh(): Promise<string | undefined> {
    return withTelemetrySpan("token-manager.force-refresh", () =>
      this.doRefresh(),
    );
  }

  /**
   * Execute a refresh, coalescing concurrent requests.
   */
  private async doRefresh(): Promise<string | undefined> {
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.refreshPromise = this.executeRefresh();
    try {
      return await this.refreshPromise;
    } finally {
      this.refreshPromise = null;
    }
  }

  private async executeRefresh(): Promise<string | undefined> {
    return withTelemetrySpan("token-manager.refresh", async () => {
      const tokens =
        this.cachedToken ??
        (await withTelemetrySpan("token-manager.load-tokens", () =>
          this.authStorage.loadTokens(this.mcpUrl),
        ));
      if (!tokens) return undefined;

      const client = await withTelemetrySpan("token-manager.load-client", () =>
        this.authStorage.loadClient(this.mcpUrl),
      );
      if (!client) return undefined;

      let response: RefreshTokenResponse;
      try {
        const metadata = await withTelemetrySpan(
          "token-manager.discover-endpoints",
          () => this.authService.discoverEndpoints(this.mcpUrl),
        );
        response = await withTelemetrySpan(
          "token-manager.refresh-access-token",
          () =>
            this.authService.refreshAccessToken({
              tokenEndpoint: metadata.tokenEndpoint,
              clientId: client.clientId,
              clientSecret: client.clientSecret,
              refreshToken: tokens.refreshToken,
            }),
        );
      } catch {
        const reloadedToken = await this.loadExternallyUpdatedToken(tokens);
        if (reloadedToken) return reloadedToken.accessToken;

        // Only clear tokens if they are actually expired and still match the
        // failed in-memory refresh token. A separate `githits login` may have
        // already written fresh tokens for long-running MCP servers.
        const isExpired = tokens.expiresAt
          ? new Date() >= new Date(tokens.expiresAt)
          : false;
        if (isExpired) {
          const currentStoredTokens =
            await this.loadExternallyUpdatedToken(tokens);
          if (currentStoredTokens) return currentStoredTokens.accessToken;

          const cleared = await withTelemetrySpan(
            "token-manager.clear-tokens-if-unchanged",
            () => this.authStorage.clearTokensIfUnchanged(this.mcpUrl, tokens),
          );
          if (!cleared) {
            const currentToken = await this.authStorage.loadTokens(this.mcpUrl);
            this.cachedToken = currentToken;
            return currentToken?.accessToken;
          }
          this.cachedToken = null;
        }
        return undefined;
      }

      const newTokenData: TokenData = {
        accessToken: response.accessToken,
        refreshToken: response.refreshToken ?? tokens.refreshToken,
        expiresAt: new Date(
          Date.now() + response.expiresIn * 1000,
        ).toISOString(),
        // Refresh starts a new token lifetime window. Keeping the
        // original createdAt makes a freshly refreshed token look
        // permanently near expiry, which triggers immediate re-refresh.
        createdAt: new Date().toISOString(),
      };

      const externallyUpdatedToken = await this.loadExternallyUpdatedToken(
        tokens,
        {
          treatMissingAsExternalUpdate: true,
        },
      );
      if (externallyUpdatedToken === null) return undefined;
      if (externallyUpdatedToken) return externallyUpdatedToken.accessToken;

      const saved = await withTelemetrySpan("token-manager.save-tokens", () =>
        this.authStorage.saveTokensIfUnchanged(
          this.mcpUrl,
          tokens,
          newTokenData,
        ),
      );
      if (!saved) {
        const currentToken = await this.authStorage.loadTokens(this.mcpUrl);
        this.cachedToken = currentToken;
        return currentToken?.accessToken;
      }
      this.cachedToken = newTokenData;
      return response.accessToken;
    });
  }

  private async loadExternallyUpdatedToken(
    failedTokens: TokenData,
    options: { treatMissingAsExternalUpdate?: boolean } = {},
  ): Promise<TokenData | null | undefined> {
    const storedTokens = await withTelemetrySpan(
      "token-manager.reload-tokens",
      () => this.authStorage.loadTokens(this.mcpUrl),
    );
    if (!storedTokens) {
      if (options.treatMissingAsExternalUpdate) this.cachedToken = null;
      return options.treatMissingAsExternalUpdate ? null : undefined;
    }
    if (areSameTokenData(storedTokens, failedTokens)) return undefined;

    this.cachedToken = storedTokens;
    return storedTokens;
  }
}

function areSameTokenData(a: TokenData, b: TokenData): boolean {
  return (
    a.accessToken === b.accessToken &&
    a.refreshToken === b.refreshToken &&
    a.expiresAt === b.expiresAt &&
    a.createdAt === b.createdAt
  );
}
