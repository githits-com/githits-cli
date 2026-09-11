import { describe, expect, it, mock, spyOn } from "bun:test";
import {
  CodeNavigationServiceImpl,
  CodeNavigationTargetNotFoundError,
  MalformedCodeNavigationResponseError,
} from "./code-navigation-service.js";
import { createMockTokenProvider } from "./test-helpers.js";

const estimates = [
  {
    kind: "REPOSITORY",
    targets: ["npm:express", "github:expressjs/express"],
    repositoryUrl: "https://github.com/expressjs/express",
    commitSha: null,
    estimate: {
      lowerSeconds: 10,
      upperSeconds: 44,
      elapsedSeconds: null,
      sampleCount: 30,
      source: "same_repository_refs",
    },
    unavailableReason: null,
  },
  {
    kind: "DOCUMENTATION",
    targets: ["site:expressjs.com"],
    repositoryUrl: null,
    commitSha: null,
    estimate: null,
    unavailableReason: "UNSUPPORTED_WORK",
  },
  {
    kind: "REPOSITORY",
    targets: ["npm:no-history"],
    repositoryUrl: "https://github.com/example/no-history",
    commitSha: "abcdef",
    estimate: {
      lowerSeconds: null,
      upperSeconds: null,
      elapsedSeconds: 12,
      sampleCount: 0,
      source: null,
    },
    unavailableReason: "NO_HISTORY",
  },
];

const progress = {
  searchRef: "estimate-ref",
  status: "INDEXING",
  targetsTotal: 3,
  targetsReady: 1,
  elapsedMs: 600_000,
  query: "router",
  queryWarnings: [],
  sources: ["CODE", "DOCS"],
  indexingEstimates: estimates,
};
const result = {
  query: "router",
  queryWarnings: [],
  sources: ["CODE", "DOCS"],
  results: [],
  page: { offset: 0, limit: 10, returned: 0, hasMore: false },
  partialResults: true,
  sourceStatus: [],
  evidenceNotice: "Provisional evidence is usable while preparation continues.",
};

for (const operation of ["search", "searchStatus"] as const) {
  function setup(responseProgress: Record<string, unknown>) {
    const fetchFn = mock(async () =>
      Response.json({
        data:
          operation === "search"
            ? {
                search: {
                  completed: responseProgress.status === "COMPLETED",
                  searchRef: "estimate-ref",
                  progress: responseProgress,
                  result,
                },
              }
            : {
                discoverySearchProgress: {
                  ...responseProgress,
                  results: result,
                },
              },
      }),
    );
    const service = new CodeNavigationServiceImpl(
      "https://backend.example.com",
      createMockTokenProvider(),
      fetchFn as unknown as typeof fetch,
    );
    const run = (
      includeFocusedSource = true,
      waitTimeoutMs = 0,
      signal?: AbortSignal,
    ) =>
      operation === "search"
        ? service.search(
            {
              targets: [{ repoUrl: "https://github.com/expressjs/express" }],
              query: "router",
              allowPartialResults: true,
              waitTimeoutMs,
            },
            { omitFocusedSource: !includeFocusedSource, signal },
          )
        : service.searchStatus("estimate-ref", waitTimeoutMs, {
            omitFocusedSource: !includeFocusedSource,
            signal,
          });
    return { fetchFn, run };
  }

  describe(`${operation} discovery indexing estimates`, () => {
    it.each([
      [0, 120_000],
      [30_000, 120_000],
      [90_000, 120_000],
      [120_000, 150_000],
    ])(
      "gives a %s ms readiness wait %s ms of HTTP budget",
      async (waitTimeoutMs, expectedTimeoutMs) => {
        const timeout = spyOn(AbortSignal, "timeout");
        try {
          const { fetchFn, run } = setup(progress);
          await run(true, waitTimeoutMs);
          expect(timeout).toHaveBeenCalledWith(expectedTimeoutMs);
          const [, init] = (
            fetchFn.mock.calls as unknown as Array<[unknown, RequestInit]>
          )[0]!;
          expect(JSON.parse(String(init.body)).variables.waitTimeoutMs).toBe(
            waitTimeoutMs,
          );
        } finally {
          timeout.mockRestore();
        }
      },
    );

    it("aborts an in-flight discovery fetch when its caller cancels", async () => {
      const controller = new AbortController();
      const { fetchFn, run } = setup(progress);
      let started!: () => void;
      const ready = new Promise<void>((resolve) => {
        started = resolve;
      });
      let upstreamSignal: AbortSignal | undefined;
      fetchFn.mockImplementationOnce((...args: unknown[]) => {
        upstreamSignal = (args[1] as RequestInit).signal ?? undefined;
        started();
        return new Promise<Response>((_resolve, reject) => {
          upstreamSignal?.addEventListener(
            "abort",
            () => reject(upstreamSignal?.reason),
            { once: true },
          );
        });
      });
      const pending = run(true, 120_000, controller.signal);
      await ready;
      controller.abort(new Error("caller stopped waiting"));
      expect(upstreamSignal?.aborted).toBe(true);
      await expect(pending).rejects.toBe(controller.signal.reason);
    });

    it("preserves the long deadline and caller cancellation through query fallback", async () => {
      const controller = new AbortController();
      const { fetchFn, run } = setup(progress);
      fetchFn.mockImplementationOnce(async () =>
        Response.json({
          errors: [
            {
              message:
                'Cannot query field "availableRefs" on type "TargetResolution".',
              extensions: { code: "GRAPHQL_VALIDATION_FAILED" },
            },
          ],
        }),
      );
      const timeout = spyOn(AbortSignal, "timeout");
      try {
        await run(true, 120_000, controller.signal);
        expect(fetchFn).toHaveBeenCalledTimes(2);
        expect(timeout.mock.calls.map((call) => call[0])).toEqual([
          150_000, 150_000,
        ]);
        controller.abort();
        for (const [, init] of fetchFn.mock.calls as unknown as Array<
          [unknown, RequestInit]
        >) {
          expect(init.signal?.aborted).toBe(true);
          expect(JSON.parse(String(init.body)).variables.waitTimeoutMs).toBe(
            120_000,
          );
        }
      } finally {
        timeout.mockRestore();
      }
    });

    it.each([false, true])(
      "selects and decodes timing evidence with focused source=%s",
      async (detailed) => {
        const { fetchFn, run } = setup(progress);
        const outcome = await run(detailed);
        const [, init] = (
          fetchFn.mock.calls as unknown as Array<[unknown, RequestInit]>
        )[0]!;
        const wire = JSON.parse(String(init.body));
        expect(wire.query).toMatch(
          /indexingEstimates\s*\{\s*kind\s+targets\s+repositoryUrl\s+commitSha\s+estimate\s*\{\s*lowerSeconds\s+upperSeconds\s+elapsedSeconds\s+sampleCount\s+source\s*\}\s+unavailableReason\s*\}/,
        );
        expect(wire.variables.includeFocusedSource).toBe(detailed);
        expect(outcome.progress?.indexingEstimates).toEqual([
          {
            kind: "REPOSITORY",
            targets: estimates[0]!.targets,
            repositoryUrl: estimates[0]!.repositoryUrl!,
            estimate: {
              lowerSeconds: 10,
              upperSeconds: 44,
              sampleCount: 30,
              source: "same_repository_refs",
            },
          },
          {
            kind: "DOCUMENTATION",
            targets: estimates[1]!.targets,
            unavailableReason: "UNSUPPORTED_WORK",
          },
          {
            kind: "REPOSITORY",
            targets: estimates[2]!.targets,
            repositoryUrl: estimates[2]!.repositoryUrl!,
            commitSha: "abcdef",
            estimate: { elapsedSeconds: 12, sampleCount: 0 },
            unavailableReason: "NO_HISTORY",
          },
        ]);
        expect(outcome.result?.partialResults).toBe(true);
        expect(outcome.result?.evidenceNotice).toBe(result.evidenceNotice);
      },
    );

    it.each(["DEFERRED", "FAILED", "TIMEOUT", "SEARCHING"])(
      "preserves timing without changing %s lifecycle",
      async (status) => {
        const outcome = await setup({ ...progress, status }).run();
        expect(outcome.progress?.status).toBe(status);
        expect(outcome.progress?.indexingEstimates).toHaveLength(3);
      },
    );

    it("decodes a completed snapshot with empty estimates", async () => {
      const outcome = await setup({
        ...progress,
        status: "COMPLETED",
        indexingEstimates: [],
      }).run();
      expect(outcome.completed).toBe(true);
      expect(outcome.progress?.indexingEstimates).toEqual([]);
    });

    it("preserves empty estimates without completing an active search", async () => {
      const outcome = await setup({ ...progress, indexingEstimates: [] }).run();
      expect(outcome.completed).toBe(false);
      expect(outcome.progress?.indexingEstimates).toEqual([]);
    });

    it.each(
      [
        undefined,
        null,
        [null],
        [{ ...estimates[0], kind: "UNKNOWN" }],
        [{ ...estimates[0], targets: null }],
      ].map((indexingEstimates) => ({ indexingEstimates })),
    )(
      "rejects malformed selected estimate data %j",
      async ({ indexingEstimates }) => {
        await expect(
          setup({ ...progress, indexingEstimates }).run(),
        ).rejects.toBeInstanceOf(MalformedCodeNavigationResponseError);
      },
    );

    it("preserves NOT_FOUND when GraphQL supplies no estimate payload", async () => {
      const fetchFn = mock(async () =>
        Response.json({
          errors: [
            {
              message: "Search not found",
              extensions: { code: "NOT_FOUND", retryable: false },
            },
          ],
        }),
      );
      const service = new CodeNavigationServiceImpl(
        "https://backend.example.com",
        createMockTokenProvider(),
        fetchFn as unknown as typeof fetch,
      );
      const response =
        operation === "search"
          ? service.search({
              targets: [{ repoUrl: "https://github.com/expressjs/express" }],
              query: "router",
            })
          : service.searchStatus("missing", 0);
      await expect(response).rejects.toBeInstanceOf(
        CodeNavigationTargetNotFoundError,
      );
    });
  });
}
