import { describe, expect, it, mock, spyOn } from "bun:test";
import { KeychainUnavailableError } from "../services/keyring-service.js";
import {
  createMockAuthStorage,
  createValidTokenData,
} from "../services/test-helpers.js";
import { logoutAction } from "./logout.js";

describe("logoutAction", () => {
  const mcpUrl = "https://mcp.githits.com";

  it("clears tokens and client registration when logged in", async () => {
    const consoleSpy = spyOn(console, "log").mockImplementation(() => {});
    const authStorage = createMockAuthStorage({
      loadTokens: mock(() => Promise.resolve(createValidTokenData())),
    });

    await logoutAction({ authStorage, mcpUrl });

    expect(authStorage.clearTokens).toHaveBeenCalledWith(mcpUrl);
    expect(authStorage.clearClient).toHaveBeenCalledWith(mcpUrl);
    consoleSpy.mockRestore();
  });

  it("clears both tokens and client even when not logged in", async () => {
    const consoleSpy = spyOn(console, "log").mockImplementation(() => {});
    const authStorage = createMockAuthStorage();

    await logoutAction({ authStorage, mcpUrl });

    // Idempotent cleanup removes orphaned client registrations
    expect(authStorage.clearTokens).toHaveBeenCalledWith(mcpUrl);
    expect(authStorage.clearClient).toHaveBeenCalledWith(mcpUrl);
    const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("Not currently logged in");
    consoleSpy.mockRestore();
  });

  it("clears client even when clearTokens throws", async () => {
    const consoleSpy = spyOn(console, "log").mockImplementation(() => {});
    const authStorage = createMockAuthStorage({
      loadTokens: mock(() => Promise.resolve(createValidTokenData())),
      clearTokens: mock(() =>
        Promise.reject(new KeychainUnavailableError("keychain locked")),
      ),
    });

    await expect(logoutAction({ authStorage, mcpUrl })).rejects.toThrow(
      KeychainUnavailableError,
    );
    expect(authStorage.clearClient).toHaveBeenCalledWith(mcpUrl);
    consoleSpy.mockRestore();
  });

  it("clears tokens even when clearClient throws", async () => {
    const consoleSpy = spyOn(console, "log").mockImplementation(() => {});
    const authStorage = createMockAuthStorage({
      loadTokens: mock(() => Promise.resolve(createValidTokenData())),
      clearClient: mock(() =>
        Promise.reject(new KeychainUnavailableError("keychain locked")),
      ),
    });

    await expect(logoutAction({ authStorage, mcpUrl })).rejects.toThrow(
      KeychainUnavailableError,
    );
    expect(authStorage.clearTokens).toHaveBeenCalledWith(mcpUrl);
    consoleSpy.mockRestore();
  });
});
