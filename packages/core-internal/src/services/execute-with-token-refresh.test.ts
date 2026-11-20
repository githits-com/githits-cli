import { describe, expect, it, mock, spyOn } from "bun:test";
import { executeWithTokenRefresh } from "./execute-with-token-refresh.js";
import {
  AuthenticationError,
  TermsAcceptanceRequiredError,
} from "./githits-service.js";
import { createMockTokenProvider } from "./test-helpers.js";
import { createStaticTokenProvider } from "./token-provider.js";

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

/** Check settlement in the next event-loop turn without a time-based delay. */
async function settledBeforeNextTurn<T>(promise: Promise<T>): Promise<unknown> {
  return Promise.race([
    promise.then(
      (value) => value,
      (error: unknown) => error,
    ),
    new Promise<symbol>((resolve) =>
      setImmediate(() => resolve(Symbol("still pending"))),
    ),
  ]);
}

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

  it("handles a token provider that aborts and throws synchronously", async () => {
    const controller = new AbortController();
    const reason = new Error("cancelled during token lookup");
    const provider = createMockTokenProvider({
      getToken: mock((): never => {
        controller.abort(reason);
        throw new Error("token store unavailable");
      }),
    });

    await expect(
      executeWithTokenRefresh({
        ...provider,
        executeWithToken: async () => "unexpected",
        shouldRefresh: () => true,
        signal: controller.signal,
      }),
    ).rejects.toBe(reason);
    // Let the test runner observe a leaked rejection from the abort promise.
    await new Promise<void>((resolve) => setImmediate(resolve));
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

  it("cancels an unresolved token lookup without starting a request", async () => {
    const lookup = deferred<string | undefined>();
    const controller = new AbortController();
    const reason = new Error("lookup cancelled");
    const executeWithToken = mock(async () => "unexpected");
    const request = executeWithTokenRefresh({
      getToken: () => lookup.promise,
      forceRefresh: async () => undefined,
      executeWithToken,
      shouldRefresh: () => true,
      signal: controller.signal,
    });

    controller.abort(reason);
    const early = await settledBeforeNextTurn(request);
    lookup.resolve("token");
    expect(early).toBe(reason);
    await expect(request).rejects.toBe(reason);
    expect(executeWithToken).not.toHaveBeenCalled();
  });

  it("does not start a request when cancellation follows token acquisition", async () => {
    const controller = new AbortController();
    const reason = new Error("cancelled after token acquisition");
    const executeWithToken = mock(async () => "unexpected");
    const request = executeWithTokenRefresh({
      getToken: () => {
        const token = Promise.resolve("token");
        queueMicrotask(() => controller.abort(reason));
        return token;
      },
      forceRefresh: async () => undefined,
      executeWithToken,
      shouldRefresh: () => true,
      signal: controller.signal,
    });

    await expect(request).rejects.toBe(reason);
    expect(executeWithToken).not.toHaveBeenCalled();
  });

  it("cancels an unresolved refresh without retrying", async () => {
    const refresh = deferred<string | undefined>();
    const controller = new AbortController();
    const reason = new Error("refresh cancelled");
    const executeWithToken = mock(async () => {
      throw new AuthenticationError();
    });
    const refreshStarted = deferred<void>();
    const request = executeWithTokenRefresh({
      getToken: async () => "old",
      forceRefresh: () => {
        refreshStarted.resolve();
        return refresh.promise;
      },
      executeWithToken,
      shouldRefresh: (error) => error instanceof AuthenticationError,
      signal: controller.signal,
    });

    await refreshStarted.promise;
    controller.abort(reason);
    const early = await settledBeforeNextTurn(request);
    refresh.resolve("new");
    expect(early).toBe(reason);
    await expect(request).rejects.toBe(reason);
    expect(executeWithToken).toHaveBeenCalledTimes(1);
  });

  it("lets a second caller use shared refresh after the first cancels", async () => {
    const refresh = deferred<string | undefined>();
    const bothRefreshing = deferred<void>();
    let refreshWaiters = 0;
    const first = new AbortController();
    const second = new AbortController();
    const reason = new Error("first cancelled");
    const executeWithToken = mock(async (token: string) => {
      if (token === "old") throw new AuthenticationError();
      return token;
    });
    const options = (signal: AbortSignal) => ({
      getToken: async () => "old",
      forceRefresh: () => {
        if (++refreshWaiters === 2) bothRefreshing.resolve();
        return refresh.promise;
      },
      executeWithToken,
      shouldRefresh: (error: unknown) => error instanceof AuthenticationError,
      signal,
    });
    const firstRequest = executeWithTokenRefresh(options(first.signal));
    const secondRequest = executeWithTokenRefresh(options(second.signal));
    await bothRefreshing.promise;
    first.abort(reason);
    const early = await settledBeforeNextTurn(firstRequest);
    refresh.resolve("new");

    expect(early).toBe(reason);
    await expect(firstRequest).rejects.toBe(reason);
    await expect(secondRequest).resolves.toBe("new");
    expect(executeWithToken).toHaveBeenCalledTimes(3);
  });

  it("cancels two callers independently while shared refresh continues", async () => {
    const refresh = deferred<string | undefined>();
    const bothRefreshing = deferred<void>();
    let refreshWaiters = 0;
    const first = new AbortController();
    const second = new AbortController();
    const firstReason = new Error("first cancelled");
    const secondReason = new Error("second cancelled");
    const executeWithToken = mock(async (token: string) => {
      if (token === "old") throw new AuthenticationError();
      return token;
    });
    const options = (signal: AbortSignal) => ({
      getToken: async () => "old",
      forceRefresh: () => {
        if (++refreshWaiters === 2) bothRefreshing.resolve();
        return refresh.promise;
      },
      executeWithToken,
      shouldRefresh: (error: unknown) => error instanceof AuthenticationError,
      signal,
    });
    const firstRequest = executeWithTokenRefresh(options(first.signal));
    const secondRequest = executeWithTokenRefresh(options(second.signal));
    await bothRefreshing.promise;
    first.abort(firstReason);
    second.abort(secondReason);
    const early = await Promise.all([
      settledBeforeNextTurn(firstRequest),
      settledBeforeNextTurn(secondRequest),
    ]);
    refresh.resolve("new");

    expect(early).toEqual([firstReason, secondReason]);
    await expect(firstRequest).rejects.toBe(firstReason);
    await expect(secondRequest).rejects.toBe(secondReason);
    expect(executeWithToken).toHaveBeenCalledTimes(2);
  });

  it("preserves refresh failure for an active caller after another cancels", async () => {
    const refresh = deferred<string | undefined>();
    const bothRefreshing = deferred<void>();
    let refreshWaiters = 0;
    const first = new AbortController();
    const second = new AbortController();
    const cancelReason = new Error("cancelled");
    const refreshError = new Error("refresh unavailable");
    const options = (signal: AbortSignal) => ({
      getToken: async () => "old",
      forceRefresh: () => {
        if (++refreshWaiters === 2) bothRefreshing.resolve();
        return refresh.promise;
      },
      executeWithToken: async () => {
        throw new AuthenticationError();
      },
      shouldRefresh: (error: unknown) => error instanceof AuthenticationError,
      signal,
    });
    const cancelled = executeWithTokenRefresh(options(first.signal));
    const active = executeWithTokenRefresh(options(second.signal));
    await bothRefreshing.promise;
    first.abort(cancelReason);
    const early = await settledBeforeNextTurn(cancelled);
    refresh.reject(refreshError);

    expect(early).toBe(cancelReason);
    await expect(cancelled).rejects.toBe(cancelReason);
    await expect(active).rejects.toBe(refreshError);
  });

  it("handles a late provider rejection after every caller cancels", async () => {
    const refresh = deferred<string | undefined>();
    const bothRefreshing = deferred<void>();
    let refreshWaiters = 0;
    const first = new AbortController();
    const second = new AbortController();
    const firstReason = new Error("first cancelled");
    const secondReason = new Error("second cancelled");
    const unhandled: unknown[] = [];
    const onUnhandled = (error: unknown) => unhandled.push(error);
    process.on("unhandledRejection", onUnhandled);
    try {
      const options = (signal: AbortSignal) => ({
        getToken: async () => "old",
        forceRefresh: () => {
          if (++refreshWaiters === 2) bothRefreshing.resolve();
          return refresh.promise;
        },
        executeWithToken: async () => {
          throw new AuthenticationError();
        },
        shouldRefresh: (error: unknown) => error instanceof AuthenticationError,
        signal,
      });
      const firstRequest = executeWithTokenRefresh(options(first.signal));
      const secondRequest = executeWithTokenRefresh(options(second.signal));
      await bothRefreshing.promise;
      first.abort(firstReason);
      second.abort(secondReason);
      const early = await Promise.all([
        settledBeforeNextTurn(firstRequest),
        settledBeforeNextTurn(secondRequest),
      ]);
      refresh.reject(new Error("late refresh failure"));
      expect(early).toEqual([firstReason, secondReason]);
      await expect(firstRequest).rejects.toBe(firstReason);
      await expect(secondRequest).rejects.toBe(secondReason);
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it.each(["success", "failure", "cancellation"])(
    "removes the abort listener after %s",
    async (outcome) => {
      const controller = new AbortController();
      const add = spyOn(controller.signal, "addEventListener");
      const remove = spyOn(controller.signal, "removeEventListener");
      const lookup = deferred<string | undefined>();
      const request = executeWithTokenRefresh({
        getToken: () => lookup.promise,
        forceRefresh: async () => undefined,
        executeWithToken: async () => "ok",
        shouldRefresh: () => false,
        signal: controller.signal,
      });
      const reason = new Error(outcome);
      try {
        if (outcome === "success") lookup.resolve("token");
        if (outcome === "failure") lookup.reject(reason);
        if (outcome === "cancellation") {
          controller.abort(reason);
          const early = await settledBeforeNextTurn(request);
          const listener = add.mock.calls[0]?.[1];
          const removedBeforeProviderSettled = remove.mock.calls.some(
            ([event, removed]) => event === "abort" && removed === listener,
          );
          lookup.reject(new Error("late token lookup failure"));
          expect(early).toBe(reason);
          expect(removedBeforeProviderSettled).toBe(true);
        }
        await request.catch(() => undefined);
        expect(add).toHaveBeenCalledWith("abort", expect.any(Function), {
          once: true,
        });
        expect(remove).toHaveBeenCalledWith("abort", add.mock.calls[0]?.[1]);
      } finally {
        lookup.resolve("token");
        await request.catch(() => undefined);
        add.mockRestore();
        remove.mockRestore();
      }
    },
  );
});
