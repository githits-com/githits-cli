import { describe, expect, it } from "bun:test";
import {
  getAppConfigDir,
  getAuthConfigPath,
  getAuthFileStorageDir,
  getLegacyAuthStorageDir,
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

describe("app config paths", () => {
  it("uses XDG_CONFIG_HOME on linux", () => {
    const original = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = "/xdg/config";
    try {
      withPlatform("linux", () => {
        const fs = createMockFileSystemService();
        expect(getAppConfigDir(fs)).toBe("/xdg/config/githits");
        expect(getAuthConfigPath(fs)).toBe("/xdg/config/githits/config.toml");
        expect(getAuthFileStorageDir(fs)).toBe("/xdg/config/githits/auth");
      });
    } finally {
      if (original === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = original;
    }
  });

  it("falls back to ~/.config on linux", () => {
    const original = process.env.XDG_CONFIG_HOME;
    delete process.env.XDG_CONFIG_HOME;
    try {
      withPlatform("linux", () => {
        expect(getAppConfigDir(createMockFileSystemService())).toBe(
          "/home/test/.config/githits",
        );
      });
    } finally {
      if (original !== undefined) process.env.XDG_CONFIG_HOME = original;
    }
  });

  it("uses Application Support on macOS", () => {
    withPlatform("darwin", () => {
      expect(getAppConfigDir(createMockFileSystemService())).toBe(
        "/home/test/Library/Application Support/githits",
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
