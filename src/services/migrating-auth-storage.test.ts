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

  it("keychain mode migrates new file tokens into keychain", async () => {
    const token = createValidTokenData();
    const primary = createMockAuthStorage();
    const file = createMockAuthStorage({
      loadTokens: mock(() => Promise.resolve(token)),
    });
    const legacy = createMockAuthStorage();
    const storage = new MigratingAuthStorage(primary, file, legacy, "keychain");

    await expect(storage.loadTokens(BASE_URL)).resolves.toEqual(token);
    expect(primary.saveTokens).toHaveBeenCalledWith(BASE_URL, token);
    expect(file.clearTokens).toHaveBeenCalledWith(BASE_URL);
    expect(legacy.clearTokens).toHaveBeenCalledWith(BASE_URL);
  });

  it("keychain mode migrates legacy tokens into keychain", async () => {
    const token = createValidTokenData();
    const primary = createMockAuthStorage();
    const file = createMockAuthStorage();
    const legacy = createMockAuthStorage({
      loadTokens: mock(() => Promise.resolve(token)),
    });
    const storage = new MigratingAuthStorage(primary, file, legacy, "keychain");

    await expect(storage.loadTokens(BASE_URL)).resolves.toEqual(token);
    expect(primary.saveTokens).toHaveBeenCalledWith(BASE_URL, token);
    expect(legacy.clearTokens).toHaveBeenCalledWith(BASE_URL);
  });

  it("keychain mode keeps plaintext entry if keychain migration write fails", async () => {
    const token = createValidTokenData();
    const primary = createMockAuthStorage({
      saveTokens: mock(() =>
        Promise.reject(new KeychainUnavailableError("keychain locked")),
      ),
    });
    const file = createMockAuthStorage({
      loadTokens: mock(() => Promise.resolve(token)),
    });
    const legacy = createMockAuthStorage();
    const storage = new MigratingAuthStorage(primary, file, legacy, "keychain");

    await expect(storage.loadTokens(BASE_URL)).resolves.toEqual(token);
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

  it("file mode uses keychain only as last-resort migration source", async () => {
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

    await expect(storage.loadTokens(BASE_URL)).resolves.toEqual(token);
    expect(file.saveTokens).toHaveBeenCalledWith(BASE_URL, token);
    expect(warning).toHaveBeenCalledWith(expect.stringContaining("exporting"));
  });

  it("chooses newer plaintext token and leaves ambiguous other entry intact", async () => {
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

    await expect(storage.loadTokens(BASE_URL)).resolves.toEqual(newer);
    expect(primary.saveTokens).toHaveBeenCalledWith(BASE_URL, newer);
    expect(legacy.clearTokens).toHaveBeenCalledWith(BASE_URL);
    expect(file.clearTokens).toHaveBeenCalledWith(BASE_URL);
  });

  it("prefers new file path and warns when plaintext timestamps are tied", async () => {
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

    await expect(storage.loadTokens(BASE_URL)).resolves.toEqual(token);
    expect(file.clearTokens).toHaveBeenCalledWith(BASE_URL);
    expect(legacy.clearTokens).not.toHaveBeenCalled();
    expect(warning).toHaveBeenCalledWith(expect.stringContaining("ambiguous"));
  });

  it("keychain mode clears both plaintext clients after unambiguous migration", async () => {
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

    await expect(storage.loadClient(BASE_URL)).resolves.toEqual(newer);
    expect(primary.saveClient).toHaveBeenCalledWith(BASE_URL, newer);
    expect(file.clearClient).toHaveBeenCalledWith(BASE_URL);
    expect(legacy.clearClient).toHaveBeenCalledWith(BASE_URL);
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
