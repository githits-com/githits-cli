import { describe, expect, it, mock, spyOn } from "bun:test";
import {
  createMockAuthService,
  createMockAuthStorage,
  createMockBrowserService,
  createValidTokenData,
} from "../services/test-helpers.js";
import { loginAction, loginFlow } from "./login.js";

describe("loginAction", () => {
  const mcpUrl = "https://mcp.githits.com";

  it("completes full OAuth flow successfully", async () => {
    const consoleSpy = spyOn(console, "log").mockImplementation(() => {});
    const authService = createMockAuthService();
    const authStorage = createMockAuthStorage();
    const browserService = createMockBrowserService();

    await loginAction(
      { port: 8080 },
      { authService, authStorage, browserService, mcpUrl },
    );

    expect(authService.discoverEndpoints).toHaveBeenCalledWith(mcpUrl);
    expect(authService.generatePkceParams).toHaveBeenCalled();
    expect(authService.startCallbackServer).toHaveBeenCalledWith(
      8080,
      "test-state",
    );
    expect(browserService.open).toHaveBeenCalled();
    expect(authService.exchangeCodeForTokens).toHaveBeenCalled();
    expect(authStorage.saveAuthSession).toHaveBeenCalledWith(
      expect.stringContaining("__githits_storage_probe__"),
      expect.any(Object),
      expect.any(Object),
    );

    consoleSpy.mockRestore();
  });

  it("skips login when already authenticated", async () => {
    const consoleSpy = spyOn(console, "log").mockImplementation(() => {});
    const authStorage = createMockAuthStorage({
      loadTokens: mock(() =>
        Promise.resolve(
          createValidTokenData({
            expiresAt: new Date(Date.now() + 3600_000).toISOString(),
          }),
        ),
      ),
    });

    await loginAction(
      {},
      {
        authService: createMockAuthService(),
        authStorage,
        browserService: createMockBrowserService(),
        mcpUrl,
      },
    );

    expect(authStorage.saveAuthSession).not.toHaveBeenCalledWith(
      mcpUrl,
      expect.any(Object),
      expect.any(Object),
    );
    consoleSpy.mockRestore();
  });

  it("forces re-authentication with --force flag", async () => {
    const consoleSpy = spyOn(console, "log").mockImplementation(() => {});
    const authStorage = createMockAuthStorage({
      loadTokens: mock(() =>
        Promise.resolve(
          createValidTokenData({
            expiresAt: new Date(Date.now() + 3600_000).toISOString(),
          }),
        ),
      ),
    });

    await loginAction(
      { force: true, port: 8080 },
      {
        authService: createMockAuthService(),
        authStorage,
        browserService: createMockBrowserService(),
        mcpUrl,
      },
    );

    expect(authStorage.saveAuthSession).toHaveBeenCalledWith(
      mcpUrl,
      expect.any(Object),
      expect.any(Object),
    );
    consoleSpy.mockRestore();
  });

  it("shows URL instead of opening browser with --no-browser", async () => {
    const consoleSpy = spyOn(console, "log").mockImplementation(() => {});
    const browserService = createMockBrowserService();

    await loginAction(
      { browser: false, port: 8080 },
      {
        authService: createMockAuthService(),
        authStorage: createMockAuthStorage(),
        browserService,
        mcpUrl,
      },
    );

    expect(browserService.open).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("reuses existing DCR client registration", async () => {
    const consoleSpy = spyOn(console, "log").mockImplementation(() => {});
    const authStorage = createMockAuthStorage({
      loadClient: mock(() =>
        Promise.resolve({
          clientId: "existing-client",
          clientSecret: "existing-secret",
          redirectUri: "http://127.0.0.1:8080/callback",
          registeredAt: "2025-01-01T00:00:00Z",
        }),
      ),
    });
    const authService = createMockAuthService();

    await loginAction(
      { port: 8080 },
      {
        authService,
        authStorage,
        browserService: createMockBrowserService(),
        mcpUrl,
      },
    );

    expect(authService.registerClient).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("registers new client when none exists", async () => {
    const consoleSpy = spyOn(console, "log").mockImplementation(() => {});
    const authStorage = createMockAuthStorage();
    const authService = createMockAuthService();

    await loginAction(
      { port: 8080 },
      {
        authService,
        authStorage,
        browserService: createMockBrowserService(),
        mcpUrl,
      },
    );

    expect(authService.registerClient).toHaveBeenCalled();
    expect(authStorage.saveAuthSession).toHaveBeenCalledWith(
      mcpUrl,
      expect.any(Object),
      expect.any(Object),
    );
    consoleSpy.mockRestore();
  });

  it("fails before remote registration when storage preflight fails", async () => {
    const consoleSpy = spyOn(console, "log").mockImplementation(() => {});
    const authStorage = createMockAuthStorage({
      saveAuthSession: mock(() => Promise.reject(new Error("keychain locked"))),
    });
    const authService = createMockAuthService();
    const browserService = createMockBrowserService();

    const result = await loginFlow(
      { port: 8080 },
      { authService, authStorage, browserService, mcpUrl },
    );

    expect(result.status).toBe("failed");
    expect(result.message).toContain("Cannot persist OAuth credentials");
    expect(authService.discoverEndpoints).not.toHaveBeenCalled();
    expect(authService.registerClient).not.toHaveBeenCalled();
    expect(browserService.open).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("clears stale client registration when tokens are absent", async () => {
    const consoleSpy = spyOn(console, "log").mockImplementation(() => {});
    const authStorage = createMockAuthStorage();
    const authService = createMockAuthService();

    await loginAction(
      { port: 8080 },
      {
        authService,
        authStorage,
        browserService: createMockBrowserService(),
        mcpUrl,
      },
    );

    expect(authStorage.clearClient).toHaveBeenCalledWith(mcpUrl);
    expect(authService.registerClient).toHaveBeenCalled();
    expect(authStorage.saveAuthSession).toHaveBeenCalledWith(
      mcpUrl,
      expect.any(Object),
      expect.any(Object),
    );
    consoleSpy.mockRestore();
  });

  it("clears client registration on token exchange failure", async () => {
    const consoleSpy = spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });

    const authStorage = createMockAuthStorage();
    const authService = createMockAuthService({
      exchangeCodeForTokens: mock(() => {
        throw new Error("invalid_grant");
      }),
    });

    try {
      await loginAction(
        { port: 8080 },
        {
          authService,
          authStorage,
          browserService: createMockBrowserService(),
          mcpUrl,
        },
      );
    } catch {
      // Expected: process.exit mock throws
    }

    expect(authStorage.clearClient).toHaveBeenCalledWith(mcpUrl);
    expect(exitSpy).toHaveBeenCalledWith(1);

    consoleSpy.mockRestore();
    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("still shows error and exits when clearClient fails during token exchange error", async () => {
    const consoleSpy = spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });

    let mcpClearClientCallCount = 0;
    const authStorage = createMockAuthStorage({
      clearClient: mock((baseUrl: string) => {
        if (baseUrl === mcpUrl) {
          mcpClearClientCallCount++;
        }
        if (baseUrl === mcpUrl && mcpClearClientCallCount > 1) {
          throw new Error("fs error");
        }
        return Promise.resolve();
      }),
    });
    const authService = createMockAuthService({
      exchangeCodeForTokens: mock(() => {
        throw new Error("invalid_grant");
      }),
    });

    try {
      await loginAction(
        { port: 8080 },
        {
          authService,
          authStorage,
          browserService: createMockBrowserService(),
          mcpUrl,
        },
      );
    } catch {
      // Expected: process.exit mock throws
    }

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalled();

    consoleSpy.mockRestore();
    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("does not clear client when tokens are still valid", async () => {
    const consoleSpy = spyOn(console, "log").mockImplementation(() => {});
    const authStorage = createMockAuthStorage({
      loadTokens: mock(() =>
        Promise.resolve(
          createValidTokenData({
            expiresAt: new Date(Date.now() + 3600_000).toISOString(),
          }),
        ),
      ),
    });

    await loginAction(
      {},
      {
        authService: createMockAuthService(),
        authStorage,
        browserService: createMockBrowserService(),
        mcpUrl,
      },
    );

    expect(authStorage.clearClient).not.toHaveBeenCalledWith(mcpUrl);
    expect(authStorage.saveAuthSession).not.toHaveBeenCalledWith(
      mcpUrl,
      expect.any(Object),
      expect.any(Object),
    );
    consoleSpy.mockRestore();
  });

  it("does not clear client when tokens are expired but present", async () => {
    const consoleSpy = spyOn(console, "log").mockImplementation(() => {});
    const authStorage = createMockAuthStorage({
      loadTokens: mock(() =>
        Promise.resolve(
          createValidTokenData({
            expiresAt: new Date(Date.now() - 3600_000).toISOString(),
          }),
        ),
      ),
    });

    await loginAction(
      { port: 8080 },
      {
        authService: createMockAuthService(),
        authStorage,
        browserService: createMockBrowserService(),
        mcpUrl,
      },
    );

    expect(authStorage.clearClient).not.toHaveBeenCalledWith(mcpUrl);
    expect(authStorage.saveAuthSession).toHaveBeenCalledWith(
      mcpUrl,
      expect.any(Object),
      expect.any(Object),
    );
    consoleSpy.mockRestore();
  });

  it("proceeds with login when token is expired", async () => {
    const consoleSpy = spyOn(console, "log").mockImplementation(() => {});
    const authStorage = createMockAuthStorage({
      loadTokens: mock(() =>
        Promise.resolve(
          createValidTokenData({
            expiresAt: new Date(Date.now() - 3600_000).toISOString(),
          }),
        ),
      ),
    });

    await loginAction(
      { port: 8080 },
      {
        authService: createMockAuthService(),
        authStorage,
        browserService: createMockBrowserService(),
        mcpUrl,
      },
    );

    expect(authStorage.saveAuthSession).toHaveBeenCalledWith(
      mcpUrl,
      expect.any(Object),
      expect.any(Object),
    );
    consoleSpy.mockRestore();
  });
});

describe("loginFlow", () => {
  const mcpUrl = "https://mcp.githits.com";

  it("returns success after completing OAuth flow", async () => {
    const consoleSpy = spyOn(console, "log").mockImplementation(() => {});

    const result = await loginFlow(
      { port: 8080 },
      {
        authService: createMockAuthService(),
        authStorage: createMockAuthStorage(),
        browserService: createMockBrowserService(),
        mcpUrl,
      },
    );

    expect(result.status).toBe("success");
    expect(result.message).toContain("Logged in successfully");
    consoleSpy.mockRestore();
  });

  it("returns already_authenticated when valid tokens exist", async () => {
    const consoleSpy = spyOn(console, "log").mockImplementation(() => {});

    const result = await loginFlow(
      {},
      {
        authService: createMockAuthService(),
        authStorage: createMockAuthStorage({
          loadTokens: mock(() =>
            Promise.resolve(
              createValidTokenData({
                expiresAt: new Date(Date.now() + 3600_000).toISOString(),
              }),
            ),
          ),
        }),
        browserService: createMockBrowserService(),
        mcpUrl,
      },
    );

    expect(result.status).toBe("already_authenticated");
    consoleSpy.mockRestore();
  });

  it("returns failed on invalid port", async () => {
    const result = await loginFlow(
      { port: -1 },
      {
        authService: createMockAuthService(),
        authStorage: createMockAuthStorage(),
        browserService: createMockBrowserService(),
        mcpUrl,
      },
    );

    expect(result.status).toBe("failed");
    expect(result.message).toContain("Invalid port");
  });

  it("returns failed when token exchange throws", async () => {
    const consoleSpy = spyOn(console, "log").mockImplementation(() => {});

    const result = await loginFlow(
      { port: 8080 },
      {
        authService: createMockAuthService({
          exchangeCodeForTokens: mock(() =>
            Promise.reject(new Error("Token exchange failed")),
          ),
        }),
        authStorage: createMockAuthStorage(),
        browserService: createMockBrowserService(),
        mcpUrl,
      },
    );

    expect(result.status).toBe("failed");
    expect(result.message).toContain("Token exchange failed");
    consoleSpy.mockRestore();
  });
});
