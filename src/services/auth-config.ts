import { z } from "zod";
import { AppConfigError, readAppConfig } from "./app-config.js";
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
  const envMode = process.env.GITHITS_AUTH_STORAGE;
  if (envMode !== undefined && envMode.trim() !== "") {
    try {
      return {
        storage: parseAuthStorageMode(envMode),
        configPath: getAuthConfigPath(fs),
      };
    } catch (error) {
      if (error instanceof AuthConfigError) {
        throw new AuthConfigError(
          `Invalid GITHITS_AUTH_STORAGE: ${error.message}`,
        );
      }
      throw error;
    }
  }

  let document: Awaited<ReturnType<typeof readAppConfig>>;
  try {
    document = await readAppConfig(fs);
  } catch (error) {
    if (error instanceof AppConfigError) {
      throw new AuthConfigError(error.message);
    }
    throw error;
  }

  const parsed = CONFIG_SCHEMA.safeParse(document.data);
  if (!parsed.success) {
    throw new AuthConfigError(
      `Invalid GitHits config at ${document.configPath}: ${z.prettifyError(parsed.error)}`,
    );
  }

  const configuredMode = parsed.data.auth?.storage;
  if (configuredMode === undefined || configuredMode.trim() === "") {
    return { storage: "keychain", configPath: document.configPath };
  }

  try {
    return {
      storage: parseAuthStorageMode(configuredMode),
      configPath: document.configPath,
    };
  } catch (error) {
    if (error instanceof AuthConfigError) {
      throw new AuthConfigError(
        `Invalid GitHits config at ${document.configPath}: ${error.message}`,
      );
    }
    throw error;
  }
}
