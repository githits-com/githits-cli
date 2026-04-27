import { describe, expect, it, mock, spyOn } from "bun:test";
import {
  createJwtToken,
  createMockAuthService,
  createMockAuthStorage,
  createValidTokenData,
  defaultClientRegistration,
} from "../services/test-helpers.js";
import { authStatusAction } from "./auth-status.js";

describe("authStatusAction", () => {
  const mcpUrl = "https://mcp.githits.com";

  function createDeps(
    overrides: {
      authStorage?: ReturnType<typeof createMockAuthStorage>;
      authService?: ReturnType<typeof createMockAuthService>;
      envApiToken?: string;
      codeNavigationCliOverrideEnabled?: boolean;
    } = {},
  ) {
    return {
      authStorage: overrides.authStorage ?? createMockAuthStorage(),
      authService: overrides.authService ?? createMockAuthService(),
      mcpUrl,
      envApiToken: overrides.envApiToken ?? undefined,
      codeNavigationCliOverrideEnabled:
        overrides.codeNavigationCliOverrideEnabled ?? false,
    };
  }

  it("shows not authenticated when no tokens stored", async () => {
    const consoleSpy = spyOn(console, "log").mockImplementation(() => {});

    await authStatusAction(createDeps());

    const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("Not authenticated");
    expect(output).toContain("githits login");
    consoleSpy.mockRestore();
  });

  it("shows authenticated status with valid token", async () => {
    const consoleSpy = spyOn(console, "log").mockImplementation(() => {});
    const authStorage = createMockAuthStorage({
      loadTokens: mock(() =>
        Promise.resolve(
          createValidTokenData({
            accessToken: createJwtToken({ feature_flags: ["code_navigation"] }),
            expiresAt: new Date(Date.now() + 3600_000).toISOString(),
          }),
        ),
      ),
      getStorageLocation: mock(() => "System keychain (githits)"),
    });

    await authStatusAction(createDeps({ authStorage }));

    const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("Authenticated");
    expect(output).toContain(mcpUrl);
    expect(output).toContain("Storage:");
    expect(output).toContain("System keychain (githits)");
    expect(output).toContain("Code navigation: enabled");
    consoleSpy.mockRestore();
  });

  it("shows expired status when token is expired and refresh fails", async () => {
    const consoleSpy = spyOn(console, "log").mockImplementation(() => {});
    const authStorage = createMockAuthStorage({
      loadTokens: mock(() =>
        Promise.resolve(
          createValidTokenData({
            expiresAt: new Date(Date.now() - 3600_000).toISOString(),
          }),
        ),
      ),
      // No client registration → refresh fails
    });

    await authStatusAction(createDeps({ authStorage }));

    const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("Token expired");
    expect(output).toContain("githits login");
    consoleSpy.mockRestore();
  });

  it("shows authenticated after successful token refresh", async () => {
    const consoleSpy = spyOn(console, "log").mockImplementation(() => {});

    const expiredToken = createValidTokenData({
      expiresAt: new Date(Date.now() - 3600_000).toISOString(),
    });
    const refreshedToken = createValidTokenData({
      accessToken: createJwtToken({ feature_flags: ["code_navigation"] }),
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    });

    let loadCount = 0;
    const authStorage = createMockAuthStorage({
      loadTokens: mock(() => {
        loadCount++;
        // First call returns expired, second returns refreshed
        return Promise.resolve(loadCount === 1 ? expiredToken : refreshedToken);
      }),
      loadClient: mock(() => Promise.resolve(defaultClientRegistration)),
    });
    const authService = createMockAuthService();

    await authStatusAction(createDeps({ authStorage, authService }));

    const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("Authenticated (token refreshed)");
    expect(output).not.toContain("Token expired");
    expect(output).toContain("Storage:");
    expect(output).toContain("Code navigation: enabled");
    consoleSpy.mockRestore();
  });

  it("shows env token info when envApiToken is provided", async () => {
    const consoleSpy = spyOn(console, "log").mockImplementation(() => {});
    const envApiToken = createJwtToken({
      feature_flags: ["code_navigation"],
    });

    await authStatusAction(
      createDeps({
        envApiToken,
      }),
    );

    const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("environment variable");
    expect(output).toContain("GITHITS_API_TOKEN");
    expect(output).not.toContain("Token:");
    expect(output).not.toContain(envApiToken.slice(0, 8));
    expect(output).toContain("Code navigation: enabled");
    consoleSpy.mockRestore();
  });

  it("shows unknown capability and active CLI override when unauthenticated", async () => {
    const consoleSpy = spyOn(console, "log").mockImplementation(() => {});

    await authStatusAction(
      createDeps({ codeNavigationCliOverrideEnabled: true }),
    );

    const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("Code navigation: unknown");
    expect(output).toContain("CLI override: enabled");
    consoleSpy.mockRestore();
  });

  it("shows never for token without expiry", async () => {
    const consoleSpy = spyOn(console, "log").mockImplementation(() => {});
    const authStorage = createMockAuthStorage({
      loadTokens: mock(() =>
        Promise.resolve(createValidTokenData({ expiresAt: null })),
      ),
    });

    await authStatusAction(createDeps({ authStorage }));

    const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("never");
    consoleSpy.mockRestore();
  });
});
