import { AsyncLocalStorage } from "node:async_hooks";
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { promisify } from "node:util";
import { DEFAULT_FETCH_TIMEOUT_MS } from "@githits/core-internal";
import { getAuthLockDir } from "./app-config-paths.js";
import type {
  AuthStorage,
  ClientRegistration,
  TokenData,
} from "./auth-storage.js";
import type { FileSystemService } from "./filesystem-service.js";

const LOCK_DIR = "auth.lock";
const LOCK_TIMEOUT_MS = DEFAULT_FETCH_TIMEOUT_MS * 2 + 10_000;
const LOCK_RETRY_MS = 25;
const LOCK_OWNER_RECHECK_MS = 1_000;
const ORPHANED_LOCK_MS = 5_000;
const OWNER_FILE = "owner.json";
const RECLAIM_FILE_PREFIX = "reclaim-";
const MAX_NODE_PROCESS_ID = 0x7fffffff;
const PROCESS_IDENTITY_LOOKUP_TIMEOUT_MS = 5_000;
const RELEASE_OWNER_READ_ATTEMPTS = 3;
const execFileAsync = promisify(execFile);

interface LockOwner {
  id: string;
  pid: number;
  createdAt: string;
  processStartedAt: string | null;
}

interface PresentLockOwner {
  state: "present";
  owner: LockOwner;
}

interface MissingLockOwner {
  state: "missing";
}

interface UnknownLockOwner {
  state: "unknown";
}

type LockOwnerReadResult =
  | PresentLockOwner
  | MissingLockOwner
  | UnknownLockOwner;

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
  private readonly processStartedAtLookup: (
    pid: number,
  ) => Promise<string | null>;
  private currentProcessStartedAtPromise: Promise<string | null> | undefined;
  private readonly lockContext = new AsyncLocalStorage<string>();
  private currentOwner: LockOwner | null = null;
  private readonly lockLoads: boolean;

  constructor(
    private readonly storage: AuthStorage,
    private readonly fileSystemService: FileSystemService,
    options: {
      lockTimeoutMs?: number;
      isOwnerAlive?: (
        pid: number,
        processStartedAt: string | null,
      ) => Promise<boolean>;
      getProcessStartedAt?: (pid: number) => Promise<string | null>;
    } = {},
  ) {
    this.lockTimeoutMs = options.lockTimeoutMs ?? LOCK_TIMEOUT_MS;
    this.processStartedAtLookup =
      options.getProcessStartedAt ?? getProcessStartedAt;
    this.isOwnerAlive =
      options.isOwnerAlive ??
      ((pid, processStartedAt) =>
        isOriginalProcessAlive(
          pid,
          processStartedAt,
          pid === process.pid
            ? () => this.getCurrentProcessStartedAt()
            : this.processStartedAtLookup,
        ));
    this.lockLoads = storage.requiresLoadLock === true;
    this.lockPath = fileSystemService.joinPath(
      getAuthLockDir(fileSystemService),
      LOCK_DIR,
    );
  }

  loadTokens(baseUrl: string): Promise<TokenData | null> {
    return this.lockLoads
      ? this.withAuthStorageLock(() => this.storage.loadTokens(baseUrl))
      : this.storage.loadTokens(baseUrl);
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

  clearActiveTokensIfUnchanged(
    baseUrl: string,
    expected: TokenData | null,
  ): Promise<boolean> {
    return this.withAuthStorageLock(() =>
      this.storage.clearActiveTokensIfUnchanged(baseUrl, expected),
    );
  }

  loadClient(baseUrl: string): Promise<ClientRegistration | null> {
    return this.lockLoads
      ? this.withAuthStorageLock(() => this.storage.loadClient(baseUrl))
      : this.storage.loadClient(baseUrl);
  }

  saveClient(baseUrl: string, data: ClientRegistration): Promise<void> {
    return this.withAuthStorageLock(() =>
      this.storage.saveClient(baseUrl, data),
    );
  }

  clearClient(baseUrl: string): Promise<void> {
    return this.withAuthStorageLock(() => this.storage.clearClient(baseUrl));
  }

  clearActiveClient(baseUrl: string): Promise<void> {
    return this.withAuthStorageLock(() =>
      this.storage.clearActiveClient(baseUrl),
    );
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
    const processStartedAt = await this.getCurrentProcessStartedAt();
    const startedAt = Date.now();
    let nextOwnerCheckAt = 0;
    await mkdir(dirname(this.lockPath), { recursive: true, mode: 0o700 });
    while (true) {
      try {
        await mkdir(this.lockPath, { recursive: false, mode: 0o700 });
        try {
          await this.writeOwner(processStartedAt);
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          if (code === "EEXIST" || code === "ENOENT") {
            // Another contender may have removed the lock directory between
            // mkdir() and owner.json creation. Treat it as a lost race.
            if (Date.now() - startedAt >= this.lockTimeoutMs) {
              throw this.createLockTimeoutError();
            }
            await sleep(LOCK_RETRY_MS);
            continue;
          }
          // An unexpected write result is not proof that this path is still
          // our empty directory. Never recursively remove a possible
          // successor lock while propagating the original failure.
          await this.fileSystemService
            .deleteDirIfEmpty(this.lockPath)
            .catch(() => undefined);
          throw error;
        }
        return;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        const now = Date.now();
        if (now >= nextOwnerCheckAt) {
          await this.reclaimStaleLock();
          nextOwnerCheckAt = Date.now() + LOCK_OWNER_RECHECK_MS;
        }
        if (Date.now() - startedAt >= this.lockTimeoutMs) {
          throw this.createLockTimeoutError();
        }
        await sleep(LOCK_RETRY_MS);
      }
    }
  }

  private createLockTimeoutError(): AuthStorageLockTimeoutError {
    return new AuthStorageLockTimeoutError(
      `Timed out waiting for GitHits auth storage lock at ${this.lockPath}. If no githits process is running, remove this directory and retry.`,
    );
  }

  private getCurrentProcessStartedAt(): Promise<string | null> {
    if (!this.currentProcessStartedAtPromise) {
      const lookup = this.processStartedAtLookup(process.pid);
      this.currentProcessStartedAtPromise = lookup;
      void lookup.then(
        (startedAt) => {
          if (
            startedAt === null &&
            this.currentProcessStartedAtPromise === lookup
          ) {
            this.currentProcessStartedAtPromise = undefined;
          }
        },
        () => {
          if (this.currentProcessStartedAtPromise === lookup) {
            this.currentProcessStartedAtPromise = undefined;
          }
        },
      );
    }
    return this.currentProcessStartedAtPromise;
  }

  private async writeOwner(processStartedAt: string | null): Promise<void> {
    const owner: LockOwner = {
      id: randomUUID(),
      pid: process.pid,
      createdAt: new Date().toISOString(),
      processStartedAt,
    };
    // Exclusive creation is the lock handoff primitive. The filesystem
    // dependency must preserve wx semantics rather than overwrite a contender.
    await this.fileSystemService.writeFileExclusive(
      this.ownerPath(),
      JSON.stringify(owner),
      0o600,
    );
    this.currentOwner = owner;
  }

  private async reclaimStaleLock(): Promise<void> {
    const ownerResult = await this.readOwner();
    if (ownerResult.state === "missing") {
      await this.reclaimOldOwnerlessLock();
      return;
    }
    if (ownerResult.state === "unknown") return;
    const owner = ownerResult.owner;
    const ownerDead = !(await this.isOwnerAlive(
      owner.pid,
      owner.processStartedAt,
    ));
    if (!ownerDead) return;

    await this.reclaimProvenDeadOwner(owner);
  }

  private async reclaimProvenDeadOwner(owner: LockOwner): Promise<void> {
    const claimPath = this.reclaimPath(owner.id);
    try {
      // Contenders that proved the same owner dead serialize on one stable,
      // owner-scoped claim, even if the lock directory is later reused.
      await this.fileSystemService.writeFileExclusive(claimPath, "", 0o600);
    } catch {
      // An existing claim or any uncertain filesystem result must retain the
      // lock. The normal acquisition loop remains bounded by its timeout.
      return;
    }

    const currentOwner = await this.readOwner();
    if (
      currentOwner.state === "present" &&
      currentOwner.owner.id === owner.id
    ) {
      try {
        await this.fileSystemService.deleteFile(this.ownerPath());
      } catch {
        // Leave the directory in place if owner removal is uncertain.
      }
    }

    try {
      await this.fileSystemService.deleteFile(claimPath);
    } catch {
      // A claim that could not be removed keeps reclamation fail-closed. The
      // lock timeout message explains how to remove an abandoned lock.
      return;
    }

    // Empty-only deletion cannot remove a successor's owner file. It also
    // lets a delayed contender finish cleanup if it briefly blocked the
    // original claim holder's directory removal.
    await this.fileSystemService
      .deleteDirIfEmpty(this.lockPath)
      .catch(() => undefined);
  }

  private async reclaimOldOwnerlessLock(): Promise<void> {
    const createdAtMs = await lockCreatedAtMs(this.lockPath);
    if (Date.now() - createdAtMs < ORPHANED_LOCK_MS) return;
    await this.fileSystemService
      .deleteDirIfEmpty(this.lockPath)
      .catch(() => undefined);
  }

  private async readOwner(): Promise<LockOwnerReadResult> {
    let raw: string;
    try {
      raw = await this.fileSystemService.readFile(this.ownerPath());
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === "ENOENT"
        ? { state: "missing" }
        : { state: "unknown" };
    }

    try {
      const parsed = JSON.parse(raw) as Partial<LockOwner>;
      if (
        typeof parsed.id !== "string" ||
        typeof parsed.pid !== "number" ||
        !Number.isSafeInteger(parsed.pid) ||
        parsed.pid <= 0 ||
        parsed.pid > MAX_NODE_PROCESS_ID ||
        typeof parsed.createdAt !== "string" ||
        !(
          typeof parsed.processStartedAt === "string" ||
          parsed.processStartedAt === null
        )
      ) {
        return { state: "unknown" };
      }
      const owner: LockOwner = {
        id: parsed.id,
        pid: parsed.pid,
        createdAt: parsed.createdAt,
        processStartedAt: parsed.processStartedAt,
      };
      return { state: "present", owner };
    } catch {
      return { state: "unknown" };
    }
  }

  private async releaseLock(): Promise<void> {
    const owner = this.currentOwner;
    this.currentOwner = null;
    if (!owner) return;
    const currentOwner = await this.readOwnerForRelease();
    if (currentOwner.state !== "present" || currentOwner.owner.id !== owner.id)
      return;
    await rm(this.lockPath, { recursive: true, force: true }).catch(
      () => undefined,
    );
  }

  private ownerPath(): string {
    return this.fileSystemService.joinPath(this.lockPath, OWNER_FILE);
  }

  private reclaimPath(ownerId: string): string {
    const ownerHash = createHash("sha256").update(ownerId).digest("hex");
    return this.fileSystemService.joinPath(
      this.lockPath,
      `${RECLAIM_FILE_PREFIX}${ownerHash}`,
    );
  }

  private async readOwnerForRelease(): Promise<LockOwnerReadResult> {
    let result = await this.readOwner();
    for (
      let attempt = 1;
      result.state === "unknown" && attempt < RELEASE_OWNER_READ_ATTEMPTS;
      attempt += 1
    ) {
      await sleep(LOCK_RETRY_MS);
      result = await this.readOwner();
    }
    return result;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function isOriginalProcessAlive(
  pid: number,
  processStartedAt: string | null,
  getStartedAt: (pid: number) => Promise<string | null>,
): Promise<boolean> {
  if (!isProcessAlive(pid)) return false;
  if (!processStartedAt) return true;
  let observedStartedAt: string | null;
  try {
    observedStartedAt = await getStartedAt(pid);
  } catch {
    return true;
  }
  // Process identity inspection is advisory PID-reuse protection. An
  // unavailable lookup is not evidence that the live PID stopped owning the
  // lock, so retain the lock and let the bounded timeout surface contention.
  if (!observedStartedAt) return true;
  return observedStartedAt === processStartedAt;
}

function isProcessAlive(pid: number): boolean {
  if (pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    // ESRCH is the only definitive absent-process result. Permission and
    // unexpected inspection failures must fail closed so they cannot admit a
    // second refresh-token consumer.
    return code !== "ESRCH";
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
      const { stdout } = await execFileAsync(
        "powershell.exe",
        [
          "-NoProfile",
          "-Command",
          `(Get-Process -Id ${pid}).StartTime.ToUniversalTime().ToString('o')`,
        ],
        {
          timeout: PROCESS_IDENTITY_LOOKUP_TIMEOUT_MS,
          killSignal: "SIGKILL",
          windowsHide: true,
        },
      );
      return stdout.trim() || null;
    }
    const { stdout } = await execFileAsync(
      "ps",
      ["-p", String(pid), "-o", "lstart="],
      {
        timeout: PROCESS_IDENTITY_LOOKUP_TIMEOUT_MS,
        killSignal: "SIGKILL",
      },
    );
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
