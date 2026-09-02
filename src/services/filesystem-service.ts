import { randomUUID } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename as renamePath,
  rmdir,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";

/**
 * Service interface for file system operations.
 * Abstraction allows for easy testing with mock implementations.
 */
export interface FileSystemService {
  /** Read file contents as string */
  readFile(path: string): Promise<string>;

  /** Write string contents to file with optional mode */
  writeFile(path: string, contents: string, mode?: number): Promise<void>;

  /** Create a new file exclusively, failing if the path already exists */
  writeFileExclusive(
    path: string,
    contents: string,
    mode?: number,
  ): Promise<void>;

  /** Delete file if it exists */
  deleteFile(path: string): Promise<void>;

  /** Delete directory if it exists and is empty */
  deleteDirIfEmpty(path: string): Promise<void>;

  /** Atomically rename a path on the same filesystem */
  rename(source: string, destination: string): Promise<void>;

  /** Check if file exists */
  exists(path: string): Promise<boolean>;

  /** Ensure directory exists, creating parent directories recursively as needed */
  ensureDir(path: string, mode?: number): Promise<void>;

  /** Create a unique temporary directory owned by the caller. */
  createTempDir(prefix: string): Promise<string>;

  /** Get user home directory */
  getHomeDir(): string;

  /** Join path segments */
  joinPath(...segments: string[]): string;

  /** Get current working directory */
  getCwd(): string;

  /** Get directory name from path */
  getDirname(path: string): string;

  /** List directory contents */
  readdir(path: string): Promise<string[]>;

  /** Check if path is a directory */
  isDirectory(path: string): Promise<boolean>;

  /**
   * Write file atomically by writing to a temp file then renaming.
   * Ensures the target file is never left in a half-written state.
   * The temp file is created in the same directory as the target
   * so rename() is atomic on the same filesystem.
   * An optional maximum mode intersects with an existing file's permissions.
   */
  atomicWriteFile(
    path: string,
    contents: string,
    maximumMode?: number,
  ): Promise<void>;
}

/**
 * Production implementation using node:fs/promises.
 */
export class FileSystemServiceImpl implements FileSystemService {
  async readFile(path: string): Promise<string> {
    try {
      return await readFile(path, "utf-8");
    } catch (error) {
      logFileSystemDiagnostic("read-file", error);
      throw error;
    }
  }

  async writeFile(
    path: string,
    contents: string,
    mode?: number,
  ): Promise<void> {
    await writeFile(path, contents, { mode });
  }

  async writeFileExclusive(
    path: string,
    contents: string,
    mode?: number,
  ): Promise<void> {
    await writeFile(path, contents, { mode, flag: "wx" });
  }

  async deleteFile(path: string): Promise<void> {
    try {
      await unlink(path);
    } catch (error) {
      // Ignore if file doesn't exist
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
  }

  async deleteDirIfEmpty(path: string): Promise<void> {
    try {
      await rmdir(path);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (
        code !== "ENOENT" &&
        code !== "ENOTEMPTY" &&
        code !== "EEXIST" &&
        code !== "ENOTDIR"
      ) {
        throw error;
      }
    }
  }

  async rename(source: string, destination: string): Promise<void> {
    await renamePath(source, destination);
  }

  async exists(path: string): Promise<boolean> {
    try {
      await stat(path);
      return true;
    } catch {
      return false;
    }
  }

  async ensureDir(path: string, mode?: number): Promise<void> {
    try {
      await mkdir(path, { recursive: true, mode });
    } catch (error) {
      logFileSystemDiagnostic("ensure-dir", error);
      throw error;
    }
  }

  async createTempDir(prefix: string): Promise<string> {
    return mkdtemp(join(tmpdir(), prefix));
  }

  getHomeDir(): string {
    return homedir();
  }

  joinPath(...segments: string[]): string {
    return join(...segments);
  }

  getCwd(): string {
    return process.cwd();
  }

  getDirname(path: string): string {
    return dirname(path);
  }

  async readdir(path: string): Promise<string[]> {
    return readdir(path);
  }

  async isDirectory(path: string): Promise<boolean> {
    try {
      const stats = await stat(path);
      return stats.isDirectory();
    } catch {
      return false;
    }
  }

  async atomicWriteFile(
    path: string,
    contents: string,
    maximumMode?: number,
  ): Promise<void> {
    const tmpPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
    const normalizedMaximum =
      maximumMode === undefined ? undefined : maximumMode & 0o777;
    // Existing modes are preserved unless a caller supplies a cap. New files
    // use that cap or default to 0600. Rename is atomic at filesystem rename
    // granularity; this does not claim power-loss durability.
    let mode = normalizedMaximum ?? 0o600;
    try {
      const existing = await stat(path);
      const existingMode = existing.mode & 0o777;
      mode =
        normalizedMaximum === undefined
          ? existingMode
          : existingMode & normalizedMaximum;
    } catch {
      // File doesn't exist yet — use default
    }
    let operation = "write-temp";
    try {
      await writeFile(tmpPath, contents, { mode });
      operation = "replace-target";
      await renamePath(tmpPath, path);
    } catch (error) {
      logFileSystemDiagnostic(operation, error);
      // Clean up temp file on failure
      try {
        await unlink(tmpPath);
      } catch {
        // Ignore cleanup errors
      }
      throw error;
    }
  }
}

function logFileSystemDiagnostic(operation: string, error: unknown): void {
  if (process.env.GITHITS_AUTH_LOCK_DIAGNOSTIC_STRESS !== "1") return;
  const code = (error as NodeJS.ErrnoException).code ?? null;
  if (code === "ENOENT") return;
  console.error(
    `[auth-filesystem-diagnostic] ${JSON.stringify({ operation, code })}`,
  );
}
