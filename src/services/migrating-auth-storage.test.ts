import { describe, expect, it, mock } from "bun:test";
import { KeychainUnavailableError } from "./keyring-service.js";
import { MigratingAuthStorage } from "./migrating-auth-storage.js";
import { AuthStoragePolicyError } from "./mode-aware-file-auth-storage.js";
import {
  createMockAuthStorage,
  createValidTokenData,
  defaultClientRegistration,
} from "./test-helpers.js";

describe("MigratingAuthStorage", () => {
  const BASE_URL = "https://mcp.githits.com";

  it("requires load locking only when file-mode migration can mutate", () => {
    const primary = createMockAuthStorage();
    const file = createMockAuthStorage();
    const legacy = createMockAuthStorage();

    expect(
      new MigratingAuthStorage(primary, file, legacy, "keychain")
        .requiresLoadLock,
    ).toBe(false);
    expect(
      new MigratingAuthStorage(primary, file, legacy, "file").requiresLoadLock,
    ).toBe(true);
  });

  it("keychain mode returns from keychain first", async () => {
    const token = createValidTokenData();
    const primary = createMockAuthStorage({
      loadTokens: mock(() => Promise.resolve(token)),
    });
    const file = createMockAuthStorage();
    const legacy = createMockAuthStorage();
    const storage = new MigratingAuthStorage(primary, file, legacy, "keychain");

    await expect(storage.loadTokens(BASE_URL)).resolves.toEqual(token);
    expect(file.loadTokens).not.toHaveBeenCalled();
    expect(legacy.loadTokens).not.toHaveBeenCalled();
  });

  it("records metadata when keychain mode reads keychain tokens", async () => {
    const token = createValidTokenData();
    const primary = createMockAuthStorage({
      loadTokens: mock(() => Promise.resolve(token)),
    });
    const metadata = {
      load: mock(() => Promise.resolve(null)),
      saveFromTokens: mock(() => Promise.resolve()),
      clear: mock(() => Promise.resolve()),
    };
    const storage = new MigratingAuthStorage(
      primary,
      createMockAuthStorage(),
      createMockAuthStorage(),
      "keychain",
      "test-config.toml",
      () => {},
      metadata,
    );

    await expect(storage.loadTokens(BASE_URL)).resolves.toEqual(token);
    expect(metadata.saveFromTokens).toHaveBeenCalledWith(BASE_URL, token);
  });

  it("clears metadata when clearing auth session", async () => {
    const metadata = {
      load: mock(() => Promise.resolve(null)),
      saveFromTokens: mock(() => Promise.resolve()),
      clear: mock(() => Promise.resolve()),
    };
    const storage = new MigratingAuthStorage(
      createMockAuthStorage(),
      createMockAuthStorage(),
      createMockAuthStorage(),
      "keychain",
      "test-config.toml",
      () => {},
      metadata,
    );

    await storage.clearAuthSession(BASE_URL);

    expect(metadata.clear).toHaveBeenCalledWith(BASE_URL);
  });

  it("keychain mode ignores file tokens instead of migrating across storage modes", async () => {
    const token = createValidTokenData();
    const primary = createMockAuthStorage();
    const file = createMockAuthStorage({
      loadTokens: mock(() => Promise.resolve(token)),
    });
    const legacy = createMockAuthStorage();
    const storage = new MigratingAuthStorage(primary, file, legacy, "keychain");

    await expect(storage.loadTokens(BASE_URL)).resolves.toBeNull();
    expect(file.loadTokens).not.toHaveBeenCalled();
    expect(primary.saveTokens).not.toHaveBeenCalled();
    expect(file.clearTokens).not.toHaveBeenCalled();
    expect(legacy.clearTokens).not.toHaveBeenCalled();
  });

  it("keychain mode does not touch file metadata when file tokens exist", async () => {
    const token = createValidTokenData();
    const primary = createMockAuthStorage();
    const file = createMockAuthStorage({
      loadTokens: mock(() => Promise.resolve(token)),
    });
    const legacy = createMockAuthStorage();
    const metadata = {
      load: mock(() => Promise.resolve(null)),
      saveFromTokens: mock(() => Promise.resolve()),
      clear: mock(() => Promise.resolve()),
    };
    const storage = new MigratingAuthStorage(
      primary,
      file,
      legacy,
      "keychain",
      "test-config.toml",
      () => {},
      metadata,
    );

    await expect(storage.loadTokens(BASE_URL)).resolves.toBeNull();

    expect(file.loadTokens).not.toHaveBeenCalled();
    expect(primary.saveTokens).not.toHaveBeenCalled();
    expect(file.clearTokens).not.toHaveBeenCalled();
    expect(metadata.clear).not.toHaveBeenCalled();
    expect(metadata.saveFromTokens).not.toHaveBeenCalled();
  });

  it("keychain mode ignores legacy plaintext tokens instead of migrating across storage modes", async () => {
    const token = createValidTokenData();
    const primary = createMockAuthStorage();
    const file = createMockAuthStorage();
    const legacy = createMockAuthStorage({
      loadTokens: mock(() => Promise.resolve(token)),
    });
    const storage = new MigratingAuthStorage(primary, file, legacy, "keychain");

    await expect(storage.loadTokens(BASE_URL)).resolves.toBeNull();
    expect(legacy.loadTokens).not.toHaveBeenCalled();
    expect(primary.saveTokens).not.toHaveBeenCalled();
    expect(legacy.clearTokens).not.toHaveBeenCalled();
  });

  it("keychain mode returns null when keychain is unavailable instead of falling back to plaintext", async () => {
    const token = createValidTokenData();
    const primary = createMockAuthStorage({
      loadTokens: mock(() =>
        Promise.reject(new KeychainUnavailableError("keychain locked")),
      ),
    });
    const file = createMockAuthStorage({
      loadTokens: mock(() => Promise.resolve(token)),
    });
    const legacy = createMockAuthStorage();
    const storage = new MigratingAuthStorage(primary, file, legacy, "keychain");

    await expect(storage.loadTokens(BASE_URL)).resolves.toBeNull();
    expect(file.loadTokens).not.toHaveBeenCalled();
    expect(file.clearTokens).not.toHaveBeenCalled();
  });

  it("keychain mode save fails instead of writing plaintext when keychain is unavailable", async () => {
    const token = createValidTokenData();
    const primary = createMockAuthStorage({
      saveTokens: mock(() =>
        Promise.reject(new KeychainUnavailableError("keychain locked")),
      ),
    });
    const file = createMockAuthStorage();
    const storage = new MigratingAuthStorage(
      primary,
      file,
      createMockAuthStorage(),
      "keychain",
      "/home/test/.config/githits/config.toml",
    );

    await expect(storage.saveTokens(BASE_URL, token)).rejects.toThrow(
      AuthStoragePolicyError,
    );
    await expect(storage.saveTokens(BASE_URL, token)).rejects.toThrow(
      /Warning: file storage is plaintext/,
    );
    await expect(storage.saveTokens(BASE_URL, token)).rejects.toThrow(
      /\[auth\]\n {5}storage = "file"/,
    );
    await expect(storage.saveTokens(BASE_URL, token)).rejects.toThrow(
      /\/home\/test\/\.config\/githits\/config\.toml/,
    );
    expect(file.saveTokens).not.toHaveBeenCalled();
  });

  it("file mode writes only to new file storage", async () => {
    const token = createValidTokenData();
    const primary = createMockAuthStorage();
    const file = createMockAuthStorage();
    const storage = new MigratingAuthStorage(
      primary,
      file,
      createMockAuthStorage(),
      "file",
    );

    await storage.saveTokens(BASE_URL, token);
    expect(file.saveTokens).toHaveBeenCalledWith(BASE_URL, token);
    expect(primary.saveTokens).not.toHaveBeenCalled();
  });

  it("file mode migrates legacy tokens into new file storage", async () => {
    const token = createValidTokenData();
    const file = createMockAuthStorage();
    const legacy = createMockAuthStorage({
      loadTokens: mock(() => Promise.resolve(token)),
    });
    const storage = new MigratingAuthStorage(
      createMockAuthStorage(),
      file,
      legacy,
      "file",
    );

    await expect(storage.loadTokens(BASE_URL)).resolves.toEqual(token);
    expect(file.saveTokens).toHaveBeenCalledWith(BASE_URL, token);
    expect(legacy.clearTokens).toHaveBeenCalledWith(BASE_URL);
  });

  it("file mode chooses newer legacy tokens when both plaintext stores exist", async () => {
    const older = createValidTokenData({ createdAt: "2025-01-01T00:00:00Z" });
    const newer = createValidTokenData({ createdAt: "2025-02-01T00:00:00Z" });
    const file = createMockAuthStorage({
      loadTokens: mock(() => Promise.resolve(older)),
    });
    const legacy = createMockAuthStorage({
      loadTokens: mock(() => Promise.resolve(newer)),
    });
    const storage = new MigratingAuthStorage(
      createMockAuthStorage(),
      file,
      legacy,
      "file",
    );

    await expect(storage.loadTokens(BASE_URL)).resolves.toEqual(newer);
    expect(file.saveTokens).toHaveBeenCalledWith(BASE_URL, newer);
    expect(legacy.clearTokens).toHaveBeenCalledWith(BASE_URL);
  });

  it("file mode keeps newer file tokens when legacy is older", async () => {
    const newer = createValidTokenData({ createdAt: "2025-02-01T00:00:00Z" });
    const older = createValidTokenData({ createdAt: "2025-01-01T00:00:00Z" });
    const file = createMockAuthStorage({
      loadTokens: mock(() => Promise.resolve(newer)),
    });
    const legacy = createMockAuthStorage({
      loadTokens: mock(() => Promise.resolve(older)),
    });
    const storage = new MigratingAuthStorage(
      createMockAuthStorage(),
      file,
      legacy,
      "file",
    );

    await expect(storage.loadTokens(BASE_URL)).resolves.toEqual(newer);
    expect(file.saveTokens).not.toHaveBeenCalled();
    expect(legacy.clearTokens).not.toHaveBeenCalled();
  });

  it("re-persists tied canonical tokens before clearing all legacy copies", async () => {
    const events: string[] = [];
    const canonical = createValidTokenData({
      accessToken: "canonical-token",
      createdAt: "2025-01-01T00:00:00Z",
    });
    const file = createMockAuthStorage({
      loadTokens: mock(() => Promise.resolve(canonical)),
      saveTokens: mock(() => {
        events.push("canonical-save");
        return Promise.resolve();
      }),
    });
    const additionalLegacy = createMockAuthStorage({
      loadTokens: mock(() =>
        Promise.resolve(
          createValidTokenData({
            accessToken: "additional-legacy-token",
            createdAt: canonical.createdAt,
          }),
        ),
      ),
      clearTokens: mock(() => {
        events.push("additional-legacy-clear");
        return Promise.reject(new Error("cleanup failed"));
      }),
    });
    const legacy = createMockAuthStorage({
      loadTokens: mock(() =>
        Promise.resolve(
          createValidTokenData({
            accessToken: "legacy-token",
            createdAt: canonical.createdAt,
          }),
        ),
      ),
      clearTokens: mock(() => {
        events.push("legacy-clear");
        return Promise.resolve();
      }),
    });
    const warning = mock(() => {});
    const storage = new MigratingAuthStorage(
      createMockAuthStorage(),
      file,
      legacy,
      "file",
      "test-config.toml",
      warning,
      undefined,
      [additionalLegacy],
    );

    await expect(storage.loadTokens(BASE_URL)).resolves.toEqual(canonical);
    expect(events).toEqual([
      "canonical-save",
      "additional-legacy-clear",
      "legacy-clear",
    ]);
    expect(file.saveTokens).toHaveBeenCalledWith(BASE_URL, canonical);
    expect(warning).not.toHaveBeenCalled();
  });

  it("reconciles invalid token timestamps through the canonical file", async () => {
    const canonical = createValidTokenData({
      accessToken: "canonical-token",
      createdAt: "not-a-date",
    });
    const file = createMockAuthStorage({
      loadTokens: mock(() => Promise.resolve(canonical)),
    });
    const legacy = createMockAuthStorage({
      loadTokens: mock(() =>
        Promise.resolve(
          createValidTokenData({
            accessToken: "legacy-token",
            createdAt: "also-not-a-date",
          }),
        ),
      ),
    });
    const storage = new MigratingAuthStorage(
      createMockAuthStorage(),
      file,
      legacy,
      "file",
    );

    await expect(storage.loadTokens(BASE_URL)).resolves.toEqual(canonical);
    expect(file.saveTokens).toHaveBeenCalledWith(BASE_URL, canonical);
    expect(legacy.clearTokens).toHaveBeenCalledWith(BASE_URL);
  });

  it("leaves legacy tokens untouched when canonical reconciliation fails", async () => {
    const canonical = createValidTokenData({
      createdAt: "2025-01-01T00:00:00Z",
    });
    const file = createMockAuthStorage({
      loadTokens: mock(() => Promise.resolve(canonical)),
      saveTokens: mock(() => Promise.reject(new Error("save failed"))),
    });
    const legacy = createMockAuthStorage({
      loadTokens: mock(() =>
        Promise.resolve(
          createValidTokenData({ createdAt: canonical.createdAt }),
        ),
      ),
    });
    const storage = new MigratingAuthStorage(
      createMockAuthStorage(),
      file,
      legacy,
      "file",
    );

    await expect(storage.loadTokens(BASE_URL)).rejects.toThrow("save failed");
    expect(legacy.clearTokens).not.toHaveBeenCalled();
  });

  it("file mode ignores keychain tokens instead of exporting across storage modes", async () => {
    const token = createValidTokenData();
    const primary = createMockAuthStorage({
      loadTokens: mock(() => Promise.resolve(token)),
    });
    const file = createMockAuthStorage();
    const legacy = createMockAuthStorage();
    const warning = mock(() => {});
    const storage = new MigratingAuthStorage(
      primary,
      file,
      legacy,
      "file",
      "test-config.toml",
      warning,
    );

    await expect(storage.loadTokens(BASE_URL)).resolves.toBeNull();
    expect(primary.loadTokens).not.toHaveBeenCalled();
    expect(file.saveTokens).not.toHaveBeenCalled();
    expect(warning).not.toHaveBeenCalled();
  });

  it("keychain mode does not inspect plaintext candidates", async () => {
    const older = createValidTokenData({ createdAt: "2025-01-01T00:00:00Z" });
    const newer = createValidTokenData({ createdAt: "2025-02-01T00:00:00Z" });
    const primary = createMockAuthStorage();
    const file = createMockAuthStorage({
      loadTokens: mock(() => Promise.resolve(older)),
    });
    const legacy = createMockAuthStorage({
      loadTokens: mock(() => Promise.resolve(newer)),
    });
    const storage = new MigratingAuthStorage(primary, file, legacy, "keychain");

    await expect(storage.loadTokens(BASE_URL)).resolves.toBeNull();
    expect(file.loadTokens).not.toHaveBeenCalled();
    expect(legacy.loadTokens).not.toHaveBeenCalled();
    expect(primary.saveTokens).not.toHaveBeenCalled();
    expect(legacy.clearTokens).not.toHaveBeenCalled();
    expect(file.clearTokens).not.toHaveBeenCalled();
  });

  it("keychain mode does not warn about ambiguous plaintext entries", async () => {
    const token = createValidTokenData({ createdAt: "2025-01-01T00:00:00Z" });
    const primary = createMockAuthStorage();
    const file = createMockAuthStorage({
      loadTokens: mock(() => Promise.resolve(token)),
    });
    const legacy = createMockAuthStorage({
      loadTokens: mock(() =>
        Promise.resolve(createValidTokenData({ createdAt: token.createdAt })),
      ),
    });
    const warning = mock(() => {});
    const storage = new MigratingAuthStorage(
      primary,
      file,
      legacy,
      "keychain",
      "test-config.toml",
      warning,
    );

    await expect(storage.loadTokens(BASE_URL)).resolves.toBeNull();
    expect(file.loadTokens).not.toHaveBeenCalled();
    expect(legacy.loadTokens).not.toHaveBeenCalled();
    expect(file.clearTokens).not.toHaveBeenCalled();
    expect(legacy.clearTokens).not.toHaveBeenCalled();
    expect(warning).not.toHaveBeenCalled();
  });

  it("does not migrate when only legacy stores have ambiguous timestamps", async () => {
    const token = createValidTokenData({ createdAt: "not-a-date" });
    const additionalLegacy = createMockAuthStorage({
      loadTokens: mock(() => Promise.resolve(token)),
    });
    const legacy = createMockAuthStorage({
      loadTokens: mock(() =>
        Promise.resolve(
          createValidTokenData({
            accessToken: "other-token",
            createdAt: "also-not-a-date",
          }),
        ),
      ),
    });
    const warning = mock(() => {});
    const file = createMockAuthStorage();
    const storage = new MigratingAuthStorage(
      createMockAuthStorage(),
      file,
      legacy,
      "file",
      "test-config.toml",
      warning,
      undefined,
      [additionalLegacy],
    );

    await expect(storage.loadTokens(BASE_URL)).resolves.toBeNull();
    expect(file.saveTokens).not.toHaveBeenCalled();
    expect(additionalLegacy.clearTokens).not.toHaveBeenCalled();
    expect(legacy.clearTokens).not.toHaveBeenCalled();
    expect(warning).toHaveBeenCalledTimes(1);
  });

  it("clears all legacy stores during logout", async () => {
    const additionalLegacy = createMockAuthStorage();
    const legacy = createMockAuthStorage();
    const storage = new MigratingAuthStorage(
      createMockAuthStorage(),
      createMockAuthStorage(),
      legacy,
      "keychain",
      "test-config.toml",
      () => {},
      undefined,
      [additionalLegacy],
    );

    await storage.clearAuthSession(BASE_URL);

    expect(additionalLegacy.clearAuthSession).toHaveBeenCalledWith(BASE_URL);
    expect(legacy.clearAuthSession).toHaveBeenCalledWith(BASE_URL);
  });

  it("keychain mode ignores plaintext clients instead of migrating across storage modes", async () => {
    const older = {
      ...defaultClientRegistration,
      registeredAt: "2025-01-01T00:00:00Z",
    };
    const newer = {
      ...defaultClientRegistration,
      clientId: "newer-client",
      registeredAt: "2025-02-01T00:00:00Z",
    };
    const primary = createMockAuthStorage();
    const file = createMockAuthStorage({
      loadClient: mock(() => Promise.resolve(older)),
    });
    const legacy = createMockAuthStorage({
      loadClient: mock(() => Promise.resolve(newer)),
    });
    const storage = new MigratingAuthStorage(primary, file, legacy, "keychain");

    await expect(storage.loadClient(BASE_URL)).resolves.toBeNull();
    expect(file.loadClient).not.toHaveBeenCalled();
    expect(legacy.loadClient).not.toHaveBeenCalled();
    expect(primary.saveClient).not.toHaveBeenCalled();
    expect(file.clearClient).not.toHaveBeenCalled();
    expect(legacy.clearClient).not.toHaveBeenCalled();
  });

  it("migrates clients according to configured mode", async () => {
    const primary = createMockAuthStorage();
    const file = createMockAuthStorage();
    const legacy = createMockAuthStorage({
      loadClient: mock(() => Promise.resolve(defaultClientRegistration)),
    });
    const storage = new MigratingAuthStorage(primary, file, legacy, "file");

    await expect(storage.loadClient(BASE_URL)).resolves.toEqual(
      defaultClientRegistration,
    );
    expect(file.saveClient).toHaveBeenCalledWith(
      BASE_URL,
      defaultClientRegistration,
    );
    expect(legacy.clearClient).toHaveBeenCalledWith(BASE_URL);
  });

  it("file mode chooses newer legacy client when both plaintext stores exist", async () => {
    const older = {
      ...defaultClientRegistration,
      registeredAt: "2025-01-01T00:00:00Z",
    };
    const newer = {
      ...defaultClientRegistration,
      clientId: "newer-client",
      registeredAt: "2025-02-01T00:00:00Z",
    };
    const file = createMockAuthStorage({
      loadClient: mock(() => Promise.resolve(older)),
    });
    const legacy = createMockAuthStorage({
      loadClient: mock(() => Promise.resolve(newer)),
    });
    const storage = new MigratingAuthStorage(
      createMockAuthStorage(),
      file,
      legacy,
      "file",
    );

    await expect(storage.loadClient(BASE_URL)).resolves.toEqual(newer);
    expect(file.saveClient).toHaveBeenCalledWith(BASE_URL, newer);
    expect(legacy.clearClient).toHaveBeenCalledWith(BASE_URL);
  });

  it("re-persists tied canonical clients before clearing all legacy copies", async () => {
    const events: string[] = [];
    const canonical = {
      ...defaultClientRegistration,
      clientId: "canonical-client",
      registeredAt: "2025-01-01T00:00:00Z",
    };
    const file = createMockAuthStorage({
      loadClient: mock(() => Promise.resolve(canonical)),
      saveClient: mock(() => {
        events.push("canonical-save");
        return Promise.resolve();
      }),
    });
    const additionalLegacy = createMockAuthStorage({
      loadClient: mock(() =>
        Promise.resolve({
          ...defaultClientRegistration,
          clientId: "additional-legacy-client",
          registeredAt: canonical.registeredAt,
        }),
      ),
      clearClient: mock(() => {
        events.push("additional-legacy-clear");
        return Promise.reject(new Error("cleanup failed"));
      }),
    });
    const legacy = createMockAuthStorage({
      loadClient: mock(() =>
        Promise.resolve({
          ...defaultClientRegistration,
          clientId: "legacy-client",
          registeredAt: canonical.registeredAt,
        }),
      ),
      clearClient: mock(() => {
        events.push("legacy-clear");
        return Promise.resolve();
      }),
    });
    const storage = new MigratingAuthStorage(
      createMockAuthStorage(),
      file,
      legacy,
      "file",
      "test-config.toml",
      () => {},
      undefined,
      [additionalLegacy],
    );

    await expect(storage.loadClient(BASE_URL)).resolves.toEqual(canonical);
    expect(events).toEqual([
      "canonical-save",
      "additional-legacy-clear",
      "legacy-clear",
    ]);
    expect(file.saveClient).toHaveBeenCalledWith(BASE_URL, canonical);
  });

  it("reconciles invalid client timestamps through the canonical file", async () => {
    const canonical = {
      ...defaultClientRegistration,
      clientId: "canonical-client",
      registeredAt: "not-a-date",
    };
    const file = createMockAuthStorage({
      loadClient: mock(() => Promise.resolve(canonical)),
    });
    const legacy = createMockAuthStorage({
      loadClient: mock(() =>
        Promise.resolve({
          ...defaultClientRegistration,
          clientId: "legacy-client",
          registeredAt: "also-not-a-date",
        }),
      ),
    });
    const storage = new MigratingAuthStorage(
      createMockAuthStorage(),
      file,
      legacy,
      "file",
    );

    await expect(storage.loadClient(BASE_URL)).resolves.toEqual(canonical);
    expect(file.saveClient).toHaveBeenCalledWith(BASE_URL, canonical);
    expect(legacy.clearClient).toHaveBeenCalledWith(BASE_URL);
  });

  it("leaves legacy clients untouched when canonical reconciliation fails", async () => {
    const canonical = {
      ...defaultClientRegistration,
      clientId: "canonical-client",
      registeredAt: "2025-01-01T00:00:00Z",
    };
    const file = createMockAuthStorage({
      loadClient: mock(() => Promise.resolve(canonical)),
      saveClient: mock(() => Promise.reject(new Error("save failed"))),
    });
    const legacy = createMockAuthStorage({
      loadClient: mock(() =>
        Promise.resolve({
          ...defaultClientRegistration,
          clientId: "legacy-client",
          registeredAt: canonical.registeredAt,
        }),
      ),
    });
    const storage = new MigratingAuthStorage(
      createMockAuthStorage(),
      file,
      legacy,
      "file",
    );

    await expect(storage.loadClient(BASE_URL)).rejects.toThrow("save failed");
    expect(legacy.clearClient).not.toHaveBeenCalled();
  });

  it("clears keychain, file, and legacy stores best-effort", async () => {
    const primary = createMockAuthStorage({
      clearTokens: mock(() =>
        Promise.reject(new KeychainUnavailableError("keychain locked")),
      ),
    });
    const file = createMockAuthStorage();
    const legacy = createMockAuthStorage();
    const storage = new MigratingAuthStorage(primary, file, legacy, "keychain");

    await storage.clearTokens(BASE_URL);
    expect(file.clearTokens).toHaveBeenCalledWith(BASE_URL);
    expect(legacy.clearTokens).toHaveBeenCalledWith(BASE_URL);
  });

  it("reports active storage location", () => {
    const primary = createMockAuthStorage({
      getStorageLocation: mock(() => "System keychain (githits)"),
    });
    const file = createMockAuthStorage({
      getStorageLocation: mock(() => "/home/test/.config/githits/auth"),
    });

    expect(
      new MigratingAuthStorage(
        primary,
        file,
        createMockAuthStorage(),
        "keychain",
      ).getStorageLocation(),
    ).toBe("System keychain (githits)");
    expect(
      new MigratingAuthStorage(
        primary,
        file,
        createMockAuthStorage(),
        "file",
      ).getStorageLocation(),
    ).toBe("/home/test/.config/githits/auth");
  });

  describe("active-scoped clears", () => {
    const makeMetadata = () => ({
      load: mock(() => Promise.resolve(null)),
      saveFromTokens: mock(() => Promise.resolve()),
      clear: mock(() => Promise.resolve()),
    });

    it("file mode clears file (and legacy) tokens but preserves keychain", async () => {
      const token = createValidTokenData();
      const primary = createMockAuthStorage({
        // Stale keychain copy that must NOT be wiped.
        loadTokens: mock(() => Promise.resolve(token)),
      });
      const file = createMockAuthStorage({
        loadTokens: mock(() => Promise.resolve(token)),
      });
      const legacy = createMockAuthStorage();
      const metadata = makeMetadata();
      const storage = new MigratingAuthStorage(
        primary,
        file,
        legacy,
        "file",
        "test-config.toml",
        () => {},
        metadata,
      );

      await expect(
        storage.clearActiveTokensIfUnchanged(BASE_URL, token),
      ).resolves.toBe(true);

      expect(file.clearTokens).toHaveBeenCalledWith(BASE_URL);
      expect(legacy.clearTokens).toHaveBeenCalledWith(BASE_URL);
      expect(primary.clearTokens).not.toHaveBeenCalled();
      expect(metadata.clear).toHaveBeenCalledWith(BASE_URL);
    });

    it("continues clearing active token stores after the first clear fails", async () => {
      const token = createValidTokenData();
      const primary = createMockAuthStorage();
      const file = createMockAuthStorage({
        loadTokens: mock(() => Promise.resolve(token)),
        clearTokens: mock(() => Promise.reject(new Error("file clear failed"))),
      });
      const legacy = createMockAuthStorage();
      const metadata = makeMetadata();
      const storage = new MigratingAuthStorage(
        primary,
        file,
        legacy,
        "file",
        "test-config.toml",
        () => {},
        metadata,
      );

      await expect(
        storage.clearActiveTokensIfUnchanged(BASE_URL, token),
      ).rejects.toThrow(/file clear failed/);

      expect(file.clearTokens).toHaveBeenCalledWith(BASE_URL);
      expect(legacy.clearTokens).toHaveBeenCalledWith(BASE_URL);
      expect(primary.clearTokens).not.toHaveBeenCalled();
      expect(metadata.clear).toHaveBeenCalledWith(BASE_URL);
    });

    it("file mode also clears a legacy-only token so it cannot resurrect", async () => {
      const token = createValidTokenData();
      const primary = createMockAuthStorage();
      const file = createMockAuthStorage(); // file empty
      const legacy = createMockAuthStorage({
        loadTokens: mock(() => Promise.resolve(token)),
      });
      const storage = new MigratingAuthStorage(primary, file, legacy, "file");

      await expect(
        storage.clearActiveTokensIfUnchanged(BASE_URL, token),
      ).resolves.toBe(true);

      expect(legacy.clearTokens).toHaveBeenCalledWith(BASE_URL);
      expect(file.clearTokens).toHaveBeenCalledWith(BASE_URL);
      expect(primary.clearTokens).not.toHaveBeenCalled();
    });

    it("keychain mode clears keychain tokens but preserves file", async () => {
      const token = createValidTokenData();
      const primary = createMockAuthStorage({
        loadTokens: mock(() => Promise.resolve(token)),
      });
      const file = createMockAuthStorage({
        // Good file token that must survive a keychain-mode refresh failure.
        loadTokens: mock(() => Promise.resolve(token)),
      });
      const legacy = createMockAuthStorage();
      const metadata = makeMetadata();
      const storage = new MigratingAuthStorage(
        primary,
        file,
        legacy,
        "keychain",
        "test-config.toml",
        () => {},
        metadata,
      );

      await expect(
        storage.clearActiveTokensIfUnchanged(BASE_URL, token),
      ).resolves.toBe(true);

      expect(primary.clearTokens).toHaveBeenCalledWith(BASE_URL);
      expect(file.clearTokens).not.toHaveBeenCalled();
      expect(legacy.clearTokens).not.toHaveBeenCalled();
      expect(metadata.clear).toHaveBeenCalledWith(BASE_URL);
    });

    it("does not clear when a newer active token replaced the expected one", async () => {
      const expected = createValidTokenData({ accessToken: "old" });
      const newer = createValidTokenData({ accessToken: "new" });
      const primary = createMockAuthStorage();
      const file = createMockAuthStorage({
        loadTokens: mock(() => Promise.resolve(newer)),
      });
      const legacy = createMockAuthStorage();
      const metadata = makeMetadata();
      const storage = new MigratingAuthStorage(
        primary,
        file,
        legacy,
        "file",
        "test-config.toml",
        () => {},
        metadata,
      );

      await expect(
        storage.clearActiveTokensIfUnchanged(BASE_URL, expected),
      ).resolves.toBe(false);

      expect(file.clearTokens).not.toHaveBeenCalled();
      expect(legacy.clearTokens).not.toHaveBeenCalled();
      expect(metadata.clear).not.toHaveBeenCalled();
    });

    it("returns false without throwing when the keychain is unavailable", async () => {
      const token = createValidTokenData();
      const primary = createMockAuthStorage({
        loadTokens: mock(() =>
          Promise.reject(new KeychainUnavailableError("locked")),
        ),
      });
      const storage = new MigratingAuthStorage(
        primary,
        createMockAuthStorage(),
        createMockAuthStorage(),
        "keychain",
      );

      await expect(
        storage.clearActiveTokensIfUnchanged(BASE_URL, token),
      ).resolves.toBe(false);
      expect(primary.clearTokens).not.toHaveBeenCalled();
    });

    it("clearActiveClient (file mode) clears file + legacy client, not keychain", async () => {
      const primary = createMockAuthStorage();
      const file = createMockAuthStorage();
      const legacy = createMockAuthStorage();
      const storage = new MigratingAuthStorage(primary, file, legacy, "file");

      await storage.clearActiveClient(BASE_URL);

      expect(file.clearClient).toHaveBeenCalledWith(BASE_URL);
      expect(legacy.clearClient).toHaveBeenCalledWith(BASE_URL);
      expect(primary.clearClient).not.toHaveBeenCalled();
    });

    it("continues clearing active client stores after the first clear fails", async () => {
      const primary = createMockAuthStorage();
      const file = createMockAuthStorage({
        clearClient: mock(() =>
          Promise.reject(new Error("file client clear failed")),
        ),
      });
      const legacy = createMockAuthStorage();
      const storage = new MigratingAuthStorage(primary, file, legacy, "file");

      await expect(storage.clearActiveClient(BASE_URL)).rejects.toThrow(
        /file client clear failed/,
      );

      expect(file.clearClient).toHaveBeenCalledWith(BASE_URL);
      expect(legacy.clearClient).toHaveBeenCalledWith(BASE_URL);
      expect(primary.clearClient).not.toHaveBeenCalled();
    });

    it("clearActiveClient (keychain mode) clears keychain client only", async () => {
      const primary = createMockAuthStorage();
      const file = createMockAuthStorage();
      const legacy = createMockAuthStorage();
      const storage = new MigratingAuthStorage(
        primary,
        file,
        legacy,
        "keychain",
      );

      await storage.clearActiveClient(BASE_URL);

      expect(primary.clearClient).toHaveBeenCalledWith(BASE_URL);
      expect(file.clearClient).not.toHaveBeenCalled();
      expect(legacy.clearClient).not.toHaveBeenCalled();
    });

    it("logout-style clears still wipe every backend (regression guard)", async () => {
      const primary = createMockAuthStorage();
      const file = createMockAuthStorage();
      const legacy = createMockAuthStorage();
      const metadata = makeMetadata();
      const storage = new MigratingAuthStorage(
        primary,
        file,
        legacy,
        "keychain",
        "test-config.toml",
        () => {},
        metadata,
      );

      await storage.clearAuthSession(BASE_URL);
      expect(primary.clearAuthSession).toHaveBeenCalledWith(BASE_URL);
      expect(file.clearAuthSession).toHaveBeenCalledWith(BASE_URL);
      expect(legacy.clearAuthSession).toHaveBeenCalledWith(BASE_URL);

      await storage.clearClient(BASE_URL);
      expect(primary.clearClient).toHaveBeenCalledWith(BASE_URL);
      expect(file.clearClient).toHaveBeenCalledWith(BASE_URL);
      expect(legacy.clearClient).toHaveBeenCalledWith(BASE_URL);
    });
  });
});
