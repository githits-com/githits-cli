import { describe, expect, it } from "bun:test";
import { win32 } from "node:path";
import {
  getAppConfigDir,
  getAuthConfigPath,
  getAuthFileStorageDir,
  getAuthLockDir,
  getLegacyAuthStorageDir,
  getLegacyMacAuthConfigPath,
  getLegacyMacAuthFileStorageDir,
} from "./app-config-paths.js";
import {
  createMockFileSystemService,
  createPlatformMockFileSystemService,
  withTestEnvVar,
  withTestPlatform,
} from "./test-helpers.js";

describe("app config paths", () => {
  it("uses XDG_CONFIG_HOME on linux", async () => {
    await withTestEnvVar("XDG_CONFIG_HOME", "/xdg/config", async () => {
      await withTestPlatform("linux", () => {
        const fs = createMockFileSystemService();
        expect(getAppConfigDir(fs)).toBe("/xdg/config/githits");
        expect(getAuthConfigPath(fs)).toBe("/xdg/config/githits/config.toml");
        expect(getAuthFileStorageDir(fs)).toBe("/xdg/config/githits/auth");
      });
    });
  });

  it("falls back to ~/.config on linux", async () => {
    await withTestEnvVar("XDG_CONFIG_HOME", undefined, async () => {
      await withTestPlatform("linux", () => {
        expect(getAppConfigDir(createMockFileSystemService())).toBe(
          "/home/test/.config/githits",
        );
      });
    });
  });

  it("uses ~/.config on macOS", async () => {
    await withTestEnvVar("XDG_CONFIG_HOME", undefined, async () => {
      await withTestPlatform("darwin", () => {
        expect(getAppConfigDir(createMockFileSystemService())).toBe(
          "/home/test/.config/githits",
        );
      });
    });
  });

  it("uses XDG_CONFIG_HOME on macOS when set", async () => {
    await withTestEnvVar("XDG_CONFIG_HOME", "/xdg/config", async () => {
      await withTestPlatform("darwin", () => {
        expect(getAppConfigDir(createMockFileSystemService())).toBe(
          "/xdg/config/githits",
        );
      });
    });
  });

  it("keeps legacy macOS Application Support paths for migration", async () => {
    await withTestPlatform("darwin", () => {
      const fs = createMockFileSystemService();
      expect(getLegacyMacAuthConfigPath(fs)).toBe(
        "/home/test/Library/Application Support/githits/config.toml",
      );
      expect(getLegacyMacAuthFileStorageDir(fs)).toBe(
        "/home/test/Library/Application Support/githits/auth",
      );
    });
  });

  it("uses APPDATA on Windows", async () => {
    await withTestEnvVar(
      "APPDATA",
      "C:\\Users\\test\\AppData\\Roaming",
      async () => {
        await withTestPlatform("win32", () => {
          const fs = createPlatformMockFileSystemService("win32");
          expect(getAppConfigDir(fs)).toBe(
            win32.join("C:\\Users\\test\\AppData\\Roaming", "githits"),
          );
        });
      },
    );
  });

  it("keeps legacy auth storage under ~/.githits", () => {
    expect(getLegacyAuthStorageDir(createMockFileSystemService())).toBe(
      "/home/test/.githits",
    );
  });

  it("keeps the auth lock under stable per-user state", () => {
    expect(getAuthLockDir(createMockFileSystemService())).toBe(
      "/home/test/.githits",
    );
  });
});
