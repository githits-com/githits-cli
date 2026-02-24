import { describe, expect, it, mock } from "bun:test";
import { KeychainUnavailableError } from "./keyring-service.js";

/**
 * Mock Entry class that replaces @napi-rs/keyring Entry in tests.
 * Each test creates a fresh mock with configurable behavior.
 */
let mockGetPassword: () => string | null = () => null;
let mockSetPassword: (password: string) => void = () => {};
let mockDeleteCredential: () => boolean = () => false;

mock.module("@napi-rs/keyring", () => ({
  Entry: class MockEntry {
    constructor(
      public service: string,
      public username: string,
    ) {}
    getPassword() {
      return mockGetPassword();
    }
    setPassword(password: string) {
      mockSetPassword(password);
    }
    deleteCredential() {
      return mockDeleteCredential();
    }
  },
}));

// Import after mock.module so the mock is active
const { KeyringServiceImpl } = await import("./keyring-service.js");

describe("KeyringServiceImpl", () => {
  describe("getPassword", () => {
    it("returns null when entry is not found", () => {
      mockGetPassword = () => null;
      const service = new KeyringServiceImpl();

      expect(service.getPassword("githits", "v1:tokens:url")).toBeNull();
    });

    it("returns stored password string", () => {
      mockGetPassword = () => '{"accessToken":"abc"}';
      const service = new KeyringServiceImpl();

      expect(service.getPassword("githits", "v1:tokens:url")).toBe(
        '{"accessToken":"abc"}',
      );
    });

    it("throws KeychainUnavailableError on platform error", () => {
      mockGetPassword = () => {
        throw new Error("Platform secure storage failure");
      };
      const service = new KeyringServiceImpl();

      expect(() => service.getPassword("githits", "v1:tokens:url")).toThrow(
        KeychainUnavailableError,
      );
    });

    it("includes original error message in KeychainUnavailableError", () => {
      mockGetPassword = () => {
        throw new Error("NoStorageAccess");
      };
      const service = new KeyringServiceImpl();

      try {
        service.getPassword("githits", "v1:tokens:url");
        expect.unreachable("should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(KeychainUnavailableError);
        expect((error as KeychainUnavailableError).message).toContain(
          "NoStorageAccess",
        );
      }
    });
  });

  describe("setPassword", () => {
    it("stores value without error", () => {
      const setFn = mock((_password: string) => {});
      mockSetPassword = setFn;
      const service = new KeyringServiceImpl();

      service.setPassword("githits", "v1:tokens:url", "secret");
      expect(setFn).toHaveBeenCalledWith("secret");
    });

    it("throws KeychainUnavailableError on platform error", () => {
      mockSetPassword = () => {
        throw new Error("NoStorageAccess");
      };
      const service = new KeyringServiceImpl();

      expect(() =>
        service.setPassword("githits", "v1:tokens:url", "secret"),
      ).toThrow(KeychainUnavailableError);
    });
  });

  describe("deletePassword", () => {
    it("returns false when entry is not found", () => {
      mockDeleteCredential = () => false;
      const service = new KeyringServiceImpl();

      expect(service.deletePassword("githits", "v1:tokens:url")).toBe(false);
    });

    it("returns true when entry is deleted", () => {
      mockDeleteCredential = () => true;
      const service = new KeyringServiceImpl();

      expect(service.deletePassword("githits", "v1:tokens:url")).toBe(true);
    });

    it("throws KeychainUnavailableError on platform error", () => {
      mockDeleteCredential = () => {
        throw new Error("Access denied");
      };
      const service = new KeyringServiceImpl();

      expect(() => service.deletePassword("githits", "v1:tokens:url")).toThrow(
        KeychainUnavailableError,
      );
    });
  });

  describe("KeychainUnavailableError", () => {
    it("preserves original error as cause", () => {
      const original = new Error("No storage daemon");
      const error = new KeychainUnavailableError("unavailable", original);

      expect(error.name).toBe("KeychainUnavailableError");
      expect(error.message).toBe("unavailable");
      expect(error.cause).toBe(original);
    });
  });
});
