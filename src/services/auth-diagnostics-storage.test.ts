import { describe, expect, it, mock } from "bun:test";
import { AuthDiagnosticsStorage } from "./auth-diagnostics-storage.js";
import { createMockFileSystemService } from "./test-helpers.js";

describe("AuthDiagnosticsStorage", () => {
  const BASE_URL = "https://mcp.githits.com";

  it("returns null when the diagnostics file does not exist", async () => {
    const storage = new AuthDiagnosticsStorage(
      createMockFileSystemService({
        exists: mock(() => Promise.resolve(false)),
      }),
      "/test/auth",
    );

    await expect(storage.load(BASE_URL)).resolves.toBeNull();
  });

  it("records a clear breadcrumb with reason and timestamp", async () => {
    const fs = createMockFileSystemService({
      exists: mock(() => Promise.resolve(false)),
    });
    const storage = new AuthDiagnosticsStorage(fs, "/test/auth");

    await storage.recordClear(BASE_URL, "terminal_invalid_refresh_token");

    expect(fs.ensureDir).toHaveBeenCalledWith("/test/auth", 0o700);
    expect(fs.atomicWriteFile).toHaveBeenCalledWith(
      "/test/auth/diagnostics.json",
      expect.any(String),
    );
    const calls = (fs.atomicWriteFile as ReturnType<typeof mock>).mock.calls;
    const written = JSON.parse(calls[0]?.[1] as string);
    expect(written.events[BASE_URL].reason).toBe(
      "terminal_invalid_refresh_token",
    );
    expect(typeof written.events[BASE_URL].at).toBe("string");
    expect(written.events[BASE_URL].at.length).toBeGreaterThan(0);
  });

  it("preserves other entries and overwrites the same base URL", async () => {
    const existing = {
      version: 1,
      events: {
        "https://other.githits.com": {
          reason: "logout",
          at: "2026-01-01T00:00:00Z",
        },
        [BASE_URL]: {
          reason: "logout",
          at: "2026-01-01T00:00:00Z",
        },
      },
    };
    const fs = createMockFileSystemService({
      exists: mock(() => Promise.resolve(true)),
      readFile: mock(() => Promise.resolve(JSON.stringify(existing))),
    });
    const storage = new AuthDiagnosticsStorage(fs, "/test/auth");

    await storage.recordClear(BASE_URL, "terminal_invalid_client");

    const calls = (fs.atomicWriteFile as ReturnType<typeof mock>).mock.calls;
    const written = JSON.parse(calls[0]?.[1] as string);
    // Same base URL is overwritten with the new reason...
    expect(written.events[BASE_URL].reason).toBe("terminal_invalid_client");
    // ...while unrelated entries are retained.
    expect(written.events["https://other.githits.com"].reason).toBe("logout");
  });

  it("never deletes the file — retention is the point", async () => {
    const fs = createMockFileSystemService({
      exists: mock(() => Promise.resolve(true)),
      readFile: mock(() =>
        Promise.resolve(
          JSON.stringify({
            version: 1,
            events: {
              [BASE_URL]: { reason: "logout", at: "2026-01-01T00:00:00Z" },
            },
          }),
        ),
      ),
    });
    const storage = new AuthDiagnosticsStorage(fs, "/test/auth");

    await storage.recordClear(BASE_URL, "logout");

    expect(fs.deleteFile).not.toHaveBeenCalled();
  });

  it("loads an event with a normalized base URL", async () => {
    const stored = {
      version: 1,
      events: {
        [BASE_URL]: { reason: "logout", at: "2026-01-01T00:00:00Z" },
      },
    };
    const storage = new AuthDiagnosticsStorage(
      createMockFileSystemService({
        exists: mock(() => Promise.resolve(true)),
        readFile: mock(() => Promise.resolve(JSON.stringify(stored))),
      }),
      "/test/auth",
    );

    await expect(storage.load(`${BASE_URL}/`)).resolves.toEqual({
      reason: "logout",
      at: "2026-01-01T00:00:00Z",
    });
  });

  it("returns null for an unrecognized reason value", async () => {
    const stored = {
      version: 1,
      events: {
        [BASE_URL]: { reason: "not-a-real-reason", at: "2026-01-01T00:00:00Z" },
      },
    };
    const storage = new AuthDiagnosticsStorage(
      createMockFileSystemService({
        exists: mock(() => Promise.resolve(true)),
        readFile: mock(() => Promise.resolve(JSON.stringify(stored))),
      }),
      "/test/auth",
    );

    await expect(storage.load(BASE_URL)).resolves.toBeNull();
  });

  it("swallows write failures so it never breaks the observed clear path", async () => {
    const storage = new AuthDiagnosticsStorage(
      createMockFileSystemService({
        exists: mock(() => Promise.resolve(false)),
        atomicWriteFile: mock(() => Promise.reject(new Error("disk full"))),
      }),
      "/test/auth",
    );

    await expect(
      storage.recordClear(BASE_URL, "logout"),
    ).resolves.toBeUndefined();
  });
});
