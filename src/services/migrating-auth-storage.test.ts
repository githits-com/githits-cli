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
    const storage = new MigratingAuthStorage(
      createMockAuthStorage(),
      createMockAuthStorage(),
      legacy,
      "keychain",
      "test-config.toml",
      warning,
      undefined,
      [additionalLegacy],
    );

    await expect(storage.loadTokens(BASE_URL)).resolves.toBeNull();
    expect(additionalLegacy.clearTokens).not.toHaveBeenCalled();
    expect(legacy.clearTokens).not.toHaveBeenCalled();
    expect(warning).not.toHaveBeenCalled();
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
});
