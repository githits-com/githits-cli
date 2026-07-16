import { describe, expect, it, mock } from "bun:test";
import { chmod, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AuthStorageImpl, normalizeBaseUrl } from "./auth-storage.js";
import { FileSystemServiceImpl } from "./filesystem-service.js";
import { createMockFileSystemService } from "./test-helpers.js";

describe("AuthStorageImpl", () => {
  const BASE_URL = "https://mcp.githits.com";

  describe("loadTokens", () => {
    it("defaults to the platform config auth directory", () => {
      const storage = new AuthStorageImpl(createMockFileSystemService());

      expect(storage.getStorageLocation()).toContain("githits/auth");
    });

    it("returns null when auth file does not exist", async () => {
      const fs = createMockFileSystemService({
        exists: mock(() => Promise.resolve(false)),
      });
      const storage = new AuthStorageImpl(fs, "/test/.githits");

      const result = await storage.loadTokens(BASE_URL);
      expect(result).toBeNull();
    });

    it("returns token data when file exists with matching URL", async () => {
      const stored = {
        version: 1,
        tokens: {
          [BASE_URL]: {
            accessToken: "eyJ-test",
            refreshToken: "refresh-test",
            expiresAt: null,
            createdAt: "2025-01-15T10:00:00Z",
          },
        },
      };
      const fs = createMockFileSystemService({
        exists: mock(() => Promise.resolve(true)),
        readFile: mock(() => Promise.resolve(JSON.stringify(stored))),
      });
      const storage = new AuthStorageImpl(fs, "/test/.githits");

      const result = await storage.loadTokens(BASE_URL);
      expect(result).toEqual(stored.tokens[BASE_URL]);
    });

    it("returns null for non-matching URL", async () => {
      const stored = {
        version: 1,
        tokens: {
          "https://other.example.com": {
            accessToken: "eyJ-test",
            refreshToken: "refresh-test",
            expiresAt: null,
            createdAt: "2025-01-15T10:00:00Z",
          },
        },
      };
      const fs = createMockFileSystemService({
        exists: mock(() => Promise.resolve(true)),
        readFile: mock(() => Promise.resolve(JSON.stringify(stored))),
      });
      const storage = new AuthStorageImpl(fs, "/test/.githits");

      const result = await storage.loadTokens(BASE_URL);
      expect(result).toBeNull();
    });

    it("returns null for invalid JSON", async () => {
      const fs = createMockFileSystemService({
        exists: mock(() => Promise.resolve(true)),
        readFile: mock(() => Promise.resolve("not json")),
      });
      const storage = new AuthStorageImpl(fs, "/test/.githits");

      const result = await storage.loadTokens(BASE_URL);
      expect(result).toBeNull();
    });

    it("returns null for wrong version", async () => {
      const stored = { version: 99, tokens: {} };
      const fs = createMockFileSystemService({
        exists: mock(() => Promise.resolve(true)),
        readFile: mock(() => Promise.resolve(JSON.stringify(stored))),
      });
      const storage = new AuthStorageImpl(fs, "/test/.githits");

      const result = await storage.loadTokens(BASE_URL);
      expect(result).toBeNull();
    });

    it("normalizes trailing slashes on base URL", async () => {
      const stored = {
        version: 1,
        tokens: {
          [BASE_URL]: {
            accessToken: "eyJ-test",
            refreshToken: "refresh-test",
            expiresAt: null,
            createdAt: "2025-01-15T10:00:00Z",
          },
        },
      };
      const fs = createMockFileSystemService({
        exists: mock(() => Promise.resolve(true)),
        readFile: mock(() => Promise.resolve(JSON.stringify(stored))),
      });
      const storage = new AuthStorageImpl(fs, "/test/.githits");

      const result = await storage.loadTokens(`${BASE_URL}/`);
      expect(result).toEqual(stored.tokens[BASE_URL]);
    });
  });

  describe("saveTokens", () => {
    it("creates config directory and writes file with secure permissions", async () => {
      const fs = createMockFileSystemService({
        exists: mock(() => Promise.resolve(false)),
      });
      const storage = new AuthStorageImpl(fs, "/test/.githits");

      await storage.saveTokens(BASE_URL, {
        accessToken: "eyJ-new",
        refreshToken: "refresh-new",
        expiresAt: null,
        createdAt: "2025-01-15T10:00:00Z",
      });

      expect(fs.ensureDir).toHaveBeenCalledWith("/test/.githits", 0o700);
      expect(fs.atomicWriteFile).toHaveBeenCalledWith(
        "/test/.githits/auth.json",
        expect.any(String),
        0o600,
      );

      // Verify the written content
      const calls = (fs.atomicWriteFile as ReturnType<typeof mock>).mock.calls;
      const writtenContent = JSON.parse(calls[0]?.[1] as string);
      expect(writtenContent.version).toBe(1);
      expect(writtenContent.tokens[BASE_URL].accessToken).toBe("eyJ-new");
    });

    it("merges with existing tokens", async () => {
      const existing = {
        version: 1,
        tokens: {
          "https://other.example.com": {
            accessToken: "eyJ-other",
            refreshToken: "refresh-other",
            expiresAt: null,
            createdAt: "2025-01-01T00:00:00Z",
          },
        },
      };
      const fs = createMockFileSystemService({
        exists: mock(() => Promise.resolve(true)),
        readFile: mock(() => Promise.resolve(JSON.stringify(existing))),
      });
      const storage = new AuthStorageImpl(fs, "/test/.githits");

      await storage.saveTokens(BASE_URL, {
        accessToken: "eyJ-new",
        refreshToken: "refresh-new",
        expiresAt: null,
        createdAt: "2025-01-15T10:00:00Z",
      });

      const calls = (fs.atomicWriteFile as ReturnType<typeof mock>).mock.calls;
      const writtenContent = JSON.parse(calls[0]?.[1] as string);
      expect(Object.keys(writtenContent.tokens)).toHaveLength(2);
      expect(writtenContent.tokens[BASE_URL].accessToken).toBe("eyJ-new");
      expect(
        writtenContent.tokens["https://other.example.com"].accessToken,
      ).toBe("eyJ-other");
    });

    it("tightens an existing permissive auth file after save", async () => {
      const dir = await mkdtemp(join(tmpdir(), "githits-auth-storage-"));
      const authPath = join(dir, "auth.json");
      try {
        await writeFile(authPath, JSON.stringify({ version: 1, tokens: {} }), {
          mode: 0o644,
        });
        if (process.platform !== "win32") await chmod(authPath, 0o644);
        const storage = new AuthStorageImpl(new FileSystemServiceImpl(), dir);

        await storage.saveTokens(BASE_URL, {
          accessToken: "eyJ-new",
          refreshToken: "refresh-new",
          expiresAt: null,
          createdAt: "2025-01-15T10:00:00Z",
        });

        expect(await storage.loadTokens(BASE_URL)).toMatchObject({
          accessToken: "eyJ-new",
          refreshToken: "refresh-new",
        });
        if (process.platform !== "win32") {
          expect((await stat(authPath)).mode & 0o777).toBe(0o600);
        }
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });
  });

  describe("clearTokens", () => {
    it("deletes file when last token is removed", async () => {
      const stored = {
        version: 1,
        tokens: {
          [BASE_URL]: {
            accessToken: "eyJ-test",
            refreshToken: "refresh-test",
            expiresAt: null,
            createdAt: "2025-01-15T10:00:00Z",
          },
        },
      };
      const fs = createMockFileSystemService({
        exists: mock(() => Promise.resolve(true)),
        readFile: mock(() => Promise.resolve(JSON.stringify(stored))),
      });
      const storage = new AuthStorageImpl(fs, "/test/.githits");

      await storage.clearTokens(BASE_URL);
      expect(fs.deleteFile).toHaveBeenCalledWith("/test/.githits/auth.json");
    });

    it("keeps file when other tokens remain", async () => {
      const stored = {
        version: 1,
        tokens: {
          [BASE_URL]: {
            accessToken: "eyJ-test",
            refreshToken: "refresh-test",
            expiresAt: null,
            createdAt: "2025-01-15T10:00:00Z",
          },
          "https://other.example.com": {
            accessToken: "eyJ-other",
            refreshToken: "refresh-other",
            expiresAt: null,
            createdAt: "2025-01-01T00:00:00Z",
          },
        },
      };
      const fs = createMockFileSystemService({
        exists: mock(() => Promise.resolve(true)),
        readFile: mock(() => Promise.resolve(JSON.stringify(stored))),
      });
      const storage = new AuthStorageImpl(fs, "/test/.githits");

      await storage.clearTokens(BASE_URL);
      expect(fs.deleteFile).not.toHaveBeenCalled();

      const calls = (fs.atomicWriteFile as ReturnType<typeof mock>).mock.calls;
      const writtenContent = JSON.parse(calls[0]?.[1] as string);
      expect(Object.keys(writtenContent.tokens)).toHaveLength(1);
      expect(writtenContent.tokens[BASE_URL]).toBeUndefined();
      expect(fs.atomicWriteFile).toHaveBeenCalledWith(
        "/test/.githits/auth.json",
        expect.any(String),
        0o600,
      );
    });

    it("does nothing when no auth file exists", async () => {
      const fs = createMockFileSystemService({
        exists: mock(() => Promise.resolve(false)),
      });
      const storage = new AuthStorageImpl(fs, "/test/.githits");

      await storage.clearTokens(BASE_URL);
      expect(fs.deleteFile).not.toHaveBeenCalled();
      expect(fs.atomicWriteFile).not.toHaveBeenCalled();
    });

    it("clearActiveTokensIfUnchanged behaves like the single-backend CAS clear", async () => {
      const token = {
        accessToken: "eyJ-test",
        refreshToken: "refresh-test",
        expiresAt: null,
        createdAt: "2025-01-15T10:00:00Z",
      };
      const fs = createMockFileSystemService({
        exists: mock(() => Promise.resolve(true)),
        readFile: mock(() =>
          Promise.resolve(
            JSON.stringify({ version: 1, tokens: { [BASE_URL]: token } }),
          ),
        ),
      });
      const storage = new AuthStorageImpl(fs, "/test/.githits");

      await expect(
        storage.clearActiveTokensIfUnchanged(BASE_URL, token),
      ).resolves.toBe(true);
      expect(fs.deleteFile).toHaveBeenCalledWith("/test/.githits/auth.json");
    });
  });

  describe("clearAuthSession", () => {
    it("attempts client cleanup even when token cleanup fails", async () => {
      const fs = createMockFileSystemService({
        exists: mock(() => Promise.resolve(true)),
        readFile: mock((path: string) => {
          if (path.endsWith("auth.json")) {
            return Promise.resolve(
              JSON.stringify({
                version: 1,
                tokens: {
                  [BASE_URL]: {
                    accessToken: "eyJ-test",
                    refreshToken: "refresh-test",
                    expiresAt: null,
                    createdAt: "2025-01-15T10:00:00Z",
                  },
                },
              }),
            );
          }
          return Promise.resolve(
            JSON.stringify({
              version: 1,
              clients: {
                [BASE_URL]: {
                  clientId: "client",
                  clientSecret: "secret",
                  redirectUri: "http://127.0.0.1:8080/callback",
                  registeredAt: "2025-01-15T10:00:00Z",
                },
              },
            }),
          );
        }),
        deleteFile: mock((path: string) => {
          if (path.endsWith("auth.json")) {
            return Promise.reject(new Error("token delete failed"));
          }
          return Promise.resolve();
        }),
      });
      const storage = new AuthStorageImpl(fs, "/test/.githits");

      await expect(storage.clearAuthSession(BASE_URL)).rejects.toThrow(
        "token delete failed",
      );

      expect(fs.deleteFile).toHaveBeenCalledWith("/test/.githits/client.json");
    });
  });

  describe("loadClient", () => {
    it("returns null when client file does not exist", async () => {
      const fs = createMockFileSystemService({
        exists: mock(() => Promise.resolve(false)),
      });
      const storage = new AuthStorageImpl(fs, "/test/.githits");

      const result = await storage.loadClient(BASE_URL);
      expect(result).toBeNull();
    });

    it("returns client registration when file exists", async () => {
      const stored = {
        version: 1,
        clients: {
          [BASE_URL]: {
            clientId: "test-client-id",
            clientSecret: "test-secret",
            redirectUri: "http://127.0.0.1:8080/callback",
            registeredAt: "2025-01-15T10:00:00Z",
          },
        },
      };
      // The storage reads auth.json first (for loadTokens), then client.json
      // But loadClient only reads client.json
      const fs = createMockFileSystemService({
        exists: mock(() => Promise.resolve(true)),
        readFile: mock(() => Promise.resolve(JSON.stringify(stored))),
      });
      const storage = new AuthStorageImpl(fs, "/test/.githits");

      const result = await storage.loadClient(BASE_URL);
      expect(result).toEqual(stored.clients[BASE_URL]);
    });
  });

  describe("saveClient", () => {
    it("saves client registration with secure permissions", async () => {
      const fs = createMockFileSystemService({
        exists: mock(() => Promise.resolve(false)),
      });
      const storage = new AuthStorageImpl(fs, "/test/.githits");

      await storage.saveClient(BASE_URL, {
        clientId: "test-client-id",
        clientSecret: "test-secret",
        redirectUri: "http://127.0.0.1:8080/callback",
        registeredAt: "2025-01-15T10:00:00Z",
      });

      expect(fs.ensureDir).toHaveBeenCalledWith("/test/.githits", 0o700);
      expect(fs.atomicWriteFile).toHaveBeenCalledWith(
        "/test/.githits/client.json",
        expect.any(String),
        0o600,
      );
    });
  });

  describe("clearClient", () => {
    it("deletes file when last client is removed", async () => {
      const stored = {
        version: 1,
        clients: {
          [BASE_URL]: {
            clientId: "test-client-id",
            clientSecret: "test-secret",
            redirectUri: "http://127.0.0.1:8080/callback",
            registeredAt: "2025-01-15T10:00:00Z",
          },
        },
      };
      const fs = createMockFileSystemService({
        exists: mock(() => Promise.resolve(true)),
        readFile: mock(() => Promise.resolve(JSON.stringify(stored))),
      });
      const storage = new AuthStorageImpl(fs, "/test/.githits");

      await storage.clearClient(BASE_URL);
      expect(fs.deleteFile).toHaveBeenCalledWith("/test/.githits/client.json");
    });

    it("keeps file when other clients remain", async () => {
      const stored = {
        version: 1,
        clients: {
          [BASE_URL]: {
            clientId: "test-client-id",
            clientSecret: "test-secret",
            redirectUri: "http://127.0.0.1:8080/callback",
            registeredAt: "2025-01-15T10:00:00Z",
          },
          "https://other.example.com": {
            clientId: "other-client-id",
            clientSecret: "other-secret",
            redirectUri: "http://127.0.0.1:9090/callback",
            registeredAt: "2025-01-01T00:00:00Z",
          },
        },
      };
      const fs = createMockFileSystemService({
        exists: mock(() => Promise.resolve(true)),
        readFile: mock(() => Promise.resolve(JSON.stringify(stored))),
      });
      const storage = new AuthStorageImpl(fs, "/test/.githits");

      await storage.clearClient(BASE_URL);
      expect(fs.deleteFile).not.toHaveBeenCalled();

      const calls = (fs.atomicWriteFile as ReturnType<typeof mock>).mock.calls;
      const writtenContent = JSON.parse(calls[0]?.[1] as string);
      expect(Object.keys(writtenContent.clients)).toHaveLength(1);
      expect(writtenContent.clients[BASE_URL]).toBeUndefined();
      expect(fs.atomicWriteFile).toHaveBeenCalledWith(
        "/test/.githits/client.json",
        expect.any(String),
        0o600,
      );
    });

    it("does nothing when no client file exists", async () => {
      const fs = createMockFileSystemService({
        exists: mock(() => Promise.resolve(false)),
      });
      const storage = new AuthStorageImpl(fs, "/test/.githits");

      await storage.clearClient(BASE_URL);
      expect(fs.deleteFile).not.toHaveBeenCalled();
      expect(fs.atomicWriteFile).not.toHaveBeenCalled();
    });
  });

  describe("getStorageLocation", () => {
    it("returns the config directory path", () => {
      const fs = createMockFileSystemService();
      const storage = new AuthStorageImpl(fs, "/test/.githits");
      expect(storage.getStorageLocation()).toBe("/test/.githits");
    });

    it("defaults to the platform config auth path", () => {
      const fs = createMockFileSystemService({
        getHomeDir: mock(() => "/home/user"),
        joinPath: mock((...segments: string[]) => segments.join("/")),
      });
      const storage = new AuthStorageImpl(fs);
      expect(storage.getStorageLocation()).toContain("/githits/auth");
    });
  });
});

describe("normalizeBaseUrl", () => {
  it("strips trailing slashes", () => {
    expect(normalizeBaseUrl("https://mcp.githits.com/")).toBe(
      "https://mcp.githits.com",
    );
  });

  it("strips multiple trailing slashes", () => {
    expect(normalizeBaseUrl("https://mcp.githits.com///")).toBe(
      "https://mcp.githits.com",
    );
  });

  it("returns URL unchanged when no trailing slash", () => {
    expect(normalizeBaseUrl("https://mcp.githits.com")).toBe(
      "https://mcp.githits.com",
    );
  });

  it("handles empty string", () => {
    expect(normalizeBaseUrl("")).toBe("");
  });
});
