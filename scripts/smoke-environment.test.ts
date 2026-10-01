import { describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  createIsolatedSmokeEnvironment,
  createScopedSmokeEnvironment,
  writeSmokeConfig,
} from "./smoke-environment.ts";

describe("createIsolatedSmokeEnvironment", () => {
  it("sets HOME, USERPROFILE, and config roots under the temporary root, removes both opt-out casings, and leaves input unchanged", () => {
    const baseEnv = {
      PATH: "/test/bin",
      GITHITS_API_TOKEN: "secret",
      githits_token: "legacy-secret",
      githits_api_url: "https://real-api.example.com",
      GITHITS_ENV: "dev",
      githits_env: "invalid",
      githits_auth_storage: "keychain",
      xdg_config_home: "/real/config",
      GITHITS_DISABLE_SKILL_UPDATE: "1",
      githits_disable_skill_update: "true",
    };
    const originalBaseEnv = { ...baseEnv };
    const isolated = createIsolatedSmokeEnvironment(
      "githits-smoke-environment-",
      baseEnv,
    );
    try {
      expect(isolated.env.PATH).toBe("/test/bin");
      expect(isolated.env.GITHITS_API_TOKEN).toBeUndefined();
      expect(isolated.env.githits_token).toBeUndefined();
      expect(isolated.env.githits_api_url).toBeUndefined();
      expect(isolated.env.GITHITS_ENV).toBeUndefined();
      expect(isolated.env.githits_env).toBeUndefined();
      expect(isolated.env.githits_auth_storage).toBeUndefined();
      expect(isolated.env.xdg_config_home).toBeUndefined();
      expect(isolated.env.GITHITS_DISABLE_SKILL_UPDATE).toBeUndefined();
      expect(isolated.env.githits_disable_skill_update).toBeUndefined();
      expect(isolated.env.GITHITS_API_URL).toBe(
        "https://api-smoke-unauth.githits.invalid",
      );
      expect(isolated.env.GITHITS_AUTH_STORAGE).toBe("file");
      expect(isolated.env.GITHITS_DISABLE_UPDATE_CHECK).toBe("1");
      expect(isolated.env.HOME).toBe(isolated.root);
      expect(isolated.env.USERPROFILE).toBe(isolated.root);
      expect(isolated.env.XDG_CONFIG_HOME).toBe(join(isolated.root, ".config"));
      expect(isolated.env.APPDATA).toBe(
        join(isolated.root, "AppData", "Roaming"),
      );
      expect(baseEnv.GITHITS_API_TOKEN).toBe("secret");
      expect(baseEnv).toEqual(originalBaseEnv);
      expect(existsSync(isolated.root)).toBe(true);
    } finally {
      isolated.cleanup();
    }
    expect(existsSync(isolated.root)).toBe(false);
  });
});

describe("createScopedSmokeEnvironment", () => {
  it("sets HOME, USERPROFILE, and config roots under the temporary root while preserving env-token/dev overrides, removing both opt-out casings, and leaving input unchanged", () => {
    const baseEnv = {
      GITHITS_API_TOKEN: "secret",
      GITHITS_AUTH_STORAGE: "file",
      HOME: "/real-home",
      XDG_CONFIG_HOME: "/real-config",
      USERPROFILE: "C:\\real-home",
      APPDATA: "C:\\real-config",
      home: "/lowercase-home",
      userprofile: "C:\\lowercase-home",
      xdg_config_home: "/lowercase-config",
      appdata: "C:\\lowercase-config",
      GITHITS_DISABLE_SKILL_UPDATE: "1",
      githits_disable_skill_update: "true",
      GITHITS_ENV: "dev",
      GITHITS_API_URL: "https://dev-api.example.com",
      GITHITS_MCP_URL: "https://dev-mcp.example.com",
    };
    const originalBaseEnv = { ...baseEnv };
    const scoped = createScopedSmokeEnvironment(
      "githits-scoped-smoke-",
      baseEnv,
    );
    try {
      expect(scoped.env.GITHITS_API_TOKEN).toBe("secret");
      expect(scoped.env.GITHITS_AUTH_STORAGE).toBe("file");
      expect(scoped.env.GITHITS_ENV).toBe("dev");
      expect(scoped.env.GITHITS_API_URL).toBe("https://dev-api.example.com");
      expect(scoped.env.GITHITS_MCP_URL).toBe("https://dev-mcp.example.com");
      expect(scoped.env.GITHITS_DISABLE_SKILL_UPDATE).toBeUndefined();
      expect(scoped.env.githits_disable_skill_update).toBeUndefined();
      expect(scoped.env.HOME).toBe(scoped.root);
      expect(scoped.env.USERPROFILE).toBe(scoped.root);
      expect(scoped.env.home).toBeUndefined();
      expect(scoped.env.userprofile).toBeUndefined();
      expect(scoped.env.XDG_CONFIG_HOME).toBe(join(scoped.root, ".config"));
      expect(scoped.env.APPDATA).toBe(join(scoped.root, "AppData", "Roaming"));
      expect(scoped.env.xdg_config_home).toBeUndefined();
      expect(scoped.env.appdata).toBeUndefined();
      const configPath = writeSmokeConfig(
        scoped.env,
        "[experimental]\ntools = true\n",
      );
      const configHome =
        process.platform === "win32"
          ? scoped.env.APPDATA!
          : scoped.env.XDG_CONFIG_HOME!;
      expect(configPath).toBe(join(configHome, "githits", "config.toml"));
      expect(baseEnv).toEqual(originalBaseEnv);
      expect(existsSync(scoped.root)).toBe(true);
      expect(scoped.env.GITHITS_DISABLE_UPDATE_CHECK).toBe("1");
    } finally {
      scoped.cleanup();
    }
  });
});

describe("smoke environment selector isolation", () => {
  it("isolates the backend selector while preserving scoped dev configuration", () => {
    const isolatedBaseEnv = {
      GITHITS_ENV: "dev",
      githits_env: "invalid",
    };
    const originalIsolatedBaseEnv = { ...isolatedBaseEnv };
    const isolated = createIsolatedSmokeEnvironment(
      "githits-smoke-selector-",
      isolatedBaseEnv,
    );
    try {
      expect(isolated.env.GITHITS_ENV).toBeUndefined();
      expect(isolated.env.githits_env).toBeUndefined();
      expect(isolated.env.GITHITS_MCP_URL).toBe(
        "https://mcp-smoke-unauth.githits.invalid",
      );
      expect(isolated.env.GITHITS_API_URL).toBe(
        "https://api-smoke-unauth.githits.invalid",
      );
      expect(isolated.env.GITHITS_CODE_NAV_URL).toBe(
        "https://code-smoke-unauth.githits.invalid",
      );
      expect(isolatedBaseEnv).toEqual(originalIsolatedBaseEnv);
    } finally {
      isolated.cleanup();
    }

    const scopedBaseEnv = {
      GITHITS_ENV: "dev",
      GITHITS_CODE_NAV_URL: "https://oss-local.example.com",
    };
    const originalScopedBaseEnv = { ...scopedBaseEnv };
    const scoped = createScopedSmokeEnvironment(
      "githits-scoped-smoke-selector-",
      scopedBaseEnv,
    );
    try {
      expect(scoped.env.GITHITS_ENV).toBe("dev");
      expect(scoped.env.GITHITS_CODE_NAV_URL).toBe(
        "https://oss-local.example.com",
      );
      expect(scopedBaseEnv).toEqual(originalScopedBaseEnv);
    } finally {
      scoped.cleanup();
    }
  });
});
