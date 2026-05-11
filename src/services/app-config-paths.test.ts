import { describe, expect, it } from "bun:test";
import {
  getAppConfigDir,
  getAuthConfigPath,
  getAuthFileStorageDir,
  getLegacyAuthStorageDir,
  getLegacyMacAuthConfigPath,
  getLegacyMacAuthFileStorageDir,
} from "./app-config-paths.js";
import { createMockFileSystemService } from "./test-helpers.js";

function withPlatform<T>(platform: NodeJS.Platform, fn: () => T): T {
  const originalPlatform = process.platform;
  Object.defineProperty(process, "platform", { value: platform });
  try {
    return fn();
  } finally {
    Object.defineProperty(process, "platform", { value: originalPlatform });
  }
}

function withEnvVar<T>(key: string, value: string | undefined, fn: () => T): T {
  const original = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
  try {
    return fn();
  } finally {
    if (original === undefined) delete process.env[key];
    else process.env[key] = original;
  }
}

describe("app config paths", () => {
  it("uses XDG_CONFIG_HOME on linux", () => {
    withEnvVar("XDG_CONFIG_HOME", "/xdg/config", () => {
      withPlatform("linux", () => {
        const fs = createMockFileSystemService();
        expect(getAppConfigDir(fs)).toBe("/xdg/config/githits");
        expect(getAuthConfigPath(fs)).toBe("/xdg/config/githits/config.toml");
        expect(getAuthFileStorageDir(fs)).toBe("/xdg/config/githits/auth");
      });
    });
  });

  it("falls back to ~/.config on linux", () => {
    withEnvVar("XDG_CONFIG_HOME", undefined, () => {
      withPlatform("linux", () => {
        expect(getAppConfigDir(createMockFileSystemService())).toBe(
          "/home/test/.config/githits",
        );
      });
    });
  });

  it("uses ~/.config on macOS", () => {
    withEnvVar("XDG_CONFIG_HOME", undefined, () => {
      withPlatform("darwin", () => {
        expect(getAppConfigDir(createMockFileSystemService())).toBe(
          "/home/test/.config/githits",
        );
      });
    });
  });

  it("uses XDG_CONFIG_HOME on macOS when set", () => {
    withEnvVar("XDG_CONFIG_HOME", "/xdg/config", () => {
      withPlatform("darwin", () => {
        expect(getAppConfigDir(createMockFileSystemService())).toBe(
          "/xdg/config/githits",
        );
      });
    });
  });

  it("keeps legacy macOS Application Support paths for migration", () => {
    withPlatform("darwin", () => {
      const fs = createMockFileSystemService();
      expect(getLegacyMacAuthConfigPath(fs)).toBe(
        "/home/test/Library/Application Support/githits/config.toml",
      );
      expect(getLegacyMacAuthFileStorageDir(fs)).toBe(
        "/home/test/Library/Application Support/githits/auth",
      );
    });
  });

  it("uses APPDATA on Windows", () => {
    const original = process.env.APPDATA;
    process.env.APPDATA = "C:\\Users\\test\\AppData\\Roaming";
    try {
      withPlatform("win32", () => {
        expect(getAppConfigDir(createMockFileSystemService())).toBe(
          "C:\\Users\\test\\AppData\\Roaming/githits",
        );
      });
    } finally {
      if (original === undefined) delete process.env.APPDATA;
      else process.env.APPDATA = original;
    }
  });

  it("keeps legacy auth storage under ~/.githits", () => {
    expect(getLegacyAuthStorageDir(createMockFileSystemService())).toBe(
      "/home/test/.githits",
    );
  });
});
