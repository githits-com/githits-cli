import type { FileSystemService } from "./filesystem-service.js";

const APP_DIR = "githits";

/**
 * Resolve GitHits' canonical config directory.
 *
 * This is intentionally shared by auth config and auth file storage so local
 * state does not drift across multiple hidden directories.
 */
export function getAppConfigDir(fs: FileSystemService): string {
  const home = fs.getHomeDir();
  if (process.platform === "win32") {
    return fs.joinPath(
      process.env.APPDATA ?? fs.joinPath(home, "AppData", "Roaming"),
      APP_DIR,
    );
  }
  return fs.joinPath(
    process.env.XDG_CONFIG_HOME ?? fs.joinPath(home, ".config"),
    APP_DIR,
  );
}

export function getAuthConfigPath(fs: FileSystemService): string {
  return fs.joinPath(getAppConfigDir(fs), "config.toml");
}

export function getAuthFileStorageDir(fs: FileSystemService): string {
  return fs.joinPath(getAppConfigDir(fs), "auth");
}

export function getLegacyAuthStorageDir(fs: FileSystemService): string {
  return fs.joinPath(fs.getHomeDir(), ".githits");
}

export function getLegacyMacAppConfigDir(fs: FileSystemService): string {
  return fs.joinPath(
    fs.getHomeDir(),
    "Library",
    "Application Support",
    APP_DIR,
  );
}

export function getLegacyMacAuthConfigPath(fs: FileSystemService): string {
  return fs.joinPath(getLegacyMacAppConfigDir(fs), "config.toml");
}

export function getLegacyMacAuthFileStorageDir(fs: FileSystemService): string {
  return fs.joinPath(getLegacyMacAppConfigDir(fs), "auth");
}
