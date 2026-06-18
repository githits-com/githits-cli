import { describe, expect, it } from "bun:test";
import { ModeAwareFileAuthStorage } from "./mode-aware-file-auth-storage.js";
import { createMockAuthStorage, createValidTokenData } from "./test-helpers.js";

describe("ModeAwareFileAuthStorage", () => {
  const BASE_URL = "https://mcp.githits.com";

  it("allows reads and clears in keychain mode", async () => {
    const inner = createMockAuthStorage();
    const storage = new ModeAwareFileAuthStorage(inner, "keychain");

    await storage.loadTokens(BASE_URL);
    await storage.clearTokens(BASE_URL);
    await storage.loadClient(BASE_URL);
    await storage.clearClient(BASE_URL);

    expect(inner.loadTokens).toHaveBeenCalledWith(BASE_URL);
    expect(inner.clearTokens).toHaveBeenCalledWith(BASE_URL);
    expect(inner.loadClient).toHaveBeenCalledWith(BASE_URL);
    expect(inner.clearClient).toHaveBeenCalledWith(BASE_URL);
  });

  it("rejects writes in keychain mode", async () => {
    const inner = createMockAuthStorage();
    const storage = new ModeAwareFileAuthStorage(
      inner,
      "keychain",
      "/home/test/.config/githits/config.toml",
    );

    await expect(
      storage.saveTokens(BASE_URL, createValidTokenData()),
    ).rejects.toThrow(/Warning: file storage is plaintext/);
    await expect(
      storage.saveTokens(BASE_URL, createValidTokenData()),
    ).rejects.toThrow(/\/home\/test\/\.config\/githits\/config\.toml/);
    expect(inner.saveTokens).not.toHaveBeenCalled();
  });

  it("allows writes in file mode", async () => {
    const inner = createMockAuthStorage();
    const storage = new ModeAwareFileAuthStorage(inner, "file");
    const token = createValidTokenData();

    await storage.saveTokens(BASE_URL, token);

    expect(inner.saveTokens).toHaveBeenCalledWith(BASE_URL, token);
  });

  it("delegates active-scoped clears in any mode without asserting file mode", async () => {
    const inner = createMockAuthStorage();
    const storage = new ModeAwareFileAuthStorage(inner, "keychain");
    const token = createValidTokenData();

    await storage.clearActiveTokensIfUnchanged(BASE_URL, token);
    await storage.clearActiveClient(BASE_URL);

    expect(inner.clearActiveTokensIfUnchanged).toHaveBeenCalledWith(
      BASE_URL,
      token,
    );
    expect(inner.clearActiveClient).toHaveBeenCalledWith(BASE_URL);
  });
});
