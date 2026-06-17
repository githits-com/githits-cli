import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getAppConfigDir, getAuthLockDir } from "./app-config-paths.js";
import { AuthStorageImpl } from "./auth-storage.js";
import { FileSystemServiceImpl } from "./filesystem-service.js";
import { LockedAuthStorage } from "./locked-auth-storage.js";
import { createValidTokenData, withTestEnvVar } from "./test-helpers.js";

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
