import { parse as parseToml } from "smol-toml";
import { z } from "zod";
import { getAuthConfigPath } from "./app-config-paths.js";
import type { FileSystemService } from "./filesystem-service.js";

export const AUTH_STORAGE_MODES = ["keychain", "file"] as const;
export type AuthStorageMode = (typeof AUTH_STORAGE_MODES)[number];

const AUTH_STORAGE_MODE_VALUES = new Set<string>(AUTH_STORAGE_MODES);
const CONFIG_SCHEMA = z
  .object({
    auth: z
      .object({
        storage: z.string().optional(),
      })
      .optional(),
  })
  .passthrough();

export class AuthConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthConfigError";
  }
}

export interface AuthConfig {
  storage: AuthStorageMode;
  configPath: string;
}

export function parseAuthStorageMode(value: string): AuthStorageMode {
  const normalized = value.trim().toLowerCase();
  if (AUTH_STORAGE_MODE_VALUES.has(normalized)) {
    return normalized as AuthStorageMode;
  }
  throw new AuthConfigError(
    `Invalid auth storage mode "${value}". Use "keychain" or "file". File mode stores OAuth credentials unencrypted on disk.`,
  );
}

export async function loadAuthConfig(
  fs: FileSystemService,
): Promise<AuthConfig> {
  const configPath = getAuthConfigPath(fs);
  const envMode = process.env.GITHITS_AUTH_STORAGE;
  if (envMode !== undefined && envMode.trim() !== "") {
    try {
      return { storage: parseAuthStorageMode(envMode), configPath };
    } catch (error) {
      if (error instanceof AuthConfigError) {
        throw new AuthConfigError(
          `Invalid GITHITS_AUTH_STORAGE: ${error.message}`,
        );
      }
      throw error;
    }
  }

  if (!(await fs.exists(configPath))) {
    return { storage: "keychain", configPath };
  }

  let rawConfig: unknown;
  try {
    rawConfig = parseToml(await fs.readFile(configPath));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new AuthConfigError(
      `Cannot parse GitHits config at ${configPath}: ${message}`,
    );
  }

  const parsed = CONFIG_SCHEMA.safeParse(rawConfig);
  if (!parsed.success) {
    throw new AuthConfigError(
      `Invalid GitHits config at ${configPath}: ${z.prettifyError(parsed.error)}`,
    );
  }

  const configuredMode = parsed.data.auth?.storage;
  if (configuredMode === undefined || configuredMode.trim() === "") {
    return { storage: "keychain", configPath };
  }

  try {
    return { storage: parseAuthStorageMode(configuredMode), configPath };
  } catch (error) {
    if (error instanceof AuthConfigError) {
      throw new AuthConfigError(
        `Invalid GitHits config at ${configPath}: ${error.message}`,
      );
    }
    throw error;
  }
}
