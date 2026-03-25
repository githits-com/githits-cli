import { describe, expect, it, mock } from "bun:test";
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
    expect(authStorage.saveTokens).toHaveBeenCalledTimes(1);
    expect(authService.discoverEndpoints).toHaveBeenCalledWith(MCP_URL);
    expect(authService.refreshAccessToken).toHaveBeenCalledTimes(1);
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
    expect(authStorage.clearTokens).toHaveBeenCalledWith(MCP_URL);
  });
});

describe("TokenManager", () => {
  const MCP_URL = "https://mcp.githits.com";

  function createTokenManager(
    overrides: {
      authService?: ReturnType<typeof createMockAuthService>;
      authStorage?: ReturnType<typeof createMockAuthStorage>;
    } = {},
  ) {
    const authService = overrides.authService ?? createMockAuthService();
    const authStorage = overrides.authStorage ?? createMockAuthStorage();
    const manager = new TokenManager({
      authService,
      authStorage,
      mcpUrl: MCP_URL,
    });
    return { manager, authService, authStorage };
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
      expect(authStorage.saveTokens).toHaveBeenCalledTimes(1);
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
      expect(authStorage.clearTokens).toHaveBeenCalledWith(MCP_URL);
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
      expect(authStorage.clearTokens).not.toHaveBeenCalled();
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
      expect(authStorage.clearTokens).toHaveBeenCalledWith(MCP_URL);
    });
  });
});
