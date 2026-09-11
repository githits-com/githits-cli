import { describe, expect, it, mock } from "bun:test";
import { FetchTimeoutError, fetchWithTimeout } from "./fetch-timeout.js";

function asFetchFn<T extends (...args: never[]) => unknown>(
  fn: T,
): typeof fetch {
  return fn as unknown as typeof fetch;
}

describe("fetchWithTimeout", () => {
  it("passes a timeout signal to fetch", async () => {
    const fetchFn = mock((_url: string, init?: RequestInit) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      expect(init).not.toHaveProperty("timeout");
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

  it("lets the signal own extended request deadlines", async () => {
    const fetchFn = mock((_url: string, init?: RequestInit) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      expect(init).toHaveProperty("timeout", false);
      return Promise.resolve(new Response("ok"));
    });
    await fetchWithTimeout(
      "https://example.com",
      {},
      {
        fetchFn: asFetchFn(fetchFn),
        timeoutMs: 330_000,
      },
    );
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
