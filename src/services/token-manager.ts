import {
  AuthenticationError,
  type TokenProvider,
  withTelemetrySpan,
} from "@githits/core-internal";
import type { AuthDiagnosticsStore } from "./auth-diagnostics-storage.js";
import {
  type AuthService,
  classifyTerminalRefreshError,
  type RefreshTokenResponse,
  type TerminalRefreshFailureReason,
} from "./auth-service.js";
import type { TokenData } from "./auth-storage.js";
import {
  type LockingAuthStorage,
  withAuthStorageLock,
} from "./locked-auth-storage.js";

/**
 * Ratio of token lifetime at which proactive refresh triggers.
 * At 0.9 (90%), a 1-hour token refreshes at ~54 minutes.
 */
const PROACTIVE_REFRESH_RATIO = 0.9;

/**
 * Dependencies needed by TokenManager.
 */
export interface TokenManagerDeps {
  authService: AuthService;
  authStorage: LockingAuthStorage;
  mcpUrl: string;
  /** Return undefined for refresh failures in local status/token probes. */
  refreshFailureMode?: "throw" | "return-undefined";
  /**
   * Optional diagnostics breadcrumb store. When present, terminal refresh
   * failures that clear the token record why, so `doctor` can explain it later.
   */
  authDiagnostics?: AuthDiagnosticsStore;
}

interface RefreshResult {
  accessToken: string | undefined;
  refreshedViaEndpoint: boolean;
  invalidatedCurrentToken: boolean;
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
  authStorage: LockingAuthStorage,
  mcpUrl: string,
): Promise<string | undefined> {
  const manager = new TokenManager({
    authService,
    authStorage,
    mcpUrl,
    refreshFailureMode: "return-undefined",
  });
  return manager.forceRefresh();
}

/**
 * Manages token lifecycle for long-running processes.
 * Handles proactive refresh, concurrent-request coalescing, and error recovery.
 */
export class TokenManager implements TokenProvider {
  private readonly authService: AuthService;
  private readonly authStorage: LockingAuthStorage;
  private readonly mcpUrl: string;
  private readonly refreshFailureMode: "throw" | "return-undefined";
  private readonly authDiagnostics?: AuthDiagnosticsStore;
  private cachedToken: TokenData | null = null;
  private softRefreshPromise: Promise<RefreshResult> | null = null;
  private forceRefreshPromise: Promise<RefreshResult> | null = null;

  constructor(deps: TokenManagerDeps) {
    this.authService = deps.authService;
    this.authStorage = deps.authStorage;
    this.mcpUrl = deps.mcpUrl;
    this.refreshFailureMode = deps.refreshFailureMode ?? "throw";
    this.authDiagnostics = deps.authDiagnostics;
  }

  async getToken(): Promise<string | undefined> {
    return withTelemetrySpan("token-manager.get-token", async () => {
      const activeForceRefresh = this.forceRefreshPromise;
      if (activeForceRefresh) {
        return (await activeForceRefresh).accessToken;
      }

      // Load from storage on first call
      if (!this.cachedToken) {
        const storedToken = await withTelemetrySpan(
          "token-manager.load-tokens",
          () => this.authStorage.loadTokens(this.mcpUrl),
        );
        const startedForceRefresh = this.forceRefreshPromise;
        if (startedForceRefresh) {
          return (await startedForceRefresh).accessToken;
        }
        if (!this.cachedToken) {
          this.cachedToken = storedToken;
        }
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

      // Attempt refresh (coalesced if already in-flight). A proactive refresh
      // failure must not block a still-valid access token, but once the access
      // token is expired the caller needs the real failure instead of a false
      // "no local token" result.
      let refresh: RefreshResult;
      try {
        refresh = await this.refreshFromGetToken();
      } catch (error) {
        if (!expired) return currentToken;
        throw error;
      }

      if (refresh.accessToken) {
        return refresh.accessToken;
      }

      if (refresh.invalidatedCurrentToken) {
        return undefined;
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
      this.refreshAfterAuthFailure(),
    );
  }

  private refreshFromGetToken(): Promise<RefreshResult> {
    return this.softRefresh();
  }

  private async softRefresh(): Promise<RefreshResult> {
    if (this.forceRefreshPromise) return this.forceRefreshPromise;
    if (this.softRefreshPromise) return this.softRefreshPromise;

    this.softRefreshPromise = this.executeRefresh();
    try {
      return await this.softRefreshPromise;
    } finally {
      this.softRefreshPromise = null;
    }
  }

  private async refreshAfterAuthFailure(): Promise<string | undefined> {
    const result = await this.forceEndpointRefresh();
    return result.accessToken;
  }

  private async forceEndpointRefresh(): Promise<RefreshResult> {
    if (this.forceRefreshPromise) return this.forceRefreshPromise;

    this.forceRefreshPromise = (async () => {
      // A force refresh must not reuse a softer getToken refresh that may
      // return externally written credentials without hitting the token
      // endpoint, but later getToken calls should join this stricter work.
      const softResult = await this.softRefreshPromise?.catch(() => undefined);
      if (softResult?.accessToken && softResult.refreshedViaEndpoint) {
        return softResult;
      }
      return this.executeRefresh();
    })();
    try {
      return await this.forceRefreshPromise;
    } finally {
      this.forceRefreshPromise = null;
    }
  }

  private async executeRefresh(): Promise<RefreshResult> {
    return withAuthStorageLock(this.authStorage, () =>
      withTelemetrySpan("token-manager.refresh", async () => {
        const candidate = await this.loadRefreshCandidate();
        if (!candidate) return refreshResult(undefined, false);
        if (candidate.externallyUpdated) {
          const { shouldRefresh } = shouldRefreshToken(
            candidate.tokens,
            PROACTIVE_REFRESH_RATIO,
            new Date(),
          );
          if (!shouldRefresh)
            return refreshResult(candidate.tokens.accessToken, false);
        }
        const tokens = candidate.tokens;

        const client = await withTelemetrySpan(
          "token-manager.load-client",
          () => this.authStorage.loadClient(this.mcpUrl),
        );
        if (!client) {
          if (this.refreshFailureMode === "return-undefined") {
            return refreshResult(undefined, false);
          }
          throw new AuthenticationError(
            "Stored GitHits credentials cannot be refreshed because the OAuth client registration is missing or unreadable.",
            "local",
          );
        }

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
        } catch (error) {
          const terminalFailure = classifyTerminalRefreshError(error);
          const reloadedToken = await this.loadExternallyUpdatedToken(tokens);
          if (reloadedToken)
            return refreshResult(reloadedToken.accessToken, false);

          const isExpired = tokens.expiresAt
            ? new Date() >= new Date(tokens.expiresAt)
            : false;
          if (terminalFailure) {
            return this.clearTerminalRefreshFailure(tokens, terminalFailure);
          }

          if (candidate.externallyUpdated && !isExpired) {
            return refreshResult(tokens.accessToken, false);
          }

          // Reload once more in case another writer landed after the first
          // post-failure check. Otherwise retain the expired candidate so the
          // next call retries without serving its access token.
          if (isExpired) {
            const currentStoredTokens =
              await this.loadExternallyUpdatedToken(tokens);
            if (currentStoredTokens) {
              return refreshResult(currentStoredTokens.accessToken, false);
            }
          }
          if (this.refreshFailureMode === "return-undefined") {
            return refreshResult(undefined, false);
          }
          throw error;
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

        const saved = await withTelemetrySpan("token-manager.save-tokens", () =>
          this.authStorage.saveTokensIfUnchanged(
            this.mcpUrl,
            tokens,
            newTokenData,
          ),
        );
        if (!saved) {
          return this.resolveSuccessfulRefreshConflict(
            tokens,
            response,
            newTokenData,
          );
        }
        this.cachedToken = newTokenData;
        return refreshResult(response.accessToken, true);
      }),
    );
  }

  private async resolveSuccessfulRefreshConflict(
    refreshedFrom: TokenData,
    response: RefreshTokenResponse,
    newTokenData: TokenData,
  ): Promise<RefreshResult> {
    const currentToken = await withTelemetrySpan(
      "token-manager.reload-tokens",
      () => this.authStorage.loadTokens(this.mcpUrl),
    );

    // Respect explicit logout/deletion that happened while refresh was in flight.
    if (!currentToken) {
      this.cachedToken = null;
      return refreshResult(undefined, false);
    }

    // If the server did not rotate the refresh token, or storage now belongs to
    // a different session/refresh lineage, the external writer should win.
    if (
      !response.refreshToken ||
      currentToken.refreshToken !== refreshedFrom.refreshToken
    ) {
      this.cachedToken = currentToken;
      return refreshResult(currentToken.accessToken, false);
    }

    const saved = await withTelemetrySpan(
      "token-manager.save-rotated-tokens-after-conflict",
      () =>
        this.authStorage.saveTokensIfUnchanged(
          this.mcpUrl,
          currentToken,
          newTokenData,
        ),
    );

    if (saved) {
      this.cachedToken = newTokenData;
      return refreshResult(newTokenData.accessToken, true);
    }

    const latestToken = await withTelemetrySpan(
      "token-manager.reload-tokens",
      () => this.authStorage.loadTokens(this.mcpUrl),
    );
    this.cachedToken = latestToken;
    return refreshResult(latestToken?.accessToken, false);
  }

  private async clearTerminalRefreshFailure(
    failedTokens: TokenData,
    reason: TerminalRefreshFailureReason,
  ): Promise<RefreshResult> {
    const cleared = await withTelemetrySpan(
      "token-manager.clear-terminal-refresh-failure",
      () =>
        this.authStorage.clearActiveTokensIfUnchanged(
          this.mcpUrl,
          failedTokens,
        ),
      { reason: `terminal_${reason}` },
    );
    if (!cleared) {
      const latestToken = await withTelemetrySpan(
        "token-manager.reload-tokens",
        () => this.authStorage.loadTokens(this.mcpUrl),
      );
      this.cachedToken = latestToken;
      return refreshResult(latestToken?.accessToken, false, !latestToken);
    }

    if (reason === "invalid_client") {
      await withTelemetrySpan(
        "token-manager.clear-invalid-client",
        () => this.authStorage.clearActiveClient(this.mcpUrl),
        { reason: "terminal_invalid_client" },
      ).catch(() => undefined);
    }

    await this.authDiagnostics?.recordClear(this.mcpUrl, `terminal_${reason}`);

    this.cachedToken = null;
    return refreshResult(undefined, false, true);
  }

  private async loadRefreshCandidate(): Promise<{
    tokens: TokenData;
    externallyUpdated: boolean;
  } | null> {
    const storedTokens = await withTelemetrySpan(
      "token-manager.load-tokens",
      () => this.authStorage.loadTokens(this.mcpUrl),
    );

    if (!this.cachedToken) {
      this.cachedToken = storedTokens;
      return storedTokens
        ? { tokens: storedTokens, externallyUpdated: false }
        : null;
    }

    if (!storedTokens) {
      this.cachedToken = null;
      return null;
    }

    if (!areSameTokenData(storedTokens, this.cachedToken)) {
      this.cachedToken = storedTokens;
      return { tokens: storedTokens, externallyUpdated: true };
    }

    return { tokens: this.cachedToken, externallyUpdated: false };
  }

  private async loadExternallyUpdatedToken(
    failedTokens: TokenData,
  ): Promise<TokenData | undefined> {
    const storedTokens = await withTelemetrySpan(
      "token-manager.reload-tokens",
      () => this.authStorage.loadTokens(this.mcpUrl),
    );
    if (!storedTokens) return undefined;
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

function refreshResult(
  accessToken: string | undefined,
  refreshedViaEndpoint: boolean,
  invalidatedCurrentToken = false,
): RefreshResult {
  return { accessToken, refreshedViaEndpoint, invalidatedCurrentToken };
}
