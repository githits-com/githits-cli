import { afterEach, describe, expect, it, mock } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RefreshTokenResponse } from "./auth-service.js";
import { AuthSessionMetadataStorage } from "./auth-session-metadata-storage.js";
import { AuthStorageImpl } from "./auth-storage.js";
import { FileSystemServiceImpl } from "./filesystem-service.js";
import { LockedAuthStorage } from "./locked-auth-storage.js";
import { MigratingAuthStorage } from "./migrating-auth-storage.js";
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

  it("reuses one rotated refresh token when two managers refresh the same stored token", async () => {
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
    await refreshGate.waitForCalls(1);
    refreshGate.resolveAll();

    const [firstResult, secondResult] = await results;
    const stored = await firstStorage.loadTokens(baseUrl);

    expect(stored).not.toBeNull();
    if (!stored) throw new Error("Expected stored token after refresh race");
    expect(stored.accessToken).toBe("first-access-token");
    expect(stored.refreshToken).toBe("first-refresh-token");
    // The waiting manager must reload storage and return the persisted winner.
    expect(firstResult).toBe(stored.accessToken);
    expect(secondResult).toBe(stored.accessToken);
    expect(refreshGate.refreshAccessToken).toHaveBeenCalledTimes(1);
    expect(firstStorage.getStorageLocation()).toContain(
      join("githits", "auth"),
    );
  });

  it("serializes endpoint refresh when rotation invalidates concurrent refreshes", async () => {
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

    let resolveFirstRefresh!: (response: RefreshTokenResponse) => void;
    let resolveFirstRefreshStarted!: () => void;
    const firstRefreshStarted = new Promise<void>((resolve) => {
      resolveFirstRefreshStarted = resolve;
    });
    let resolveSecondRefreshStarted!: () => void;
    const secondRefreshStarted = new Promise<void>((resolve) => {
      resolveSecondRefreshStarted = resolve;
    });
    let refreshCall = 0;
    const refreshAccessToken = mock(() => {
      refreshCall++;
      if (refreshCall === 1) {
        resolveFirstRefreshStarted();
        return new Promise<RefreshTokenResponse>((resolve) => {
          resolveFirstRefresh = resolve;
        });
      }
      resolveSecondRefreshStarted();
      return Promise.reject(new Error("invalid_grant"));
    });
    const authService = createMockAuthService({ refreshAccessToken });
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
    await firstRefreshStarted;
    await Promise.race([secondRefreshStarted, sleep(100)]);

    resolveFirstRefresh({
      accessToken: "refreshed-access-token",
      refreshToken: "refreshed-refresh-token",
      expiresIn: 3600,
    });

    await expect(results).resolves.toEqual([
      "refreshed-access-token",
      "refreshed-access-token",
    ]);
    expect(refreshAccessToken).toHaveBeenCalledTimes(1);
    expect(await firstStorage.loadTokens(baseUrl)).toEqual(
      expect.objectContaining({
        accessToken: "refreshed-access-token",
        refreshToken: "refreshed-refresh-token",
      }),
    );
  });

  it("makes one endpoint refresh for many simultaneous expired-token agents", async () => {
    const storageCount = 12;
    const storages = await createRealStorageSet(storageCount);
    const initial = createExpiredToken({
      accessToken: "initial-access-token",
      refreshToken: "initial-refresh-token",
    });
    await storages[0]?.saveAuthSession(
      baseUrl,
      defaultClientRegistration,
      initial,
    );
    const refreshGate = createRefreshGate([
      {
        accessToken: "refreshed-access-token",
        refreshToken: "refreshed-refresh-token",
        expiresIn: 3600,
      },
    ]);
    const authService = createMockAuthService({
      refreshAccessToken: refreshGate.refreshAccessToken,
    });
    const managers = storages.map(
      (authStorage) =>
        new TokenManager({ authService, authStorage, mcpUrl: baseUrl }),
    );

    const results = Promise.all(managers.map((manager) => manager.getToken()));
    await refreshGate.waitForCalls(1);
    await Promise.race([refreshGate.waitForCalls(2), sleep(100)]);
    refreshGate.resolveAll();

    await expect(results).resolves.toEqual(
      Array.from({ length: storageCount }, () => "refreshed-access-token"),
    );
    expect(refreshGate.refreshAccessToken).toHaveBeenCalledTimes(1);
    expect(await storages[0]?.loadTokens(baseUrl)).toEqual(
      expect.objectContaining({
        accessToken: "refreshed-access-token",
        refreshToken: "refreshed-refresh-token",
      }),
    );
  }, 20_000);

  it("makes one endpoint refresh for many simultaneous force refresh retries", async () => {
    const storageCount = 12;
    const storages = await createRealStorageSet(storageCount);
    const initial = createValidTokenData({
      accessToken: "rejected-access-token",
      refreshToken: "initial-refresh-token",
      createdAt: new Date(Date.now() - 60_000).toISOString(),
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    });
    await storages[0]?.saveAuthSession(
      baseUrl,
      defaultClientRegistration,
      initial,
    );
    const refreshGate = createRefreshGate([
      {
        accessToken: "retry-access-token",
        refreshToken: "retry-refresh-token",
        expiresIn: 3600,
      },
    ]);
    const authService = createMockAuthService({
      refreshAccessToken: refreshGate.refreshAccessToken,
    });
    const managers = storages.map(
      (authStorage) =>
        new TokenManager({ authService, authStorage, mcpUrl: baseUrl }),
    );

    await expect(
      Promise.all(managers.map((manager) => manager.getToken())),
    ).resolves.toEqual(
      Array.from({ length: storageCount }, () => "rejected-access-token"),
    );

    const results = Promise.all(
      managers.map((manager) => manager.forceRefresh()),
    );
    await refreshGate.waitForCalls(1);
    await Promise.race([refreshGate.waitForCalls(2), sleep(100)]);
    refreshGate.resolveAll();

    await expect(results).resolves.toEqual(
      Array.from({ length: storageCount }, () => "retry-access-token"),
    );
    expect(refreshGate.refreshAccessToken).toHaveBeenCalledTimes(1);
    expect(await storages[0]?.loadTokens(baseUrl)).toEqual(
      expect.objectContaining({
        accessToken: "retry-access-token",
        refreshToken: "retry-refresh-token",
      }),
    );
  }, 20_000);

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
    const externalLoginWrite = secondStorage.saveAuthSession(
      baseUrl,
      defaultClientRegistration,
      externalLogin,
    );
    refreshGate.resolveAll();

    expect(await result).toBe("rotated-access-token");
    await externalLoginWrite;
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
    const externalLoginWrite = secondStorage.saveAuthSession(
      baseUrl,
      defaultClientRegistration,
      externalLogin,
    );
    rejectRefresh(new Error("refresh failed"));

    expect(await result).toBeUndefined();
    await externalLoginWrite;
    expect(await firstStorage.loadTokens(baseUrl)).toEqual(externalLogin);
    expect(refreshAccessToken).toHaveBeenCalledTimes(1);
  });

  it("keychain-mode refresh failure does not wipe the good file-mode token", async () => {
    // The reported bug: a stale keychain token (from a launch without
    // GITHITS_AUTH_STORAGE) fails refresh and must not destroy the user's good
    // file-mode credentials.
    const { storage, primary, file } = await createCompositeStorage("keychain");
    await primary.saveAuthSession(
      baseUrl,
      defaultClientRegistration,
      createExpiredToken({
        accessToken: "stale-keychain",
        refreshToken: "stale-keychain-refresh",
      }),
    );
    const goodFileToken = createValidTokenData({
      accessToken: "good-file",
      refreshToken: "good-file-refresh",
    });
    await file.saveAuthSession(
      baseUrl,
      defaultClientRegistration,
      goodFileToken,
    );

    const manager = new TokenManager({
      authService: createMockAuthService({
        refreshAccessToken: mock(() => Promise.reject(new Error("boom"))),
      }),
      authStorage: storage,
      mcpUrl: baseUrl,
    });

    expect(await manager.getToken()).toBeUndefined();

    expect(await primary.loadTokens(baseUrl)).toBeNull(); // active cleared
    expect(await file.loadTokens(baseUrl)).toEqual(goodFileToken); // survives
    expect(await file.loadClient(baseUrl)).toEqual(defaultClientRegistration);
  });

  it("file-mode refresh failure clears legacy too so it cannot resurrect", async () => {
    const { storage, file, legacy } = await createCompositeStorage("file");
    await legacy.saveAuthSession(
      baseUrl,
      defaultClientRegistration,
      createValidTokenData({
        accessToken: "legacy",
        refreshToken: "legacy-refresh",
        createdAt: new Date(Date.now() - 9000_000).toISOString(),
        expiresAt: new Date(Date.now() - 120_000).toISOString(),
      }),
    );
    await file.saveAuthSession(
      baseUrl,
      defaultClientRegistration,
      createExpiredToken({
        accessToken: "file",
        refreshToken: "file-refresh",
      }),
    );

    const manager = new TokenManager({
      authService: createMockAuthService({
        refreshAccessToken: mock(() => Promise.reject(new Error("boom"))),
      }),
      authStorage: storage,
      mcpUrl: baseUrl,
    });

    expect(await manager.getToken()).toBeUndefined();

    expect(await file.loadTokens(baseUrl)).toBeNull();
    expect(await legacy.loadTokens(baseUrl)).toBeNull();
    // A fresh active-mode load must not resurrect the legacy token.
    expect(await storage.loadTokens(baseUrl)).toBeNull();
  });

  async function createCompositeStorage(mode: "file" | "keychain"): Promise<{
    storage: LockedAuthStorage;
    primary: AuthStorageImpl;
    file: AuthStorageImpl;
    legacy: AuthStorageImpl;
  }> {
    const root = await mkdtemp(join(tmpdir(), "githits-tm-composite-"));
    tempDirs.push(root);
    const fs = new FileSystemServiceImpl();
    const homeDir = join(root, "home");
    const fsWithHome = Object.assign(Object.create(fs), fs, {
      getHomeDir: () => homeDir,
    }) as FileSystemServiceImpl;
    // Separate file-backed dirs stand in for the keychain/file/legacy backends
    // so the composite clear logic is exercised without the real OS keychain.
    const primary = new AuthStorageImpl(fs, join(root, "keychain"));
    const file = new AuthStorageImpl(fs, join(root, "file"));
    const legacy = new AuthStorageImpl(fs, join(root, "legacy"));
    const metadata = new AuthSessionMetadataStorage(fs, join(root, "meta"));
    const migrating = new MigratingAuthStorage(
      primary,
      file,
      legacy,
      mode,
      "config.toml",
      () => {},
      metadata,
    );
    const storage = withConfigRoot(
      join(root, "config"),
      () => new LockedAuthStorage(migrating, fsWithHome),
    );
    return { storage, primary, file, legacy };
  }

  async function createRealStorages(): Promise<{
    firstStorage: LockedAuthStorage;
    secondStorage: LockedAuthStorage;
  }> {
    const [firstStorage, secondStorage] = await createRealStorageSet(2);
    if (!firstStorage || !secondStorage) {
      throw new Error("Expected two real storages");
    }
    return { firstStorage, secondStorage };
  }

  async function createRealStorageSet(
    count: number,
  ): Promise<LockedAuthStorage[]> {
    const root = await mkdtemp(join(tmpdir(), "githits-token-manager-"));
    tempDirs.push(root);
    const fs = new FileSystemServiceImpl();
    const homeDir = join(root, "home");
    const fsWithHome = Object.assign(Object.create(fs), fs, {
      getHomeDir: () => homeDir,
    }) as FileSystemServiceImpl;
    const configRoot = join(root, "config");
    const configDir = join(configRoot, "githits", "auth");
    return withConfigRoot(configRoot, () =>
      Array.from(
        { length: count },
        () =>
          new LockedAuthStorage(new AuthStorageImpl(fs, configDir), fsWithHome),
      ),
    );
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

  function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
});
