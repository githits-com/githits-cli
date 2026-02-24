import {
  mkdir,
  readdir,
  readFile,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
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

  /** Delete file if it exists */
  deleteFile(path: string): Promise<void>;

  /** Check if file exists */
  exists(path: string): Promise<boolean>;

  /** Ensure directory exists, creating parent directories recursively as needed */
  ensureDir(path: string, mode?: number): Promise<void>;

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
}

/**
 * Production implementation using node:fs/promises.
 */
export class FileSystemServiceImpl implements FileSystemService {
  async readFile(path: string): Promise<string> {
    return readFile(path, "utf-8");
  }

  async writeFile(
    path: string,
    contents: string,
    mode?: number,
  ): Promise<void> {
    await writeFile(path, contents, { mode });
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

  async exists(path: string): Promise<boolean> {
    try {
      await stat(path);
      return true;
    } catch {
      return false;
    }
  }

  async ensureDir(path: string, mode?: number): Promise<void> {
    await mkdir(path, { recursive: true, mode });
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
}
