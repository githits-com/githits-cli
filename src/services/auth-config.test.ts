import { describe, expect, it, mock } from "bun:test";
import {
  AuthConfigError,
  loadAuthConfig,
  parseAuthStorageMode,
} from "./auth-config.js";
import { createMockFileSystemService } from "./test-helpers.js";

async function withEnv<T>(
  value: string | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  const original = process.env.GITHITS_AUTH_STORAGE;
  if (value === undefined) delete process.env.GITHITS_AUTH_STORAGE;
  else process.env.GITHITS_AUTH_STORAGE = value;
  try {
    return await fn();
  } finally {
    if (original === undefined) delete process.env.GITHITS_AUTH_STORAGE;
    else process.env.GITHITS_AUTH_STORAGE = original;
  }
}

async function withPlatform<T>(
  platform: NodeJS.Platform,
  fn: () => Promise<T>,
): Promise<T> {
  const originalPlatform = process.platform;
  Object.defineProperty(process, "platform", { value: platform });
  try {
    return await fn();
  } finally {
    Object.defineProperty(process, "platform", { value: originalPlatform });
  }
}

describe("auth config", () => {
  it("parses storage modes case-insensitively", () => {
    expect(parseAuthStorageMode("keychain")).toBe("keychain");
    expect(parseAuthStorageMode(" KEYCHAIN ")).toBe("keychain");
    expect(parseAuthStorageMode("file")).toBe("file");
  });

  it("rejects invalid storage mode", () => {
    expect(() => parseAuthStorageMode("plaintext")).toThrow(AuthConfigError);
  });

  it("defaults to keychain when config file is missing", async () => {
    await withEnv(undefined, async () => {
      const config = await loadAuthConfig(
        createMockFileSystemService({
          exists: mock(() => Promise.resolve(false)),
        }),
      );
      expect(config.storage).toBe("keychain");
      expect(config.configPath).toContain("githits/config.toml");
    });
  });

  it("reads file mode from config.toml", async () => {
    await withEnv(undefined, async () => {
      const config = await loadAuthConfig(
        createMockFileSystemService({
          exists: mock(() => Promise.resolve(true)),
          readFile: mock(() => Promise.resolve('[auth]\nstorage = "file"\n')),
        }),
      );
      expect(config.storage).toBe("file");
    });
  });

  it("falls back to the old macOS config path for existing installs", async () => {
    await withEnv(undefined, async () => {
      await withPlatform("darwin", async () => {
        const config = await loadAuthConfig(
          createMockFileSystemService({
            exists: mock((path: string) =>
              Promise.resolve(path.includes("Library/Application Support")),
            ),
            readFile: mock(() => Promise.resolve('[auth]\nstorage = "file"\n')),
          }),
        );
        expect(config).toEqual({
          storage: "file",
          configPath:
            "/home/test/Library/Application Support/githits/config.toml",
        });
      });
    });
  });

  it("uses env override before config file", async () => {
    await withEnv("file", async () => {
      const fs = createMockFileSystemService({
        exists: mock(() => Promise.resolve(true)),
        readFile: mock(() => Promise.resolve('[auth]\nstorage = "keychain"\n')),
      });
      const config = await loadAuthConfig(fs);
      expect(config.storage).toBe("file");
      expect(fs.readFile).not.toHaveBeenCalled();
    });
  });

  it("rejects invalid env override", async () => {
    await withEnv("plaintext", async () => {
      await expect(
        loadAuthConfig(createMockFileSystemService()),
      ).rejects.toThrow(/GITHITS_AUTH_STORAGE/);
    });
  });

  it("ignores blank env override and falls back to config", async () => {
    await withEnv("   ", async () => {
      const config = await loadAuthConfig(
        createMockFileSystemService({
          exists: mock(() => Promise.resolve(true)),
          readFile: mock(() => Promise.resolve('[auth]\nstorage = "file"\n')),
        }),
      );
      expect(config.storage).toBe("file");
    });
  });

  it("rejects invalid TOML", async () => {
    await withEnv(undefined, async () => {
      await expect(
        loadAuthConfig(
          createMockFileSystemService({
            exists: mock(() => Promise.resolve(true)),
            readFile: mock(() => Promise.resolve("[auth\n")),
          }),
        ),
      ).rejects.toThrow(/Cannot parse GitHits config/);
    });
  });

  it("rejects invalid auth.storage in config", async () => {
    await withEnv(undefined, async () => {
      await expect(
        loadAuthConfig(
          createMockFileSystemService({
            exists: mock(() => Promise.resolve(true)),
            readFile: mock(() =>
              Promise.resolve('[auth]\nstorage = "plaintext"\n'),
            ),
          }),
        ),
      ).rejects.toThrow(/Invalid GitHits config/);
    });
  });

  it("does not validate the experimental subsection for auth", async () => {
    await withEnv(undefined, async () => {
      const config = await loadAuthConfig(
        createMockFileSystemService({
          exists: mock(() => Promise.resolve(true)),
          readFile: mock(() =>
            Promise.resolve(
              '[experimental]\ntools = "not-a-boolean"\n\n[auth]\nstorage = "file"\n',
            ),
          ),
        }),
      );
      expect(config.storage).toBe("file");
    });
  });
});
