import { describe, expect, it, mock, spyOn } from "bun:test";
import { AuthRequiredError } from "@githits/mcp/internal";
import {
  createMockAuthService,
  createMockAuthStorage,
  createValidTokenData,
  defaultClientRegistration,
} from "../services/test-helpers.js";
import { authStatusAction, authTokenAction } from "./auth-status.js";

describe("authStatusAction", () => {
  const mcpUrl = "https://mcp.githits.com";

  function createDeps(
    overrides: {
      authStorage?: ReturnType<typeof createMockAuthStorage>;
      authService?: ReturnType<typeof createMockAuthService>;
      envApiToken?: string;
    } = {},
  ) {
    return {
      authStorage: overrides.authStorage ?? createMockAuthStorage(),
      authService: overrides.authService ?? createMockAuthService(),
      mcpUrl,
      envApiToken: overrides.envApiToken ?? undefined,
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
    consoleSpy.mockRestore();
  });

  it("shows env token info when envApiToken is provided", async () => {
    const consoleSpy = spyOn(console, "log").mockImplementation(() => {});
    const envApiToken = "ghi-env-token";

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

describe("authTokenAction", () => {
  const mcpUrl = "https://mcp.githits.com";

  function createDeps(
    overrides: {
      authStorage?: ReturnType<typeof createMockAuthStorage>;
      authService?: ReturnType<typeof createMockAuthService>;
      envApiToken?: string;
    } = {},
  ) {
    return {
      authStorage: overrides.authStorage ?? createMockAuthStorage(),
      authService: overrides.authService ?? createMockAuthService(),
      mcpUrl,
      envApiToken: overrides.envApiToken ?? undefined,
    };
  }

  function createOutput() {
    const chunks: string[] = [];
    return {
      output: { write: mock((text: string) => chunks.push(text)) },
      chunks,
    };
  }

  it("prints the env token without reading local storage", async () => {
    const authStorage = createMockAuthStorage();
    const { output, chunks } = createOutput();

    await authTokenAction(
      createDeps({ authStorage, envApiToken: "ghi-env-token" }),
      output,
    );

    expect(chunks).toEqual(["ghi-env-token\n"]);
    expect(authStorage.loadTokens).not.toHaveBeenCalled();
  });

  it("prints a stored unexpired token", async () => {
    const authStorage = createMockAuthStorage({
      loadTokens: mock(() =>
        Promise.resolve(
          createValidTokenData({
            accessToken: "ghi-stored-token",
            expiresAt: new Date(Date.now() + 3600_000).toISOString(),
          }),
        ),
      ),
    });
    const authService = createMockAuthService();
    const { output, chunks } = createOutput();

    await authTokenAction(createDeps({ authStorage, authService }), output);

    expect(chunks).toEqual(["ghi-stored-token\n"]);
    expect(authService.refreshAccessToken).not.toHaveBeenCalled();
  });

  it("prints a stored token without expiry", async () => {
    const authStorage = createMockAuthStorage({
      loadTokens: mock(() =>
        Promise.resolve(
          createValidTokenData({
            accessToken: "ghi-never-expiring",
            expiresAt: null,
          }),
        ),
      ),
    });
    const { output, chunks } = createOutput();

    await authTokenAction(createDeps({ authStorage }), output);

    expect(chunks).toEqual(["ghi-never-expiring\n"]);
  });

  it("refreshes and prints an expired token", async () => {
    const expiredToken = createValidTokenData({
      accessToken: "ghi-expired-token",
      expiresAt: new Date(Date.now() - 3600_000).toISOString(),
    });
    const authStorage = createMockAuthStorage({
      loadTokens: mock(() => Promise.resolve(expiredToken)),
      loadClient: mock(() => Promise.resolve(defaultClientRegistration)),
    });
    const authService = createMockAuthService({
      refreshAccessToken: mock(() =>
        Promise.resolve({
          accessToken: "ghi-refreshed-token",
          refreshToken: "refresh-token",
          expiresIn: 3600,
        }),
      ),
    });
    const { output, chunks } = createOutput();

    await authTokenAction(createDeps({ authStorage, authService }), output);

    expect(chunks).toEqual(["ghi-refreshed-token\n"]);
    expect(authService.refreshAccessToken).toHaveBeenCalledTimes(1);
  });

  it("throws AuthRequiredError when unauthenticated", async () => {
    const { output } = createOutput();

    await expect(authTokenAction(createDeps(), output)).rejects.toBeInstanceOf(
      AuthRequiredError,
    );
    expect(output.write).not.toHaveBeenCalled();
  });

  it("throws AuthRequiredError when expired token cannot refresh", async () => {
    const authStorage = createMockAuthStorage({
      loadTokens: mock(() =>
        Promise.resolve(
          createValidTokenData({
            expiresAt: new Date(Date.now() - 3600_000).toISOString(),
          }),
        ),
      ),
    });
    const { output } = createOutput();

    await expect(
      authTokenAction(createDeps({ authStorage }), output),
    ).rejects.toBeInstanceOf(AuthRequiredError);
    expect(output.write).not.toHaveBeenCalled();
  });
});
