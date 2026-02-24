import { describe, expect, it, mock } from "bun:test";
import { KeychainUnavailableError } from "./keyring-service.js";
import { MigratingAuthStorage } from "./migrating-auth-storage.js";
import {
  createMockAuthStorage,
  createValidTokenData,
  defaultClientRegistration,
} from "./test-helpers.js";

describe("MigratingAuthStorage", () => {
  const BASE_URL = "https://mcp.githits.com";

  describe("loadTokens", () => {
    it("returns from primary when found", async () => {
      const tokenData = createValidTokenData();
      const primary = createMockAuthStorage({
        loadTokens: mock(() => Promise.resolve(tokenData)),
      });
      const legacy = createMockAuthStorage();
      const storage = new MigratingAuthStorage(primary, legacy);

      const result = await storage.loadTokens(BASE_URL);
      expect(result).toEqual(tokenData);
      expect(legacy.loadTokens).not.toHaveBeenCalled();
    });

    it("migrates from legacy when primary returns null", async () => {
      const tokenData = createValidTokenData();
      const primary = createMockAuthStorage();
      const legacy = createMockAuthStorage({
        loadTokens: mock(() => Promise.resolve(tokenData)),
      });
      const storage = new MigratingAuthStorage(primary, legacy);

      const result = await storage.loadTokens(BASE_URL);

      expect(result).toEqual(tokenData);
      expect(primary.saveTokens).toHaveBeenCalledWith(BASE_URL, tokenData);
      expect(legacy.clearTokens).toHaveBeenCalledWith(BASE_URL);
    });

    it("returns null when both return null", async () => {
      const primary = createMockAuthStorage();
      const legacy = createMockAuthStorage();
      const storage = new MigratingAuthStorage(primary, legacy);

      const result = await storage.loadTokens(BASE_URL);
      expect(result).toBeNull();
    });

    it("keeps legacy entry intact if primary write fails", async () => {
      const tokenData = createValidTokenData();
      const primary = createMockAuthStorage({
        saveTokens: mock(() =>
          Promise.reject(new KeychainUnavailableError("Keychain write failed")),
        ),
      });
      const legacy = createMockAuthStorage({
        loadTokens: mock(() => Promise.resolve(tokenData)),
      });
      const storage = new MigratingAuthStorage(primary, legacy);

      await expect(storage.loadTokens(BASE_URL)).rejects.toThrow(
        KeychainUnavailableError,
      );
      expect(legacy.clearTokens).not.toHaveBeenCalled();
    });

    it("succeeds when primary write succeeds but legacy clear fails", async () => {
      const tokenData = createValidTokenData();
      const primary = createMockAuthStorage();
      const legacy = createMockAuthStorage({
        loadTokens: mock(() => Promise.resolve(tokenData)),
        clearTokens: mock(() => Promise.reject(new Error("file locked"))),
      });
      const storage = new MigratingAuthStorage(primary, legacy);

      const result = await storage.loadTokens(BASE_URL);

      expect(result).toEqual(tokenData);
      expect(primary.saveTokens).toHaveBeenCalledWith(BASE_URL, tokenData);
      // Legacy clear failed but was swallowed — migration still succeeded
      expect(legacy.clearTokens).toHaveBeenCalledWith(BASE_URL);
    });
  });

  describe("saveTokens", () => {
    it("writes only to primary", async () => {
      const tokenData = createValidTokenData();
      const primary = createMockAuthStorage();
      const legacy = createMockAuthStorage();
      const storage = new MigratingAuthStorage(primary, legacy);

      await storage.saveTokens(BASE_URL, tokenData);

      expect(primary.saveTokens).toHaveBeenCalledWith(BASE_URL, tokenData);
      expect(legacy.saveTokens).not.toHaveBeenCalled();
    });
  });

  describe("clearTokens", () => {
    it("clears from both primary and legacy", async () => {
      const primary = createMockAuthStorage();
      const legacy = createMockAuthStorage();
      const storage = new MigratingAuthStorage(primary, legacy);

      await storage.clearTokens(BASE_URL);

      expect(primary.clearTokens).toHaveBeenCalledWith(BASE_URL);
      expect(legacy.clearTokens).toHaveBeenCalledWith(BASE_URL);
    });

    it("attempts legacy clear even when primary throws", async () => {
      const primary = createMockAuthStorage({
        clearTokens: mock(() =>
          Promise.reject(new KeychainUnavailableError("keychain locked")),
        ),
      });
      const legacy = createMockAuthStorage();
      const storage = new MigratingAuthStorage(primary, legacy);

      await expect(storage.clearTokens(BASE_URL)).rejects.toThrow(
        KeychainUnavailableError,
      );
      expect(legacy.clearTokens).toHaveBeenCalledWith(BASE_URL);
    });

    it("propagates primary error when both primary and legacy throw", async () => {
      const primaryError = new KeychainUnavailableError("keychain locked");
      const primary = createMockAuthStorage({
        clearTokens: mock(() => Promise.reject(primaryError)),
      });
      const legacy = createMockAuthStorage({
        clearTokens: mock(() => Promise.reject(new Error("file locked"))),
      });
      const storage = new MigratingAuthStorage(primary, legacy);

      // Primary error takes precedence; legacy error is swallowed
      await expect(storage.clearTokens(BASE_URL)).rejects.toBe(primaryError);
    });
  });

  describe("loadClient", () => {
    it("returns from primary when found", async () => {
      const primary = createMockAuthStorage({
        loadClient: mock(() => Promise.resolve(defaultClientRegistration)),
      });
      const legacy = createMockAuthStorage();
      const storage = new MigratingAuthStorage(primary, legacy);

      const result = await storage.loadClient(BASE_URL);
      expect(result).toEqual(defaultClientRegistration);
      expect(legacy.loadClient).not.toHaveBeenCalled();
    });

    it("migrates from legacy when primary returns null", async () => {
      const primary = createMockAuthStorage();
      const legacy = createMockAuthStorage({
        loadClient: mock(() => Promise.resolve(defaultClientRegistration)),
      });
      const storage = new MigratingAuthStorage(primary, legacy);

      const result = await storage.loadClient(BASE_URL);

      expect(result).toEqual(defaultClientRegistration);
      expect(primary.saveClient).toHaveBeenCalledWith(
        BASE_URL,
        defaultClientRegistration,
      );
      expect(legacy.clearClient).toHaveBeenCalledWith(BASE_URL);
    });

    it("returns null when both return null", async () => {
      const primary = createMockAuthStorage();
      const legacy = createMockAuthStorage();
      const storage = new MigratingAuthStorage(primary, legacy);

      const result = await storage.loadClient(BASE_URL);
      expect(result).toBeNull();
    });

    it("keeps legacy entry intact if primary write fails", async () => {
      const primary = createMockAuthStorage({
        saveClient: mock(() =>
          Promise.reject(new KeychainUnavailableError("Keychain write failed")),
        ),
      });
      const legacy = createMockAuthStorage({
        loadClient: mock(() => Promise.resolve(defaultClientRegistration)),
      });
      const storage = new MigratingAuthStorage(primary, legacy);

      await expect(storage.loadClient(BASE_URL)).rejects.toThrow(
        KeychainUnavailableError,
      );
      expect(legacy.clearClient).not.toHaveBeenCalled();
    });

    it("succeeds when primary write succeeds but legacy clear fails", async () => {
      const primary = createMockAuthStorage();
      const legacy = createMockAuthStorage({
        loadClient: mock(() => Promise.resolve(defaultClientRegistration)),
        clearClient: mock(() => Promise.reject(new Error("file locked"))),
      });
      const storage = new MigratingAuthStorage(primary, legacy);

      const result = await storage.loadClient(BASE_URL);

      expect(result).toEqual(defaultClientRegistration);
      expect(primary.saveClient).toHaveBeenCalledWith(
        BASE_URL,
        defaultClientRegistration,
      );
      expect(legacy.clearClient).toHaveBeenCalledWith(BASE_URL);
    });
  });

  describe("saveClient", () => {
    it("writes only to primary", async () => {
      const primary = createMockAuthStorage();
      const legacy = createMockAuthStorage();
      const storage = new MigratingAuthStorage(primary, legacy);

      await storage.saveClient(BASE_URL, defaultClientRegistration);

      expect(primary.saveClient).toHaveBeenCalledWith(
        BASE_URL,
        defaultClientRegistration,
      );
      expect(legacy.saveClient).not.toHaveBeenCalled();
    });
  });

  describe("clearClient", () => {
    it("clears from both primary and legacy", async () => {
      const primary = createMockAuthStorage();
      const legacy = createMockAuthStorage();
      const storage = new MigratingAuthStorage(primary, legacy);

      await storage.clearClient(BASE_URL);

      expect(primary.clearClient).toHaveBeenCalledWith(BASE_URL);
      expect(legacy.clearClient).toHaveBeenCalledWith(BASE_URL);
    });

    it("attempts legacy clear even when primary throws", async () => {
      const primary = createMockAuthStorage({
        clearClient: mock(() =>
          Promise.reject(new KeychainUnavailableError("keychain locked")),
        ),
      });
      const legacy = createMockAuthStorage();
      const storage = new MigratingAuthStorage(primary, legacy);

      await expect(storage.clearClient(BASE_URL)).rejects.toThrow(
        KeychainUnavailableError,
      );
      expect(legacy.clearClient).toHaveBeenCalledWith(BASE_URL);
    });

    it("propagates primary error when both primary and legacy throw", async () => {
      const primaryError = new KeychainUnavailableError("keychain locked");
      const primary = createMockAuthStorage({
        clearClient: mock(() => Promise.reject(primaryError)),
      });
      const legacy = createMockAuthStorage({
        clearClient: mock(() => Promise.reject(new Error("file locked"))),
      });
      const storage = new MigratingAuthStorage(primary, legacy);

      // Primary error takes precedence; legacy error is swallowed
      await expect(storage.clearClient(BASE_URL)).rejects.toBe(primaryError);
    });
  });

  describe("migration independence", () => {
    it("client migration succeeds independently when token migration fails", async () => {
      const tokenData = createValidTokenData();
      const primary = createMockAuthStorage({
        saveTokens: mock(() =>
          Promise.reject(new KeychainUnavailableError("fail")),
        ),
      });
      const legacy = createMockAuthStorage({
        loadTokens: mock(() => Promise.resolve(tokenData)),
        loadClient: mock(() => Promise.resolve(defaultClientRegistration)),
      });
      const storage = new MigratingAuthStorage(primary, legacy);

      // Token migration fails
      await expect(storage.loadTokens(BASE_URL)).rejects.toThrow(
        KeychainUnavailableError,
      );

      // Client migration succeeds independently
      const client = await storage.loadClient(BASE_URL);
      expect(client).toEqual(defaultClientRegistration);
      expect(primary.saveClient).toHaveBeenCalledWith(
        BASE_URL,
        defaultClientRegistration,
      );
    });
  });

  describe("getStorageLocation", () => {
    it("returns primary storage location", () => {
      const primary = createMockAuthStorage({
        getStorageLocation: mock(() => "System keychain (githits)"),
      });
      const legacy = createMockAuthStorage();
      const storage = new MigratingAuthStorage(primary, legacy);

      expect(storage.getStorageLocation()).toBe("System keychain (githits)");
    });
  });
});
