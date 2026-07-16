import { afterEach, describe, expect, it, mock } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getAppConfigDir, getAuthLockDir } from "./app-config-paths.js";
import {
  AuthStorageImpl,
  type ClientRegistration,
  type TokenData,
} from "./auth-storage.js";
import { FileSystemServiceImpl } from "./filesystem-service.js";
import { LockedAuthStorage } from "./locked-auth-storage.js";
import {
  createMockAuthStorage,
  createValidTokenData,
  withTestEnvVar,
} from "./test-helpers.js";

describe("LockedAuthStorage", () => {
  const baseUrl = "https://mcp.githits.com";
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      tempDirs
        .splice(0)
        .map((dir) => rm(dir, { recursive: true, force: true })),
    );
  });

  it("serializes conditional token saves across storage instances", async () => {
    const { fs, fsWithHome, configDir } = await createStoragePaths();
    const first = new LockedAuthStorage(
      new AuthStorageImpl(fs, configDir),
      fsWithHome,
    );
    const second = new LockedAuthStorage(
      new AuthStorageImpl(fs, configDir),
      fsWithHome,
    );
    const initial = createValidTokenData({ accessToken: "initial" });
    await first.saveTokens(baseUrl, initial);

    const [firstSaved, secondSaved] = await Promise.all([
      first.saveTokensIfUnchanged(
        baseUrl,
        initial,
        createValidTokenData({ accessToken: "first" }),
      ),
      second.saveTokensIfUnchanged(
        baseUrl,
        initial,
        createValidTokenData({ accessToken: "second" }),
      ),
    ]);

    expect([firstSaved, secondSaved].filter(Boolean)).toHaveLength(1);
    const finalToken = await first.loadTokens(baseUrl);
    expect(finalToken).not.toBeNull();
    expect(["first", "second"]).toContain(finalToken?.accessToken ?? "");
  });

  it("serializes token loads with external writes", async () => {
    const { fsWithHome } = await createStoragePaths();
    let releaseLoad!: () => void;
    let loadStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      loadStarted = resolve;
    });
    let contentionStarted!: () => void;
    const contention = new Promise<"contention">((resolve) => {
      contentionStarted = () => resolve("contention");
    });
    let saveStarted!: () => void;
    const innerSave = new Promise<"save">((resolve) => {
      saveStarted = () => resolve("save");
    });
    const firstInner = createMockAuthStorage({
      requiresLoadLock: true,
      loadTokens: mock<(_baseUrl: string) => Promise<TokenData | null>>(
        () =>
          new Promise<TokenData | null>((resolve) => {
            loadStarted();
            releaseLoad = () => resolve(createValidTokenData());
          }),
      ),
    });
    const secondInner = createMockAuthStorage({
      saveTokens: mock(() => {
        saveStarted();
        return Promise.resolve();
      }),
    });
    const first = new LockedAuthStorage(firstInner, fsWithHome);
    const second = new LockedAuthStorage(secondInner, fsWithHome, {
      isOwnerAlive: async () => {
        contentionStarted();
        return true;
      },
    });

    const load = first.loadTokens(baseUrl);
    await started;
    const save = second.saveTokens(baseUrl, createValidTokenData());
    expect(await Promise.race([contention, innerSave])).toBe("contention");
    expect(secondInner.saveTokens).not.toHaveBeenCalled();

    releaseLoad();
    await Promise.all([load, save]);
    expect(secondInner.saveTokens).toHaveBeenCalledTimes(1);
  });

  it("serializes client loads with external writes", async () => {
    const { fsWithHome } = await createStoragePaths();
    let releaseLoad!: () => void;
    let loadStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      loadStarted = resolve;
    });
    let contentionStarted!: () => void;
    const contention = new Promise<"contention">((resolve) => {
      contentionStarted = () => resolve("contention");
    });
    let saveStarted!: () => void;
    const innerSave = new Promise<"save">((resolve) => {
      saveStarted = () => resolve("save");
    });
    const firstInner = createMockAuthStorage({
      requiresLoadLock: true,
      loadClient: mock<
        (_baseUrl: string) => Promise<ClientRegistration | null>
      >(
        () =>
          new Promise<ClientRegistration | null>((resolve) => {
            loadStarted();
            releaseLoad = () => resolve(null);
          }),
      ),
    });
    const secondInner = createMockAuthStorage({
      saveClient: mock(() => {
        saveStarted();
        return Promise.resolve();
      }),
    });
    const first = new LockedAuthStorage(firstInner, fsWithHome);
    const second = new LockedAuthStorage(secondInner, fsWithHome, {
      isOwnerAlive: async () => {
        contentionStarted();
        return true;
      },
    });

    const load = first.loadClient(baseUrl);
    await started;
    const save = second.saveClient(baseUrl, {
      clientId: "client-id",
      clientSecret: "client-secret",
      redirectUri: "http://127.0.0.1/callback",
      registeredAt: "2026-01-01T00:00:00Z",
    });
    expect(await Promise.race([contention, innerSave])).toBe("contention");
    expect(secondInner.saveClient).not.toHaveBeenCalled();

    releaseLoad();
    await Promise.all([load, save]);
    expect(secondInner.saveClient).toHaveBeenCalledTimes(1);
  });

  it("keeps read-only storage loads outside the mutation lock", async () => {
    const { fsWithHome, lockPath } = await createStoragePaths();
    await mkdir(lockPath, { recursive: true, mode: 0o700 });
    await writeFile(
      join(lockPath, "owner.json"),
      JSON.stringify({
        id: "live-owner",
        pid: process.pid,
        createdAt: new Date().toISOString(),
        processStartedAt: "test-start-time",
      }),
    );
    const storage = new LockedAuthStorage(createMockAuthStorage(), fsWithHome, {
      isOwnerAlive: async () => true,
      lockTimeoutMs: 10,
    });

    await expect(storage.loadTokens(baseUrl)).resolves.toBeNull();
    await expect(storage.loadClient(baseUrl)).resolves.toBeNull();
  });

  it("clearActiveTokensIfUnchanged delegates through the lock", async () => {
    const { fsWithHome } = await createStoragePaths();
    const inner = createMockAuthStorage();
    const storage = new LockedAuthStorage(inner, fsWithHome);
    const token = createValidTokenData();

    await storage.clearActiveTokensIfUnchanged(baseUrl, token);

    expect(inner.clearActiveTokensIfUnchanged).toHaveBeenCalledWith(
      baseUrl,
      token,
    );
  });

  it("clearActiveClient is re-entrant inside a held lock", async () => {
    const { fsWithHome } = await createStoragePaths();
    const inner = createMockAuthStorage();
    const storage = new LockedAuthStorage(inner, fsWithHome, {
      lockTimeoutMs: 100,
    });

    // Would time out acquiring the lock again if it were not re-entrant.
    await storage.withAuthStorageLock(async () => {
      await storage.clearActiveClient(baseUrl);
    });

    expect(inner.clearActiveClient).toHaveBeenCalledWith(baseUrl);
  });

  it("allows nested storage writes inside a scoped lock", async () => {
    const { fs, fsWithHome, configDir } = await createStoragePaths();
    const storage = new LockedAuthStorage(
      new AuthStorageImpl(fs, configDir),
      fsWithHome,
      { lockTimeoutMs: 100 },
    );
    const token = createValidTokenData({ accessToken: "nested" });

    await storage.withAuthStorageLock(async () => {
      await storage.saveTokens(baseUrl, token);
    });

    expect(await storage.loadTokens(baseUrl)).toEqual(token);
  });

  it("uses one per-user lock across different config directories", async () => {
    const { fs, fsWithHome, configDir, root } = await createStoragePaths();
    const first = await withTestEnvVar(
      "XDG_CONFIG_HOME",
      join(root, "xdg-a"),
      () =>
        new LockedAuthStorage(new AuthStorageImpl(fs, configDir), fsWithHome),
    );
    const second = await withTestEnvVar(
      "XDG_CONFIG_HOME",
      join(root, "xdg-b"),
      () =>
        new LockedAuthStorage(new AuthStorageImpl(fs, configDir), fsWithHome),
    );
    let active = 0;
    let maxActive = 0;
    const runLocked = async (storage: LockedAuthStorage) => {
      await storage.withAuthStorageLock(async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 50));
        active -= 1;
      });
    };

    await Promise.all([runLocked(first), runLocked(second)]);

    expect(maxActive).toBe(1);
  });

  it("reclaims stale lock directories", async () => {
    const { fs, fsWithHome, configDir, lockPath } = await createStoragePaths();
    await mkdir(lockPath, { recursive: true, mode: 0o700 });
    await writeFile(
      join(lockPath, "owner.json"),
      JSON.stringify({
        id: "dead-owner",
        pid: 999_999_999,
        createdAt: new Date().toISOString(),
        processStartedAt: null,
      }),
    );
    const storage = new LockedAuthStorage(
      new AuthStorageImpl(fs, configDir),
      fsWithHome,
      { lockTimeoutMs: 100 },
    );
    const token = createValidTokenData({ accessToken: "fresh" });

    await storage.saveTokens(baseUrl, token);

    expect(await storage.loadTokens(baseUrl)).toEqual(token);
  });

  it("does not reclaim live locks just because they are old", async () => {
    const { fs, fsWithHome, configDir, lockPath } = await createStoragePaths();
    await mkdir(lockPath, { recursive: true, mode: 0o700 });
    await writeFile(
      join(lockPath, "owner.json"),
      JSON.stringify({
        id: "live-owner",
        pid: process.pid,
        createdAt: new Date(Date.now() - 120_000).toISOString(),
        processStartedAt: "test-start-time",
      }),
    );
    const storage = new LockedAuthStorage(
      new AuthStorageImpl(fs, configDir),
      fsWithHome,
      { isOwnerAlive: async () => true, lockTimeoutMs: 100 },
    );

    await expect(
      storage.saveTokens(
        baseUrl,
        createValidTokenData({ accessToken: "fresh" }),
      ),
    ).rejects.toThrow("Timed out waiting for GitHits auth storage lock");
  });

  async function createStoragePaths(): Promise<{
    fs: FileSystemServiceImpl;
    fsWithHome: FileSystemServiceImpl;
    configDir: string;
    lockPath: string;
    root: string;
  }> {
    const root = await mkdtemp(join(tmpdir(), "githits-lock-"));
    tempDirs.push(root);
    const fs = new FileSystemServiceImpl();
    const homeDir = join(root, "home");
    const fsWithHome = Object.assign(Object.create(fs), fs, {
      getHomeDir: () => homeDir,
    }) as FileSystemServiceImpl;
    const appConfigDir = getAppConfigDir(fsWithHome);
    const authLockDir = getAuthLockDir(fsWithHome);
    return {
      fs,
      fsWithHome,
      configDir: join(appConfigDir, "auth"),
      lockPath: join(authLockDir, "auth.lock"),
      root,
    };
  }
});
