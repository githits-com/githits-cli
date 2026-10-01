import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SMOKE_ROOT_ENV_KEYS = new Set([
  "HOME",
  "USERPROFILE",
  "XDG_CONFIG_HOME",
  "APPDATA",
]);

const SCOPED_MANAGED_ENV_KEYS = new Set([
  ...SMOKE_ROOT_ENV_KEYS,
  "GITHITS_DISABLE_SKILL_UPDATE",
]);

const MANAGED_ENV_KEYS = new Set([
  ...SCOPED_MANAGED_ENV_KEYS,
  "GITHITS_API_TOKEN",
  "GITHITS_TOKEN",
  "GITHITS_AUTH_STORAGE",
  "GITHITS_DISABLE_UPDATE_CHECK",
  "GITHITS_MCP_URL",
  "GITHITS_API_URL",
  "GITHITS_CODE_NAV_URL",
  "GITHITS_ENV",
]);

export interface IsolatedSmokeEnvironment {
  env: Record<string, string>;
  root: string;
  cleanup(): void;
}

/**
 * Creates temporary config and skill roots while preserving inherited
 * environment credentials such as an env token. Host file-auth state is not
 * copied, and inherited skill-update opt-outs are removed.
 */
export function createScopedSmokeEnvironment(
  prefix: string,
  baseEnv: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): IsolatedSmokeEnvironment {
  const root = mkdtempSync(join(tmpdir(), prefix));
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(baseEnv)) {
    if (
      value !== undefined &&
      !SCOPED_MANAGED_ENV_KEYS.has(key.toUpperCase())
    ) {
      env[key] = value;
    }
  }
  env.HOME = root;
  env.USERPROFILE = root;
  env.XDG_CONFIG_HOME = join(root, ".config");
  env.APPDATA = join(root, "AppData", "Roaming");
  env.GITHITS_DISABLE_UPDATE_CHECK = "1";
  return {
    env,
    root,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

export function writeSmokeConfig(
  env: Record<string, string | undefined>,
  contents: string,
): string {
  const configHome =
    process.platform === "win32" ? env.APPDATA : env.XDG_CONFIG_HOME;
  if (!configHome)
    throw new Error("Smoke config environment has no platform config root");
  const configDir = join(configHome, "githits");
  mkdirSync(configDir, { recursive: true });
  const configPath = join(configDir, "config.toml");
  writeFileSync(configPath, contents);
  return configPath;
}

/**
 * Creates a credential-free smoke environment with isolated config and skill
 * roots, leaving skill updates enabled.
 */
export function createIsolatedSmokeEnvironment(
  prefix: string,
  baseEnv: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): IsolatedSmokeEnvironment {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(baseEnv)) {
    if (value !== undefined && !MANAGED_ENV_KEYS.has(key.toUpperCase())) {
      env[key] = value;
    }
  }

  const root = mkdtempSync(join(tmpdir(), prefix));
  env.HOME = root;
  env.USERPROFILE = root;
  env.XDG_CONFIG_HOME = join(root, ".config");
  env.APPDATA = join(root, "AppData", "Roaming");
  env.GITHITS_AUTH_STORAGE = "file";
  env.GITHITS_DISABLE_UPDATE_CHECK = "1";
  env.GITHITS_MCP_URL = "https://mcp-smoke-unauth.githits.invalid";
  env.GITHITS_API_URL = "https://api-smoke-unauth.githits.invalid";
  env.GITHITS_CODE_NAV_URL = "https://code-smoke-unauth.githits.invalid";

  return {
    env,
    root,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}
