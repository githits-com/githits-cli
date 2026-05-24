import { afterEach, describe, expect, it, mock } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RefreshTokenResponse } from "./auth-service.js";
import { AuthStorageImpl } from "./auth-storage.js";
import { FileSystemServiceImpl } from "./filesystem-service.js";
import { LockedAuthStorage } from "./locked-auth-storage.js";
import {
  createMockAuthService,
  createValidTokenData,
  defaultClientRegistration,
} from "./test-helpers.js";
import { TokenManager } from "./token-manager.js";

describe("TokenManager file-backed integration", () => {
  const baseUrl = "https://mcp.githits.com";
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      tempDirs
        .splice(0)
        .map((dir) => rm(dir, { recursive: true, force: true })),
    );
  });

  it("preserves one rotated refresh token when two managers refresh the same stored token", async () => {
    const { firstStorage, secondStorage } = await createRealStorages();
    const initial = createExpiredToken({
      accessToken: "initial-access-token",
      refreshToken: "initial-refresh-token",
    });
    await firstStorage.saveAuthSession(
      baseUrl,
      defaultClientRegistration,
      initial,
    );
    const refreshGate = createRefreshGate([
      {
        accessToken: "first-access-token",
        refreshToken: "first-refresh-token",
        expiresIn: 3600,
      },
      {
        accessToken: "second-access-token",
        refreshToken: "second-refresh-token",
        expiresIn: 3600,
      },
    ]);
    const authService = createMockAuthService({
      refreshAccessToken: refreshGate.refreshAccessToken,
    });
    const firstManager = new TokenManager({
      authService,
      authStorage: firstStorage,
      mcpUrl: baseUrl,
    });
    const secondManager = new TokenManager({
      authService,
      authStorage: secondStorage,
      mcpUrl: baseUrl,
    });

    const results = Promise.all([
      firstManager.getToken(),
      secondManager.getToken(),
    ]);
    await refreshGate.waitForCalls(2);
    refreshGate.resolveAll();

    const [firstResult, secondResult] = await results;
    const stored = await firstStorage.loadTokens(baseUrl);

    expect(stored).not.toBeNull();
    if (!stored) throw new Error("Expected stored token after refresh race");
    expect(["first-access-token", "second-access-token"]).toContain(
      stored.accessToken,
    );
    expect(stored.refreshToken).toBe(
      stored.accessToken === "first-access-token"
        ? "first-refresh-token"
        : "second-refresh-token",
    );
    // The losing refresh must reload storage and return the persisted winner.
    expect(firstResult).toBe(stored.accessToken);
    expect(secondResult).toBe(stored.accessToken);
    expect(refreshGate.refreshAccessToken).toHaveBeenCalledTimes(2);
    expect(firstStorage.getStorageLocation()).toContain(
      join("githits", "auth"),
    );
  });

  it("does not overwrite an external login written while refresh is in flight", async () => {
    const { firstStorage, secondStorage } = await createRealStorages();
    const initial = createExpiredToken({
      accessToken: "initial-access-token",
      refreshToken: "initial-refresh-token",
    });
    const externalLogin = createValidTokenData({
      accessToken: "external-login-access-token",
      refreshToken: "external-login-refresh-token",
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    });
    await firstStorage.saveAuthSession(
      baseUrl,
      defaultClientRegistration,
      initial,
    );
    const refreshGate = createRefreshGate([
      {
        accessToken: "rotated-access-token",
        refreshToken: "rotated-refresh-token",
        expiresIn: 3600,
      },
    ]);
    const manager = new TokenManager({
      authService: createMockAuthService({
        refreshAccessToken: refreshGate.refreshAccessToken,
      }),
      authStorage: firstStorage,
      mcpUrl: baseUrl,
    });

    const result = manager.getToken();
    await refreshGate.waitForCalls(1);
    await secondStorage.saveAuthSession(
      baseUrl,
      defaultClientRegistration,
      externalLogin,
    );
    refreshGate.resolveAll();

    expect(await result).toBe("external-login-access-token");
    expect(await firstStorage.loadTokens(baseUrl)).toEqual(externalLogin);
    expect(refreshGate.refreshAccessToken).toHaveBeenCalledTimes(1);
  });

  it("does not clear an external login when refresh fails", async () => {
    const { firstStorage, secondStorage } = await createRealStorages();
    const initial = createExpiredToken({
      accessToken: "initial-access-token",
      refreshToken: "initial-refresh-token",
    });
    const externalLogin = createValidTokenData({
      accessToken: "external-login-access-token",
      refreshToken: "external-login-refresh-token",
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    });
    await firstStorage.saveAuthSession(
      baseUrl,
      defaultClientRegistration,
      initial,
    );
    let rejectRefresh!: (error: Error) => void;
    let resolveRefreshStarted!: () => void;
    const refreshStarted = new Promise<void>((resolve) => {
      resolveRefreshStarted = resolve;
    });
    const refreshAccessToken = mock(
      () =>
        new Promise<RefreshTokenResponse>((_resolve, reject) => {
          rejectRefresh = reject;
          resolveRefreshStarted();
        }),
    );
    const manager = new TokenManager({
      authService: createMockAuthService({ refreshAccessToken }),
      authStorage: firstStorage,
      mcpUrl: baseUrl,
    });

    const result = manager.getToken();
    await refreshStarted;
    await secondStorage.saveAuthSession(
      baseUrl,
      defaultClientRegistration,
      externalLogin,
    );
    rejectRefresh(new Error("refresh failed"));

    expect(await result).toBe("external-login-access-token");
    expect(await firstStorage.loadTokens(baseUrl)).toEqual(externalLogin);
    expect(refreshAccessToken).toHaveBeenCalledTimes(1);
  });

  async function createRealStorages(): Promise<{
    firstStorage: LockedAuthStorage;
    secondStorage: LockedAuthStorage;
  }> {
    const root = await mkdtemp(join(tmpdir(), "githits-token-manager-"));
    tempDirs.push(root);
    const fs = new FileSystemServiceImpl();
    const homeDir = join(root, "home");
    const fsWithHome = Object.assign(Object.create(fs), fs, {
      getHomeDir: () => homeDir,
    }) as FileSystemServiceImpl;
    const configRoot = join(root, "config");
    const configDir = join(configRoot, "githits", "auth");
    return withConfigRoot(configRoot, () => ({
      firstStorage: new LockedAuthStorage(
        new AuthStorageImpl(fs, configDir),
        fsWithHome,
      ),
      secondStorage: new LockedAuthStorage(
        new AuthStorageImpl(fs, configDir),
        fsWithHome,
      ),
    }));
  }

  function withConfigRoot<T>(configRoot: string, create: () => T): T {
    const envKey = process.platform === "win32" ? "APPDATA" : "XDG_CONFIG_HOME";
    const previous = process.env[envKey];
    process.env[envKey] = configRoot;
    try {
      return create();
    } finally {
      if (previous === undefined) {
        delete process.env[envKey];
      } else {
        process.env[envKey] = previous;
      }
    }
  }

  function createExpiredToken(overrides: {
    accessToken: string;
    refreshToken: string;
  }) {
    return createValidTokenData({
      ...overrides,
      createdAt: new Date(Date.now() - 7200_000).toISOString(),
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });
  }

  function createRefreshGate(responses: RefreshTokenResponse[]): {
    refreshAccessToken: ReturnType<typeof mock>;
    waitForCalls(count: number): Promise<void>;
    resolveAll(): void;
  } {
    const pending: Array<(response: RefreshTokenResponse) => void> = [];
    const waiters: Array<{ count: number; resolve: () => void }> = [];
    const refreshAccessToken = mock(
      () =>
        new Promise<RefreshTokenResponse>((resolve) => {
          pending.push(resolve);
          for (const waiter of waiters) {
            if (pending.length >= waiter.count) waiter.resolve();
          }
        }),
    );
    return {
      refreshAccessToken,
      waitForCalls: (count) =>
        pending.length >= count
          ? Promise.resolve()
          : new Promise((resolve) => waiters.push({ count, resolve })),
      resolveAll: () => {
        for (const [index, resolve] of pending.entries()) {
          const response = responses[index];
          if (!response) throw new Error(`Missing response for call ${index}`);
          resolve(response);
        }
      },
    };
  }
});
