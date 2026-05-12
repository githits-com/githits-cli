import { describe, expect, it, mock } from "bun:test";
import { AuthSessionMetadataStorage } from "./auth-session-metadata-storage.js";
import {
  createMockFileSystemService,
  createValidTokenData,
} from "./test-helpers.js";

describe("AuthSessionMetadataStorage", () => {
  const BASE_URL = "https://mcp.githits.com";

  it("returns null when metadata file does not exist", async () => {
    const storage = new AuthSessionMetadataStorage(
      createMockFileSystemService({
        exists: mock(() => Promise.resolve(false)),
      }),
      "/test/auth",
    );

    await expect(storage.load(BASE_URL)).resolves.toBeNull();
  });

  it("saves non-secret token metadata", async () => {
    const fs = createMockFileSystemService({
      exists: mock(() => Promise.resolve(false)),
    });
    const storage = new AuthSessionMetadataStorage(fs, "/test/auth");

    await storage.saveFromTokens(
      BASE_URL,
      createValidTokenData({
        accessToken: "secret-access",
        refreshToken: "secret-refresh",
        createdAt: "2026-01-01T00:00:00Z",
        expiresAt: "2026-01-01T01:00:00Z",
      }),
    );

    expect(fs.ensureDir).toHaveBeenCalledWith("/test/auth", 0o700);
    expect(fs.atomicWriteFile).toHaveBeenCalledWith(
      "/test/auth/metadata.json",
      expect.any(String),
    );
    const calls = (fs.atomicWriteFile as ReturnType<typeof mock>).mock.calls;
    const written = JSON.parse(calls[0]?.[1] as string);
    expect(written.sessions[BASE_URL]).toMatchObject({
      createdAt: "2026-01-01T00:00:00Z",
      expiresAt: "2026-01-01T01:00:00Z",
    });
    expect(JSON.stringify(written)).not.toContain("secret-access");
    expect(JSON.stringify(written)).not.toContain("secret-refresh");
  });

  it("loads metadata with normalized base URL", async () => {
    const metadata = {
      version: 1,
      sessions: {
        [BASE_URL]: {
          createdAt: "2026-01-01T00:00:00Z",
          expiresAt: null,
          updatedAt: "2026-01-01T00:00:00Z",
        },
      },
    };
    const storage = new AuthSessionMetadataStorage(
      createMockFileSystemService({
        exists: mock(() => Promise.resolve(true)),
        readFile: mock(() => Promise.resolve(JSON.stringify(metadata))),
      }),
      "/test/auth",
    );

    await expect(storage.load(`${BASE_URL}/`)).resolves.toEqual(
      metadata.sessions[BASE_URL],
    );
  });

  it("returns null for malformed metadata entries", async () => {
    const metadata = {
      version: 1,
      sessions: {
        [BASE_URL]: {
          createdAt: "2026-01-01T00:00:00Z",
          expiresAt: null,
        },
      },
    };
    const storage = new AuthSessionMetadataStorage(
      createMockFileSystemService({
        exists: mock(() => Promise.resolve(true)),
        readFile: mock(() => Promise.resolve(JSON.stringify(metadata))),
      }),
      "/test/auth",
    );

    await expect(storage.load(BASE_URL)).resolves.toBeNull();
  });

  it("clears the metadata file when last session is removed", async () => {
    const metadata = {
      version: 1,
      sessions: {
        [BASE_URL]: {
          createdAt: "2026-01-01T00:00:00Z",
          expiresAt: null,
          updatedAt: "2026-01-01T00:00:00Z",
        },
      },
    };
    const fs = createMockFileSystemService({
      exists: mock(() => Promise.resolve(true)),
      readFile: mock(() => Promise.resolve(JSON.stringify(metadata))),
    });
    const storage = new AuthSessionMetadataStorage(fs, "/test/auth");

    await storage.clear(BASE_URL);

    expect(fs.deleteFile).toHaveBeenCalledWith("/test/auth/metadata.json");
  });
});
