import { describe, expect, it, mock } from "bun:test";
import { KeychainAuthStorage } from "./keychain-auth-storage.js";
import { KeychainUnavailableError } from "./keyring-service.js";
import {
  createMockKeyringService,
  createValidTokenData,
  defaultClientRegistration,
} from "./test-helpers.js";

describe("KeychainAuthStorage", () => {
  const BASE_URL = "https://mcp.githits.com";

  describe("loadTokens", () => {
    it("returns null when keyring returns null", async () => {
      const keyring = createMockKeyringService();
      const storage = new KeychainAuthStorage(keyring);

      const result = await storage.loadTokens(BASE_URL);
      expect(result).toBeNull();
    });

    it("returns parsed TokenData for valid JSON", async () => {
      const tokenData = createValidTokenData();
      const keyring = createMockKeyringService({
        getPassword: mock(() => JSON.stringify(tokenData)),
      });
      const storage = new KeychainAuthStorage(keyring);

      const result = await storage.loadTokens(BASE_URL);
      expect(result).toEqual(tokenData);
    });

    it("returns null for corrupt JSON in keyring", async () => {
      const keyring = createMockKeyringService({
        getPassword: mock(() => "not valid json{{{"),
      });
      const storage = new KeychainAuthStorage(keyring);

      const result = await storage.loadTokens(BASE_URL);
      expect(result).toBeNull();
    });

    it("returns null for JSON missing required fields", async () => {
      const keyring = createMockKeyringService({
        getPassword: mock(() => JSON.stringify({ accessToken: "abc" })),
      });
      const storage = new KeychainAuthStorage(keyring);

      const result = await storage.loadTokens(BASE_URL);
      expect(result).toBeNull();
    });

    it("returns null for empty-string fields", async () => {
      const keyring = createMockKeyringService({
        getPassword: mock(() =>
          JSON.stringify({
            accessToken: "",
            refreshToken: "valid",
            createdAt: "2025-01-15T10:30:00Z",
            expiresAt: null,
          }),
        ),
      });
      const storage = new KeychainAuthStorage(keyring);

      const result = await storage.loadTokens(BASE_URL);
      expect(result).toBeNull();
    });

    it("returns null for non-object JSON values", async () => {
      const keyring = createMockKeyringService({
        getPassword: mock(() => '"just a string"'),
      });
      const storage = new KeychainAuthStorage(keyring);

      const result = await storage.loadTokens(BASE_URL);
      expect(result).toBeNull();
    });

    it("normalizes trailing slashes on base URL", async () => {
      const tokenData = createValidTokenData();
      const getPassword = mock(() => JSON.stringify(tokenData));
      const keyring = createMockKeyringService({ getPassword });
      const storage = new KeychainAuthStorage(keyring);

      await storage.loadTokens(`${BASE_URL}/`);

      expect(getPassword).toHaveBeenCalledWith(
        "githits",
        `v1:tokens:${BASE_URL}`,
      );
    });
  });

  describe("saveTokens", () => {
    it("serializes and stores with correct key", async () => {
      const setPassword = mock(
        (_service: string, _account: string, _password: string) => {},
      );
      const keyring = createMockKeyringService({ setPassword });
      const storage = new KeychainAuthStorage(keyring);
      const tokenData = createValidTokenData();

      await storage.saveTokens(BASE_URL, tokenData);

      expect(setPassword).toHaveBeenCalledWith(
        "githits",
        `v1:tokens:${BASE_URL}`,
        JSON.stringify(tokenData),
      );
    });
  });

  describe("clearTokens", () => {
    it("calls deletePassword with correct key", async () => {
      const deletePassword = mock((_service: string, _account: string) => true);
      const keyring = createMockKeyringService({ deletePassword });
      const storage = new KeychainAuthStorage(keyring);

      await storage.clearTokens(BASE_URL);

      expect(deletePassword).toHaveBeenCalledWith(
        "githits",
        `v1:tokens:${BASE_URL}`,
      );
    });

    it("propagates KeychainUnavailableError from deletePassword", async () => {
      const keyring = createMockKeyringService({
        deletePassword: mock(() => {
          throw new KeychainUnavailableError("access denied");
        }),
      });
      const storage = new KeychainAuthStorage(keyring);

      await expect(storage.clearTokens(BASE_URL)).rejects.toThrow(
        KeychainUnavailableError,
      );
    });
  });

  describe("loadClient", () => {
    it("returns null when keyring returns null", async () => {
      const keyring = createMockKeyringService();
      const storage = new KeychainAuthStorage(keyring);

      const result = await storage.loadClient(BASE_URL);
      expect(result).toBeNull();
    });

    it("returns parsed ClientRegistration for valid JSON", async () => {
      const keyring = createMockKeyringService({
        getPassword: mock(() => JSON.stringify(defaultClientRegistration)),
      });
      const storage = new KeychainAuthStorage(keyring);

      const result = await storage.loadClient(BASE_URL);
      expect(result).toEqual(defaultClientRegistration);
    });

    it("returns null for JSON missing required fields", async () => {
      const keyring = createMockKeyringService({
        getPassword: mock(() => JSON.stringify({ clientId: "only-this" })),
      });
      const storage = new KeychainAuthStorage(keyring);

      const result = await storage.loadClient(BASE_URL);
      expect(result).toBeNull();
    });

    it("returns null for empty-string fields", async () => {
      const keyring = createMockKeyringService({
        getPassword: mock(() =>
          JSON.stringify({
            clientId: "",
            clientSecret: "valid",
            redirectUri: "http://127.0.0.1:8080/callback",
            registeredAt: "2025-01-15T10:30:00Z",
          }),
        ),
      });
      const storage = new KeychainAuthStorage(keyring);

      const result = await storage.loadClient(BASE_URL);
      expect(result).toBeNull();
    });

    it("uses correct key prefix for clients", async () => {
      const getPassword = mock(() => null);
      const keyring = createMockKeyringService({ getPassword });
      const storage = new KeychainAuthStorage(keyring);

      await storage.loadClient(BASE_URL);

      expect(getPassword).toHaveBeenCalledWith(
        "githits",
        `v1:client:${BASE_URL}`,
      );
    });
  });

  describe("saveClient", () => {
    it("serializes and stores with correct key", async () => {
      const setPassword = mock(
        (_service: string, _account: string, _password: string) => {},
      );
      const keyring = createMockKeyringService({ setPassword });
      const storage = new KeychainAuthStorage(keyring);

      await storage.saveClient(BASE_URL, defaultClientRegistration);

      expect(setPassword).toHaveBeenCalledWith(
        "githits",
        `v1:client:${BASE_URL}`,
        JSON.stringify(defaultClientRegistration),
      );
    });
  });

  describe("clearClient", () => {
    it("calls deletePassword with correct key", async () => {
      const deletePassword = mock((_service: string, _account: string) => true);
      const keyring = createMockKeyringService({ deletePassword });
      const storage = new KeychainAuthStorage(keyring);

      await storage.clearClient(BASE_URL);

      expect(deletePassword).toHaveBeenCalledWith(
        "githits",
        `v1:client:${BASE_URL}`,
      );
    });

    it("propagates KeychainUnavailableError from deletePassword", async () => {
      const keyring = createMockKeyringService({
        deletePassword: mock(() => {
          throw new KeychainUnavailableError("access denied");
        }),
      });
      const storage = new KeychainAuthStorage(keyring);

      await expect(storage.clearClient(BASE_URL)).rejects.toThrow(
        KeychainUnavailableError,
      );
    });
  });

  describe("getStorageLocation", () => {
    it("returns platform-specific descriptive string", () => {
      const keyring = createMockKeyringService();
      const storage = new KeychainAuthStorage(keyring);
      const location = storage.getStorageLocation();

      expect(location).toContain("githits");
      if (process.platform === "darwin") {
        expect(location).toBe("macOS Keychain (githits)");
      } else if (process.platform === "win32") {
        expect(location).toBe("Windows Credential Manager (githits)");
      } else {
        expect(location).toBe("System keychain (githits)");
      }
    });
  });
});
