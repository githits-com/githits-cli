import { describe, expect, it, mock } from "bun:test";
import { FetchTimeoutError } from "@githits/core-internal";
import { TokenRefreshError } from "./auth-service.js";
import type { TokenData } from "./auth-storage.js";
import {
  createMockAuthService,
  createMockAuthStorage,
  createValidTokenData,
  defaultClientRegistration,
  defaultTokenResponse,
} from "./test-helpers.js";
import {
  refreshExpiredToken,
  shouldRefreshToken,
  TokenManager,
} from "./token-manager.js";

describe("shouldRefreshToken", () => {
  it("returns false/false when expiresAt is null", () => {
    const token = createValidTokenData({ expiresAt: null });
    const result = shouldRefreshToken(token, 0.9, new Date());
    expect(result).toEqual({ expired: false, shouldRefresh: false });
  });

  it("returns expired when now is past expiresAt", () => {
    const token = createValidTokenData({
      createdAt: "2025-01-01T00:00:00Z",
      expiresAt: "2025-01-01T01:00:00Z",
    });
    const now = new Date("2025-01-01T02:00:00Z");
    const result = shouldRefreshToken(token, 0.9, now);
    expect(result).toEqual({ expired: true, shouldRefresh: true });
  });

  it("returns false/false when token is fresh (before threshold)", () => {
    const token = createValidTokenData({
      createdAt: "2025-01-01T00:00:00Z",
      expiresAt: "2025-01-01T01:00:00Z",
    });
    // 30 minutes in = 50% of lifetime, well below 90% threshold
    const now = new Date("2025-01-01T00:30:00Z");
    const result = shouldRefreshToken(token, 0.9, now);
    expect(result).toEqual({ expired: false, shouldRefresh: false });
  });

  it("returns shouldRefresh when past 90% threshold", () => {
    const token = createValidTokenData({
      createdAt: "2025-01-01T00:00:00Z",
      expiresAt: "2025-01-01T01:00:00Z",
    });
    // 55 minutes in = ~91.7% of lifetime, past 90% threshold
    const now = new Date("2025-01-01T00:55:00Z");
    const result = shouldRefreshToken(token, 0.9, now);
    expect(result).toEqual({ expired: false, shouldRefresh: true });
  });

  it("returns false at exactly 89% of lifetime", () => {
    const token = createValidTokenData({
      createdAt: "2025-01-01T00:00:00Z",
      expiresAt: "2025-01-01T01:00:00Z",
    });
    // 53.4 minutes = 89%
    const now = new Date("2025-01-01T00:53:24Z");
    const result = shouldRefreshToken(token, 0.9, now);
    expect(result).toEqual({ expired: false, shouldRefresh: false });
  });

  it("handles invalid lifetime (createdAt >= expiresAt)", () => {
    const token = createValidTokenData({
      createdAt: "2025-01-01T02:00:00Z",
      expiresAt: "2025-01-01T01:00:00Z",
    });
    const now = new Date("2025-01-01T00:30:00Z");
    const result = shouldRefreshToken(token, 0.9, now);
    expect(result).toEqual({ expired: false, shouldRefresh: false });
  });
});

describe("refreshExpiredToken", () => {
  const MCP_URL = "https://mcp.githits.com";

  it("returns undefined when no tokens are stored", async () => {
    const authService = createMockAuthService();
    const authStorage = createMockAuthStorage();

    const result = await refreshExpiredToken(authService, authStorage, MCP_URL);
    expect(result).toBeUndefined();
  });

  it("returns undefined when no client registration exists", async () => {
    const expiredToken = createValidTokenData({
      createdAt: new Date(Date.now() - 7200_000).toISOString(),
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });
    const authService = createMockAuthService();
    const authStorage = createMockAuthStorage({
      loadTokens: mock(() => Promise.resolve(expiredToken)),
    });

    const result = await refreshExpiredToken(authService, authStorage, MCP_URL);
    expect(result).toBeUndefined();
  });

  it("refreshes and saves new tokens on success", async () => {
    const expiredToken = createValidTokenData({
      createdAt: new Date(Date.now() - 7200_000).toISOString(),
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });
    const authService = createMockAuthService();
    const authStorage = createMockAuthStorage({
      loadTokens: mock(() => Promise.resolve(expiredToken)),
      loadClient: mock(() => Promise.resolve(defaultClientRegistration)),
    });

    const result = await refreshExpiredToken(authService, authStorage, MCP_URL);

    expect(result).toBe(defaultTokenResponse.accessToken);
    expect(authStorage.saveTokensIfUnchanged).toHaveBeenCalledTimes(1);
    expect(authService.discoverEndpoints).toHaveBeenCalledWith(MCP_URL);
    expect(authService.refreshAccessToken).toHaveBeenCalledTimes(1);
  });

  it("keeps existing refresh token when refresh response omits one", async () => {
    const expiredToken = createValidTokenData({
      createdAt: new Date(Date.now() - 7200_000).toISOString(),
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
      refreshToken: "existing-refresh-token",
    });
    const authService = createMockAuthService({
      refreshAccessToken: mock(() =>
        Promise.resolve({
          accessToken: "new-access-token",
          expiresIn: 3600,
        }),
      ),
    });
    const authStorage = createMockAuthStorage({
      loadTokens: mock(() => Promise.resolve(expiredToken)),
      loadClient: mock(() => Promise.resolve(defaultClientRegistration)),
    });

    const result = await refreshExpiredToken(authService, authStorage, MCP_URL);

    expect(result).toBe("new-access-token");
    expect(authStorage.saveTokensIfUnchanged).toHaveBeenCalledTimes(1);
    expect(authStorage.saveTokensIfUnchanged).toHaveBeenCalledWith(
      MCP_URL,
      expiredToken,
      expect.objectContaining({ refreshToken: "existing-refresh-token" }),
    );
  });

  it("clears tokens and returns undefined on refresh failure", async () => {
    const expiredToken = createValidTokenData({
      createdAt: new Date(Date.now() - 7200_000).toISOString(),
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });
    const authService = createMockAuthService({
      refreshAccessToken: mock(() =>
        Promise.reject(new Error("refresh failed")),
      ),
    });
    const authStorage = createMockAuthStorage({
      loadTokens: mock(() => Promise.resolve(expiredToken)),
      loadClient: mock(() => Promise.resolve(defaultClientRegistration)),
    });

    const result = await refreshExpiredToken(authService, authStorage, MCP_URL);

    expect(result).toBeUndefined();
    expect(authStorage.clearActiveTokensIfUnchanged).toHaveBeenCalledWith(
      MCP_URL,
      expiredToken,
    );
  });
});

describe("TokenManager", () => {
  const MCP_URL = "https://mcp.githits.com";

  function createTokenManager(
    overrides: {
      authService?: ReturnType<typeof createMockAuthService>;
      authStorage?: ReturnType<typeof createMockAuthStorage>;
      authDiagnostics?: {
        recordClear: ReturnType<typeof mock>;
        load: ReturnType<typeof mock>;
      };
    } = {},
  ) {
    const authService = overrides.authService ?? createMockAuthService();
    const authStorage = overrides.authStorage ?? createMockAuthStorage();
    const authDiagnostics = overrides.authDiagnostics ?? {
      recordClear: mock(() => Promise.resolve()),
      load: mock(() => Promise.resolve(null)),
    };
    const manager = new TokenManager({
      authService,
      authStorage,
      mcpUrl: MCP_URL,
      authDiagnostics,
    });
    return { manager, authService, authStorage, authDiagnostics };
  }

  describe("getToken", () => {
    it("returns undefined when no tokens are stored", async () => {
      const { manager } = createTokenManager();
      const result = await manager.getToken();
      expect(result).toBeUndefined();
    });

    it("returns cached token when not expired", async () => {
      const tokenData = createValidTokenData({
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
        createdAt: new Date(Date.now() - 60_000).toISOString(),
      });
      const { manager, authStorage } = createTokenManager({
        authStorage: createMockAuthStorage({
          loadTokens: mock(() => Promise.resolve(tokenData)),
        }),
      });

      const result = await manager.getToken();
      expect(result).toBe(tokenData.accessToken);
      // Second call should use cache, not load from storage again
      await manager.getToken();
      expect(authStorage.loadTokens).toHaveBeenCalledTimes(1);
    });

    it("returns token without refresh when expiresAt is null", async () => {
      const tokenData = createValidTokenData({ expiresAt: null });
      const { manager, authService } = createTokenManager({
        authStorage: createMockAuthStorage({
          loadTokens: mock(() => Promise.resolve(tokenData)),
        }),
      });

      const result = await manager.getToken();
      expect(result).toBe(tokenData.accessToken);
      expect(authService.refreshAccessToken).not.toHaveBeenCalled();
    });

    it("proactively refreshes when past 90% of lifetime", async () => {
      // Token created 58 minutes ago, expires in 2 minutes (past 90% threshold)
      const tokenData = createValidTokenData({
        createdAt: new Date(Date.now() - 58 * 60_000).toISOString(),
        expiresAt: new Date(Date.now() + 2 * 60_000).toISOString(),
      });
      const { manager, authService, authStorage } = createTokenManager({
        authService: createMockAuthService(),
        authStorage: createMockAuthStorage({
          loadTokens: mock(() => Promise.resolve(tokenData)),
          loadClient: mock(() => Promise.resolve(defaultClientRegistration)),
        }),
      });

      const result = await manager.getToken();
      expect(result).toBe(defaultTokenResponse.accessToken);
      expect(authService.refreshAccessToken).toHaveBeenCalledTimes(1);
      expect(authStorage.saveTokensIfUnchanged).toHaveBeenCalledTimes(1);
    });

    it("returns current token when proactive refresh fails", async () => {
      // Token created 58 minutes ago, expires in 2 minutes
      const tokenData = createValidTokenData({
        createdAt: new Date(Date.now() - 58 * 60_000).toISOString(),
        expiresAt: new Date(Date.now() + 2 * 60_000).toISOString(),
      });
      const { manager } = createTokenManager({
        authService: createMockAuthService({
          refreshAccessToken: mock(() =>
            Promise.reject(new Error("network error")),
          ),
        }),
        authStorage: createMockAuthStorage({
          loadTokens: mock(() => Promise.resolve(tokenData)),
          loadClient: mock(() => Promise.resolve(defaultClientRegistration)),
        }),
      });

      // Should return current (still-valid) token despite refresh failure
      const result = await manager.getToken();
      expect(result).toBe(tokenData.accessToken);

      // Subsequent call should also return the token (cache must not be cleared)
      const result2 = await manager.getToken();
      expect(result2).toBe(tokenData.accessToken);
    });

    it("clears token immediately when proactive refresh reports token reuse", async () => {
      const tokenData = createValidTokenData({
        createdAt: new Date(Date.now() - 58 * 60_000).toISOString(),
        expiresAt: new Date(Date.now() + 2 * 60_000).toISOString(),
      });
      const { manager, authStorage } = createTokenManager({
        authService: createMockAuthService({
          refreshAccessToken: mock(() =>
            Promise.reject(
              new TokenRefreshError(
                400,
                JSON.stringify({
                  error: "invalid_grant",
                  error_description: "Invalid Refresh Token: Already Used",
                }),
              ),
            ),
          ),
        }),
        authStorage: createMockAuthStorage({
          loadTokens: mock(() => Promise.resolve(tokenData)),
          loadClient: mock(() => Promise.resolve(defaultClientRegistration)),
        }),
      });

      const result = await manager.getToken();

      expect(result).toBeUndefined();
      expect(authStorage.clearActiveTokensIfUnchanged).toHaveBeenCalledWith(
        MCP_URL,
        tokenData,
      );
      expect(authStorage.clearActiveClient).not.toHaveBeenCalled();
    });

    it("records a diagnostics breadcrumb when refresh-token reuse clears the token", async () => {
      const tokenData = createValidTokenData({
        createdAt: new Date(Date.now() - 58 * 60_000).toISOString(),
        expiresAt: new Date(Date.now() + 2 * 60_000).toISOString(),
      });
      const { manager, authDiagnostics } = createTokenManager({
        authService: createMockAuthService({
          refreshAccessToken: mock(() =>
            Promise.reject(
              new TokenRefreshError(
                400,
                JSON.stringify({
                  error: "invalid_grant",
                  error_description: "Invalid Refresh Token: Already Used",
                }),
              ),
            ),
          ),
        }),
        authStorage: createMockAuthStorage({
          loadTokens: mock(() => Promise.resolve(tokenData)),
          loadClient: mock(() => Promise.resolve(defaultClientRegistration)),
        }),
      });

      await manager.getToken();

      expect(authDiagnostics.recordClear).toHaveBeenCalledWith(
        MCP_URL,
        "terminal_invalid_refresh_token",
      );
    });

    it("records a diagnostics breadcrumb when an invalid client clears the token", async () => {
      const tokenData = createValidTokenData({
        createdAt: new Date(Date.now() - 58 * 60_000).toISOString(),
        expiresAt: new Date(Date.now() + 2 * 60_000).toISOString(),
      });
      const { manager, authDiagnostics } = createTokenManager({
        authService: createMockAuthService({
          refreshAccessToken: mock(() =>
            Promise.reject(
              new TokenRefreshError(
                400,
                JSON.stringify({
                  error: "invalid_client",
                  error_description: "OAuth client not found",
                }),
              ),
            ),
          ),
        }),
        authStorage: createMockAuthStorage({
          loadTokens: mock(() => Promise.resolve(tokenData)),
          loadClient: mock(() => Promise.resolve(defaultClientRegistration)),
        }),
      });

      await manager.getToken();

      expect(authDiagnostics.recordClear).toHaveBeenCalledWith(
        MCP_URL,
        "terminal_invalid_client",
      );
    });

    it("clears client registration when proactive refresh reports invalid client", async () => {
      const tokenData = createValidTokenData({
        createdAt: new Date(Date.now() - 58 * 60_000).toISOString(),
        expiresAt: new Date(Date.now() + 2 * 60_000).toISOString(),
      });
      const { manager, authStorage } = createTokenManager({
        authService: createMockAuthService({
          refreshAccessToken: mock(() =>
            Promise.reject(
              new TokenRefreshError(
                400,
                JSON.stringify({
                  error: "invalid_client",
                  error_description: "OAuth client not found",
                }),
              ),
            ),
          ),
        }),
        authStorage: createMockAuthStorage({
          loadTokens: mock(() => Promise.resolve(tokenData)),
          loadClient: mock(() => Promise.resolve(defaultClientRegistration)),
        }),
      });

      const result = await manager.getToken();

      expect(result).toBeUndefined();
      expect(authStorage.clearActiveTokensIfUnchanged).toHaveBeenCalledWith(
        MCP_URL,
        tokenData,
      );
      expect(authStorage.clearActiveClient).toHaveBeenCalledWith(MCP_URL);
      // Automatic cleanup must never use the clear-everything variants, which
      // would wipe credentials in the inactive storage backend.
      expect(authStorage.clearTokensIfUnchanged).not.toHaveBeenCalled();
      expect(authStorage.clearTokens).not.toHaveBeenCalled();
      expect(authStorage.clearClient).not.toHaveBeenCalled();
      expect(authStorage.clearAuthSession).not.toHaveBeenCalled();
    });

    it("returns current token when proactive endpoint discovery times out", async () => {
      const tokenData = createValidTokenData({
        createdAt: new Date(Date.now() - 58 * 60_000).toISOString(),
        expiresAt: new Date(Date.now() + 2 * 60_000).toISOString(),
      });
      const authService = createMockAuthService({
        discoverEndpoints: mock(() => Promise.reject(new FetchTimeoutError(1))),
      });
      const { manager, authStorage } = createTokenManager({
        authService,
        authStorage: createMockAuthStorage({
          loadTokens: mock(() => Promise.resolve(tokenData)),
          loadClient: mock(() => Promise.resolve(defaultClientRegistration)),
        }),
      });

      const result = await manager.getToken();

      expect(result).toBe(tokenData.accessToken);
      expect(authService.discoverEndpoints).toHaveBeenCalledWith(MCP_URL);
      expect(authStorage.clearActiveTokensIfUnchanged).not.toHaveBeenCalled();
    });

    it("returns undefined when expired token refresh fails", async () => {
      const tokenData = createValidTokenData({
        createdAt: new Date(Date.now() - 7200_000).toISOString(),
        expiresAt: new Date(Date.now() - 60_000).toISOString(),
      });
      const { manager, authStorage } = createTokenManager({
        authService: createMockAuthService({
          refreshAccessToken: mock(() =>
            Promise.reject(new Error("refresh failed")),
          ),
        }),
        authStorage: createMockAuthStorage({
          loadTokens: mock(() => Promise.resolve(tokenData)),
          loadClient: mock(() => Promise.resolve(defaultClientRegistration)),
        }),
      });

      const result = await manager.getToken();
      expect(result).toBeUndefined();
      expect(authStorage.clearActiveTokensIfUnchanged).toHaveBeenCalledWith(
        MCP_URL,
        tokenData,
      );
    });

    it("clears expired tokens when forced refresh times out", async () => {
      const tokenData = createValidTokenData({
        createdAt: new Date(Date.now() - 7200_000).toISOString(),
        expiresAt: new Date(Date.now() - 60_000).toISOString(),
      });
      const { manager, authStorage } = createTokenManager({
        authService: createMockAuthService({
          refreshAccessToken: mock(() =>
            Promise.reject(new FetchTimeoutError(1)),
          ),
        }),
        authStorage: createMockAuthStorage({
          loadTokens: mock(() => Promise.resolve(tokenData)),
          loadClient: mock(() => Promise.resolve(defaultClientRegistration)),
        }),
      });

      const result = await manager.forceRefresh();

      expect(result).toBeUndefined();
      expect(authStorage.clearActiveTokensIfUnchanged).toHaveBeenCalledWith(
        MCP_URL,
        tokenData,
      );
    });

    it("coalesces concurrent refresh requests", async () => {
      const tokenData = createValidTokenData({
        createdAt: new Date(Date.now() - 7200_000).toISOString(),
        expiresAt: new Date(Date.now() - 60_000).toISOString(),
      });
      const refreshMock = mock(() => Promise.resolve(defaultTokenResponse));
      const { manager } = createTokenManager({
        authService: createMockAuthService({
          refreshAccessToken: refreshMock,
        }),
        authStorage: createMockAuthStorage({
          loadTokens: mock(() => Promise.resolve(tokenData)),
          loadClient: mock(() => Promise.resolve(defaultClientRegistration)),
        }),
      });

      // Fire two getToken calls concurrently
      const [result1, result2] = await Promise.all([
        manager.getToken(),
        manager.getToken(),
      ]);

      expect(result1).toBe(defaultTokenResponse.accessToken);
      expect(result2).toBe(defaultTokenResponse.accessToken);
      // Should have only called refresh once despite two concurrent requests
      expect(refreshMock).toHaveBeenCalledTimes(1);
    });

    it("returns undefined when client registration is missing", async () => {
      const tokenData = createValidTokenData({
        createdAt: new Date(Date.now() - 7200_000).toISOString(),
        expiresAt: new Date(Date.now() - 60_000).toISOString(),
      });
      const { manager } = createTokenManager({
        authStorage: createMockAuthStorage({
          loadTokens: mock(() => Promise.resolve(tokenData)),
          // loadClient returns null by default
        }),
      });

      const result = await manager.getToken();
      expect(result).toBeUndefined();
    });
  });

  describe("forceRefresh", () => {
    it("refreshes even when token is not expired", async () => {
      const tokenData = createValidTokenData({
        createdAt: new Date(Date.now() - 60_000).toISOString(),
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      });
      const { manager, authService } = createTokenManager({
        authService: createMockAuthService(),
        authStorage: createMockAuthStorage({
          loadTokens: mock(() => Promise.resolve(tokenData)),
          loadClient: mock(() => Promise.resolve(defaultClientRegistration)),
        }),
      });

      // First call to populate cache
      await manager.getToken();

      const result = await manager.forceRefresh();
      expect(result).toBe(defaultTokenResponse.accessToken);
      expect(authService.refreshAccessToken).toHaveBeenCalledTimes(1);
    });

    it("returns undefined when refresh fails with valid token", async () => {
      const tokenData = createValidTokenData({
        createdAt: new Date(Date.now() - 60_000).toISOString(),
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      });
      const { manager, authStorage } = createTokenManager({
        authService: createMockAuthService({
          refreshAccessToken: mock(() =>
            Promise.reject(new Error("refresh failed")),
          ),
        }),
        authStorage: createMockAuthStorage({
          loadTokens: mock(() => Promise.resolve(tokenData)),
          loadClient: mock(() => Promise.resolve(defaultClientRegistration)),
        }),
      });

      // Populate cache
      await manager.getToken();

      const result = await manager.forceRefresh();
      expect(result).toBeUndefined();
      // Should NOT clear tokens since the token is still valid (not expired)
      expect(authStorage.clearActiveTokensIfUnchanged).not.toHaveBeenCalled();
    });

    it("clears tokens when refresh fails with expired token", async () => {
      const tokenData = createValidTokenData({
        createdAt: new Date(Date.now() - 7200_000).toISOString(),
        expiresAt: new Date(Date.now() - 60_000).toISOString(),
      });
      const { manager, authStorage } = createTokenManager({
        authService: createMockAuthService({
          refreshAccessToken: mock(() =>
            Promise.reject(new Error("refresh failed")),
          ),
        }),
        authStorage: createMockAuthStorage({
          loadTokens: mock(() => Promise.resolve(tokenData)),
          loadClient: mock(() => Promise.resolve(defaultClientRegistration)),
        }),
      });

      // getToken will attempt refresh since token is expired
      await manager.getToken();

      // forceRefresh should also clear since token is expired
      const result = await manager.forceRefresh();
      expect(result).toBeUndefined();
      expect(authStorage.clearActiveTokensIfUnchanged).toHaveBeenCalledWith(
        MCP_URL,
        tokenData,
      );
    });

    it("forceRefresh falls back to fresh external tokens when refreshing them fails", async () => {
      const staleToken = createValidTokenData({
        accessToken: "stale-access-token",
        refreshToken: "stale-refresh-token",
        createdAt: new Date(Date.now() - 7200_000).toISOString(),
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      });
      const freshToken = createValidTokenData({
        accessToken: "fresh-access-token",
        refreshToken: "fresh-refresh-token",
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      });
      const loadTokens = mock<() => Promise<TokenData | null>>(() =>
        Promise.resolve(staleToken),
      );
      const authStorage = createMockAuthStorage({
        loadTokens,
        loadClient: mock(() => Promise.resolve(defaultClientRegistration)),
      });
      const manager = new TokenManager({
        authService: createMockAuthService({
          refreshAccessToken: mock(() => Promise.reject(new Error("stale"))),
        }),
        authStorage,
        mcpUrl: MCP_URL,
      });

      expect(await manager.getToken()).toBe("stale-access-token");
      loadTokens.mockImplementation(() => Promise.resolve(freshToken));

      const result = await manager.forceRefresh();

      expect(result).toBe("fresh-access-token");
      expect(authStorage.clearActiveTokensIfUnchanged).not.toHaveBeenCalled();
    });

    it("uses externally refreshed tokens on later getToken calls", async () => {
      const staleToken = createValidTokenData({
        accessToken: "stale-access-token",
        refreshToken: "stale-refresh-token",
        createdAt: new Date(Date.now() - 7200_000).toISOString(),
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      });
      const freshToken = createValidTokenData({
        accessToken: "fresh-access-token",
        refreshToken: "fresh-refresh-token",
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      });
      const loadTokens = mock<() => Promise<TokenData | null>>(() =>
        Promise.resolve(staleToken),
      );
      const refreshAccessToken = mock(() => Promise.reject(new Error("stale")));
      const authStorage = createMockAuthStorage({
        loadTokens,
        loadClient: mock(() => Promise.resolve(defaultClientRegistration)),
      });
      const manager = new TokenManager({
        authService: createMockAuthService({ refreshAccessToken }),
        authStorage,
        mcpUrl: MCP_URL,
      });

      expect(await manager.getToken()).toBe("stale-access-token");
      expect(refreshAccessToken).toHaveBeenCalledTimes(1);
      loadTokens.mockImplementation(() => Promise.resolve(freshToken));
      const recovered = await manager.forceRefresh();
      expect(refreshAccessToken).toHaveBeenCalledTimes(1);
      const next = await manager.getToken();

      expect(recovered).toBe("fresh-access-token");
      expect(next).toBe("fresh-access-token");
      expect(refreshAccessToken).toHaveBeenCalledTimes(1);
    });

    it("refreshes externally updated tokens that are already expired", async () => {
      const cachedToken = createValidTokenData({
        accessToken: "cached-access-token",
        refreshToken: "cached-refresh-token",
        createdAt: new Date(Date.now() - 60_000).toISOString(),
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      });
      const expiredExternalToken = createValidTokenData({
        accessToken: "expired-external-access-token",
        refreshToken: "expired-external-refresh-token",
        createdAt: new Date(Date.now() - 7200_000).toISOString(),
        expiresAt: new Date(Date.now() - 60_000).toISOString(),
      });
      const loadTokens = mock<() => Promise<TokenData | null>>(() =>
        Promise.resolve(cachedToken),
      );
      const refreshAccessToken = mock(() =>
        Promise.resolve({
          accessToken: "refreshed-external-access-token",
          refreshToken: "refreshed-external-refresh-token",
          expiresIn: 3600,
        }),
      );
      const authStorage = createMockAuthStorage({
        loadTokens,
        loadClient: mock(() => Promise.resolve(defaultClientRegistration)),
      });
      const manager = new TokenManager({
        authService: createMockAuthService({ refreshAccessToken }),
        authStorage,
        mcpUrl: MCP_URL,
      });

      expect(await manager.getToken()).toBe("cached-access-token");
      loadTokens.mockImplementation(() =>
        Promise.resolve(expiredExternalToken),
      );

      const result = await manager.forceRefresh();

      expect(result).toBe("refreshed-external-access-token");
      expect(refreshAccessToken).toHaveBeenCalledWith(
        expect.objectContaining({
          refreshToken: "expired-external-refresh-token",
        }),
      );
    });

    it("reuses an in-flight endpoint soft refresh for concurrent forceRefresh calls", async () => {
      let storedToken = createValidTokenData({
        accessToken: "stored-access-token",
        refreshToken: "stored-refresh-token",
        createdAt: new Date(Date.now() - 58 * 60_000).toISOString(),
        expiresAt: new Date(Date.now() + 2 * 60_000).toISOString(),
      });
      let resolveSoftRefresh!: (value: typeof defaultTokenResponse) => void;
      const softRefresh = new Promise<typeof defaultTokenResponse>(
        (resolve) => {
          resolveSoftRefresh = resolve;
        },
      );
      let resolveRefreshStarted!: () => void;
      const refreshStarted = new Promise<void>((resolve) => {
        resolveRefreshStarted = resolve;
      });
      let refreshCall = 0;
      const refreshAccessToken = mock(() => {
        refreshCall++;
        resolveRefreshStarted();
        return refreshCall === 1
          ? softRefresh
          : Promise.resolve({
              accessToken: "force-access-token",
              refreshToken: "force-refresh-token",
              expiresIn: 3600,
            });
      });
      const authStorage = createMockAuthStorage({
        loadTokens: mock(() => Promise.resolve(storedToken)),
        loadClient: mock(() => Promise.resolve(defaultClientRegistration)),
        saveTokensIfUnchanged: mock((_baseUrl, _expected, data) => {
          storedToken = data;
          return Promise.resolve(true);
        }),
      });
      const manager = new TokenManager({
        authService: createMockAuthService({ refreshAccessToken }),
        authStorage,
        mcpUrl: MCP_URL,
      });

      const softResult = manager.getToken();
      await refreshStarted;
      expect(refreshAccessToken).toHaveBeenCalledTimes(1);
      const forceResult1 = manager.forceRefresh();
      const forceResult2 = manager.forceRefresh();
      const getTokenDuringForce = manager.getToken();

      resolveSoftRefresh({
        accessToken: "soft-access-token",
        refreshToken: "soft-refresh-token",
        expiresIn: 3600,
      });

      expect(await softResult).toBe("soft-access-token");
      await expect(
        Promise.all([forceResult1, forceResult2, getTokenDuringForce]),
      ).resolves.toEqual([
        "soft-access-token",
        "soft-access-token",
        "soft-access-token",
      ]);
      expect(refreshAccessToken).toHaveBeenCalledTimes(1);
    });

    it("forceRefresh performs an endpoint refresh after an in-flight soft refresh reuses external storage", async () => {
      const cachedToken = createValidTokenData({
        accessToken: "cached-access-token",
        refreshToken: "cached-refresh-token",
        createdAt: new Date(Date.now() - 60_000).toISOString(),
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      });
      const externalToken = createValidTokenData({
        accessToken: "external-access-token",
        refreshToken: "external-refresh-token",
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      });
      let resolveExternalLoad!: (value: TokenData) => void;
      const externalLoad = new Promise<TokenData>((resolve) => {
        resolveExternalLoad = resolve;
      });
      let loadCall = 0;
      const loadTokens = mock(() => {
        loadCall++;
        if (loadCall === 1) return Promise.resolve(cachedToken);
        if (loadCall === 2) return externalLoad;
        return Promise.resolve(externalToken);
      });
      const refreshAccessToken = mock(() =>
        Promise.resolve({
          accessToken: "force-access-token",
          refreshToken: "force-refresh-token",
          expiresIn: 3600,
        }),
      );
      const authStorage = createMockAuthStorage({
        loadTokens,
        loadClient: mock(() => Promise.resolve(defaultClientRegistration)),
      });
      const manager = new TokenManager({
        authService: createMockAuthService({ refreshAccessToken }),
        authStorage,
        mcpUrl: MCP_URL,
      });

      expect(await manager.getToken()).toBe("cached-access-token");
      cachedToken.createdAt = new Date(Date.now() - 58 * 60_000).toISOString();
      cachedToken.expiresAt = new Date(Date.now() + 2 * 60_000).toISOString();

      const softResult = manager.getToken();
      const forceResult = manager.forceRefresh();
      resolveExternalLoad(externalToken);

      expect(await softResult).toBe("external-access-token");
      expect(await forceResult).toBe("force-access-token");
      expect(refreshAccessToken).toHaveBeenCalledTimes(1);
      expect(refreshAccessToken).toHaveBeenCalledWith(
        expect.objectContaining({ refreshToken: "external-refresh-token" }),
      );
    });

    it("getToken joins an in-flight forceRefresh even when the cached token looks fresh", async () => {
      const tokenData = createValidTokenData({
        accessToken: "cached-access-token",
        refreshToken: "cached-refresh-token",
        createdAt: new Date(Date.now() - 60_000).toISOString(),
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      });
      let resolveRefresh!: (value: typeof defaultTokenResponse) => void;
      const refreshResponse = new Promise<typeof defaultTokenResponse>(
        (resolve) => {
          resolveRefresh = resolve;
        },
      );
      let resolveRefreshStarted!: () => void;
      const refreshStarted = new Promise<void>((resolve) => {
        resolveRefreshStarted = resolve;
      });
      const refreshAccessToken = mock(() => {
        resolveRefreshStarted();
        return refreshResponse;
      });
      const authStorage = createMockAuthStorage({
        loadTokens: mock(() => Promise.resolve(tokenData)),
        loadClient: mock(() => Promise.resolve(defaultClientRegistration)),
      });
      const manager = new TokenManager({
        authService: createMockAuthService({ refreshAccessToken }),
        authStorage,
        mcpUrl: MCP_URL,
      });

      expect(await manager.getToken()).toBe("cached-access-token");
      const forceResult = manager.forceRefresh();
      await refreshStarted;
      const getTokenDuringForce = manager.getToken();

      resolveRefresh({
        accessToken: "force-access-token",
        refreshToken: "force-refresh-token",
        expiresIn: 3600,
      });

      expect(await forceResult).toBe("force-access-token");
      expect(await getTokenDuringForce).toBe("force-access-token");
      expect(refreshAccessToken).toHaveBeenCalledTimes(1);
    });

    it("getToken joins forceRefresh that starts during its initial storage load", async () => {
      const tokenData = createValidTokenData({
        accessToken: "initial-access-token",
        refreshToken: "initial-refresh-token",
        createdAt: new Date(Date.now() - 60_000).toISOString(),
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      });
      let resolveInitialLoad!: (value: TokenData) => void;
      const initialLoad = new Promise<TokenData>((resolve) => {
        resolveInitialLoad = resolve;
      });
      let loadCall = 0;
      const loadTokens = mock(() => {
        loadCall++;
        return loadCall === 1 ? initialLoad : Promise.resolve(tokenData);
      });
      let resolveRefresh!: (value: typeof defaultTokenResponse) => void;
      const refreshResponse = new Promise<typeof defaultTokenResponse>(
        (resolve) => {
          resolveRefresh = resolve;
        },
      );
      let resolveRefreshStarted!: () => void;
      const refreshStarted = new Promise<void>((resolve) => {
        resolveRefreshStarted = resolve;
      });
      const refreshAccessToken = mock(() => {
        resolveRefreshStarted();
        return refreshResponse;
      });
      const authStorage = createMockAuthStorage({
        loadTokens,
        loadClient: mock(() => Promise.resolve(defaultClientRegistration)),
      });
      const manager = new TokenManager({
        authService: createMockAuthService({ refreshAccessToken }),
        authStorage,
        mcpUrl: MCP_URL,
      });

      const getTokenResult = manager.getToken();
      const forceResult = manager.forceRefresh();
      await refreshStarted;

      resolveInitialLoad(tokenData);
      resolveRefresh({
        accessToken: "force-access-token",
        refreshToken: "force-refresh-token",
        expiresIn: 3600,
      });

      await expect(Promise.all([getTokenResult, forceResult])).resolves.toEqual(
        ["force-access-token", "force-access-token"],
      );
      expect(refreshAccessToken).toHaveBeenCalledTimes(1);
    });

    it("getToken joins a failing in-flight forceRefresh instead of returning cached tokens", async () => {
      const tokenData = createValidTokenData({
        accessToken: "cached-access-token",
        refreshToken: "cached-refresh-token",
        createdAt: new Date(Date.now() - 60_000).toISOString(),
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      });
      let rejectRefresh!: (error: Error) => void;
      const refreshResponse = new Promise<never>((_resolve, reject) => {
        rejectRefresh = reject;
      });
      let resolveRefreshStarted!: () => void;
      const refreshStarted = new Promise<void>((resolve) => {
        resolveRefreshStarted = resolve;
      });
      const refreshAccessToken = mock(() => {
        resolveRefreshStarted();
        return refreshResponse;
      });
      const authStorage = createMockAuthStorage({
        loadTokens: mock(() => Promise.resolve(tokenData)),
        loadClient: mock(() => Promise.resolve(defaultClientRegistration)),
      });
      const manager = new TokenManager({
        authService: createMockAuthService({ refreshAccessToken }),
        authStorage,
        mcpUrl: MCP_URL,
      });

      expect(await manager.getToken()).toBe("cached-access-token");
      const forceResult = manager.forceRefresh();
      await refreshStarted;
      const getTokenDuringForce = manager.getToken();

      rejectRefresh(new Error("refresh failed"));

      await expect(forceResult).resolves.toBeUndefined();
      await expect(getTokenDuringForce).resolves.toBeUndefined();
      expect(refreshAccessToken).toHaveBeenCalledTimes(1);
    });

    it("recovers externally updated tokens that preserve the same refresh token", async () => {
      const staleToken = createValidTokenData({
        accessToken: "stale-access-token",
        refreshToken: "same-refresh-token",
        createdAt: new Date(Date.now() - 7200_000).toISOString(),
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      });
      const freshToken = createValidTokenData({
        accessToken: "fresh-access-token",
        refreshToken: "same-refresh-token",
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      });
      const loadTokens = mock<() => Promise<TokenData | null>>(() =>
        Promise.resolve(staleToken),
      );
      const authStorage = createMockAuthStorage({
        loadTokens,
        loadClient: mock(() => Promise.resolve(defaultClientRegistration)),
      });
      const manager = new TokenManager({
        authService: createMockAuthService({
          refreshAccessToken: mock(() => Promise.reject(new Error("stale"))),
        }),
        authStorage,
        mcpUrl: MCP_URL,
      });

      expect(await manager.getToken()).toBe("stale-access-token");
      loadTokens.mockImplementation(() => Promise.resolve(freshToken));

      const result = await manager.forceRefresh();

      expect(result).toBe("fresh-access-token");
      expect(authStorage.clearActiveTokensIfUnchanged).not.toHaveBeenCalled();
    });

    it("does not clear fresh tokens written after the first failed-refresh reload", async () => {
      const staleToken = createValidTokenData({
        accessToken: "stale-access-token",
        refreshToken: "stale-refresh-token",
        createdAt: new Date(Date.now() - 7200_000).toISOString(),
        expiresAt: new Date(Date.now() - 60_000).toISOString(),
      });
      const freshToken = createValidTokenData({
        accessToken: "fresh-access-token",
        refreshToken: "fresh-refresh-token",
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      });
      const loadTokens = mock<() => Promise<TokenData | null>>(() =>
        Promise.resolve(staleToken),
      );
      const authStorage = createMockAuthStorage({
        loadTokens,
        loadClient: mock(() => Promise.resolve(defaultClientRegistration)),
      });
      const manager = new TokenManager({
        authService: createMockAuthService({
          refreshAccessToken: mock(() => Promise.reject(new Error("stale"))),
        }),
        authStorage,
        mcpUrl: MCP_URL,
      });

      loadTokens
        .mockImplementationOnce(() => Promise.resolve(staleToken))
        .mockImplementationOnce(() => Promise.resolve(staleToken))
        .mockImplementationOnce(() => Promise.resolve(freshToken));

      const result = await manager.getToken();

      expect(result).toBe("fresh-access-token");
      expect(authStorage.clearActiveTokensIfUnchanged).not.toHaveBeenCalled();
    });

    it("does not overwrite fresh tokens written during refresh", async () => {
      const staleToken = createValidTokenData({
        accessToken: "stale-access-token",
        refreshToken: "stale-refresh-token",
        createdAt: new Date(Date.now() - 7200_000).toISOString(),
        expiresAt: new Date(Date.now() - 60_000).toISOString(),
      });
      const freshToken = createValidTokenData({
        accessToken: "fresh-access-token",
        refreshToken: "fresh-refresh-token",
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      });
      const loadTokens = mock(() => Promise.resolve(staleToken));
      const authStorage = createMockAuthStorage({
        loadTokens,
        saveTokensIfUnchanged: mock(() => Promise.resolve(false)),
        loadClient: mock(() => Promise.resolve(defaultClientRegistration)),
      });
      const manager = new TokenManager({
        authService: createMockAuthService({
          refreshAccessToken: mock(() =>
            Promise.resolve({
              accessToken: "refresh-access-token",
              expiresIn: 3600,
            }),
          ),
        }),
        authStorage,
        mcpUrl: MCP_URL,
      });

      loadTokens
        .mockImplementationOnce(() => Promise.resolve(staleToken))
        .mockImplementationOnce(() => Promise.resolve(staleToken))
        .mockImplementationOnce(() => Promise.resolve(freshToken));

      const result = await manager.getToken();

      expect(result).toBe("fresh-access-token");
      expect(authStorage.saveTokensIfUnchanged).toHaveBeenCalledTimes(1);
      expect(authStorage.saveTokens).not.toHaveBeenCalled();
    });

    it("persists a rotated refresh token when same-lineage storage changes during refresh", async () => {
      const staleToken = createValidTokenData({
        accessToken: "stale-access-token",
        refreshToken: "stale-refresh-token",
        createdAt: new Date(Date.now() - 7200_000).toISOString(),
        expiresAt: new Date(Date.now() - 60_000).toISOString(),
      });
      const freshToken = createValidTokenData({
        accessToken: "fresh-access-token",
        refreshToken: "stale-refresh-token",
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      });
      const loadTokens = mock(() => Promise.resolve(staleToken));
      const saveTokensIfUnchanged = mock(() => Promise.resolve(false));
      const authStorage = createMockAuthStorage({
        loadTokens,
        saveTokensIfUnchanged,
        loadClient: mock(() => Promise.resolve(defaultClientRegistration)),
      });
      const manager = new TokenManager({
        authService: createMockAuthService({
          refreshAccessToken: mock(() =>
            Promise.resolve({
              accessToken: "rotated-access-token",
              refreshToken: "rotated-refresh-token",
              expiresIn: 3600,
            }),
          ),
        }),
        authStorage,
        mcpUrl: MCP_URL,
      });

      loadTokens
        .mockImplementationOnce(() => Promise.resolve(staleToken))
        .mockImplementationOnce(() => Promise.resolve(staleToken))
        .mockImplementationOnce(() => Promise.resolve(freshToken));
      saveTokensIfUnchanged
        .mockImplementationOnce(() => Promise.resolve(false))
        .mockImplementationOnce(() => Promise.resolve(true));

      const result = await manager.getToken();

      expect(result).toBe("rotated-access-token");
      expect(saveTokensIfUnchanged).toHaveBeenCalledTimes(2);
      expect(saveTokensIfUnchanged).toHaveBeenNthCalledWith(
        2,
        MCP_URL,
        freshToken,
        expect.objectContaining({
          accessToken: "rotated-access-token",
          refreshToken: "rotated-refresh-token",
        }),
      );
      expect(authStorage.saveTokens).not.toHaveBeenCalled();
    });

    it("keeps external tokens from a different refresh lineage", async () => {
      const staleToken = createValidTokenData({
        accessToken: "stale-access-token",
        refreshToken: "stale-refresh-token",
        createdAt: new Date(Date.now() - 7200_000).toISOString(),
        expiresAt: new Date(Date.now() - 60_000).toISOString(),
      });
      const freshToken = createValidTokenData({
        accessToken: "fresh-access-token",
        refreshToken: "fresh-refresh-token",
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      });
      const loadTokens = mock(() => Promise.resolve(staleToken));
      const saveTokensIfUnchanged = mock(() => Promise.resolve(false));
      const authStorage = createMockAuthStorage({
        loadTokens,
        saveTokensIfUnchanged,
        loadClient: mock(() => Promise.resolve(defaultClientRegistration)),
      });
      const manager = new TokenManager({
        authService: createMockAuthService({
          refreshAccessToken: mock(() =>
            Promise.resolve({
              accessToken: "rotated-access-token",
              refreshToken: "rotated-refresh-token",
              expiresIn: 3600,
            }),
          ),
        }),
        authStorage,
        mcpUrl: MCP_URL,
      });

      loadTokens
        .mockImplementationOnce(() => Promise.resolve(staleToken))
        .mockImplementationOnce(() => Promise.resolve(staleToken))
        .mockImplementationOnce(() => Promise.resolve(freshToken));

      const result = await manager.getToken();

      expect(result).toBe("fresh-access-token");
      expect(saveTokensIfUnchanged).toHaveBeenCalledTimes(1);
      expect(authStorage.saveTokens).not.toHaveBeenCalled();
    });

    it("does not rewrite tokens deleted during refresh", async () => {
      const staleToken = createValidTokenData({
        accessToken: "stale-access-token",
        refreshToken: "stale-refresh-token",
        createdAt: new Date(Date.now() - 7200_000).toISOString(),
        expiresAt: new Date(Date.now() - 60_000).toISOString(),
      });
      const loadTokens = mock<() => Promise<TokenData | null>>(() =>
        Promise.resolve(staleToken),
      );
      const authStorage = createMockAuthStorage({
        loadTokens,
        saveTokensIfUnchanged: mock(() => Promise.resolve(false)),
        loadClient: mock(() => Promise.resolve(defaultClientRegistration)),
      });
      const manager = new TokenManager({
        authService: createMockAuthService({
          refreshAccessToken: mock(() =>
            Promise.resolve({
              accessToken: "refresh-access-token",
              expiresIn: 3600,
            }),
          ),
        }),
        authStorage,
        mcpUrl: MCP_URL,
      });

      loadTokens
        .mockImplementationOnce(() => Promise.resolve(staleToken))
        .mockImplementationOnce(() => Promise.resolve(staleToken))
        .mockImplementationOnce(() => Promise.resolve(null));

      const result = await manager.getToken();

      expect(result).toBeUndefined();
      expect(authStorage.saveTokensIfUnchanged).toHaveBeenCalledTimes(1);
      expect(authStorage.saveTokens).not.toHaveBeenCalled();
    });

    it("resets createdAt on refresh so a fresh token is not immediately refreshed again", async () => {
      const tokenData = createValidTokenData({
        createdAt: new Date(Date.now() - 58 * 60_000).toISOString(),
        expiresAt: new Date(Date.now() + 2 * 60_000).toISOString(),
      });
      const refreshMock = mock(() => Promise.resolve(defaultTokenResponse));
      const authStorage = createMockAuthStorage({
        loadTokens: mock(() => Promise.resolve(tokenData)),
        loadClient: mock(() => Promise.resolve(defaultClientRegistration)),
      });
      const manager = new TokenManager({
        authService: createMockAuthService({
          refreshAccessToken: refreshMock,
        }),
        authStorage,
        mcpUrl: MCP_URL,
      });

      const refreshed = await manager.getToken();
      const second = await manager.getToken();

      expect(refreshed).toBe(defaultTokenResponse.accessToken);
      expect(second).toBe(defaultTokenResponse.accessToken);
      expect(refreshMock).toHaveBeenCalledTimes(1);
      expect(authStorage.saveTokensIfUnchanged).toHaveBeenCalledTimes(1);
    });
  });
});
