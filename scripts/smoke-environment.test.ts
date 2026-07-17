import { describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { createIsolatedSmokeEnvironment } from "./smoke-environment.ts";

describe("createIsolatedSmokeEnvironment", () => {
  it("strips credentials and isolates platform config roots", () => {
    const baseEnv = {
      PATH: "/test/bin",
      GITHITS_API_TOKEN: "secret",
      githits_token: "legacy-secret",
      githits_api_url: "https://real-api.example.com",
      githits_auth_storage: "keychain",
      xdg_config_home: "/real/config",
      PKGSEER_URL: "https://real.example.com",
    };
    const isolated = createIsolatedSmokeEnvironment(
      "githits-smoke-environment-",
      baseEnv,
    );
    try {
      expect(isolated.env.PATH).toBe("/test/bin");
      expect(isolated.env.GITHITS_API_TOKEN).toBeUndefined();
      expect(isolated.env.githits_token).toBeUndefined();
      expect(isolated.env.githits_api_url).toBeUndefined();
      expect(isolated.env.githits_auth_storage).toBeUndefined();
      expect(isolated.env.xdg_config_home).toBeUndefined();
      expect(isolated.env.PKGSEER_URL).toBeUndefined();
      expect(isolated.env.GITHITS_API_URL).toBe(
        "https://api-smoke-unauth.githits.invalid",
      );
      expect(isolated.env.GITHITS_AUTH_STORAGE).toBe("file");
      expect(isolated.env.GITHITS_DISABLE_UPDATE_CHECK).toBe("1");
      for (const key of ["HOME", "USERPROFILE", "XDG_CONFIG_HOME", "APPDATA"]) {
        expect(isolated.env[key]?.startsWith(isolated.root)).toBe(true);
      }
      expect(baseEnv.GITHITS_API_TOKEN).toBe("secret");
      expect(existsSync(isolated.root)).toBe(true);
    } finally {
      isolated.cleanup();
    }
    expect(existsSync(isolated.root)).toBe(false);
  });
});
