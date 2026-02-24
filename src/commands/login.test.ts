import { describe, expect, it, mock, spyOn } from "bun:test";
import {
  createMockAuthService,
  createMockAuthStorage,
  createMockBrowserService,
  createValidTokenData,
} from "../services/test-helpers.js";
import { loginAction } from "./login.js";

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
    expect(authStorage.saveTokens).toHaveBeenCalled();

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

    expect(authStorage.saveTokens).not.toHaveBeenCalled();
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

    expect(authStorage.saveTokens).toHaveBeenCalled();
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
    expect(authStorage.saveClient).toHaveBeenCalled();
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

    expect(authStorage.saveTokens).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
