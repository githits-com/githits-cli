import {
  afterEach,
  describe,
  expect,
  it,
  mock,
  setDefaultTimeout,
} from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CodeNavigationServiceImpl } from "@githits/core-internal";
import {
  type RefreshTokenResponse,
  TokenRefreshError,
} from "./auth-service.js";
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

  // These tests intentionally exercise the production process-identity probe,
  // which is capped at five seconds per PowerShell invocation.
  setDefaultTimeout(20_000);

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

  it("retains a refresh token after a transient failure for the next invocation", async () => {
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
    const firstManager = new TokenManager({
      authService: createMockAuthService({
        refreshAccessToken: mock(() =>
          Promise.reject(new Error("network unavailable")),
        ),
      }),
      authStorage: firstStorage,
      mcpUrl: baseUrl,
    });

    await expect(firstManager.getToken()).rejects.toThrow(
      "network unavailable",
    );
    expect(await secondStorage.loadTokens(baseUrl)).toEqual(initial);

    const refreshAccessToken = mock((_request: { refreshToken: string }) =>
      Promise.resolve({
        accessToken: "rotated-access-token",
        refreshToken: "rotated-refresh-token",
        expiresIn: 3600,
      }),
    );
    const secondManager = new TokenManager({
      authService: createMockAuthService({ refreshAccessToken }),
      authStorage: secondStorage,
      mcpUrl: baseUrl,
    });

    expect(await secondManager.getToken()).toBe("rotated-access-token");
    expect(refreshAccessToken).toHaveBeenCalledWith(
      expect.objectContaining({ refreshToken: "initial-refresh-token" }),
    );
    expect(await firstStorage.loadTokens(baseUrl)).toMatchObject({
      accessToken: "rotated-access-token",
      refreshToken: "rotated-refresh-token",
    });
  });

  it("silently refreshes an expired stored login before a search call", async () => {
    const { firstStorage } = await createRealStorages();
    await firstStorage.saveAuthSession(
      baseUrl,
      defaultClientRegistration,
      createExpiredToken({
        accessToken: "expired-access-token",
        refreshToken: "stored-refresh-token",
      }),
    );
    const refreshAccessToken = mock(() =>
      Promise.resolve({
        accessToken: "refreshed-access-token",
        refreshToken: "rotated-refresh-token",
        expiresIn: 3600,
      }),
    );
    const manager = new TokenManager({
      authService: createMockAuthService({ refreshAccessToken }),
      authStorage: firstStorage,
      mcpUrl: baseUrl,
    });
    const fetchFn = mock((_url: string | URL | Request, _init?: RequestInit) =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            data: {
              search: {
                completed: true,
                searchRef: "search-ref-123",
                result: {
                  query: "test",
                  queryWarnings: [],
                  sources: ["CODE"],
                  results: [],
                  page: {
                    offset: 0,
                    limit: 20,
                    returned: 0,
                    hasMore: false,
                  },
                  partialResults: false,
                  sourceStatus: [],
                },
                progress: null,
              },
            },
          }),
          { headers: { "Content-Type": "application/json" } },
        ),
      ),
    ) as unknown as typeof fetch;
    const service = new CodeNavigationServiceImpl(
      "https://pkgseer.dev",
      manager,
      fetchFn,
    );

    const result = await service.search({
      targets: [{ registry: "NPM", packageName: "express" }],
      query: "test",
    });
    expect(result.state).toBe("completed");
    expect(refreshAccessToken).toHaveBeenCalledWith(
      expect.objectContaining({ refreshToken: "stored-refresh-token" }),
    );
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const request = (fetchFn as unknown as ReturnType<typeof mock>).mock
      .calls[0]?.[1] as RequestInit | undefined;
    expect(request?.headers).toMatchObject({
      Authorization: "Bearer refreshed-access-token",
    });
    expect(await firstStorage.loadTokens(baseUrl)).toMatchObject({
      accessToken: "refreshed-access-token",
      refreshToken: "rotated-refresh-token",
    });
  });

  it("preserves the real refresh failure instead of reporting a missing local token", async () => {
    const { firstStorage } = await createRealStorages();
    const expired = createExpiredToken({
      accessToken: "expired-access-token",
      refreshToken: "stored-refresh-token",
    });
    await firstStorage.saveAuthSession(
      baseUrl,
      defaultClientRegistration,
      expired,
    );
    const manager = new TokenManager({
      authService: createMockAuthService({
        refreshAccessToken: mock(() =>
          Promise.reject(new Error("refresh transport unavailable")),
        ),
      }),
      authStorage: firstStorage,
      mcpUrl: baseUrl,
    });
    const fetchFn = mock(() =>
      Promise.reject(new Error("backend should not be called")),
    ) as unknown as typeof fetch;
    const service = new CodeNavigationServiceImpl(
      "https://pkgseer.dev",
      manager,
      fetchFn,
    );

    await expect(
      service.search({
        targets: [{ registry: "NPM", packageName: "express" }],
        query: "test",
      }),
    ).rejects.toThrow("refresh transport unavailable");
    expect(fetchFn).not.toHaveBeenCalled();
    expect(await firstStorage.loadTokens(baseUrl)).toEqual(expired);
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
  });

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

    await expect(result).rejects.toThrow("refresh failed");
    await externalLoginWrite;
    expect(await firstStorage.loadTokens(baseUrl)).toEqual(externalLogin);
    expect(refreshAccessToken).toHaveBeenCalledTimes(1);
  });

  it("keychain-mode terminal refresh failure does not wipe the good file-mode token", async () => {
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
      authStorage: storage,
      mcpUrl: baseUrl,
    });

    expect(await manager.getToken()).toBeUndefined();

    expect(await primary.loadTokens(baseUrl)).toBeNull(); // active cleared
    expect(await file.loadTokens(baseUrl)).toEqual(goodFileToken); // survives
    expect(await file.loadClient(baseUrl)).toEqual(defaultClientRegistration);
  });

  it("file-mode terminal refresh failure clears legacy so it cannot resurrect", async () => {
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
    interface PendingRefresh {
      index: number;
      resolve: (response: RefreshTokenResponse) => void;
      reject: (error: Error) => void;
    }

    const pending: PendingRefresh[] = [];
    const waiters: Array<{ count: number; resolve: () => void }> = [];
    let callCount = 0;
    let released = false;
    const notifyWaiters = (): void => {
      for (let index = waiters.length - 1; index >= 0; index--) {
        const waiter = waiters[index];
        if (waiter && callCount >= waiter.count) {
          waiters.splice(index, 1);
          waiter.resolve();
        }
      }
    };
    const refreshAccessToken = mock(() => {
      const index = callCount++;
      const response = responses[index];
      notifyWaiters();
      if (released) {
        return response
          ? Promise.resolve(response)
          : Promise.reject(new Error(`Missing response for call ${index}`));
      }
      return new Promise<RefreshTokenResponse>((resolve, reject) => {
        pending.push({ index, resolve, reject });
      });
    });
    return {
      refreshAccessToken,
      waitForCalls: (count) =>
        callCount >= count
          ? Promise.resolve()
          : new Promise((resolve) => waiters.push({ count, resolve })),
      resolveAll: () => {
        released = true;
        let missingResponseError: Error | undefined;
        for (const { index, resolve, reject } of pending.splice(0)) {
          const response = responses[index];
          if (response) resolve(response);
          else {
            const error = new Error(`Missing response for call ${index}`);
            reject(error);
            missingResponseError ??= error;
          }
        }
        if (missingResponseError) throw missingResponseError;
      },
    };
  }

  function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
});
