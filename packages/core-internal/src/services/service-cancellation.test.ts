import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import { CodeNavigationServiceImpl } from "./code-navigation-service.js";
import { GrepServiceImpl } from "./grep-service.js";
import { ListServiceImpl } from "./list-service.js";
import { PackageIntelligenceServiceImpl } from "./package-intelligence-service.js";
import { ReadServiceImpl } from "./read-service.js";
import { ResolveTargetServiceImpl } from "./resolve-target-service.js";
import type { ServiceRequestOptions } from "./service-request-options.js";
import { createMockTokenProvider } from "./test-helpers.js";
import type { TokenProvider } from "./token-provider.js";

const ENDPOINT = "https://source.example.test";

type FetchHandler = (
  input: Parameters<typeof fetch>[0],
  init?: RequestInit,
) => Promise<Response>;

interface CancellationCase {
  name: string;
  call: (
    fetchFn: typeof fetch,
    tokenProvider: TokenProvider,
    options?: ServiceRequestOptions,
  ) => Promise<unknown>;
}

function asFetch(handler: FetchHandler): typeof fetch {
  return handler as unknown as typeof fetch;
}

const cases: CancellationCase[] = [
  {
    name: "list",
    call: (fetchFn, tokenProvider, options) =>
      new ListServiceImpl(ENDPOINT, tokenProvider, fetchFn).list(
        { target: "npm:express", includeDetailedFields: false },
        options,
      ),
  },
  {
    name: "read",
    call: (fetchFn, tokenProvider, options) =>
      new ReadServiceImpl(ENDPOINT, tokenProvider, fetchFn).read(
        { target: "npm:express", path: "index.js" },
        options,
      ),
  },
  {
    name: "grep",
    call: (fetchFn, tokenProvider, options) =>
      new GrepServiceImpl(ENDPOINT, tokenProvider, fetchFn).grep(
        {
          targets: [{ target: "npm:express" }],
          pattern: "router",
          patternType: "LITERAL",
          caseSensitive: true,
          contextLinesBefore: 0,
          contextLinesAfter: 0,
          includeDetailedFields: false,
        },
        options,
      ),
  },
  {
    name: "resolveTarget",
    call: (fetchFn, tokenProvider, options) =>
      new ResolveTargetServiceImpl(
        ENDPOINT,
        tokenProvider,
        fetchFn,
      ).resolveTarget(
        {
          name: "express",
          limit: 5,
          includeDetailedFields: false,
          includeNameSimilarity: false,
        },
        options,
      ),
  },
  {
    name: "codeDiff",
    call: (fetchFn, tokenProvider, options) =>
      new CodeNavigationServiceImpl(ENDPOINT, tokenProvider, fetchFn).codeDiff(
        {
          target: { registry: "NPM", packageName: "express" },
          from: "4.0.0",
          to: "5.0.0",
          mode: "inventory",
        },
        options,
      ),
  },
  {
    name: "packageSummary",
    call: (fetchFn, tokenProvider, options) =>
      new PackageIntelligenceServiceImpl(
        ENDPOINT,
        tokenProvider,
        fetchFn,
      ).packageSummary({ registry: "NPM", packageName: "express" }, options),
  },
  {
    name: "packageVulnerabilities",
    call: (fetchFn, tokenProvider, options) =>
      new PackageIntelligenceServiceImpl(
        ENDPOINT,
        tokenProvider,
        fetchFn,
      ).packageVulnerabilities(
        { registry: "NPM", packageName: "express", includeTransitive: true },
        options,
      ),
  },
  {
    name: "packageDependencies",
    call: (fetchFn, tokenProvider, options) =>
      new PackageIntelligenceServiceImpl(
        ENDPOINT,
        tokenProvider,
        fetchFn,
      ).packageDependencies(
        { registry: "NPM", packageName: "express" },
        options,
      ),
  },
  {
    name: "packageChangelog",
    call: (fetchFn, tokenProvider, options) =>
      new PackageIntelligenceServiceImpl(
        ENDPOINT,
        tokenProvider,
        fetchFn,
      ).packageChangelog({ registry: "NPM", packageName: "express" }, options),
  },
  {
    name: "packageUpgradeReview",
    call: (fetchFn, tokenProvider, options) =>
      new PackageIntelligenceServiceImpl(
        ENDPOINT,
        tokenProvider,
        fetchFn,
      ).packageUpgradeReview(
        {
          packages: [
            {
              registry: "NPM",
              name: "express",
              currentVersion: "4.0.0",
              targetVersion: "5.0.0",
            },
          ],
          includeTransitiveSecurity: true,
          includeDependencyIssues: false,
          changelogLimit: 10,
        },
        options,
      ),
  },
];

/** A fetch that never settles on its own and rejects once its signal aborts. */
function pendingHeadersFetch(started: () => void): FetchHandler {
  return (_input, init) =>
    new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (!signal) throw new Error("expected a request signal");
      signal.addEventListener("abort", () => reject(signal.reason), {
        once: true,
      });
      started();
    });
}

/** A fetch whose headers arrive but whose body only ends when aborted. */
function pendingBodyFetch(started: () => void): FetchHandler {
  return async (_input, init) => {
    const signal = init?.signal;
    if (!signal) throw new Error("expected a request signal");
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        signal.addEventListener(
          "abort",
          () => controller.error(signal.reason),
          { once: true },
        );
        started();
      },
    });
    return new Response(body, {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
}

async function captureError(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected the request to reject");
}

describe("network service caller cancellation", () => {
  afterEach(() => {
    mock.restore();
  });

  describe.each(cases)("$name", ({ call }) => {
    it("aborts a pending request when the caller signal aborts", async () => {
      const controller = new AbortController();
      const reason = new Error("caller cancelled");
      const fetchFn = mock(pendingHeadersFetch(() => controller.abort(reason)));

      await expect(
        call(asFetch(fetchFn), createMockTokenProvider(), {
          signal: controller.signal,
        }),
      ).rejects.toBe(reason);
      expect(fetchFn).toHaveBeenCalledTimes(1);
    });

    it("aborts a pending response body read when the caller signal aborts", async () => {
      const controller = new AbortController();
      const reason = new Error("caller cancelled during body");
      const fetchFn = mock(pendingBodyFetch(() => controller.abort(reason)));

      await expect(
        call(asFetch(fetchFn), createMockTokenProvider(), {
          signal: controller.signal,
        }),
      ).rejects.toBe(reason);
    });

    it("does not start a request for an already-aborted caller", async () => {
      const controller = new AbortController();
      const reason = new Error("already cancelled");
      controller.abort(reason);
      const getToken = mock(() => Promise.resolve("token"));
      const fetchFn = mock(() => Promise.resolve(new Response("{}")));

      await expect(
        call(asFetch(fetchFn), createMockTokenProvider({ getToken }), {
          signal: controller.signal,
        }),
      ).rejects.toBe(reason);
      expect(getToken).not.toHaveBeenCalled();
      expect(fetchFn).not.toHaveBeenCalled();
    });

    it("keeps the internal timeout mapping when a caller signal is present", async () => {
      const runWithInternalTimeout = async (
        options?: ServiceRequestOptions,
      ): Promise<unknown> => {
        const deadline = new AbortController();
        const timeout = spyOn(AbortSignal, "timeout").mockImplementation(
          () => deadline.signal,
        );
        try {
          const fetchFn = mock(
            pendingHeadersFetch(() =>
              deadline.abort(
                new DOMException("deadline reached", "TimeoutError"),
              ),
            ),
          );
          return await captureError(
            call(asFetch(fetchFn), createMockTokenProvider(), options),
          );
        } finally {
          timeout.mockRestore();
        }
      };

      const withoutSignal = await runWithInternalTimeout();
      const caller = new AbortController();
      const withSignal = await runWithInternalTimeout({
        signal: caller.signal,
      });

      expect(caller.signal.aborted).toBe(false);
      expect(withSignal).toBeInstanceOf(Error);
      expect((withSignal as Error).constructor).toBe(
        (withoutSignal as Error).constructor,
      );
      expect((withSignal as Error).message).toBe(
        (withoutSignal as Error).message,
      );
      expect((withSignal as Error).name).not.toBe("AbortError");
    });

    it("does not retry when the caller aborts during token refresh", async () => {
      const controller = new AbortController();
      const reason = new Error("caller cancelled during refresh");
      const forceRefresh = mock(async () => {
        controller.abort(reason);
        return "refreshed-token";
      });
      const fetchFn = mock(() =>
        Promise.resolve(
          new Response(JSON.stringify({ message: "Unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          }),
        ),
      );

      await expect(
        call(asFetch(fetchFn), createMockTokenProvider({ forceRefresh }), {
          signal: controller.signal,
        }),
      ).rejects.toBe(reason);
      expect(forceRefresh).toHaveBeenCalledTimes(1);
      expect(fetchFn).toHaveBeenCalledTimes(1);
    });
  });

  it("cancels an active grep authentication retry without a third request", async () => {
    const controller = new AbortController();
    const reason = new Error("retry cancelled");
    let requests = 0;
    let retryStarted!: () => void;
    const retry = new Promise<void>((resolve) => {
      retryStarted = resolve;
    });
    const fetchFn = mock(
      (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        requests += 1;
        if (requests === 1) {
          return Promise.resolve(new Response("{}", { status: 401 }));
        }
        retryStarted();
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(init.signal?.reason),
            { once: true },
          );
        });
      },
    );
    const service = new GrepServiceImpl(
      ENDPOINT,
      createMockTokenProvider(),
      asFetch(fetchFn),
    );
    const request = service.grep(
      {
        targets: [{ target: "npm:express" }],
        pattern: "router",
        patternType: "LITERAL",
        caseSensitive: true,
        contextLinesBefore: 0,
        contextLinesAfter: 0,
        includeDetailedFields: false,
      },
      { signal: controller.signal },
    );

    await retry;
    controller.abort(reason);
    await expect(request).rejects.toBe(reason);
    expect(requests).toBe(2);
  });
});
