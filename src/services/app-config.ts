import { parse as parseToml } from "smol-toml";
import {
  getAuthConfigPath,
  getLegacyMacAuthConfigPath,
} from "./app-config-paths.js";
import type { FileSystemService } from "./filesystem-service.js";

/** The parsed contents of the shared GitHits TOML configuration document. */
export interface AppConfigDocument {
  configPath: string;
  data: unknown;
}

/** Raised when the shared GitHits configuration cannot be read or parsed. */
export class AppConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AppConfigError";
  }
}

/**
 * Locate and parse GitHits' shared TOML configuration document.
 *
 * A missing document is represented by an empty object at the canonical path.
 * On macOS, an existing legacy Application Support document is read when the
 * canonical document is absent. Surface-specific loaders validate `data`.
 */
export async function readAppConfig(
  fs: FileSystemService,
): Promise<AppConfigDocument> {
  let configPath = getAuthConfigPath(fs);
  if (!(await fs.exists(configPath))) {
    const legacyMacConfigPath = getLegacyMacAuthConfigPath(fs);
    if (
      process.platform === "darwin" &&
      (await fs.exists(legacyMacConfigPath))
    ) {
      configPath = legacyMacConfigPath;
    } else {
      return { configPath, data: {} };
    }
  }

  try {
    return {
      configPath,
      data: parseToml(await fs.readFile(configPath)),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new AppConfigError(
      `Cannot parse GitHits config at ${configPath}: ${message}`,
    );
  }
}
