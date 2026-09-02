import { afterEach, describe, expect, it, mock } from "bun:test";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { getAuthLockDir } from "./app-config-paths.js";
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

interface Deferred {
  promise: Promise<void>;
  resolve(): void;
}

function createDeferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

describe("LockedAuthStorage", () => {
  const baseUrl = "https://mcp.githits.com";
  const testProcessStartedAt = async (): Promise<string> =>
    "test-process-started-at";
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      tempDirs
        .splice(0)
        .map((dir) => rm(dir, { recursive: true, force: true })),
    );
  });

  it("keeps file-auth fixtures inside the test root", async () => {
    const { configDir, root } = await createStoragePaths();

    expect(configDir).toBe(join(root, "config", "auth"));
  });

  it("serializes conditional token saves across storage instances", async () => {
    const { fs, fsWithHome, configDir } = await createStoragePaths();
    const first = new LockedAuthStorage(
      new AuthStorageImpl(fs, configDir),
      fsWithHome,
      { getProcessStartedAt: testProcessStartedAt },
    );
    const second = new LockedAuthStorage(
      new AuthStorageImpl(fs, configDir),
      fsWithHome,
      { getProcessStartedAt: testProcessStartedAt },
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

  it("reuses the current process identity across lock acquisitions", async () => {
    const { fsWithHome } = await createStoragePaths();
    const getProcessStartedAt = mock(async (_pid: number) =>
      Promise.resolve("test-process-started-at"),
    );
    const storage = new LockedAuthStorage(createMockAuthStorage(), fsWithHome, {
      getProcessStartedAt,
    });

    await storage.saveTokens(baseUrl, createValidTokenData());
    await storage.clearTokens(baseUrl);

    expect(getProcessStartedAt).toHaveBeenCalledTimes(1);
    expect(getProcessStartedAt).toHaveBeenCalledWith(process.pid);
  });

  it("retries transient owner reads while releasing its lock", async () => {
    const { fs, fsWithHome, lockPath } = await createStoragePaths();
    const ownerPath = join(lockPath, "owner.json");
    const readFile = fsWithHome.readFile.bind(fsWithHome);
    let ownerReadCount = 0;
    fsWithHome.readFile = mock(async (path: string) => {
      if (path === ownerPath && ownerReadCount === 0) {
        ownerReadCount += 1;
        const error = new Error(
          "owner file is temporarily busy",
        ) as NodeJS.ErrnoException;
        error.code = "EPERM";
        throw error;
      }
      ownerReadCount += 1;
      return readFile(path);
    });
    const storage = new LockedAuthStorage(createMockAuthStorage(), fsWithHome, {
      getProcessStartedAt: testProcessStartedAt,
    });

    await storage.withAuthStorageLock(async () => undefined);

    expect(ownerReadCount).toBe(2);
    expect(await fs.exists(lockPath)).toBe(false);
  });

  it("retries transient owner deletion while releasing its lock", async () => {
    const { fs, fsWithHome, lockPath } = await createStoragePaths();
    const ownerPath = join(lockPath, "owner.json");
    const deleteFile = fsWithHome.deleteFile.bind(fsWithHome);
    let ownerDeleteCount = 0;
    fsWithHome.deleteFile = mock(async (path: string) => {
      if (path === ownerPath && ownerDeleteCount === 0) {
        ownerDeleteCount += 1;
        const error = new Error(
          "owner file is temporarily busy",
        ) as NodeJS.ErrnoException;
        error.code = "EPERM";
        throw error;
      }
      ownerDeleteCount += 1;
      await deleteFile(path);
    });
    const storage = new LockedAuthStorage(createMockAuthStorage(), fsWithHome, {
      getProcessStartedAt: testProcessStartedAt,
    });

    await storage.withAuthStorageLock(async () => undefined);

    expect(ownerDeleteCount).toBe(2);
    expect(await fs.exists(lockPath)).toBe(false);
  });

  it("lets a successor acquire while the previous release path is cleaning up", async () => {
    const { fs, fsWithHome, lockPath } = await createStoragePaths();
    const firstEntered = createDeferred();
    const releaseFirst = createDeferred();
    const secondObservedFirst = createDeferred();
    const secondEntered = createDeferred();
    const cleanupStarted = createDeferred();
    const continueCleanup = createDeferred();
    const renamePath = fsWithHome.rename.bind(fsWithHome);
    const deleteDirIfEmpty = fsWithHome.deleteDirIfEmpty.bind(fsWithHome);
    let firstReleasePath = "";
    const firstFs = Object.assign(Object.create(fsWithHome), {
      rename: mock(async (source: string, destination: string) => {
        if (source === lockPath) firstReleasePath = destination;
        await renamePath(source, destination);
      }),
      deleteDirIfEmpty: mock(async (path: string) => {
        if (firstReleasePath !== "" && path === firstReleasePath) {
          cleanupStarted.resolve();
          await continueCleanup.promise;
        }
        await deleteDirIfEmpty(path);
      }),
    }) as FileSystemServiceImpl;
    const first = new LockedAuthStorage(createMockAuthStorage(), firstFs, {
      lockTimeoutMs: 1_000,
      getProcessStartedAt: testProcessStartedAt,
    });
    const second = new LockedAuthStorage(createMockAuthStorage(), fsWithHome, {
      lockTimeoutMs: 1_000,
      getProcessStartedAt: testProcessStartedAt,
      isOwnerAlive: async () => {
        secondObservedFirst.resolve();
        return true;
      },
    });
    let activeCriticalSections = 0;
    let maxActiveCriticalSections = 0;
    let secondDidEnter = false;
    let firstDidComplete = false;

    const firstRun = first
      .withAuthStorageLock(async () => {
        activeCriticalSections += 1;
        maxActiveCriticalSections = Math.max(
          maxActiveCriticalSections,
          activeCriticalSections,
        );
        firstEntered.resolve();
        await releaseFirst.promise;
        activeCriticalSections -= 1;
      })
      .then(() => {
        firstDidComplete = true;
      });
    await firstEntered.promise;
    const firstOwnerId = (
      JSON.parse(await fs.readFile(join(lockPath, "owner.json"))) as {
        id: string;
      }
    ).id;
    const expectedReleasePath = join(
      dirname(lockPath),
      `auth.lock.release-${createHash("sha256").update(firstOwnerId).digest("hex")}`,
    );
    const secondRun = second.withAuthStorageLock(async () => {
      activeCriticalSections += 1;
      maxActiveCriticalSections = Math.max(
        maxActiveCriticalSections,
        activeCriticalSections,
      );
      secondDidEnter = true;
      secondEntered.resolve();
      activeCriticalSections -= 1;
    });

    try {
      await secondObservedFirst.promise;
      expect(secondDidEnter).toBe(false);

      releaseFirst.resolve();
      await cleanupStarted.promise;
      await secondEntered.promise;
      await secondRun;

      expect(firstReleasePath).toBe(expectedReleasePath);
      expect(firstDidComplete).toBe(false);
      expect(maxActiveCriticalSections).toBe(1);
    } finally {
      releaseFirst.resolve();
      continueCleanup.resolve();
    }

    await firstRun;
    expect(await fs.exists(lockPath)).toBe(false);
  });

  it("retains an ownerless directory when release rename fails", async () => {
    const { fs, fsWithHome, lockPath } = await createStoragePaths();
    const ownerPath = join(lockPath, "owner.json");
    const rename = mock(async () => {
      const error = new Error(
        "lock directory cannot be renamed",
      ) as NodeJS.ErrnoException;
      error.code = "EPERM";
      throw error;
    });
    fsWithHome.rename = rename;
    const storage = new LockedAuthStorage(createMockAuthStorage(), fsWithHome, {
      getProcessStartedAt: testProcessStartedAt,
    });

    await storage.withAuthStorageLock(async () => undefined);

    expect(rename).toHaveBeenCalledTimes(1);
    expect(await fs.exists(lockPath)).toBe(true);
    expect(await fs.exists(ownerPath)).toBe(false);
  });

  it("keeps a concurrent holder when another acquisition loses owner creation", async () => {
    const { fs, fsWithHome, lockPath } = await createStoragePaths();
    const ownerPath = join(lockPath, "owner.json");
    const firstOwnerWriteStarted = createDeferred();
    const continueFirstOwnerWrite = createDeferred();
    const holderEntered = createDeferred();
    const loserObservedHolder = createDeferred();
    const startNestedLock = createDeferred();
    const nestedLockFinished = createDeferred();
    const releaseHolder = createDeferred();
    const writeFileExclusive = fsWithHome.writeFileExclusive.bind(fsWithHome);
    let ownerWriteCount = 0;
    fsWithHome.writeFileExclusive = mock(
      async (path: string, contents: string, mode?: number) => {
        if (path === ownerPath) {
          ownerWriteCount += 1;
          if (ownerWriteCount === 1) {
            firstOwnerWriteStarted.resolve();
            await continueFirstOwnerWrite.promise;
          }
        }
        await writeFileExclusive(path, contents, mode);
      },
    );
    const storage = new LockedAuthStorage(createMockAuthStorage(), fsWithHome, {
      lockTimeoutMs: 1_000,
      getProcessStartedAt: testProcessStartedAt,
      isOwnerAlive: async () => {
        loserObservedHolder.resolve();
        return true;
      },
    });
    let firstEntered = false;
    let nestedLockError: unknown;

    const firstRun = storage.withAuthStorageLock(async () => {
      firstEntered = true;
    });
    await firstOwnerWriteStarted.promise;
    await fsWithHome.deleteDirIfEmpty(lockPath);
    const holderRun = storage.withAuthStorageLock(async () => {
      holderEntered.resolve();
      await startNestedLock.promise;
      try {
        await storage.withAuthStorageLock(async () => undefined);
      } catch (error) {
        nestedLockError = error;
      } finally {
        nestedLockFinished.resolve();
      }
      await releaseHolder.promise;
    });

    try {
      await holderEntered.promise;
      continueFirstOwnerWrite.resolve();
      await loserObservedHolder.promise;
      startNestedLock.resolve();
      await nestedLockFinished.promise;
    } finally {
      continueFirstOwnerWrite.resolve();
      startNestedLock.resolve();
      releaseHolder.resolve();
    }
    const runResults = await Promise.allSettled([firstRun, holderRun]);
    for (const result of runResults) {
      if (result.status === "rejected") throw result.reason;
    }

    expect(nestedLockError).toBeUndefined();
    expect(firstEntered).toBe(true);
    expect(ownerWriteCount).toBe(3);
    expect(await fs.exists(lockPath)).toBe(false);
  });

  it("releases only the owner acquired by an overlapping operation", async () => {
    const { fs, fsWithHome, lockPath } = await createStoragePaths();
    const ownerPath = join(lockPath, "owner.json");
    const firstEntered = createDeferred();
    const releaseFirst = createDeferred();
    const secondEntered = createDeferred();
    const startNestedLock = createDeferred();
    const nestedLockFinished = createDeferred();
    const releaseSecond = createDeferred();
    const storage = new LockedAuthStorage(createMockAuthStorage(), fsWithHome, {
      lockTimeoutMs: 1_000,
      getProcessStartedAt: testProcessStartedAt,
    });
    let nestedLockError: unknown;
    let coordinationError: unknown;
    let secondOwnerIdBefore = "";
    let secondOwnerIdAfter = "";

    const firstRun = storage.withAuthStorageLock(async () => {
      firstEntered.resolve();
      await releaseFirst.promise;
    });
    await firstEntered.promise;
    // Simulate a pre-upgrade peer removing a live lock so a second operation
    // can acquire on the same storage instance before the first one releases.
    await rm(lockPath, { recursive: true, force: true });
    const secondRun = storage.withAuthStorageLock(async () => {
      secondEntered.resolve();
      await startNestedLock.promise;
      try {
        await storage.withAuthStorageLock(async () => undefined);
      } catch (error) {
        nestedLockError = error;
      } finally {
        nestedLockFinished.resolve();
      }
      await releaseSecond.promise;
    });

    try {
      await secondEntered.promise;
      secondOwnerIdBefore = (
        JSON.parse(await fs.readFile(ownerPath)) as { id: string }
      ).id;
      releaseFirst.resolve();
      await firstRun;
      secondOwnerIdAfter = (
        JSON.parse(await fs.readFile(ownerPath)) as { id: string }
      ).id;
      startNestedLock.resolve();
      await nestedLockFinished.promise;
    } catch (error) {
      coordinationError = error;
    } finally {
      releaseFirst.resolve();
      startNestedLock.resolve();
      releaseSecond.resolve();
    }
    const runResults = await Promise.allSettled([firstRun, secondRun]);
    for (const result of runResults) {
      if (result.status === "rejected") throw result.reason;
    }
    if (coordinationError) throw coordinationError;

    expect(secondOwnerIdBefore).not.toBe("");
    expect(secondOwnerIdAfter).toBe(secondOwnerIdBefore);
    expect(nestedLockError).toBeUndefined();
    expect(await fs.exists(lockPath)).toBe(false);
  });

  it("retries an unavailable current process identity", async () => {
    const { fsWithHome } = await createStoragePaths();
    let lookupCount = 0;
    const getProcessStartedAt = mock(async (_pid: number) => {
      lookupCount += 1;
      return lookupCount === 1 ? null : "test-process-started-at";
    });
    const storage = new LockedAuthStorage(createMockAuthStorage(), fsWithHome, {
      getProcessStartedAt,
    });

    await storage.saveTokens(baseUrl, createValidTokenData());
    await storage.clearTokens(baseUrl);

    expect(getProcessStartedAt).toHaveBeenCalledTimes(2);
  });

  it("keeps a live owner lock when its process identity is unavailable", async () => {
    const { fs, fsWithHome, configDir, lockPath } = await createStoragePaths();
    await mkdir(lockPath, { recursive: true, mode: 0o700 });
    await writeFile(
      join(lockPath, "owner.json"),
      JSON.stringify({
        id: "live-owner",
        pid: process.pid,
        createdAt: new Date().toISOString(),
        processStartedAt: "recorded-start-time",
      }),
    );
    const storage = new LockedAuthStorage(
      new AuthStorageImpl(fs, configDir),
      fsWithHome,
      {
        getProcessStartedAt: async () => null,
        lockTimeoutMs: 100,
      },
    );

    await expect(
      storage.saveTokens(
        baseUrl,
        createValidTokenData({ accessToken: "must-not-save" }),
      ),
    ).rejects.toThrow("Timed out waiting for GitHits auth storage lock");
    expect(await fs.exists(lockPath)).toBe(true);
  });

  it("keeps a live owner lock when its process identity lookup fails", async () => {
    const liveOwner = spawn(
      process.execPath,
      ["-e", "setInterval(() => {}, 1_000)"],
      { stdio: "ignore" },
    );
    await once(liveOwner, "spawn");
    const liveOwnerPid = liveOwner.pid;
    if (!liveOwnerPid) throw new Error("Failed to start live owner process");

    try {
      const { fs, fsWithHome, configDir, lockPath } =
        await createStoragePaths();
      await mkdir(lockPath, { recursive: true, mode: 0o700 });
      await writeFile(
        join(lockPath, "owner.json"),
        JSON.stringify({
          id: "live-owner",
          pid: liveOwnerPid,
          createdAt: new Date().toISOString(),
          processStartedAt: "recorded-start-time",
        }),
      );
      const storage = new LockedAuthStorage(
        new AuthStorageImpl(fs, configDir),
        fsWithHome,
        {
          getProcessStartedAt: async (pid) => {
            if (pid === process.pid) return "contender-start-time";
            throw new Error("process identity lookup failed");
          },
          lockTimeoutMs: 100,
        },
      );

      await expect(
        storage.saveTokens(
          baseUrl,
          createValidTokenData({ accessToken: "must-not-save" }),
        ),
      ).rejects.toThrow("Timed out waiting for GitHits auth storage lock");
      expect(await fs.exists(lockPath)).toBe(true);
    } finally {
      if (liveOwner.exitCode === null) {
        const exited = once(liveOwner, "exit");
        liveOwner.kill();
        await exited;
      }
    }
  });

  it("reclaims a live PID whose start time does not match the owner", async () => {
    const { fs, fsWithHome, configDir, lockPath } = await createStoragePaths();
    await mkdir(lockPath, { recursive: true, mode: 0o700 });
    await writeFile(
      join(lockPath, "owner.json"),
      JSON.stringify({
        id: "stale-owner",
        pid: process.pid,
        createdAt: new Date().toISOString(),
        processStartedAt: "previous-process-start-time",
      }),
    );
    const storage = new LockedAuthStorage(
      new AuthStorageImpl(fs, configDir),
      fsWithHome,
      {
        getProcessStartedAt: async () => "current-process-start-time",
        lockTimeoutMs: 5_000,
      },
    );
    const token = createValidTokenData({ accessToken: "fresh" });

    await storage.saveTokens(baseUrl, token);

    expect(await storage.loadTokens(baseUrl)).toEqual(token);
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
    const first = new LockedAuthStorage(firstInner, fsWithHome, {
      getProcessStartedAt: testProcessStartedAt,
    });
    const second = new LockedAuthStorage(secondInner, fsWithHome, {
      getProcessStartedAt: testProcessStartedAt,
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
    const first = new LockedAuthStorage(firstInner, fsWithHome, {
      getProcessStartedAt: testProcessStartedAt,
    });
    const second = new LockedAuthStorage(secondInner, fsWithHome, {
      getProcessStartedAt: testProcessStartedAt,
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
    const storage = new LockedAuthStorage(inner, fsWithHome, {
      getProcessStartedAt: testProcessStartedAt,
    });
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
      getProcessStartedAt: testProcessStartedAt,
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
      {
        lockTimeoutMs: 100,
        getProcessStartedAt: testProcessStartedAt,
      },
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
        new LockedAuthStorage(new AuthStorageImpl(fs, configDir), fsWithHome, {
          getProcessStartedAt: testProcessStartedAt,
        }),
    );
    const second = await withTestEnvVar(
      "XDG_CONFIG_HOME",
      join(root, "xdg-b"),
      () =>
        new LockedAuthStorage(new AuthStorageImpl(fs, configDir), fsWithHome, {
          getProcessStartedAt: testProcessStartedAt,
        }),
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
      {
        lockTimeoutMs: 100,
        getProcessStartedAt: testProcessStartedAt,
        isOwnerAlive: async () => false,
      },
    );
    const token = createValidTokenData({ accessToken: "fresh" });

    await storage.saveTokens(baseUrl, token);

    expect(await storage.loadTokens(baseUrl)).toEqual(token);
  });

  it("serializes concurrent reclaimers for the same dead owner", async () => {
    const { fs, fsWithHome, configDir, lockPath } = await createStoragePaths();
    const ownerPath = join(lockPath, "owner.json");
    const deadOwnerPid = 999_999_999;
    await mkdir(lockPath, { recursive: true, mode: 0o700 });
    await writeFile(
      ownerPath,
      JSON.stringify({
        id: "../../dead-owner",
        pid: deadOwnerPid,
        createdAt: new Date().toISOString(),
        processStartedAt: null,
      }),
    );

    const deletionStarted = createDeferred();
    const continueDeletion = createDeferred();
    const secondOwnerChecked = createDeferred();
    const deleteFile = fsWithHome.deleteFile.bind(fsWithHome);
    let pauseFirstOwnerDelete = true;
    const firstFs = Object.assign(Object.create(fsWithHome), {
      deleteFile: mock(async (path: string) => {
        if (path === ownerPath && pauseFirstOwnerDelete) {
          pauseFirstOwnerDelete = false;
          deletionStarted.resolve();
          await continueDeletion.promise;
        }
        await deleteFile(path);
      }),
    }) as FileSystemServiceImpl;
    let secondOwnerDeleteCount = 0;
    const secondFs = Object.assign(Object.create(fsWithHome), {
      deleteFile: mock(async (path: string) => {
        if (path === ownerPath) secondOwnerDeleteCount += 1;
        await deleteFile(path);
      }),
    }) as FileSystemServiceImpl;
    const first = new LockedAuthStorage(
      new AuthStorageImpl(fs, configDir),
      firstFs,
      {
        lockTimeoutMs: 2_000,
        getProcessStartedAt: testProcessStartedAt,
        isOwnerAlive: async (pid) => pid !== deadOwnerPid,
      },
    );
    const second = new LockedAuthStorage(
      new AuthStorageImpl(fs, configDir),
      secondFs,
      {
        lockTimeoutMs: 100,
        getProcessStartedAt: testProcessStartedAt,
        isOwnerAlive: async (pid) => {
          if (pid === deadOwnerPid) secondOwnerChecked.resolve();
          return pid !== deadOwnerPid;
        },
      },
    );
    let active = 0;
    let maxActive = 0;
    const runLocked = async (storage: LockedAuthStorage): Promise<void> => {
      await storage.withAuthStorageLock(async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 25));
        active -= 1;
      });
    };

    const firstRun = runLocked(first);
    await deletionStarted.promise;
    const secondRun = runLocked(second);
    await secondOwnerChecked.promise;
    await expect(secondRun).rejects.toThrow(
      "Timed out waiting for GitHits auth storage lock",
    );

    const claimFiles = (await fs.readdir(lockPath)).filter((entry) =>
      entry.startsWith("reclaim-"),
    );
    expect(claimFiles).toHaveLength(1);
    expect(claimFiles[0]).toMatch(/^reclaim-[0-9a-f]{64}$/);
    expect(secondOwnerDeleteCount).toBe(0);

    continueDeletion.resolve();
    await firstRun;
    await runLocked(second);

    expect(maxActive).toBe(1);
  });

  it("retries transient reclaim-claim deletion", async () => {
    const { fs, fsWithHome, configDir, lockPath } = await createStoragePaths();
    const deadOwnerId = "dead-owner";
    const ownerPath = join(lockPath, "owner.json");
    const claimPath = join(
      lockPath,
      `reclaim-${createHash("sha256").update(deadOwnerId).digest("hex")}`,
    );
    await mkdir(lockPath, { recursive: true, mode: 0o700 });
    await writeFile(
      ownerPath,
      JSON.stringify({
        id: deadOwnerId,
        pid: 999_999_999,
        createdAt: new Date().toISOString(),
        processStartedAt: null,
      }),
    );
    const deleteFile = fsWithHome.deleteFile.bind(fsWithHome);
    let claimDeleteCount = 0;
    fsWithHome.deleteFile = mock(async (path: string) => {
      if (path === claimPath) {
        claimDeleteCount += 1;
        if (claimDeleteCount === 1) {
          const error = new Error(
            "claim file is temporarily busy",
          ) as NodeJS.ErrnoException;
          error.code = "EPERM";
          throw error;
        }
      }
      await deleteFile(path);
    });
    const storage = new LockedAuthStorage(
      new AuthStorageImpl(fs, configDir),
      fsWithHome,
      {
        lockTimeoutMs: 1_000,
        getProcessStartedAt: testProcessStartedAt,
        isOwnerAlive: async () => false,
      },
    );
    const token = createValidTokenData({ accessToken: "fresh" });

    await storage.saveTokens(baseUrl, token);

    expect(claimDeleteCount).toBe(2);
    expect(await storage.loadTokens(baseUrl)).toEqual(token);
  });

  it("keeps a successor lock when a delayed dead-owner reclaimer resumes", async () => {
    const { fs, fsWithHome, configDir, lockPath } = await createStoragePaths();
    const ownerPath = join(lockPath, "owner.json");
    const deadOwnerId = "dead-owner";
    const deadOwnerPid = 999_999_999;
    await mkdir(lockPath, { recursive: true, mode: 0o700 });
    await writeFile(
      ownerPath,
      JSON.stringify({
        id: deadOwnerId,
        pid: deadOwnerPid,
        createdAt: new Date().toISOString(),
        processStartedAt: null,
      }),
    );

    const delayedOwnerCheckStarted = createDeferred();
    const continueDelayedOwnerCheck = createDeferred();
    const delayedCleanupFinished = createDeferred();
    const successorEntered = createDeferred();
    const releaseSuccessor = createDeferred();
    const deleteFile = fsWithHome.deleteFile.bind(fsWithHome);
    const deleteDirIfEmpty = fsWithHome.deleteDirIfEmpty.bind(fsWithHome);
    let delayedOwnerDeleteCount = 0;
    const delayedFs = Object.assign(Object.create(fsWithHome), {
      deleteFile: mock(async (path: string) => {
        if (path === ownerPath) delayedOwnerDeleteCount += 1;
        await deleteFile(path);
      }),
      deleteDirIfEmpty: mock(async (path: string) => {
        await deleteDirIfEmpty(path);
        delayedCleanupFinished.resolve();
      }),
    }) as FileSystemServiceImpl;
    const delayed = new LockedAuthStorage(
      new AuthStorageImpl(fs, configDir),
      delayedFs,
      {
        lockTimeoutMs: 2_000,
        getProcessStartedAt: testProcessStartedAt,
        isOwnerAlive: async (pid) => {
          if (pid !== deadOwnerPid) return true;
          delayedOwnerCheckStarted.resolve();
          await continueDelayedOwnerCheck.promise;
          return false;
        },
      },
    );
    const winner = new LockedAuthStorage(
      new AuthStorageImpl(fs, configDir),
      fsWithHome,
      {
        lockTimeoutMs: 2_000,
        getProcessStartedAt: testProcessStartedAt,
        isOwnerAlive: async (pid) => pid !== deadOwnerPid,
      },
    );
    let active = 0;
    let maxActive = 0;

    const delayedRun = delayed.withAuthStorageLock(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      active -= 1;
    });
    await delayedOwnerCheckStarted.promise;
    const winnerRun = winner.withAuthStorageLock(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      successorEntered.resolve();
      await releaseSuccessor.promise;
      active -= 1;
    });
    await successorEntered.promise;

    continueDelayedOwnerCheck.resolve();
    await delayedCleanupFinished.promise;

    const successorOwner = JSON.parse(await fs.readFile(ownerPath)) as {
      id: string;
    };
    expect(successorOwner.id).not.toBe(deadOwnerId);
    expect(delayedOwnerDeleteCount).toBe(0);

    releaseSuccessor.resolve();
    await Promise.all([delayedRun, winnerRun]);

    expect(maxActive).toBe(1);
  });

  it("retains a stale owner when its reclaim claim already exists", async () => {
    const { fs, fsWithHome, configDir, lockPath } = await createStoragePaths();
    const deadOwnerId = "dead-owner";
    const ownerPath = join(lockPath, "owner.json");
    const claimPath = join(
      lockPath,
      `reclaim-${createHash("sha256").update(deadOwnerId).digest("hex")}`,
    );
    await mkdir(lockPath, { recursive: true, mode: 0o700 });
    await writeFile(
      ownerPath,
      JSON.stringify({
        id: deadOwnerId,
        pid: 999_999_999,
        createdAt: new Date().toISOString(),
        processStartedAt: null,
      }),
    );
    await writeFile(claimPath, "");
    const storage = new LockedAuthStorage(
      new AuthStorageImpl(fs, configDir),
      fsWithHome,
      {
        lockTimeoutMs: 100,
        getProcessStartedAt: testProcessStartedAt,
        isOwnerAlive: async () => false,
      },
    );

    await expect(
      storage.saveTokens(
        baseUrl,
        createValidTokenData({ accessToken: "must-not-save" }),
      ),
    ).rejects.toThrow("Timed out waiting for GitHits auth storage lock");
    expect(await fs.exists(ownerPath)).toBe(true);
    expect(await fs.exists(claimPath)).toBe(true);
  });

  it("reclaims an old lock directory whose owner file is missing", async () => {
    const { fs, fsWithHome, configDir, lockPath } = await createStoragePaths();
    await mkdir(lockPath, { recursive: true, mode: 0o700 });
    const staleAt = new Date(Date.now() - 10_000);
    await utimes(lockPath, staleAt, staleAt);
    const storage = new LockedAuthStorage(
      new AuthStorageImpl(fs, configDir),
      fsWithHome,
      {
        lockTimeoutMs: 100,
        getProcessStartedAt: testProcessStartedAt,
      },
    );
    const token = createValidTokenData({ accessToken: "fresh" });

    await storage.saveTokens(baseUrl, token);

    expect(await storage.loadTokens(baseUrl)).toEqual(token);
  });

  it("reclaims old ownerless directories containing only claim files", async () => {
    const { fs, fsWithHome, configDir, lockPath } = await createStoragePaths();
    const claimPath = join(
      lockPath,
      `reclaim-${createHash("sha256").update("abandoned").digest("hex")}`,
    );
    await mkdir(lockPath, { recursive: true, mode: 0o700 });
    await writeFile(claimPath, "");
    const staleAt = new Date(Date.now() - 10_000);
    await utimes(lockPath, staleAt, staleAt);
    const storage = new LockedAuthStorage(
      new AuthStorageImpl(fs, configDir),
      fsWithHome,
      {
        lockTimeoutMs: 1_000,
        getProcessStartedAt: testProcessStartedAt,
      },
    );
    const token = createValidTokenData({ accessToken: "fresh" });

    await storage.saveTokens(baseUrl, token);

    expect(await fs.exists(claimPath)).toBe(false);
    expect(await storage.loadTokens(baseUrl)).toEqual(token);
  });

  it("keeps old ownerless directories containing unknown entries", async () => {
    const { fs, fsWithHome, configDir, lockPath } = await createStoragePaths();
    const unknownPath = join(lockPath, "reclaim-not-a-valid-owner-hash");
    await mkdir(lockPath, { recursive: true, mode: 0o700 });
    await writeFile(unknownPath, "");
    const staleAt = new Date(Date.now() - 10_000);
    await utimes(lockPath, staleAt, staleAt);
    const storage = new LockedAuthStorage(
      new AuthStorageImpl(fs, configDir),
      fsWithHome,
      {
        lockTimeoutMs: 100,
        getProcessStartedAt: testProcessStartedAt,
      },
    );

    await expect(
      storage.saveTokens(
        baseUrl,
        createValidTokenData({ accessToken: "must-not-save" }),
      ),
    ).rejects.toThrow("Timed out waiting for GitHits auth storage lock");
    expect(await fs.exists(unknownPath)).toBe(true);
  });

  it("keeps an old ownerless lock when an owner appears before deletion", async () => {
    const { fs, fsWithHome, configDir, lockPath } = await createStoragePaths();
    await mkdir(lockPath, { recursive: true, mode: 0o700 });
    const staleAt = new Date(Date.now() - 10_000);
    await utimes(lockPath, staleAt, staleAt);
    const deleteEmptyDir = fsWithHome.deleteDirIfEmpty.bind(fsWithHome);
    fsWithHome.deleteDirIfEmpty = mock(async (path: string) => {
      await writeFile(
        join(lockPath, "owner.json"),
        JSON.stringify({
          id: "new-live-owner",
          pid: process.pid,
          createdAt: new Date().toISOString(),
          processStartedAt: "test-start-time",
        }),
      );
      await deleteEmptyDir(path);
    });
    const storage = new LockedAuthStorage(
      new AuthStorageImpl(fs, configDir),
      fsWithHome,
      {
        lockTimeoutMs: 100,
        getProcessStartedAt: testProcessStartedAt,
      },
    );

    await expect(
      storage.saveTokens(
        baseUrl,
        createValidTokenData({ accessToken: "must-not-save" }),
      ),
    ).rejects.toThrow("Timed out waiting for GitHits auth storage lock");
    expect(fsWithHome.deleteDirIfEmpty).toHaveBeenCalledTimes(1);
    expect(await fs.exists(join(lockPath, "owner.json"))).toBe(true);
  });

  it("keeps an old ownerless lock when empty-directory removal fails", async () => {
    const { fs, fsWithHome, configDir, lockPath } = await createStoragePaths();
    await mkdir(lockPath, { recursive: true, mode: 0o700 });
    const staleAt = new Date(Date.now() - 10_000);
    await utimes(lockPath, staleAt, staleAt);
    fsWithHome.deleteDirIfEmpty = mock(async () => {
      const error = new Error(
        "lock directory is busy",
      ) as NodeJS.ErrnoException;
      error.code = "EPERM";
      throw error;
    });
    const storage = new LockedAuthStorage(
      new AuthStorageImpl(fs, configDir),
      fsWithHome,
      {
        lockTimeoutMs: 100,
        getProcessStartedAt: testProcessStartedAt,
      },
    );

    await expect(
      storage.saveTokens(
        baseUrl,
        createValidTokenData({ accessToken: "must-not-save" }),
      ),
    ).rejects.toThrow("Timed out waiting for GitHits auth storage lock");
    expect(fsWithHome.deleteDirIfEmpty).toHaveBeenCalledTimes(1);
    expect(await fs.exists(lockPath)).toBe(true);
  });

  it("keeps an old live lock when its owner file is temporarily unreadable", async () => {
    const { fs, fsWithHome, configDir, lockPath } = await createStoragePaths();
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
    const staleAt = new Date(Date.now() - 10_000);
    await utimes(lockPath, staleAt, staleAt);
    fsWithHome.readFile = mock(async () => {
      const error = new Error("owner file is busy") as NodeJS.ErrnoException;
      error.code = "EPERM";
      throw error;
    });
    const isOwnerAlive = mock(async () => true);
    const storage = new LockedAuthStorage(
      new AuthStorageImpl(fs, configDir),
      fsWithHome,
      {
        isOwnerAlive,
        lockTimeoutMs: 100,
        getProcessStartedAt: testProcessStartedAt,
      },
    );

    await expect(
      storage.saveTokens(
        baseUrl,
        createValidTokenData({ accessToken: "must-not-save" }),
      ),
    ).rejects.toThrow("Timed out waiting for GitHits auth storage lock");
    expect(isOwnerAlive).not.toHaveBeenCalled();
    expect(await fs.exists(lockPath)).toBe(true);
  });

  it("keeps old locks whose owner metadata contains an invalid PID", async () => {
    for (const invalidPid of [1.5, 2_147_483_648]) {
      const { fs, fsWithHome, configDir, lockPath } =
        await createStoragePaths();
      await mkdir(lockPath, { recursive: true, mode: 0o700 });
      await writeFile(
        join(lockPath, "owner.json"),
        JSON.stringify({
          id: "invalid-owner",
          pid: invalidPid,
          createdAt: new Date().toISOString(),
          processStartedAt: null,
        }),
      );
      const staleAt = new Date(Date.now() - 10_000);
      await utimes(lockPath, staleAt, staleAt);
      fsWithHome.deleteDirIfEmpty = mock(async () => undefined);
      const isOwnerAlive = mock(async () => true);
      const storage = new LockedAuthStorage(
        new AuthStorageImpl(fs, configDir),
        fsWithHome,
        {
          isOwnerAlive,
          lockTimeoutMs: 100,
          getProcessStartedAt: testProcessStartedAt,
        },
      );

      await expect(
        storage.saveTokens(
          baseUrl,
          createValidTokenData({ accessToken: "must-not-save" }),
        ),
      ).rejects.toThrow("Timed out waiting for GitHits auth storage lock");
      expect(isOwnerAlive).not.toHaveBeenCalled();
      expect(fsWithHome.deleteDirIfEmpty).not.toHaveBeenCalled();
      expect(await fs.exists(lockPath)).toBe(true);
    }
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
    const isOwnerAlive = mock(async () => true);
    const storage = new LockedAuthStorage(
      new AuthStorageImpl(fs, configDir),
      fsWithHome,
      {
        isOwnerAlive,
        lockTimeoutMs: 100,
        getProcessStartedAt: testProcessStartedAt,
      },
    );

    await expect(
      storage.saveTokens(
        baseUrl,
        createValidTokenData({ accessToken: "fresh" }),
      ),
    ).rejects.toThrow("Timed out waiting for GitHits auth storage lock");
    expect(isOwnerAlive).toHaveBeenCalledTimes(1);
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
    const authLockDir = getAuthLockDir(fsWithHome);
    return {
      fs,
      fsWithHome,
      configDir: join(root, "config", "auth"),
      lockPath: join(authLockDir, "auth.lock"),
      root,
    };
  }
});
