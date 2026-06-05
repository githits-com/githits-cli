import { AsyncLocalStorage } from "node:async_hooks";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { promisify } from "node:util";
import { DEFAULT_FETCH_TIMEOUT_MS } from "@githits/core-internal";
import { getAppConfigDir } from "./app-config-paths.js";
import type {
  AuthStorage,
  ClientRegistration,
  TokenData,
} from "./auth-storage.js";
import type { FileSystemService } from "./filesystem-service.js";

const LOCK_DIR = "auth.lock";
const LOCK_TIMEOUT_MS = DEFAULT_FETCH_TIMEOUT_MS * 2 + 10_000;
const LOCK_RETRY_MS = 25;
const ORPHANED_LOCK_MS = 5_000;
const OWNER_FILE = "owner.json";
const execFileAsync = promisify(execFile);

interface LockOwner {
  id: string;
  pid: number;
  createdAt: string;
  processStartedAt: string | null;
}

export class AuthStorageLockTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthStorageLockTimeoutError";
  }
}

export interface AuthStorageLockProvider {
  withAuthStorageLock<T>(fn: () => Promise<T>): Promise<T>;
}

export type LockingAuthStorage = AuthStorage & AuthStorageLockProvider;

export function withAuthStorageLock<T>(
  storage: LockingAuthStorage,
  fn: () => Promise<T>,
): Promise<T> {
  return storage.withAuthStorageLock(fn);
}

export class LockedAuthStorage implements AuthStorage, AuthStorageLockProvider {
  private readonly lockPath: string;
  private readonly lockTimeoutMs: number;
  private readonly isOwnerAlive: (
    pid: number,
    processStartedAt: string | null,
  ) => Promise<boolean>;
  private readonly lockContext = new AsyncLocalStorage<string>();
  private currentOwner: LockOwner | null = null;

  constructor(
    private readonly storage: AuthStorage,
    fileSystemService: FileSystemService,
    options: {
      lockTimeoutMs?: number;
      isOwnerAlive?: (
        pid: number,
        processStartedAt: string | null,
      ) => Promise<boolean>;
    } = {},
  ) {
    this.lockTimeoutMs = options.lockTimeoutMs ?? LOCK_TIMEOUT_MS;
    this.isOwnerAlive = options.isOwnerAlive ?? isOriginalProcessAlive;
    this.lockPath = fileSystemService.joinPath(
      getAppConfigDir(fileSystemService),
      LOCK_DIR,
    );
  }

  loadTokens(baseUrl: string): Promise<TokenData | null> {
    return this.storage.loadTokens(baseUrl);
  }

  saveTokens(baseUrl: string, data: TokenData): Promise<void> {
    return this.withAuthStorageLock(() =>
      this.storage.saveTokens(baseUrl, data),
    );
  }

  saveTokensIfUnchanged(
    baseUrl: string,
    expected: TokenData | null,
    data: TokenData,
  ): Promise<boolean> {
    return this.withAuthStorageLock(() =>
      this.storage.saveTokensIfUnchanged(baseUrl, expected, data),
    );
  }

  clearTokens(baseUrl: string): Promise<void> {
    return this.withAuthStorageLock(() => this.storage.clearTokens(baseUrl));
  }

  clearTokensIfUnchanged(
    baseUrl: string,
    expected: TokenData | null,
  ): Promise<boolean> {
    return this.withAuthStorageLock(() =>
      this.storage.clearTokensIfUnchanged(baseUrl, expected),
    );
  }

  loadClient(baseUrl: string): Promise<ClientRegistration | null> {
    return this.storage.loadClient(baseUrl);
  }

  saveClient(baseUrl: string, data: ClientRegistration): Promise<void> {
    return this.withAuthStorageLock(() =>
      this.storage.saveClient(baseUrl, data),
    );
  }

  clearClient(baseUrl: string): Promise<void> {
    return this.withAuthStorageLock(() => this.storage.clearClient(baseUrl));
  }

  saveAuthSession(
    baseUrl: string,
    client: ClientRegistration,
    tokens: TokenData,
  ): Promise<void> {
    return this.withAuthStorageLock(() =>
      this.storage.saveAuthSession(baseUrl, client, tokens),
    );
  }

  clearAuthSession(baseUrl: string): Promise<void> {
    return this.withAuthStorageLock(() =>
      this.storage.clearAuthSession(baseUrl),
    );
  }

  getStorageLocation(): string {
    return this.storage.getStorageLocation();
  }

  async withAuthStorageLock<T>(fn: () => Promise<T>): Promise<T> {
    const ownerId = this.lockContext.getStore();
    if (ownerId && this.currentOwner?.id === ownerId) {
      return fn();
    }

    await this.acquireLock();
    const acquiredOwnerId = this.currentOwner?.id;
    try {
      return await this.lockContext.run(acquiredOwnerId ?? "", fn);
    } finally {
      await this.releaseLock();
    }
  }

  private async acquireLock(): Promise<void> {
    const processStartedAt = await getProcessStartedAt(process.pid);
    const startedAt = Date.now();
    await mkdir(dirname(this.lockPath), { recursive: true, mode: 0o700 });
    while (true) {
      try {
        await mkdir(this.lockPath, { recursive: false, mode: 0o700 });
        try {
          await this.writeOwner(processStartedAt);
        } catch (error) {
          this.currentOwner = null;
          if ((error as NodeJS.ErrnoException).code === "EEXIST") {
            await sleep(LOCK_RETRY_MS);
            continue;
          }
          await rm(this.lockPath, { recursive: true, force: true }).catch(
            () => undefined,
          );
          throw error;
        }
        return;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        await this.reclaimStaleLock();
        if (Date.now() - startedAt >= this.lockTimeoutMs) {
          throw new AuthStorageLockTimeoutError(
            `Timed out waiting for GitHits auth storage lock at ${this.lockPath}. If no githits process is running, remove this directory and retry.`,
          );
        }
        await sleep(LOCK_RETRY_MS);
      }
    }
  }

  private async writeOwner(processStartedAt: string | null): Promise<void> {
    const owner: LockOwner = {
      id: randomUUID(),
      pid: process.pid,
      createdAt: new Date().toISOString(),
      processStartedAt,
    };
    await writeFile(this.ownerPath(), JSON.stringify(owner), {
      mode: 0o600,
      flag: "wx",
    });
    this.currentOwner = owner;
  }

  private async reclaimStaleLock(): Promise<void> {
    const owner = await this.readOwner();
    if (!owner) {
      await this.reclaimOldOwnerlessLock();
      return;
    }
    const ownerDead = !(await this.isOwnerAlive(
      owner.pid,
      owner.processStartedAt,
    ));
    if (!ownerDead) return;

    const currentOwner = await this.readOwner();
    if (!currentOwner || currentOwner.id !== owner.id) return;

    await rm(this.lockPath, { recursive: true, force: true }).catch(
      () => undefined,
    );
  }

  private async reclaimOldOwnerlessLock(): Promise<void> {
    const createdAtMs = await lockCreatedAtMs(this.lockPath);
    if (Date.now() - createdAtMs < ORPHANED_LOCK_MS) return;
    await rm(this.lockPath, { recursive: true, force: true }).catch(
      () => undefined,
    );
  }

  private async readOwner(): Promise<LockOwner | null> {
    try {
      const raw = await readFile(this.ownerPath(), "utf8");
      const parsed = JSON.parse(raw) as Partial<LockOwner>;
      if (
        typeof parsed.id !== "string" ||
        typeof parsed.pid !== "number" ||
        typeof parsed.createdAt !== "string" ||
        !(
          typeof parsed.processStartedAt === "string" ||
          parsed.processStartedAt === null
        )
      ) {
        return null;
      }
      return {
        id: parsed.id,
        pid: parsed.pid,
        createdAt: parsed.createdAt,
        processStartedAt: parsed.processStartedAt,
      };
    } catch {
      return null;
    }
  }

  private async releaseLock(): Promise<void> {
    const owner = this.currentOwner;
    this.currentOwner = null;
    if (!owner) return;
    const currentOwner = await this.readOwner();
    if (!currentOwner || currentOwner.id !== owner.id) return;
    await rm(this.lockPath, { recursive: true, force: true }).catch(
      () => undefined,
    );
  }

  private ownerPath(): string {
    return `${this.lockPath}/${OWNER_FILE}`;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function isOriginalProcessAlive(
  pid: number,
  processStartedAt: string | null,
): Promise<boolean> {
  if (!isProcessAlive(pid)) return false;
  if (!processStartedAt) return true;
  return (await getProcessStartedAt(pid)) === processStartedAt;
}

function isProcessAlive(pid: number): boolean {
  if (pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === "EPERM";
  }
}

export async function getProcessStartedAtForTesting(
  pid: number,
): Promise<string | null> {
  return getProcessStartedAt(pid);
}

async function getProcessStartedAt(pid: number): Promise<string | null> {
  try {
    if (process.platform === "win32") {
      const { stdout } = await execFileAsync("powershell.exe", [
        "-NoProfile",
        "-Command",
        `(Get-Process -Id ${pid}).StartTime.ToUniversalTime().ToString('o')`,
      ]);
      return stdout.trim() || null;
    }
    const { stdout } = await execFileAsync("ps", [
      "-p",
      String(pid),
      "-o",
      "lstart=",
    ]);
    const parsed = Date.parse(stdout.trim());
    return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
  } catch {
    return null;
  }
}

async function lockCreatedAtMs(path: string): Promise<number> {
  try {
    const { stat } = await import("node:fs/promises");
    return (await stat(path)).mtimeMs;
  } catch {
    return 0;
  }
}
