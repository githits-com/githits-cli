import { getAuthFileStorageDir } from "./app-config-paths.js";
import type { TokenData } from "./auth-storage.js";
import { normalizeBaseUrl } from "./auth-storage.js";
import type { FileSystemService } from "./filesystem-service.js";

export interface AuthSessionMetadata {
  createdAt: string;
  expiresAt: string | null;
  updatedAt: string;
}

export interface AuthSessionMetadataStore {
  load(baseUrl: string): Promise<AuthSessionMetadata | null>;
  saveFromTokens(baseUrl: string, tokens: TokenData): Promise<void>;
  clear(baseUrl: string): Promise<void>;
}

interface StoredAuthSessionMetadata {
  version: 1;
  sessions: Record<string, AuthSessionMetadata>;
}

const METADATA_FILE = "metadata.json";
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

/**
 * Stores non-secret auth metadata used for startup decisions without touching
 * OS keychain entries. Tokens and client secrets stay in the configured store.
 */
export class AuthSessionMetadataStorage implements AuthSessionMetadataStore {
  private readonly configDir: string;
  private readonly metadataPath: string;

  constructor(
    private readonly fs: FileSystemService,
    configDir?: string,
  ) {
    this.configDir = configDir ?? getAuthFileStorageDir(fs);
    this.metadataPath = fs.joinPath(this.configDir, METADATA_FILE);
  }

  async load(baseUrl: string): Promise<AuthSessionMetadata | null> {
    const stored = await this.loadFile();
    if (!stored) return null;
    const metadata = stored.sessions[normalizeBaseUrl(baseUrl)] ?? null;
    return isAuthSessionMetadata(metadata) ? metadata : null;
  }

  async saveFromTokens(baseUrl: string, tokens: TokenData): Promise<void> {
    const stored = (await this.loadFile()) ?? {
      version: 1 as const,
      sessions: {},
    };
    stored.sessions[normalizeBaseUrl(baseUrl)] = {
      createdAt: tokens.createdAt,
      expiresAt: tokens.expiresAt,
      updatedAt: new Date().toISOString(),
    };

    await this.fs.ensureDir(this.configDir, DIR_MODE);
    await this.fs.atomicWriteFile(
      this.metadataPath,
      JSON.stringify(stored, null, 2),
      FILE_MODE,
    );
  }

  async clear(baseUrl: string): Promise<void> {
    const stored = await this.loadFile();
    if (!stored) return;

    delete stored.sessions[normalizeBaseUrl(baseUrl)];

    if (Object.keys(stored.sessions).length === 0) {
      await this.fs.deleteFile(this.metadataPath);
      return;
    }

    await this.fs.atomicWriteFile(
      this.metadataPath,
      JSON.stringify(stored, null, 2),
      FILE_MODE,
    );
  }

  private async loadFile(): Promise<StoredAuthSessionMetadata | null> {
    if (!(await this.fs.exists(this.metadataPath))) return null;
    try {
      const content = await this.fs.readFile(this.metadataPath);
      const data = JSON.parse(content);
      if (data.version !== 1 || !data.sessions) return null;
      return data as StoredAuthSessionMetadata;
    } catch {
      return null;
    }
  }
}

function isAuthSessionMetadata(
  value: AuthSessionMetadata | null,
): value is AuthSessionMetadata {
  if (value === null || typeof value !== "object") return false;
  return (
    typeof value.createdAt === "string" &&
    value.createdAt.length > 0 &&
    typeof value.updatedAt === "string" &&
    value.updatedAt.length > 0 &&
    (value.expiresAt === null ||
      (typeof value.expiresAt === "string" && value.expiresAt.length > 0))
  );
}
