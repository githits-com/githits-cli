import { describe, expect, it, mock } from "bun:test";
import { AppConfigError, readAppConfig } from "./app-config.js";
import {
  createMockFileSystemService,
  createPlatformMockFileSystemService,
  withTestEnvVar,
  withTestPlatform,
} from "./test-helpers.js";

async function withDefaultLinuxConfigPath<T>(fn: () => Promise<T>): Promise<T> {
  return withTestPlatform("linux", () =>
    withTestEnvVar("XDG_CONFIG_HOME", undefined, fn),
  );
}

describe("shared app config", () => {
  it("returns an empty document at the canonical path when missing", async () => {
    const fs = createMockFileSystemService();

    await withDefaultLinuxConfigPath(async () => {
      await expect(readAppConfig(fs)).resolves.toEqual({
        configPath: "/home/test/.config/githits/config.toml",
        data: {},
      });
    });
    expect(fs.readFile).not.toHaveBeenCalled();
  });

  it("reads and parses the canonical config path", async () => {
    const fs = createMockFileSystemService({
      exists: mock(() => Promise.resolve(true)),
      readFile: mock(() => Promise.resolve('[auth]\nstorage = "file"\n')),
    });

    await withDefaultLinuxConfigPath(async () => {
      await expect(readAppConfig(fs)).resolves.toEqual({
        configPath: "/home/test/.config/githits/config.toml",
        data: { auth: { storage: "file" } },
      });
    });
    expect(fs.readFile).toHaveBeenCalledWith(
      "/home/test/.config/githits/config.toml",
    );
  });

  it("uses XDG and Windows platform config paths", async () => {
    await withTestEnvVar("XDG_CONFIG_HOME", "/xdg/config", async () => {
      await withTestPlatform("linux", async () => {
        const fs = createMockFileSystemService({
          exists: mock(() => Promise.resolve(false)),
        });
        await expect(readAppConfig(fs)).resolves.toMatchObject({
          configPath: "/xdg/config/githits/config.toml",
        });
      });
    });

    await withTestPlatform("win32", async () => {
      await withTestEnvVar(
        "APPDATA",
        "C:\\Users\\test\\AppData\\Roaming",
        async () => {
          const fs = createPlatformMockFileSystemService("win32");
          await expect(readAppConfig(fs)).resolves.toMatchObject({
            configPath:
              "C:\\Users\\test\\AppData\\Roaming\\githits\\config.toml",
          });
        },
      );
    });
  });

  it("falls back to an existing legacy macOS config path", async () => {
    const fs = createMockFileSystemService({
      exists: mock((path: string) =>
        Promise.resolve(path.includes("Library/Application Support")),
      ),
      readFile: mock(() => Promise.resolve('[auth]\nstorage = "file"\n')),
    });

    await withTestPlatform("darwin", async () => {
      await expect(readAppConfig(fs)).resolves.toEqual({
        configPath:
          "/home/test/Library/Application Support/githits/config.toml",
        data: { auth: { storage: "file" } },
      });
    });
  });

  it("rejects invalid TOML with the selected path", async () => {
    const fs = createMockFileSystemService({
      exists: mock(() => Promise.resolve(true)),
      readFile: mock(() => Promise.resolve("[auth\n")),
    });

    await withDefaultLinuxConfigPath(async () => {
      await expect(readAppConfig(fs)).rejects.toThrow(
        /Cannot parse GitHits config at \/home\/test\/\.config\/githits\/config\.toml/,
      );
      await expect(readAppConfig(fs)).rejects.toBeInstanceOf(AppConfigError);
    });
  });
});
