import { describe, expect, it, mock, spyOn } from "bun:test";
import { FetchTimeoutError } from "@githits/core-internal";
import {
  createMockAuthService,
  createMockAuthStorage,
  createMockBrowserService,
  createValidTokenData,
} from "../services/test-helpers.js";
import { loginAction, loginFlow, silentLoginOutput } from "./login.js";

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
    const output = consoleSpy.mock.calls
      .map((call) => String(call[0]))
      .join("\n");
    expect(output).toContain("Logged in successfully.");
    expect(output).toContain("You're ready to use GitHits.");
    expect(output).not.toContain("Token expires");
    expect(output).not.toContain("Environment:");

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
    const output = consoleSpy.mock.calls
      .map((call) => String(call[0]))
      .join("\n");
    expect(output).toContain("Already logged in.");
    expect(output).toContain("You're ready to use GitHits.");
    expect(output).not.toContain("Environment:");
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
    const output = consoleSpy.mock.calls
      .map((call) => String(call[0]))
      .join("\n");
    expect(output).toContain(
      "The sign-in callback is listening on 127.0.0.1:8080 on this machine.",
    );
    expect(output).toContain("ssh -N -L 8080:127.0.0.1:8080 user@remote-host");
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
    expect(authService.buildAuthUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        redirectUri:
          "http://127.0.0.1:8080/callback?utm_source=githits-cli&utm_medium=cli&utm_campaign=cli-auth",
      }),
    );
    expect(authService.exchangeCodeForTokens).toHaveBeenCalledWith(
      expect.objectContaining({
        redirectUri:
          "http://127.0.0.1:8080/callback?utm_source=githits-cli&utm_medium=cli&utm_campaign=cli-auth",
      }),
    );
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
    expect(authService.registerClient).toHaveBeenCalledWith({
      registrationEndpoint: "https://accounts.githits.com/oauth/register",
      redirectUris: [
        "http://127.0.0.1:8080/callback",
        "http://127.0.0.1:8080/callback?utm_source=githits-cli&utm_medium=cli&utm_campaign=cli-auth",
      ],
    });
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

    expect(authStorage.clearActiveClient).toHaveBeenCalledWith(mcpUrl);
    // Re-registration must not wipe the inactive backend's client.
    expect(authStorage.clearClient).not.toHaveBeenCalled();
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

    expect(authStorage.clearActiveClient).toHaveBeenCalledWith(mcpUrl);
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
      clearActiveClient: mock((baseUrl: string) => {
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

    expect(authStorage.clearActiveClient).not.toHaveBeenCalledWith(mcpUrl);
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

    expect(authStorage.clearActiveClient).not.toHaveBeenCalledWith(mcpUrl);
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
    const close = mock(() => Promise.resolve());
    const authService = createMockAuthService({
      startCallbackServer: mock(() =>
        Promise.resolve({
          result: Promise.resolve({
            type: "success",
            code: "test-code",
            state: "test-state",
          } as const),
          close,
        }),
      ),
    });

    const result = await loginFlow(
      { port: 8080 },
      {
        authService,
        authStorage: createMockAuthStorage(),
        browserService: createMockBrowserService(),
        mcpUrl,
      },
    );

    expect(result.status).toBe("success");
    expect(result.message).toContain("Logged in successfully");
    expect(close).toHaveBeenCalledTimes(1);
    consoleSpy.mockRestore();
  });

  for (const [name, error, expected] of [
    [
      "network failure",
      new TypeError("fetch failed"),
      "Could not reach GitHits to start sign-in",
    ],
    [
      "fetch timeout",
      new FetchTimeoutError(100),
      "GitHits timed out while starting sign-in",
    ],
    [
      "abort",
      new DOMException("aborted", "AbortError"),
      "GitHits timed out while starting sign-in",
    ],
  ] as const) {
    it(`returns a friendly result for discovery ${name}`, async () => {
      const authService = createMockAuthService({
        discoverEndpoints: mock(() => Promise.reject(error)),
      });
      const browserService = createMockBrowserService();

      const result = await loginFlow(
        { port: 8080 },
        {
          authService,
          authStorage: createMockAuthStorage(),
          browserService,
          mcpUrl,
        },
        silentLoginOutput,
      );

      expect(result).toEqual({
        status: "failed",
        message: expect.stringContaining(expected),
      });
      expect(authService.registerClient).not.toHaveBeenCalled();
      expect(browserService.open).not.toHaveBeenCalled();
    });
  }

  it("returns a failed result when new-client registration rejects", async () => {
    const authService = createMockAuthService({
      registerClient: mock(() =>
        Promise.reject(new Error("registration unavailable")),
      ),
    });
    const browserService = createMockBrowserService();

    const result = await loginFlow(
      { port: 8080 },
      {
        authService,
        authStorage: createMockAuthStorage(),
        browserService,
        mcpUrl,
      },
      silentLoginOutput,
    );

    expect(result).toEqual({
      status: "failed",
      message: "Could not start sign-in: registration unavailable",
    });
    expect(browserService.open).not.toHaveBeenCalled();
  });

  it("normalizes and bounds protocol failure messages", async () => {
    const authService = createMockAuthService({
      registerClient: mock(() =>
        Promise.reject(new Error(`first line\nsecond line ${"x".repeat(600)}`)),
      ),
    });

    const result = await loginFlow(
      { port: 8080 },
      {
        authService,
        authStorage: createMockAuthStorage(),
        browserService: createMockBrowserService(),
        mcpUrl,
      },
      silentLoginOutput,
    );

    expect(result.message).not.toContain("\n");
    expect(result.message).toContain("first line second line");
    expect(result.message.length).toBeLessThan(550);
  });

  it("does not serialize non-Error storage failures", async () => {
    const authStorage = createMockAuthStorage({
      saveAuthSession: mock(() => Promise.reject({ secret: "hidden" })),
    });

    const result = await loginFlow(
      { port: 8080 },
      {
        authService: createMockAuthService(),
        authStorage,
        browserService: createMockBrowserService(),
        mcpUrl,
      },
      silentLoginOutput,
    );

    expect(result.message).toBe(
      "Cannot persist OAuth credentials: Unexpected error.",
    );
    expect(result.message).not.toContain("hidden");
  });

  it("returns a failed result when changed-port registration rejects", async () => {
    const authStorage = createMockAuthStorage({
      loadTokens: mock(() =>
        Promise.resolve(
          createValidTokenData({
            expiresAt: new Date(Date.now() + 3600_000).toISOString(),
          }),
        ),
      ),
      loadClient: mock(() =>
        Promise.resolve({
          clientId: "existing-client",
          clientSecret: "existing-secret",
          redirectUri: "http://127.0.0.1:8080/callback",
          registeredAt: "2025-01-01T00:00:00Z",
        }),
      ),
    });
    const authService = createMockAuthService({
      registerClient: mock(() =>
        Promise.reject(new Error("registration unavailable")),
      ),
    });

    const result = await loginFlow(
      { force: true, port: 9090 },
      {
        authService,
        authStorage,
        browserService: createMockBrowserService(),
        mcpUrl,
      },
      silentLoginOutput,
    );

    expect(result.status).toBe("failed");
    expect(result.message).toContain("registration unavailable");
    expect(authStorage.clearActiveClient).not.toHaveBeenCalledWith(mcpUrl);
  });

  it("returns a storage failure when final auth-session persistence fails", async () => {
    const saveAuthSession = mock((baseUrl: string) =>
      baseUrl.includes("__githits_storage_probe__")
        ? Promise.resolve()
        : Promise.reject(new Error("keychain write failed")),
    );
    const authStorage = createMockAuthStorage({ saveAuthSession });

    const result = await loginFlow(
      { port: 8080 },
      {
        authService: createMockAuthService(),
        authStorage,
        browserService: createMockBrowserService(),
        mcpUrl,
      },
      silentLoginOutput,
    );

    expect(result).toEqual({
      status: "failed",
      message: "Cannot persist OAuth credentials: keychain write failed",
    });
    expect(saveAuthSession).toHaveBeenCalledTimes(2);
  });

  it("routes progress through the provided reporter instead of stdout", async () => {
    const consoleSpy = spyOn(console, "log").mockImplementation(() => {});
    const writes: string[] = [];

    const result = await loginFlow(
      { port: 8080 },
      {
        authService: createMockAuthService(),
        authStorage: createMockAuthStorage(),
        browserService: createMockBrowserService(),
        mcpUrl,
      },
      {
        write: (message: string) => {
          writes.push(message);
        },
      },
    );

    expect(result.status).toBe("success");
    expect(writes).toContain("Opening browser for GitHits sign-in...\n");
    expect(writes).toContain("If the browser did not open, open this URL:\n");
    expect(
      writes.some((message) =>
        message.startsWith("  https://accounts.githits.com/oauth/authorize?"),
      ),
    ).toBe(true);
    expect(writes).toContain("Waiting for sign-in to finish...\n");
    expect(consoleSpy).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("prints manual URL when browser opening fails", async () => {
    const writes: string[] = [];
    const browserService = createMockBrowserService({
      open: mock(() => Promise.reject(new Error("no display"))),
    });

    const result = await loginFlow(
      { port: 8080 },
      {
        authService: createMockAuthService(),
        authStorage: createMockAuthStorage(),
        browserService,
        mcpUrl,
      },
      { write: (message: string) => writes.push(message) },
    );

    expect(result.status).toBe("success");
    expect(writes).toContain(
      "Could not open browser automatically: no display\n",
    );
    expect(writes).toContain("If the browser did not open, open this URL:\n");
    expect(
      writes.some((message) =>
        message.startsWith("  https://accounts.githits.com/oauth/authorize?"),
      ),
    ).toBe(true);
  });

  it("closes callback server and clears fresh client when authentication wait fails", async () => {
    const close = mock(() => Promise.resolve());
    const authStorage = createMockAuthStorage();
    const authService = createMockAuthService({
      startCallbackServer: mock(() =>
        Promise.resolve({
          result: Promise.reject(new Error("callback failed")),
          close,
        }),
      ),
    });

    const result = await loginFlow(
      { port: 8080 },
      {
        authService,
        authStorage,
        browserService: createMockBrowserService(),
        mcpUrl,
      },
      silentLoginOutput,
    );

    expect(result.status).toBe("failed");
    expect(result.message).toBe("callback failed.");
    expect(close).toHaveBeenCalledTimes(1);
    expect(authStorage.clearActiveClient).toHaveBeenCalledWith(mcpUrl);
  });

  it("returns actionable timeout message and clears fresh client", async () => {
    const close = mock(() => Promise.resolve());
    const authStorage = createMockAuthStorage();
    const authService = createMockAuthService({
      startCallbackServer: mock(() =>
        Promise.resolve({
          result: new Promise<never>(() => {}),
          close,
        }),
      ),
    });

    const timeout = setTimeout;
    globalThis.setTimeout = ((callback: () => void) => {
      if (typeof callback === "function") callback();
      return 0 as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout;

    try {
      const result = await loginFlow(
        { port: 8080 },
        {
          authService,
          authStorage,
          browserService: createMockBrowserService(),
          mcpUrl,
        },
        silentLoginOutput,
      );

      expect(result.status).toBe("failed");
      expect(result.message).toContain(
        "Authentication timed out after 5 minutes",
      );
      expect(result.message).toContain("Run the same command again");
      expect(close).toHaveBeenCalledTimes(1);
      expect(authStorage.clearActiveClient).toHaveBeenCalledWith(mcpUrl);
    } finally {
      globalThis.setTimeout = timeout;
    }
  });

  it("does not clear reused client when forced login times out", async () => {
    const existingToken = createValidTokenData({
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    });
    const close = mock(() => Promise.resolve());
    const authStorage = createMockAuthStorage({
      loadTokens: mock(() => Promise.resolve(existingToken)),
      loadClient: mock(() =>
        Promise.resolve({
          clientId: "existing-client",
          clientSecret: "existing-secret",
          redirectUri: "http://127.0.0.1:8080/callback",
          registeredAt: "2025-01-01T00:00:00Z",
        }),
      ),
    });
    const authService = createMockAuthService({
      startCallbackServer: mock(() =>
        Promise.resolve({
          result: Promise.reject(new Error("callback failed")),
          close,
        }),
      ),
    });

    const result = await loginFlow(
      { force: true },
      {
        authService,
        authStorage,
        browserService: createMockBrowserService(),
        mcpUrl,
      },
      silentLoginOutput,
    );

    expect(result.status).toBe("failed");
    expect(authStorage.clearActiveClient).not.toHaveBeenCalledWith(mcpUrl);
  });

  it("does not clear stored client when changed-port login fails before saving", async () => {
    const existingToken = createValidTokenData({
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    });
    const close = mock(() => Promise.resolve());
    const authStorage = createMockAuthStorage({
      loadTokens: mock(() => Promise.resolve(existingToken)),
      loadClient: mock(() =>
        Promise.resolve({
          clientId: "existing-client",
          clientSecret: "existing-secret",
          redirectUri: "http://127.0.0.1:8080/callback",
          registeredAt: "2025-01-01T00:00:00Z",
        }),
      ),
    });
    const authService = createMockAuthService({
      startCallbackServer: mock(() =>
        Promise.resolve({
          result: Promise.reject(new Error("callback failed")),
          close,
        }),
      ),
    });

    const result = await loginFlow(
      { force: true, port: 9090 },
      {
        authService,
        authStorage,
        browserService: createMockBrowserService(),
        mcpUrl,
      },
      silentLoginOutput,
    );

    expect(result.status).toBe("failed");
    expect(authService.registerClient).toHaveBeenCalled();
    expect(authStorage.clearActiveClient).not.toHaveBeenCalledWith(mcpUrl);
  });

  it("does not open browser when callback server cannot start", async () => {
    const browserService = createMockBrowserService();
    const authService = createMockAuthService({
      startCallbackServer: mock(() =>
        Promise.reject(
          new Error("Failed to start callback server: EADDRINUSE"),
        ),
      ),
    });

    const result = await loginFlow(
      { port: 8080 },
      {
        authService,
        authStorage: createMockAuthStorage(),
        browserService,
        mcpUrl,
      },
      silentLoginOutput,
    );

    expect(result).toEqual({
      status: "failed",
      message: "Failed to start callback server: EADDRINUSE",
    });
    expect(browserService.open).not.toHaveBeenCalled();
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

  it("stays quiet when the silent reporter is used", async () => {
    const consoleSpy = spyOn(console, "log").mockImplementation(() => {});

    await loginFlow(
      { port: 8080 },
      {
        authService: createMockAuthService(),
        authStorage: createMockAuthStorage(),
        browserService: createMockBrowserService(),
        mcpUrl,
      },
      silentLoginOutput,
    );

    expect(consoleSpy).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  for (const port of [
    -1,
    0,
    1.5,
    65_536,
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ]) {
    it(`returns failed before authentication for programmatic port ${port}`, async () => {
      const authStorage = createMockAuthStorage();
      const authService = createMockAuthService();
      const result = await loginFlow(
        { port },
        {
          authService,
          authStorage,
          browserService: createMockBrowserService(),
          mcpUrl,
        },
        silentLoginOutput,
      );

      expect(result.status).toBe("failed");
      expect(result.message).toContain("Invalid port");
      expect(authStorage.loadTokens).not.toHaveBeenCalled();
      expect(authService.discoverEndpoints).not.toHaveBeenCalled();
    });
  }

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
