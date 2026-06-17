import { describe, expect, it, mock, spyOn } from "bun:test";
import { KeychainUnavailableError } from "../services/keyring-service.js";
import { createMockAuthStorage } from "../services/test-helpers.js";
import { logoutAction } from "./logout.js";

describe("logoutAction", () => {
  const mcpUrl = "https://mcp.githits.com";

  it("clears tokens and client registration when logged in", async () => {
    const consoleSpy = spyOn(console, "log").mockImplementation(() => {});
    const authStorage = createMockAuthStorage();

    await logoutAction({ authStorage, mcpUrl });

    expect(authStorage.loadTokens).not.toHaveBeenCalled();
    expect(authStorage.clearAuthSession).toHaveBeenCalledWith(mcpUrl);
    consoleSpy.mockRestore();
  });

  it("clears both tokens and client without checking login state", async () => {
    const consoleSpy = spyOn(console, "log").mockImplementation(() => {});
    const authStorage = createMockAuthStorage();

    await logoutAction({ authStorage, mcpUrl });

    // Idempotent cleanup removes orphaned client registrations.
    expect(authStorage.clearAuthSession).toHaveBeenCalledWith(mcpUrl);
    expect(authStorage.loadTokens).not.toHaveBeenCalled();
    const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("Logged out");
    expect(output).not.toContain("Environment:");
    consoleSpy.mockRestore();
  });

  it("propagates session clear failures", async () => {
    const consoleSpy = spyOn(console, "log").mockImplementation(() => {});
    const authStorage = createMockAuthStorage({
      clearAuthSession: mock(() =>
        Promise.reject(new KeychainUnavailableError("keychain locked")),
      ),
    });

    await expect(logoutAction({ authStorage, mcpUrl })).rejects.toThrow(
      KeychainUnavailableError,
    );
    expect(authStorage.loadTokens).not.toHaveBeenCalled();
    expect(authStorage.clearAuthSession).toHaveBeenCalledWith(mcpUrl);
    consoleSpy.mockRestore();
  });
});
