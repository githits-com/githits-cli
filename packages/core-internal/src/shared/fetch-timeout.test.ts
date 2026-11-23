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

  it("applies the transport deadline to a body read after headers return", async () => {
    const fetchFn = mock(
      async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        const signal = init?.signal;
        if (!signal) throw new Error("expected a request signal");
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            signal.addEventListener(
              "abort",
              () => controller.error(signal.reason),
              { once: true },
            );
          },
        });
        return new Response(body);
      },
    );

    const response = await fetchWithTimeout(
      "https://example.test",
      {},
      { fetchFn: asFetchFn(fetchFn), timeoutMs: 5 },
    );
    const result = await Promise.race([
      response.text().catch((error: unknown) => error),
      Bun.sleep(50),
    ]);
    expect(result).toHaveProperty("name", "TimeoutError");
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

  it("enforces and clears the deadline in Node when the request is the only pending work", async () => {
    const source = await Bun.file(
      new URL("./fetch-timeout.ts", import.meta.url),
    ).text();
    const helper = new Bun.Transpiler({ loader: "ts" }).transformSync(source);
    const child = Bun.spawn(
      [
        "node",
        "--input-type=module",
        "--eval",
        `${helper}
          await fetchWithTimeout("https://example.test", {}, {
            fetchFn: async () => new Response("ok"),
            timeoutMs: 60_000,
          });
          try {
            await fetchWithTimeout("https://example.test", {}, {
              fetchFn: () => new Promise(() => {}),
              timeoutMs: 10,
            });
          } catch (error) {
            if (!(error instanceof FetchTimeoutError)) throw error;
            console.log(error.name);
          }`,
      ],
      { stdout: "pipe", stderr: "pipe", timeout: 3_000 },
    );
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);

    expect({ exitCode, stdout: stdout.trim(), stderr }).toEqual({
      exitCode: 0,
      stdout: "FetchTimeoutError",
      stderr: "",
    });
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

  it("preserves the deadline when the caller aborts and fetch rejects in the same turn", async () => {
    const controller = new AbortController();
    const deadline = new AbortController();
    const timeout = spyOn(AbortSignal, "timeout").mockReturnValue(
      deadline.signal,
    );
    const fetchFn = mock(
      (_input: Parameters<typeof fetch>[0], init?: RequestInit) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener("abort", () => {
            controller.abort(new Error("late caller cancellation"));
            reject(new Error("transport failed"));
          });
        }),
    );

    try {
      const pending = fetchWithTimeout(
        "https://example.com",
        { signal: controller.signal },
        { fetchFn: asFetchFn(fetchFn), timeoutMs: 10_000 },
      );
      await Promise.resolve();
      deadline.abort(new DOMException("deadline reached", "TimeoutError"));

      await expect(pending).rejects.toBeInstanceOf(FetchTimeoutError);
      expect(controller.signal.aborted).toBe(true);
    } finally {
      timeout.mockRestore();
    }
  });

  it("removes cancellation listeners after the request settles", async () => {
    const controller = new AbortController();
    const add = spyOn(AbortSignal.prototype, "addEventListener");
    const remove = spyOn(AbortSignal.prototype, "removeEventListener");

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
