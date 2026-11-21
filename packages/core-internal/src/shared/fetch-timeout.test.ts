import { describe, expect, it, mock, spyOn } from "bun:test";
import { FetchTimeoutError, fetchWithTimeout } from "./fetch-timeout.js";

function asFetchFn<T extends (...args: never[]) => unknown>(
  fn: T,
): typeof fetch {
  return fn as unknown as typeof fetch;
}

describe("fetchWithTimeout", () => {
  it("keeps body consumption within the original deadline", async () => {
    const fetchFn = asFetchFn(
      mock(async () => new Response("headers arrived")),
    );
    await expect(
      fetchWithTimeout(
        "https://example.com",
        {},
        { fetchFn, timeoutMs: 5 },
        () => new Promise<string>(() => {}),
      ),
    ).rejects.toBeInstanceOf(FetchTimeoutError);
  });

  it("preserves caller cancellation during body consumption", async () => {
    const controller = new AbortController();
    const reason = new Error("caller stopped reading");
    const fetchFn = asFetchFn(
      mock(async () => new Response("headers arrived")),
    );
    await expect(
      fetchWithTimeout(
        "https://example.com",
        { signal: controller.signal },
        { fetchFn, timeoutMs: 1000 },
        async () => {
          controller.abort(reason);
          throw reason;
        },
      ),
    ).rejects.toBe(reason);
  });

  it("passes a timeout signal to fetch", async () => {
    const fetchFn = mock((_url: string, init?: RequestInit) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return Promise.resolve(new Response("ok"));
    });

    const response = await fetchWithTimeout(
      "https://example.com",
      {},
      {
        fetchFn: asFetchFn(fetchFn),
        timeoutMs: 100,
      },
    );

    expect(await response.text()).toBe("ok");
  });

  it("rejects with FetchTimeoutError when the timeout expires", async () => {
    const fetchFn = mock(() => new Promise<Response>(() => {}));

    await expect(
      fetchWithTimeout(
        "https://example.com",
        {},
        {
          fetchFn: asFetchFn(fetchFn),
          timeoutMs: 1,
        },
      ),
    ).rejects.toThrow(FetchTimeoutError);
  });

  it("preserves caller aborts", async () => {
    const controller = new AbortController();
    const cause = new Error("caller aborted");
    const fetchFn = mock((_url: string, init?: RequestInit) => {
      init?.signal?.addEventListener("abort", () => {});
      return Promise.reject(cause);
    });
    const pending = fetchWithTimeout(
      "https://example.com",
      { signal: controller.signal },
      { fetchFn: asFetchFn(fetchFn), timeoutMs: 10_000 },
    );
    controller.abort(cause);

    await expect(pending).rejects.toBe(cause);
  });

  it("does not dispatch when the caller is already aborted", async () => {
    const controller = new AbortController();
    const reason = new Error("cancelled before dispatch");
    controller.abort(reason);
    const fetchFn = mock(() => Promise.resolve(new Response("ok")));

    await expect(
      fetchWithTimeout(
        "https://example.com",
        { signal: controller.signal },
        { fetchFn: asFetchFn(fetchFn), timeoutMs: 10_000 },
      ),
    ).rejects.toBe(reason);

    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("cancels a transport that ignores its abort signal", async () => {
    const controller = new AbortController();
    const reason = new Error("cancelled during fetch");
    let started!: () => void;
    const dispatched = new Promise<void>((resolve) => {
      started = resolve;
    });
    const fetchFn = mock(() => {
      started();
      return new Promise<Response>(() => {});
    });

    const pending = fetchWithTimeout(
      "https://example.com",
      { signal: controller.signal },
      { fetchFn: asFetchFn(fetchFn), timeoutMs: 10_000 },
    );

    await dispatched;
    controller.abort(reason);

    await expect(pending).rejects.toBe(reason);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("cancels a stalled response consumer", async () => {
    const controller = new AbortController();
    const reason = new Error("cancelled during body read");
    let started!: () => void;
    const consuming = new Promise<void>((resolve) => {
      started = resolve;
    });

    const pending = fetchWithTimeout(
      "https://example.com",
      { signal: controller.signal },
      {
        fetchFn: asFetchFn(mock(async () => new Response("ok"))),
        timeoutMs: 10_000,
      },
      () => {
        started();
        return new Promise<string>(() => {});
      },
    );

    await consuming;
    controller.abort(reason);

    await expect(pending).rejects.toBe(reason);
  });

  it("preserves the timeout error if the caller aborts afterward", async () => {
    const controller = new AbortController();
    const reason = new Error("late caller cancellation");
    const deadline = new AbortController();
    const originalTimeout = AbortSignal.timeout;

    AbortSignal.timeout = mock(() => deadline.signal);

    try {
      const pending = fetchWithTimeout(
        "https://example.com",
        { signal: controller.signal },
        {
          fetchFn: asFetchFn(mock(() => new Promise<Response>(() => {}))),
          timeoutMs: 10_000,
        },
      );

      deadline.abort(new DOMException("deadline", "TimeoutError"));
      controller.abort(reason);

      await expect(pending).rejects.toBeInstanceOf(FetchTimeoutError);
    } finally {
      AbortSignal.timeout = originalTimeout;
    }
  });

  it("preserves caller cancellation before the deadline", async () => {
    const controller = new AbortController();
    const reason = new Error("caller cancelled first");
    const deadline = new AbortController();
    const originalTimeout = AbortSignal.timeout;

    AbortSignal.timeout = mock(() => deadline.signal);

    try {
      const pending = fetchWithTimeout(
        "https://example.com",
        { signal: controller.signal },
        {
          fetchFn: asFetchFn(mock(() => new Promise<Response>(() => {}))),
          timeoutMs: 10_000,
        },
      );

      controller.abort(reason);
      deadline.abort(new DOMException("deadline", "TimeoutError"));

      await expect(pending).rejects.toBe(reason);
    } finally {
      AbortSignal.timeout = originalTimeout;
    }
  });

  it("preserves timeout precedence when transport rejects after both aborts", async () => {
    const caller = new AbortController();
    const deadline = new AbortController();
    const originalTimeout = AbortSignal.timeout;
    const transportError = new Error("transport failed");

    AbortSignal.timeout = mock(() => deadline.signal);

    try {
      let rejectFetch!: (reason: unknown) => void;
      const fetchFn = mock(
        () =>
          new Promise<Response>((_, reject) => {
            rejectFetch = reject;
          }),
      );

      const pending = fetchWithTimeout(
        "https://example.com",
        { signal: caller.signal },
        { fetchFn: asFetchFn(fetchFn), timeoutMs: 10_000 },
      );

      await Promise.resolve();
      deadline.abort(new DOMException("deadline", "TimeoutError"));
      caller.abort(new Error("late caller cancellation"));
      rejectFetch(transportError);

      await expect(pending).rejects.toBeInstanceOf(FetchTimeoutError);
    } finally {
      AbortSignal.timeout = originalTimeout;
    }
  });

  it("removes cancellation listeners after the request settles", async () => {
    const controller = new AbortController();
    const add = spyOn(controller.signal, "addEventListener");
    const remove = spyOn(controller.signal, "removeEventListener");

    try {
      await fetchWithTimeout(
        "https://example.com",
        { signal: controller.signal },
        {
          fetchFn: asFetchFn(mock(async () => new Response("ok"))),
          timeoutMs: 10_000,
        },
      );

      const addedAbortListeners = add.mock.calls.filter(
        ([type]) => type === "abort",
      ).length;
      const removedAbortListeners = remove.mock.calls.filter(
        ([type]) => type === "abort",
      ).length;

      expect(addedAbortListeners).toBeGreaterThan(0);
      expect(removedAbortListeners).toBe(addedAbortListeners);
    } finally {
      add.mockRestore();
      remove.mockRestore();
    }
  });
});
