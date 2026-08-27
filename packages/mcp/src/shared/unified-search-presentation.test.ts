import { describe, expect, it } from "bun:test";
import { projectUnifiedSearchPresentation } from "./unified-search-presentation.js";
import type {
  UnifiedSearchCompletedPayload,
  UnifiedSearchIncompletePayload,
  UnifiedSearchSourceStatusPayload,
  UnifiedSearchStatusCompletedPayload,
  UnifiedSearchStatusIncompletePayload,
  UnifiedSearchStatusResultPayload,
} from "./unified-search-response.js";

const hit = {
  type: "repository_code",
  target: "npm:express@4.18.2",
  title: "router",
  summary: "router implementation",
  locator: { packageName: "express", version: "4.18.2" },
};

function completed(
  overrides: Partial<UnifiedSearchCompletedPayload> = {},
): UnifiedSearchCompletedPayload {
  return {
    query: { raw: "router" },
    completed: true,
    partialResults: false,
    hasMore: false,
    results: [hit],
    ...overrides,
  };
}

function incomplete(
  overrides: Partial<UnifiedSearchIncompletePayload> = {},
): UnifiedSearchIncompletePayload {
  return {
    query: { raw: "router" },
    completed: false,
    hasMore: false,
    results: [],
    searchRef: "search-ref-1",
    progress: {
      status: "INDEXING",
      targetsReady: 0,
      targetsTotal: 1,
      elapsedMs: 200,
    },
    ...overrides,
  };
}

function statusResult(
  overrides: Partial<UnifiedSearchStatusResultPayload> = {},
): UnifiedSearchStatusResultPayload {
  return {
    query: { raw: "router" },
    partialResults: false,
    hasMore: false,
    results: [],
    ...overrides,
  };
}

function statusCompleted(
  result: UnifiedSearchStatusResultPayload = statusResult(),
): UnifiedSearchStatusCompletedPayload {
  return { completed: true, searchRef: "search-ref-1", result };
}

function statusIncomplete(
  overrides: Partial<UnifiedSearchStatusIncompletePayload> = {},
): UnifiedSearchStatusIncompletePayload {
  return {
    completed: false,
    searchRef: "search-ref-1",
    progress: {
      status: "INDEXING",
      targetsReady: 0,
      targetsTotal: 1,
      elapsedMs: 200,
    },
    ...overrides,
  };
}

function source(
  overrides: Partial<UnifiedSearchSourceStatusPayload> = {},
): UnifiedSearchSourceStatusPayload {
  return {
    source: "code",
    targetLabel: "npm:express@4.18.2",
    ...overrides,
  };
}

describe("projectUnifiedSearchPresentation", () => {
  it.each(["PENDING", "INDEXING", "SEARCHING"] as const)(
    "keeps active lifecycle %s distinct",
    (status) => {
      const presentation = projectUnifiedSearchPresentation(
        incomplete({
          progress: {
            status,
            targetsReady: 0,
            targetsTotal: 1,
            elapsedMs: 200,
          },
        }),
      );

      expect(presentation.lifecycle).toEqual({ kind: "active", status });
      expect(presentation.progress).toEqual({
        targetsReady: 0,
        targetsTotal: 1,
        elapsedMs: 200,
      });
      expect(presentation.action).toEqual({
        kind: "poll",
        searchRef: "search-ref-1",
      });
    },
  );

  it.each(["DEFERRED", "TIMEOUT", "FAILED"] as const)(
    "keeps terminal lifecycle %s distinct and non-polling",
    (status) => {
      const presentation = projectUnifiedSearchPresentation(
        incomplete({
          progress: {
            status,
            targetsReady: 0,
            targetsTotal: 1,
            elapsedMs: 60_000,
          },
        }),
      );

      expect(presentation.lifecycle).toEqual({ kind: "terminal", status });
      expect(presentation.action).toEqual({ kind: "new_search" });
    },
  );

  it("preserves an unknown raw lifecycle without polling", () => {
    const presentation = projectUnifiedSearchPresentation(
      incomplete({
        progress: {
          status: "FUTURE_SESSION_STATE",
          targetsReady: 1,
          targetsTotal: 2,
          elapsedMs: 60_000,
        },
      }),
    );

    expect(presentation.lifecycle).toEqual({
      kind: "unknown",
      status: "FUTURE_SESSION_STATE",
    });
    expect(presentation.action).toEqual({ kind: "new_search" });
  });

  it("classifies completed current hits as final", () => {
    const presentation = projectUnifiedSearchPresentation(completed());

    expect(presentation.availability).toEqual({
      kind: "final",
      hasSnapshot: true,
      resultCount: 1,
    });
    expect(presentation.lifecycle).toEqual({
      kind: "completed",
      status: "COMPLETED",
    });
    expect(presentation.action).toEqual({ kind: "none" });
  });

  it("continues completed mutable evidence through the exact initial reference", () => {
    const presentation = projectUnifiedSearchPresentation(
      completed({
        searchRef: "search-ref-initial",
        evidenceNotice: "opaque notice",
      }),
    );

    expect(presentation.action).toEqual({
      kind: "status",
      searchRef: "search-ref-initial",
    });
  });

  it("continues completed mutable evidence through the exact status reference", () => {
    const presentation = projectUnifiedSearchPresentation(
      statusCompleted(
        statusResult({
          results: [hit],
          evidenceNotice: "opaque notice",
        }),
      ),
    );

    expect(presentation.action).toEqual({
      kind: "status",
      searchRef: "search-ref-1",
    });
  });

  it("classifies an empty searched snapshot and eligible pivots", () => {
    const presentation = projectUnifiedSearchPresentation(
      completed({ results: [], sourceStatus: [source({ resultCount: 0 })] }),
    );

    expect(presentation.availability).toEqual({
      kind: "empty",
      hasSnapshot: true,
      resultCount: 0,
    });
    expect(presentation.sources).toEqual([
      {
        kind: "code",
        entries: [
          {
            state: "searched",
            target: "npm:express@4.18.2",
            resultCount: 0,
          },
        ],
      },
    ]);
    expect(presentation.action).toEqual({
      kind: "query_rewrite",
      rewrites: ["shorter_or_broader", "symbol", "code_grep"],
    });
  });

  it("groups symbol source readiness with code", () => {
    const presentation = projectUnifiedSearchPresentation(
      completed({
        query: { raw: "router", sources: ["symbol"] },
        results: [],
        sourceStatus: [
          source({
            source: "symbol",
            codeIndexState: "CURRENT",
            resultCount: 0,
          }),
        ],
      }),
    );

    expect(presentation.sources).toEqual([
      {
        kind: "code",
        entries: [
          {
            state: "searched",
            target: "npm:express@4.18.2",
            resultCount: 0,
          },
        ],
      },
    ]);
  });

  it.each(["MISSING", "UNRESOLVABLE", "FUTURE_STATE"] as const)(
    "treats source state %s as unavailable and suppresses pivots",
    (state) => {
      const presentation = projectUnifiedSearchPresentation(
        completed({
          results: [],
          sourceStatus: [
            source({
              source: "code",
              codeIndexState: state,
              resultCount: 0,
            }),
          ],
        }),
      );

      expect(presentation.sources).toEqual([
        {
          kind: "code",
          entries: [
            {
              state: "unavailable",
              target: "npm:express@4.18.2",
              resultCount: 0,
            },
          ],
        },
      ]);
      expect(presentation.action).toEqual({ kind: "none" });
    },
  );

  it.each(["docs", "auto"] as const)(
    "uses neutral docs provenance for contributor-less %s sources",
    (sourceName) => {
      const presentation = projectUnifiedSearchPresentation(
        completed({
          results: [],
          sourceStatus: [source({ source: sourceName, resultCount: 0 })],
        }),
      );

      expect(presentation.sources).toEqual([
        {
          kind: "docs",
          entries: [
            {
              state: "searched",
              target: "npm:express@4.18.2",
              resultCount: 0,
            },
          ],
        },
      ]);
    },
  );

  it.each([
    ["PENDING", "no_snapshot"],
    ["INDEXING", "no_snapshot"],
    ["SEARCHING", "no_snapshot"],
  ] as const)("classifies %s progress-only responses", (status, kind) => {
    const presentation = projectUnifiedSearchPresentation(
      incomplete({
        progress: {
          status,
          targetsReady: 0,
          targetsTotal: 1,
          elapsedMs: 200,
          requestedSources: ["code"],
        },
      }),
    );

    expect(presentation.availability.kind).toBe(kind);
    expect(presentation.availability.hasSnapshot).toBe(false);
    expect(presentation.sources).toEqual([]);
    expect(presentation.progress).toEqual({
      targetsReady: 0,
      targetsTotal: 1,
      elapsedMs: 200,
      requestedSources: ["code"],
    });
    expect(presentation.targets).toEqual([]);
    expect(presentation.action.kind).toBe("poll");
  });

  it.each([
    ["PENDING", false, "interim"],
    ["PENDING", true, "partial"],
    ["INDEXING", false, "interim"],
    ["INDEXING", true, "partial"],
    ["SEARCHING", false, "interim"],
    ["SEARCHING", true, "partial"],
  ] as const)(
    "classifies %s snapshot with partialResults=%s as %s",
    (status, partialResults, kind) => {
      const presentation = projectUnifiedSearchPresentation(
        incomplete({
          partialResults,
          results: [hit],
          progress: {
            status,
            targetsReady: 1,
            targetsTotal: 1,
            elapsedMs: 200,
          },
        }),
      );

      expect(presentation.availability).toEqual({
        kind,
        hasSnapshot: true,
        resultCount: 1,
      });
    },
  );

  it("classifies stored result snapshots with the same availability rules", () => {
    const interim = projectUnifiedSearchPresentation(
      statusIncomplete({ result: statusResult({ results: [hit] }) }),
    );
    const partial = projectUnifiedSearchPresentation(
      statusIncomplete({
        result: statusResult({ partialResults: true, results: [hit] }),
      }),
    );
    const completedPartial = projectUnifiedSearchPresentation(
      statusCompleted(statusResult({ partialResults: true, results: [hit] })),
    );

    expect(interim.availability.kind).toBe("interim");
    expect(partial.availability.kind).toBe("partial");
    expect(completedPartial.availability.kind).toBe("partial");
  });

  it("classifies a progress-only status without a result snapshot", () => {
    const presentation = projectUnifiedSearchPresentation(statusIncomplete());

    expect(presentation.availability).toEqual({
      kind: "no_snapshot",
      hasSnapshot: false,
      resultCount: 0,
    });
    expect(presentation.sources).toEqual([]);
    expect(presentation.warnings).toEqual([]);
  });

  it("retains parser warnings from an initial progress-only query", () => {
    const presentation = projectUnifiedSearchPresentation(
      incomplete({
        query: { raw: "router", warnings: ["unknown qualifier"] },
      }),
    );

    expect(presentation.query).toEqual({
      raw: "router",
      warnings: ["unknown qualifier"],
    });
    expect(presentation.warnings).toEqual([
      { kind: "query", message: "unknown qualifier" },
    ]);
  });

  it("groups searched, waiting, and available documentation contributors", () => {
    const presentation = projectUnifiedSearchPresentation(
      completed({
        results: [],
        sourceStatus: [
          source({
            source: "docs",
            targetLabel: "npm:express@5.1.0",
            contributors: [
              {
                kind: "REPOSITORY_DOCS",
                state: "SEARCHED",
                resultCount: 1,
                repositoryUrl: "https://github.com/expressjs/express",
              },
              {
                kind: "DOCPACK",
                state: "PENDING",
                resultCount: 0,
                siteKey: "expressjs.com",
              },
              {
                kind: "DOCPACK",
                state: "READY",
                resultCount: 0,
                siteKey: "api.example.com",
                siteUrl: "https://api.example.com/reference",
              },
            ],
          }),
        ],
      }),
    );

    expect(presentation.sources).toEqual([
      {
        kind: "repository_docs",
        entries: [
          {
            state: "searched",
            target: "https://github.com/expressjs/express",
            contextTarget: "npm:express@5.1.0",
            resultCount: 1,
            repositoryUrl: "https://github.com/expressjs/express",
          },
        ],
      },
      {
        kind: "site_docs",
        entries: [
          {
            state: "waiting",
            target: "expressjs.com",
            contextTarget: "npm:express@5.1.0",
            resultCount: 0,
            siteKey: "expressjs.com",
          },
          {
            state: "available_not_searched",
            target: "https://api.example.com/reference",
            contextTarget: "npm:express@5.1.0",
            resultCount: 0,
            siteKey: "api.example.com",
            siteUrl: "https://api.example.com/reference",
          },
        ],
      },
    ]);
    expect(
      presentation.trustLimits.filter((limit) => limit.kind === "source"),
    ).toEqual([
      {
        kind: "source",
        state: "waiting",
        source: "site_docs",
        target: "expressjs.com",
      },
      {
        kind: "source",
        state: "available_not_searched",
        source: "site_docs",
        target: "https://api.example.com/reference",
      },
    ]);
  });

  it("retains repository and site contributor identities", () => {
    const presentation = projectUnifiedSearchPresentation(
      completed({
        sourceStatus: [
          source({
            source: "docs",
            targetLabel: "npm:express@5.1.0",
            contributors: [
              {
                kind: "REPOSITORY_DOCS",
                state: "SEARCHED",
                resultCount: 1,
                repositoryUrl: "https://github.com/expressjs/express",
                commitSha: "0123456789abcdef",
              },
              {
                kind: "DOCPACK",
                state: "SEARCHED",
                freshness: "STALE",
                resultCount: 1,
                siteKey: "expressjs.com",
                coverage: { coverageState: "PARTIAL", pagesCrawled: 120 },
              },
            ],
          }),
        ],
      }),
    );

    expect(presentation.sources).toEqual([
      {
        kind: "repository_docs",
        entries: [
          {
            state: "searched",
            target: "https://github.com/expressjs/express",
            contextTarget: "npm:express@5.1.0",
            resultCount: 1,
            repositoryUrl: "https://github.com/expressjs/express",
            commitSha: "0123456789abcdef",
          },
        ],
      },
      {
        kind: "site_docs",
        entries: [
          {
            state: "searched",
            target: "expressjs.com",
            contextTarget: "npm:express@5.1.0",
            resultCount: 1,
            siteKey: "expressjs.com",
          },
        ],
      },
    ]);
    expect(presentation.trustLimits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "stale",
          target: "expressjs.com",
        }),
        expect.objectContaining({
          kind: "coverage",
          source: "site_docs",
          target: "expressjs.com",
        }),
      ]),
    );
  });

  it("keeps progress-only source status empty while projecting target readiness", () => {
    const presentation = projectUnifiedSearchPresentation(
      incomplete({
        progress: {
          status: "INDEXING",
          targetsReady: 0,
          targetsTotal: 1,
          elapsedMs: 200,
          requestedSources: ["CODE", "DOCS"],
          targets: [
            {
              requested: "npm:n8n@2.36.7",
              freshness: "INDEXING",
              indexingRef: "idx-hidden",
              availableVersions: [
                { version: "2.26.9", ref: "v2.26.9" },
                { version: "2.26.5", ref: "v2.26.5" },
              ],
            },
          ],
        },
      }),
    );

    expect(presentation.sources).toEqual([]);
    expect(presentation.trustLimits).toEqual([]);
    expect(presentation.targets).toEqual([
      {
        requested: "npm:n8n@2.36.7",
        freshness: "INDEXING",
      },
    ]);
    expect(presentation.alternatives).toEqual([
      {
        target: "npm:n8n@2.36.7",
        versions: [
          { version: "2.26.9", ref: "v2.26.9" },
          { version: "2.26.5", ref: "v2.26.5" },
        ],
        versionsRemaining: 0,
        refs: [],
        refsRemaining: 0,
        suggestedRefs: [],
        suggestedRefsRemaining: 0,
      },
    ]);
  });

  it("keeps multiple target alternatives in backend order", () => {
    const presentation = projectUnifiedSearchPresentation(
      incomplete({
        progress: {
          status: "INDEXING",
          targetsReady: 0,
          targetsTotal: 2,
          elapsedMs: 200,
          targets: [
            {
              requested: "npm:express latest",
              availableVersions: [{ version: "4.18.2", ref: "v4.18.2" }],
            },
            {
              requested: "github:expressjs/express#main",
              availableRefs: [{ ref: "main" }],
            },
          ],
        },
      }),
    );

    expect(presentation.alternatives).toEqual([
      expect.objectContaining({
        target: "npm:express latest",
        versions: [{ version: "4.18.2", ref: "v4.18.2" }],
      }),
      expect.objectContaining({
        target: "github:expressjs/express#main",
        refs: [{ ref: "main" }],
      }),
    ]);
    expect(presentation.targets).toEqual([
      { requested: "npm:express latest" },
      { requested: "github:expressjs/express#main" },
    ]);
  });

  it("retains progress target identities without diagnostics or alternatives", () => {
    const presentation = projectUnifiedSearchPresentation(
      incomplete({
        progress: {
          status: "INDEXING",
          targetsReady: 0,
          targetsTotal: 1,
          elapsedMs: 200,
          targets: [
            {
              requested: "npm:express latest",
              resolvedRequested: "npm:express@5.2.1",
              served: "npm:express@5.1.0",
              freshness: "STALE",
              indexingRef: "idx-hidden",
              requestedRefKind: "OMITTED_VERSION",
              targetResolution: {
                freshness: "fallback_recent",
                freshnessReason: "latest_version_indexing",
                indexingRef: "idx-hidden",
                availableVersions: [],
                availableRefs: [],
              },
            },
          ],
        },
      }),
    );

    expect(presentation.targets).toEqual([
      {
        requested: "npm:express latest",
        fresh: "npm:express@5.2.1",
        served: "npm:express@5.1.0",
        freshness: "STALE",
      },
    ]);
    expect(JSON.stringify(presentation.targets)).not.toContain("indexingRef");
    expect(JSON.stringify(presentation.targets)).not.toContain(
      "OMITTED_VERSION",
    );
    expect(JSON.stringify(presentation.targets)).not.toContain(
      "latest_version_indexing",
    );
  });

  it("projects the supplied n8n active empty snapshot without raw diagnostics", () => {
    const presentation = projectUnifiedSearchPresentation(
      incomplete({
        partialResults: false,
        results: [],
        sourceStatus: [
          source({
            source: "code",
            targetLabel: "npm:n8n@2.36.7",
            indexingStatus: "INDEXING",
            codeIndexState: "PENDING",
            resultCount: 0,
          }),
          source({
            source: "docs",
            targetLabel: "npm:n8n@2.36.7",
            targetResolution: {
              freshness: "indexing",
              freshnessReason: "latest_version_indexing",
              indexingRef: "indexing-ref-hidden",
              availableVersions: [
                { version: "2.26.9", ref: "v2.26.9" },
                { version: "2.26.5", ref: "v2.26.5" },
                { version: "2.23.2", ref: "v2.23.2" },
                { version: "2.22.6", ref: "v2.22.6" },
              ],
              availableRefs: [{ ref: "HEAD" }, { ref: "master" }],
            },
            contributors: [
              {
                kind: "DOCPACK",
                state: "READY",
                resultCount: 0,
                siteKey: "n8n.io",
                siteUrl: "https://n8n.io",
                coverage: {
                  coverageState: "CAPPED",
                  pagesCrawled: 1480,
                },
              },
              {
                kind: "REPOSITORY_DOCS",
                state: "PENDING",
                resultCount: 0,
                repositoryUrl: "https://github.com/n8n-io/n8n",
              },
            ],
          }),
        ],
        evidenceNotice: "Opaque evidence notice.",
      }),
    );

    expect(presentation.availability.kind).toBe("empty");
    expect(presentation.lifecycle).toMatchObject({
      kind: "active",
      status: "INDEXING",
    });
    expect(presentation.sources).toEqual([
      {
        kind: "code",
        entries: [
          {
            state: "waiting",
            target: "npm:n8n@2.36.7",
            resultCount: 0,
          },
        ],
      },
      {
        kind: "site_docs",
        entries: [
          {
            state: "available_not_searched",
            target: "https://n8n.io",
            contextTarget: "npm:n8n@2.36.7",
            resultCount: 0,
            siteKey: "n8n.io",
            siteUrl: "https://n8n.io",
          },
        ],
      },
      {
        kind: "repository_docs",
        entries: [
          {
            state: "waiting",
            target: "https://github.com/n8n-io/n8n",
            contextTarget: "npm:n8n@2.36.7",
            resultCount: 0,
            repositoryUrl: "https://github.com/n8n-io/n8n",
          },
        ],
      },
    ]);
    expect(presentation.alternatives[0]?.versions).toHaveLength(3);
    expect(presentation.alternatives[0]?.versionsRemaining).toBe(1);
    expect(presentation.alternatives[0]?.refs).toEqual([
      { ref: "HEAD" },
      { ref: "master" },
    ]);
    expect(presentation.trustLimits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "source", state: "waiting" }),
        expect.objectContaining({
          kind: "source",
          state: "available_not_searched",
        }),
        expect.objectContaining({ kind: "coverage", state: "capped" }),
        expect.objectContaining({ kind: "mutable_evidence" }),
      ]),
    );
    expect(JSON.stringify(presentation)).not.toContain("indexingRef");
    expect(JSON.stringify(presentation)).not.toContain(
      "latest_version_indexing",
    );
    expect(presentation.action).toEqual({
      kind: "poll",
      searchRef: "search-ref-1",
    });
  });

  it("classifies stale, fallback, and provisional trust limits", () => {
    const presentation = projectUnifiedSearchPresentation(
      completed({
        results: [
          {
            ...hit,
            requestedTarget: "npm:express latest",
            freshTarget: "npm:express@5.2.1",
            servedTarget: "npm:express@5.1.0",
            freshness: "STALE",
          },
        ],
        sourceStatus: [
          source({
            codeIndexState: "PROVISIONAL",
            targetResolution: {
              freshness: "fallback_recent",
              availableVersions: [],
              availableRefs: [],
              served: {
                registry: "npm",
                packageName: "express",
                version: "5.1.0",
              },
            },
          }),
        ],
      }),
    );

    expect(presentation.trustLimits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "stale",
          servedTarget: "npm:express@5.1.0",
        }),
        expect.objectContaining({
          kind: "provisional",
          target: "npm:express@4.18.2",
        }),
        expect.objectContaining({
          kind: "stale",
          target: "npm:express@4.18.2",
        }),
      ]),
    );
  });

  it("retains site suggestions while keeping active and terminal actions safe", () => {
    const siteStatus = source({
      source: "docs",
      targetLabel: "site:example.com",
      suggestedSiteTargets: ["site:docs.example.com", "site:api.example.com"],
      suggestedSiteTargetsTruncated: true,
    });
    const expectedSuggestions = [
      {
        target: "site:example.com",
        suggestions: ["site:docs.example.com", "site:api.example.com"],
        truncated: true,
      },
    ];

    const active = projectUnifiedSearchPresentation(
      incomplete({ partialResults: false, sourceStatus: [siteStatus] }),
    );
    expect(active.siteSuggestions).toEqual(expectedSuggestions);
    expect(active.action).toEqual({
      kind: "poll",
      searchRef: "search-ref-1",
    });

    const completedPresentation = projectUnifiedSearchPresentation(
      completed({ results: [], sourceStatus: [siteStatus] }),
    );
    expect(completedPresentation.siteSuggestions).toEqual(expectedSuggestions);
    expect(completedPresentation.action).toEqual({
      kind: "site_retry",
    });

    for (const status of ["DEFERRED", "FUTURE_SESSION_STATE"] as const) {
      const terminal = projectUnifiedSearchPresentation(
        incomplete({
          partialResults: false,
          sourceStatus: [siteStatus],
          progress: {
            status,
            targetsReady: 0,
            targetsTotal: 1,
            elapsedMs: 60_000,
          },
        }),
      );
      expect(terminal.action).toEqual({
        kind: "site_retry",
      });
      expect(terminal.action).not.toHaveProperty("searchRef");
    }
  });

  it("classifies coverage and structured query constraints without promoted warnings", () => {
    const presentation = projectUnifiedSearchPresentation(
      completed({
        query: {
          raw: "router",
          warnings: ["unknown qualifier"],
          filters: { kind: "function", publicOnly: true },
        },
        results: [],
        warnings: ["Source 'code' is indexing"],
        sourceStatus: [
          source({
            source: "docs",
            targetLabel: "site:expressjs.com",
            coverage: { coverageState: "PARTIAL", pagesCrawled: 42 },
            ignoredFilters: ["category"],
            incompatibleQueryFeatures: ["exact_name"],
          }),
        ],
      }),
    );

    expect(presentation.warnings).toEqual([
      { kind: "query", message: "unknown qualifier" },
      {
        kind: "ignored_filter",
        source: "site:expressjs.com",
        values: ["category"],
      },
      {
        kind: "incompatible_query_feature",
        source: "site:expressjs.com",
        values: ["exact_name"],
      },
    ]);
    expect(presentation.trustLimits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "coverage", state: "partial" }),
      ]),
    );
    expect(JSON.stringify(presentation)).not.toContain(
      "Source 'code' is indexing",
    );
    expect(presentation.action).toEqual({ kind: "none" });
  });

  it("suppresses generic pivots for evidence limits and prefers indexed alternatives", () => {
    const presentation = projectUnifiedSearchPresentation(
      completed({
        query: { raw: "router", filters: { kind: "function" } },
        results: [],
        sourceStatus: [
          source({
            codeIndexState: "INDEXING",
            targetResolution: {
              freshness: "indexing",
              availableVersions: [{ version: "4.17.0", ref: "v4.17.0" }],
              availableRefs: [],
            },
          }),
        ],
      }),
    );

    expect(presentation.action).toEqual({
      kind: "indexed_alternative",
      target: "npm:express@4.18.2",
      category: "version",
      value: "4.17.0",
    });
  });

  it("allows only a shorter/broader pivot for a standalone site", () => {
    const presentation = projectUnifiedSearchPresentation(
      completed({
        query: { raw: "router", sources: ["docs"] },
        results: [],
        sourceStatus: [
          source({
            source: "docs",
            targetLabel: "site:expressjs.com",
            resultCount: 0,
          }),
        ],
      }),
    );

    expect(presentation.action).toEqual({
      kind: "query_rewrite",
      rewrites: ["site_shorter_or_broader"],
    });
  });

  it("only exposes filter and symbol pivots when the request makes them applicable", () => {
    const filtered = projectUnifiedSearchPresentation(
      completed({
        query: { raw: "router", filters: { kind: "function" } },
        results: [],
      }),
    );
    const symbol = projectUnifiedSearchPresentation(
      completed({
        query: { raw: "router", sources: ["symbol"] },
        results: [],
      }),
    );

    expect(filtered.action).toEqual({
      kind: "query_rewrite",
      rewrites: ["shorter_or_broader", "remove_filters", "symbol", "code_grep"],
    });
    expect(symbol.action).toEqual({
      kind: "query_rewrite",
      rewrites: ["shorter_or_broader", "code_grep"],
    });
  });

  it("bounds alternatives in backend order and counts remaining values", () => {
    const versions = Array.from({ length: 5 }, (_, index) => ({
      version: `1.${index}.0`,
      ref: `v1.${index}.0`,
    }));
    const refs = Array.from({ length: 5 }, (_, index) => ({
      ref: `ref-${index}`,
    }));
    const presentation = projectUnifiedSearchPresentation(
      incomplete({
        progress: {
          status: "INDEXING",
          targetsReady: 0,
          targetsTotal: 1,
          elapsedMs: 200,
          targets: [
            {
              requested: "npm:express latest",
              availableVersions: versions,
              availableRefs: refs,
              suggestedRefs: refs,
            },
          ],
        },
      }),
    );

    expect(presentation.alternatives).toEqual([
      {
        target: "npm:express latest",
        versions: versions.slice(0, 3),
        versionsRemaining: 2,
        refs: refs.slice(0, 3),
        refsRemaining: 2,
        suggestedRefs: refs.slice(0, 3),
        suggestedRefsRemaining: 2,
      },
    ]);
  });
});
