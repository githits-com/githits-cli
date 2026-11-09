import { describe, expect, it, mock } from "bun:test";
import { executeWithTokenRefresh } from "./execute-with-token-refresh.js";
import {
  AuthenticationError,
  TermsAcceptanceRequiredError,
} from "./githits-service.js";
import { createMockTokenProvider } from "./test-helpers.js";
import { createStaticTokenProvider } from "./token-provider.js";

describe("executeWithTokenRefresh", () => {
  it.each([
    "ghi-static-token",
    "gh-proj-static-token",
    `sk-githits-${"A".repeat(43)}`,
    `sk-githits-proj-${"A".repeat(43)}`,
    `sk-githits-proj-${"A".repeat(38)}`,
    "sk-githits-malformed",
    "future-format-token",
    "header.payload.signature",
  ])(
    "preserves static-token failures without retrying for %s",
    async (token) => {
      for (const failure of [
        new AuthenticationError(),
        new TermsAcceptanceRequiredError(),
      ]) {
        const executeWithToken = mock(async () => {
          throw failure;
        });
        await expect(
          executeWithTokenRefresh({
            ...createStaticTokenProvider(token),
            executeWithToken,
            shouldRefresh: () => true,
          }),
        ).rejects.toBe(failure);
        expect(executeWithToken).toHaveBeenCalledTimes(1);
        expect(executeWithToken).toHaveBeenCalledWith(token);
      }
    },
  );

  it("uses the provider refresh contract regardless of the token prefix", async () => {
    const token = "sk-githits-custom-provider-token";
    const provider = createMockTokenProvider({
      getToken: mock(async () => token),
    });
    const executeWithToken = mock(async (value: string) => {
      if (value === token) throw new AuthenticationError();
      return value;
    });

    await expect(
      executeWithTokenRefresh({
        ...provider,
        executeWithToken,
        shouldRefresh: () => true,
      }),
    ).resolves.toBe("mock-refreshed-token");
    expect(provider.forceRefresh).toHaveBeenCalledTimes(1);
    expect(executeWithToken).toHaveBeenCalledTimes(2);
  });
  it("rejects with an already-aborted caller reason before reading a token", async () => {
    const controller = new AbortController();
    const reason = new Error("already cancelled");
    controller.abort(reason);
    const getToken = mock(() => Promise.resolve("token"));
    const executeWithToken = mock(() => Promise.resolve("unexpected"));

    await expect(
      executeWithTokenRefresh({
        getToken,
        forceRefresh: mock(() => Promise.resolve("refreshed")),
        executeWithToken,
        shouldRefresh: () => true,
        signal: controller.signal,
      }),
    ).rejects.toBe(reason);
    expect(getToken).not.toHaveBeenCalled();
    expect(executeWithToken).not.toHaveBeenCalled();
  });

  it("does not execute when the caller aborts while the token is read", async () => {
    const controller = new AbortController();
    const reason = new Error("cancelled during token lookup");
    const executeWithToken = mock(() => Promise.resolve("unexpected"));

    await expect(
      executeWithTokenRefresh({
        getToken: async () => {
          controller.abort(reason);
          return "token";
        },
        forceRefresh: mock(() => Promise.resolve("refreshed")),
        executeWithToken,
        shouldRefresh: () => true,
        signal: controller.signal,
      }),
    ).rejects.toBe(reason);
    expect(executeWithToken).not.toHaveBeenCalled();
  });

  it("does not refresh when the caller aborted before a refreshable failure", async () => {
    const controller = new AbortController();
    const reason = new Error("cancelled before failure");
    const forceRefresh = mock(() => Promise.resolve("refreshed"));

    await expect(
      executeWithTokenRefresh({
        getToken: () => Promise.resolve("token"),
        forceRefresh,
        executeWithToken: async () => {
          controller.abort(reason);
          throw new AuthenticationError();
        },
        shouldRefresh: () => true,
        signal: controller.signal,
      }),
    ).rejects.toBe(reason);
    expect(forceRefresh).not.toHaveBeenCalled();
  });

  it("does not retry when the caller aborts during refresh", async () => {
    const controller = new AbortController();
    const reason = new Error("cancelled during refresh");
    const executeWithToken = mock(() =>
      Promise.reject(new AuthenticationError()),
    );

    await expect(
      executeWithTokenRefresh({
        getToken: () => Promise.resolve("token"),
        forceRefresh: async () => {
          controller.abort(reason);
          return "refreshed";
        },
        executeWithToken,
        shouldRefresh: () => true,
        signal: controller.signal,
      }),
    ).rejects.toBe(reason);
    expect(executeWithToken).toHaveBeenCalledTimes(1);
  });

  it("retries once after refresh while the caller signal stays active", async () => {
    const controller = new AbortController();
    const executeWithToken = mock(async (token: string) => {
      if (token === "token") throw new AuthenticationError();
      return `ok:${token}`;
    });

    await expect(
      executeWithTokenRefresh({
        getToken: () => Promise.resolve("token"),
        forceRefresh: () => Promise.resolve("refreshed"),
        executeWithToken,
        shouldRefresh: () => true,
        signal: controller.signal,
      }),
    ).resolves.toBe("ok:refreshed");
    expect(executeWithToken).toHaveBeenCalledTimes(2);
  });
  it("surfaces the caller reason when token lookup rejects after an abort", async () => {
    const controller = new AbortController();
    const reason = new Error("cancelled during token lookup");
    const executeWithToken = mock(() => Promise.resolve("unexpected"));

    await expect(
      executeWithTokenRefresh({
        getToken: async () => {
          controller.abort(reason);
          throw new Error("token store unavailable");
        },
        forceRefresh: mock(() => Promise.resolve("refreshed")),
        executeWithToken,
        shouldRefresh: () => true,
        signal: controller.signal,
      }),
    ).rejects.toBe(reason);
    expect(executeWithToken).not.toHaveBeenCalled();
  });

  it("surfaces the caller reason when refresh rejects after an abort", async () => {
    const controller = new AbortController();
    const reason = new Error("cancelled during refresh");
    const executeWithToken = mock(() =>
      Promise.reject(new AuthenticationError()),
    );

    await expect(
      executeWithTokenRefresh({
        getToken: () => Promise.resolve("token"),
        forceRefresh: async () => {
          controller.abort(reason);
          throw new Error("refresh endpoint unavailable");
        },
        executeWithToken,
        shouldRefresh: () => true,
        signal: controller.signal,
      }),
    ).rejects.toBe(reason);
    expect(executeWithToken).toHaveBeenCalledTimes(1);
  });

  it("keeps token-provider errors when the caller is still active", async () => {
    const providerError = new Error("token store unavailable");

    await expect(
      executeWithTokenRefresh({
        getToken: () => Promise.reject(providerError),
        forceRefresh: mock(() => Promise.resolve("refreshed")),
        executeWithToken: mock(() => Promise.resolve("unexpected")),
        shouldRefresh: () => true,
        signal: new AbortController().signal,
      }),
    ).rejects.toBe(providerError);
  });
});
