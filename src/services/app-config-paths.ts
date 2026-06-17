import type { FileSystemService } from "./filesystem-service.js";

const APP_DIR = "githits";
const USER_AUTH_STATE_DIR = ".githits";

type AppConfigPathEnv = NodeJS.ProcessEnv;

/**
 * Resolve GitHits' canonical config directory.
 *
 * This is intentionally shared by auth config and auth file storage so local
 * state does not drift across multiple hidden directories.
 */
export function getAppConfigDir(fs: FileSystemService): string {
  return getAppConfigDirForEnv(
    fs,
    process.env,
    process.platform,
    fs.getHomeDir(),
  );
}

export function getAppConfigDirForEnv(
  fs: FileSystemService,
  env: AppConfigPathEnv,
  platform: NodeJS.Platform,
  home = getHomeDirForEnv(fs, env, platform),
): string {
  if (platform === "win32") {
    return fs.joinPath(
      env.APPDATA ?? fs.joinPath(home, "AppData", "Roaming"),
      APP_DIR,
    );
  }
  return fs.joinPath(
    env.XDG_CONFIG_HOME ?? fs.joinPath(home, ".config"),
    APP_DIR,
  );
}

export function getAuthConfigPath(fs: FileSystemService): string {
  return fs.joinPath(getAppConfigDir(fs), "config.toml");
}

export function getAuthConfigPathForEnv(
  fs: FileSystemService,
  env: AppConfigPathEnv,
  platform: NodeJS.Platform,
): string {
  return fs.joinPath(getAppConfigDirForEnv(fs, env, platform), "config.toml");
}

export function getAuthFileStorageDir(fs: FileSystemService): string {
  return fs.joinPath(getAppConfigDir(fs), "auth");
}

export function getAuthFileStorageDirForEnv(
  fs: FileSystemService,
  env: AppConfigPathEnv,
  platform: NodeJS.Platform,
): string {
  return fs.joinPath(getAppConfigDirForEnv(fs, env, platform), "auth");
}

function getHomeDirForEnv(
  fs: FileSystemService,
  env: AppConfigPathEnv,
  platform: NodeJS.Platform,
): string {
  if (platform === "win32" && env.USERPROFILE) return env.USERPROFILE;
  if (platform !== "win32" && env.HOME) return env.HOME;
  return fs.getHomeDir();
}

export function getLegacyAuthStorageDir(fs: FileSystemService): string {
  return fs.joinPath(fs.getHomeDir(), USER_AUTH_STATE_DIR);
}

export function getLegacyAuthStorageDirForEnv(
  fs: FileSystemService,
  env: AppConfigPathEnv,
  platform: NodeJS.Platform,
): string {
  return fs.joinPath(getHomeDirForEnv(fs, env, platform), USER_AUTH_STATE_DIR);
}

export function getAuthLockDir(fs: FileSystemService): string {
  return fs.joinPath(fs.getHomeDir(), USER_AUTH_STATE_DIR);
}

export function getLegacyMacAppConfigDir(fs: FileSystemService): string {
  return fs.joinPath(
    fs.getHomeDir(),
    "Library",
    "Application Support",
    APP_DIR,
  );
}

export function getLegacyMacAppConfigDirForEnv(
  fs: FileSystemService,
  env: AppConfigPathEnv,
): string {
  return fs.joinPath(
    getHomeDirForEnv(fs, env, "darwin"),
    "Library",
    "Application Support",
    APP_DIR,
  );
}

export function getLegacyMacAuthConfigPath(fs: FileSystemService): string {
  return fs.joinPath(getLegacyMacAppConfigDir(fs), "config.toml");
}

export function getLegacyMacAuthConfigPathForEnv(
  fs: FileSystemService,
  env: AppConfigPathEnv,
): string {
  return fs.joinPath(getLegacyMacAppConfigDirForEnv(fs, env), "config.toml");
}

export function getLegacyMacAuthFileStorageDir(fs: FileSystemService): string {
  return fs.joinPath(getLegacyMacAppConfigDir(fs), "auth");
}

export function getLegacyMacAuthFileStorageDirForEnv(
  fs: FileSystemService,
  env: AppConfigPathEnv,
): string {
  return fs.joinPath(getLegacyMacAppConfigDirForEnv(fs, env), "auth");
}
