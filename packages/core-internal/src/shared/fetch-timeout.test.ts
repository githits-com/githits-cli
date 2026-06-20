import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import {
  FetchTimeoutError,
  fetchWithTimeout,
  retryFetchWithTimeout,
} from "./fetch-timeout.js";

function asFetchFn<T extends (...args: never[]) => unknown>(
  fn: T,
): typeof fetch {
  return fn as unknown as typeof fetch;
}

// Store original setTimeout
const originalSetTimeout = globalThis.setTimeout;

describe("fetchWithTimeout", () => {
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
    controller.abort();

    await expect(
      fetchWithTimeout(
        "https://example.com",
        { signal: controller.signal },
        { fetchFn: asFetchFn(fetchFn), timeoutMs: 10_000 },
      ),
    ).rejects.toBe(cause);
  });
});

describe("retryFetchWithTimeout", () => {
  beforeEach(() => {
    // Mock setTimeout to immediately invoke callback (no actual delays)
    globalThis.setTimeout = mock((fn: () => void, _ms: number) => {
      fn();
      return 0;
    }) as never;
  });

  afterEach(() => {
    // Restore original setTimeout
    globalThis.setTimeout = originalSetTimeout;
  });

  it("succeeds on first attempt without retry", async () => {
    const fetchFn = mock(() => Promise.resolve(new Response("ok")));

    const response = await retryFetchWithTimeout(
      "https://example.com",
      {},
      {
        fetchFn: asFetchFn(fetchFn),
        timeoutMs: 100,
        maxRetries: 3,
      },
    );

    expect(await response.text()).toBe("ok");
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("retries on FetchTimeoutError and succeeds", async () => {
    let callCount = 0;
    const fetchFn = mock(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.reject(new FetchTimeoutError(100));
      }
      return Promise.resolve(new Response("ok after retry"));
    });

    const response = await retryFetchWithTimeout(
      "https://example.com",
      {},
      {
        fetchFn: asFetchFn(fetchFn),
        timeoutMs: 100,
        maxRetries: 3,
        baseDelayMs: 100,
      },
    );

    expect(await response.text()).toBe("ok after retry");
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("does not retry when idempotent=false", async () => {
    const error = new FetchTimeoutError(100);
    const fetchFn = mock(() => Promise.reject(error));

    await expect(
      retryFetchWithTimeout(
        "https://example.com",
        {},
        {
          fetchFn: asFetchFn(fetchFn),
          timeoutMs: 100,
          idempotent: false,
        },
      ),
    ).rejects.toThrow(error);

    // Only initial attempt, no retries
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("respects maxRetries option", async () => {
    const error = new FetchTimeoutError(100);
    const fetchFn = mock(() => Promise.reject(error));

    await expect(
      retryFetchWithTimeout(
        "https://example.com",
        {},
        {
          fetchFn: asFetchFn(fetchFn),
          timeoutMs: 100,
          maxRetries: 2,
          baseDelayMs: 100,
        },
      ),
    ).rejects.toThrow(error);

    // Initial attempt + 2 retries = 3 calls total
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it("calls onRetry hook", async () => {
    let callCount = 0;
    const fetchFn = mock(() => {
      callCount++;
      if (callCount <= 2) {
        return Promise.reject(new FetchTimeoutError(100));
      }
      return Promise.resolve(new Response("ok"));
    });

    const onRetry = mock(() => {});

    const response = await retryFetchWithTimeout(
      "https://example.com",
      {},
      {
        fetchFn: asFetchFn(fetchFn),
        timeoutMs: 100,
        maxRetries: 3,
        baseDelayMs: 100,
        onRetry,
      },
    );

    expect(await response.text()).toBe("ok");
    expect(onRetry).toHaveBeenCalledTimes(2);
  });
});
