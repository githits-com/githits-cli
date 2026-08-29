import { describe, expect, it } from "bun:test";
import {
  classifyTargetFreshness,
  projectUnifiedSearchPresentation,
  targetDisplayFamilyKey,
} from "./unified-search-presentation.js";
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

function groupedSources(
  presentation: ReturnType<typeof projectUnifiedSearchPresentation>,
) {
  return presentation.targetGroups.flatMap((group) => group.sources);
}

function groupedTrustLimits(
  presentation: ReturnType<typeof projectUnifiedSearchPresentation>,
) {
  return presentation.targetGroups.flatMap((group) => group.trustLimits);
}

function groupedAlternatives(
  presentation: ReturnType<typeof projectUnifiedSearchPresentation>,
) {
  return presentation.targetGroups.flatMap((group) =>
    group.alternatives ? [group.alternatives] : [],
  );
}

function groupedSiteSuggestions(
  presentation: ReturnType<typeof projectUnifiedSearchPresentation>,
) {
  return presentation.targetGroups.flatMap((group) => group.siteSuggestions);
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
    expect(groupedSources(presentation)).toEqual([
      {
        kind: "code",
        entries: [
          {
            state: "searched",
            target: "npm:express@4.18.2",
            searchTarget: "npm:express@4.18.2",
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

  it("preserves symbol source readiness as symbols", () => {
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

    expect(groupedSources(presentation)).toEqual([
      {
        kind: "symbols",
        entries: [
          {
            state: "searched",
            target: "npm:express@4.18.2",
            searchTarget: "npm:express@4.18.2",
            resultCount: 0,
          },
        ],
      },
    ]);
  });

  it("source and warning provenance keeps code and symbols as separate lanes", () => {
    const presentation = projectUnifiedSearchPresentation(
      completed({
        results: [],
        sourceStatus: [
          source({ source: "CODE", codeIndexState: "CURRENT" }),
          source({ source: "SYMBOL", codeIndexState: "CURRENT" }),
        ],
      }),
    );

    expect(groupedSources(presentation).map((group) => group.kind)).toEqual([
      "code",
      "symbols",
    ]);
  });

  it.each(["MISSING", "FUTURE_STATE"] as const)(
    "terminal target recovery keeps source state %s unavailable with conservative pivots",
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

      expect(groupedSources(presentation)).toEqual([
        {
          kind: "code",
          entries: [
            {
              state: "unavailable",
              target: "npm:express@4.18.2",
              searchTarget: "npm:express@4.18.2",
              resultCount: 0,
            },
          ],
        },
      ]);
      expect(presentation.action).toEqual({ kind: "new_search" });
    },
  );

  it("terminal target recovery selects exact unresolvable and missing states", () => {
    const presentation = projectUnifiedSearchPresentation(
      completed({
        results: [],
        sourceStatus: [
          source({
            targetLabel: "npm:express@4.18.2",
            codeIndexState: "NOT_FOUND",
            resultCount: 0,
          }),
          source({
            targetLabel: "github:owner/repo#main",
            indexingStatus: "UNRESOLVABLE",
            codeIndexState: "UNRESOLVABLE",
            targetResolution: {
              freshness: "indexing",
              freshnessReason: "no_current_fallback",
              requested: { repoUrl: "https://github.com/owner/repo" },
              availableVersions: [],
              availableRefs: [],
            },
            resultCount: 0,
          }),
          source({
            source: "docs",
            targetLabel: "site:docs.example.com",
            indexingStatus: "NOT_FOUND",
            resultCount: 0,
          }),
          source({
            targetLabel: "opaque:target",
            indexingStatus: "UNRESOLVABLE",
            resultCount: 0,
          }),
          source({
            targetLabel: "npm:express@4.18.2",
            indexingStatus: "UNRESOLVABLE",
            resultCount: 0,
          }),
        ],
      }),
    );

    expect(presentation.action).toEqual({ kind: "none" });
    expect(presentation.targetGroups.map((group) => group.recovery)).toEqual([
      { kind: "fix", family: "package" },
      { kind: "fix", family: "repository" },
      { kind: "fix", family: "unknown" },
      { kind: "fix", family: "site" },
    ]);
    expect(presentation.action).not.toHaveProperty("searchRef");
  });

  it("terminal target recovery keeps a registry target as package with repo resolution", () => {
    const presentation = projectUnifiedSearchPresentation(
      completed({
        results: [],
        sourceStatus: [
          source({
            targetLabel: "npm:express@4.18.2",
            codeIndexState: "NOT_FOUND",
            targetResolution: {
              requested: { repoUrl: "https://github.com/expressjs/express" },
              availableVersions: [],
              availableRefs: [],
            },
            resultCount: 0,
          }),
        ],
      }),
    );

    expect(presentation.action).toEqual({ kind: "none" });
    expect(presentation.targetGroups[0]?.recovery).toEqual({
      kind: "fix",
      family: "package",
    });
  });

  it("terminal target recovery preserves site suggestion precedence", () => {
    const presentation = projectUnifiedSearchPresentation(
      completed({
        results: [],
        sourceStatus: [
          source({
            source: "docs",
            targetLabel: "site:docs.example.com",
            indexingStatus: "UNRESOLVABLE",
            suggestedSiteTargets: ["site:docs.example.com/guide"],
            resultCount: 0,
          }),
        ],
      }),
    );

    expect(presentation.action).toEqual({ kind: "none" });
    expect(presentation.targetGroups[0]?.recovery).toEqual({
      kind: "try",
      category: "site",
      target: "site:docs.example.com/guide",
      additionalTargets: [],
      truncated: false,
    });
  });

  it("terminal target recovery preserves indexed alternative precedence", () => {
    const presentation = projectUnifiedSearchPresentation(
      completed({
        results: [],
        sourceStatus: [
          source({
            targetLabel: "npm:express@4.18.2",
            codeIndexState: "UNRESOLVABLE",
            targetResolution: {
              freshness: "indexing",
              freshnessReason: "no_current_fallback",
              availableVersions: [{ version: "4.17.0", ref: "v4.17.0" }],
              availableRefs: [],
            },
            resultCount: 0,
          }),
        ],
      }),
    );

    expect(presentation.action).toEqual({ kind: "none" });
    expect(presentation.targetGroups[0]?.recovery).toEqual({
      kind: "try",
      category: "version",
      target: "npm:express@4.17.0",
      additionalTargets: [],
      truncated: false,
    });
  });

  it("normalizes latest package display identities for recovery targets", () => {
    const presentation = projectUnifiedSearchPresentation(
      completed({
        results: [],
        sourceStatus: [
          source({
            targetLabel: "npm:express latest",
            requestedTarget: "npm:express latest",
            codeIndexState: "UNRESOLVABLE",
            targetResolution: {
              availableVersions: [{ version: "5.1.0", ref: "v5.1.0" }],
              availableRefs: [],
            },
            resultCount: 0,
          }),
        ],
      }),
    );

    expect(presentation.targetGroups[0]?.recovery).toEqual({
      kind: "try",
      category: "version",
      target: "npm:express@5.1.0",
      additionalTargets: [],
      truncated: false,
    });
  });

  it("keeps terminal recovery for a failed peer beside healthy hits", () => {
    const presentation = projectUnifiedSearchPresentation(
      completed({
        sourceStatus: [
          source({
            targetLabel: "npm:express@4.18.2",
            codeIndexState: "CURRENT",
            resultCount: 1,
          }),
          source({
            targetLabel: "npm:missing@1.0.0",
            codeIndexState: "NOT_FOUND",
            resultCount: 0,
          }),
        ],
      }),
    );

    expect(
      presentation.targetGroups.map((group) => ({
        target: group.identity.requested,
        recovery: group.recovery,
      })),
    ).toEqual([
      { target: "npm:express@4.18.2", recovery: undefined },
      {
        target: "npm:missing@1.0.0",
        recovery: { kind: "fix", family: "package" },
      },
    ]);
    expect(presentation.action).toEqual({ kind: "none" });
  });

  it("terminal target recovery prefers indexed alternatives without freshness signals", () => {
    const presentation = projectUnifiedSearchPresentation(
      completed({
        results: [],
        sourceStatus: [
          source({
            targetLabel: "npm:express@4.18.2",
            codeIndexState: "NOT_FOUND",
            targetResolution: {
              availableVersions: [{ version: "4.17.0", ref: "v4.17.0" }],
              availableRefs: [],
            },
            resultCount: 0,
          }),
        ],
      }),
    );

    expect(presentation.action).toEqual({ kind: "none" });
    expect(presentation.targetGroups[0]?.recovery).toEqual({
      kind: "try",
      category: "version",
      target: "npm:express@4.17.0",
      additionalTargets: [],
      truncated: false,
    });
  });

  it.each(["docs", "auto"] as const)(
    "uses neutral docs provenance for contributor-less %s sources",
    (sourceName) => {
      const presentation = projectUnifiedSearchPresentation(
        completed({
          results: [],
          sourceStatus: [source({ source: sourceName, resultCount: 0 })],
        }),
      );

      expect(groupedSources(presentation)).toEqual([
        {
          kind: "docs",
          entries: [
            {
              state: "searched",
              target: "npm:express@4.18.2",
              searchTarget: "npm:express@4.18.2",
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
    expect(groupedSources(presentation)).toEqual([]);
    expect(presentation.progress).toEqual({
      targetsReady: 0,
      targetsTotal: 1,
      elapsedMs: 200,
      requestedSources: ["code"],
    });
    expect(presentation.targetGroups).toEqual([]);
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
    expect(groupedSources(presentation)).toEqual([]);
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

    expect(groupedSources(presentation)).toEqual([
      {
        kind: "repository_docs",
        entries: [
          {
            state: "searched",
            target: "https://github.com/expressjs/express",
            searchTarget: "npm:express@5.1.0",
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
            searchTarget: "npm:express@5.1.0",
            resultCount: 0,
            siteKey: "expressjs.com",
          },
          {
            state: "available_not_searched",
            target: "https://api.example.com/reference",
            searchTarget: "npm:express@5.1.0",
            resultCount: 0,
            siteKey: "api.example.com",
            siteUrl: "https://api.example.com/reference",
          },
        ],
      },
    ]);
    expect(
      groupedTrustLimits(presentation).filter(
        (limit) => limit.kind === "source",
      ),
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

    expect(groupedSources(presentation)).toEqual([
      {
        kind: "repository_docs",
        entries: [
          {
            state: "searched",
            target: "https://github.com/expressjs/express",
            searchTarget: "npm:express@5.1.0",
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
            searchTarget: "npm:express@5.1.0",
            resultCount: 1,
            siteKey: "expressjs.com",
          },
        ],
      },
    ]);
    expect(groupedTrustLimits(presentation)).toEqual(
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

    expect(groupedSources(presentation)).toEqual([]);
    expect(groupedTrustLimits(presentation)).toEqual([]);
    expect(presentation.targetGroups.map((group) => group.identity)).toEqual([
      {
        requested: "npm:n8n@2.36.7",
        freshness: "INDEXING",
      },
    ]);
    expect(groupedAlternatives(presentation)).toEqual([
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

    expect(groupedAlternatives(presentation)).toEqual([
      expect.objectContaining({
        target: "npm:express latest",
        versions: [{ version: "4.18.2", ref: "v4.18.2" }],
      }),
      expect.objectContaining({
        target: "github:expressjs/express#main",
        refs: [{ ref: "main" }],
      }),
    ]);
    expect(presentation.targetGroups.map((group) => group.identity)).toEqual([
      { requested: "npm:express latest" },
      { requested: "github:expressjs/express#main" },
    ]);
  });

  it("classifies versionless available-version entries as refs", () => {
    const sha = "df0abc9333a3398b97b71f6ea7cd77d5ea3e9f97";
    const secondSha = "1b51edac7c5f2844e23602164a52643bb625993a";
    const thirdSha = "4687d59a28ca41c4a9c06e69b68e8d3300000000";
    const presentation = projectUnifiedSearchPresentation(
      completed({
        results: [],
        sourceStatus: [
          source({
            targetLabel: "npm:express@4.1.1",
            targetResolution: {
              availableVersions: [
                { ref: sha },
                { ref: secondSha },
                { ref: thirdSha },
                { version: "4.0.0", ref: "v4.0.0" },
              ],
              availableRefs: [{ ref: "master" }],
            },
          }),
        ],
      }),
    );

    expect(groupedAlternatives(presentation)[0]?.versions).toEqual([
      { version: "4.0.0", ref: "v4.0.0" },
    ]);
    expect(groupedAlternatives(presentation)[0]?.refs).toEqual([
      { ref: "master" },
      { ref: sha },
      { ref: secondSha },
    ]);
    expect(groupedAlternatives(presentation)[0]?.refsRemaining).toBe(1);
  });

  it.each([
    ["resolvedRequested", "npm:express@5.2.1"],
    ["served", "npm:express@5.1.0"],
  ] as const)(
    "anchors %s-only progress alternatives to the target group",
    (identityKey, identity) => {
      const presentation = projectUnifiedSearchPresentation(
        incomplete({
          progress: {
            status: "INDEXING",
            targetsReady: 0,
            targetsTotal: 1,
            elapsedMs: 200,
            targets: [
              {
                [identityKey]: identity,
                availableVersions: [{ version: "4.18.2", ref: "v4.18.2" }],
              },
            ],
          },
        }),
      );

      expect(groupedAlternatives(presentation)).toEqual([
        expect.objectContaining({ target: identity }),
      ]);
      expect(presentation.targetGroups).toHaveLength(1);
      expect(presentation.targetGroups[0]?.alternatives).toEqual(
        expect.objectContaining({ target: identity }),
      );
    },
  );

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

    expect(presentation.targetGroups.map((group) => group.identity)).toEqual([
      {
        requested: "npm:express latest",
        fresh: "npm:express@5.2.1",
        served: "npm:express@5.1.0",
        freshness: "STALE",
      },
    ]);
    expect(JSON.stringify(presentation.targetGroups)).not.toContain(
      "indexingRef",
    );
    expect(JSON.stringify(presentation.targetGroups)).not.toContain(
      "OMITTED_VERSION",
    );
    expect(JSON.stringify(presentation.targetGroups)).not.toContain(
      "latest_version_indexing",
    );
  });

  it("projects the supplied n8n active empty snapshot without raw diagnostics", () => {
    const presentation = projectUnifiedSearchPresentation(
      incomplete({
        partialResults: false,
        results: [],
        progress: {
          status: "INDEXING",
          targetsReady: 0,
          targetsTotal: 1,
          elapsedMs: 8200,
          targets: [
            {
              requested: "npm:n8n",
              resolvedRequested: "npm:n8n@2.36.7",
              freshness: "INDEXING",
              availableVersions: [
                { version: "2.26.9", ref: "v2.26.9" },
                { version: "2.26.5", ref: "v2.26.5" },
                { version: "2.23.2", ref: "v2.23.2" },
                { version: "2.22.6", ref: "v2.22.6" },
              ],
              availableRefs: [{ ref: "HEAD" }, { ref: "master" }],
            },
          ],
        },
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
    expect(presentation.targetGroups).toEqual([
      {
        freshnessKind: "indexing",
        identity: {
          requested: "npm:n8n",
          fresh: "npm:n8n@2.36.7",
          freshness: "INDEXING",
        },
        sources: [
          {
            kind: "code",
            entries: [
              {
                state: "waiting",
                target: "npm:n8n@2.36.7",
                searchTarget: "npm:n8n@2.36.7",
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
                searchTarget: "npm:n8n@2.36.7",
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
                searchTarget: "npm:n8n@2.36.7",
                resultCount: 0,
                repositoryUrl: "https://github.com/n8n-io/n8n",
              },
            ],
          },
        ],
        alternatives: {
          target: "npm:n8n",
          versions: [
            { version: "2.26.9", ref: "v2.26.9" },
            { version: "2.26.5", ref: "v2.26.5" },
            { version: "2.23.2", ref: "v2.23.2" },
          ],
          versionsRemaining: 1,
          refs: [{ ref: "HEAD" }, { ref: "master" }],
          refsRemaining: 0,
          suggestedRefs: [],
          suggestedRefsRemaining: 0,
        },
        siteSuggestions: [],
        trustLimits: [
          {
            kind: "source",
            source: "code",
            state: "waiting",
            target: "npm:n8n@2.36.7",
          },
          {
            kind: "source",
            source: "site_docs",
            state: "available_not_searched",
            target: "https://n8n.io",
          },
          {
            kind: "source",
            source: "repository_docs",
            state: "waiting",
            target: "https://github.com/n8n-io/n8n",
          },
          {
            kind: "coverage",
            source: "site_docs",
            state: "capped",
            target: "https://n8n.io",
            pagesCrawled: 1480,
            frontierRemaining: undefined,
            estimatedTotalPages: undefined,
          },
        ],
      },
    ]);
    expect(
      presentation.targetGroups.flatMap((group) => group.trustLimits),
    ).not.toContainEqual({ kind: "mutable_evidence" });
    expect(groupedSources(presentation)).toEqual([
      {
        kind: "code",
        entries: [
          {
            state: "waiting",
            target: "npm:n8n@2.36.7",
            searchTarget: "npm:n8n@2.36.7",
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
            searchTarget: "npm:n8n@2.36.7",
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
            searchTarget: "npm:n8n@2.36.7",
            resultCount: 0,
            repositoryUrl: "https://github.com/n8n-io/n8n",
          },
        ],
      },
    ]);
    expect(groupedAlternatives(presentation)[0]?.versions).toHaveLength(3);
    expect(groupedAlternatives(presentation)[0]?.versionsRemaining).toBe(1);
    expect(groupedAlternatives(presentation)[0]?.refs).toEqual([
      { ref: "HEAD" },
      { ref: "master" },
    ]);
    expect(groupedTrustLimits(presentation)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "source", state: "waiting" }),
        expect.objectContaining({
          kind: "source",
          state: "available_not_searched",
        }),
        expect.objectContaining({ kind: "coverage", state: "capped" }),
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

  it("groups resolved and served target labels without mutating flat identities", () => {
    const presentation = projectUnifiedSearchPresentation(
      incomplete({
        partialResults: false,
        progress: {
          status: "INDEXING",
          targetsReady: 0,
          targetsTotal: 2,
          elapsedMs: 200,
          targets: [
            {
              requested: "npm:express latest",
              resolvedRequested: "npm:express@5.2.1",
              freshness: "INDEXING",
              availableVersions: [{ version: "5.0.0", ref: "v5.0.0" }],
            },
            {
              requested: "npm:koa@3.0.0",
              resolvedRequested: "npm:koa@3.0.0",
              freshness: "INDEXING",
            },
          ],
        },
        sourceStatus: [
          source({
            targetLabel: "npm:express@5.2.1",
            requestedTarget: "npm:express latest",
            freshTarget: "npm:express@5.2.1",
            servedTarget: "npm:express@5.1.0",
            codeIndexState: "STALE",
          }),
          source({
            targetLabel: "npm:koa@3.0.0",
            codeIndexState: "CURRENT",
          }),
        ],
      }),
    );

    expect(targetDisplayFamilyKey("npm:express")).toBe(
      targetDisplayFamilyKey("npm:express latest"),
    );
    expect(targetDisplayFamilyKey("npm:express latest")).toBe(
      targetDisplayFamilyKey("npm:express@5.2.1"),
    );
    expect(targetDisplayFamilyKey("github:expressjs/express#main")).toBe(
      targetDisplayFamilyKey("github:expressjs/express#refs/heads/main"),
    );
    expect(
      targetDisplayFamilyKey("github:expressjs/express@refs/heads/main"),
    ).toBe(targetDisplayFamilyKey("github:expressjs/express"));

    expect(presentation.targetGroups).toHaveLength(2);
    const expressGroup = presentation.targetGroups.find(
      (group) => group.identity.requested === "npm:express latest",
    );
    expect(expressGroup).toEqual(
      expect.objectContaining({
        identity: expect.objectContaining({
          requested: "npm:express latest",
          fresh: "npm:express@5.2.1",
          served: "npm:express@5.1.0",
        }),
        alternatives: expect.objectContaining({
          target: "npm:express latest",
        }),
      }),
    );
    expect(expressGroup?.sources).toEqual([
      {
        kind: "code",
        entries: [
          expect.objectContaining({
            target: "npm:express@5.1.0",
            searchTarget: "npm:express@5.1.0",
          }),
        ],
      },
    ]);
    expect(expressGroup?.trustLimits).toEqual([
      expect.objectContaining({
        kind: "stale",
        servedTarget: "npm:express@5.1.0",
      }),
    ]);
    expect(presentation.targetGroups.map((group) => group.identity)).toEqual([
      {
        requested: "npm:express latest",
        fresh: "npm:express@5.2.1",
        served: "npm:express@5.1.0",
        freshness: "INDEXING",
      },
      {
        requested: "npm:koa@3.0.0",
        fresh: "npm:koa@3.0.0",
        freshness: "INDEXING",
      },
    ]);
  });

  it("keeps explicit package versions in separate target groups", () => {
    const presentation = projectUnifiedSearchPresentation(
      incomplete({
        partialResults: false,
        progress: {
          status: "INDEXING",
          targetsReady: 0,
          targetsTotal: 2,
          elapsedMs: 200,
          targets: [
            {
              requested: "npm:express@4.18.2",
              resolvedRequested: "npm:express@4.18.2",
              availableVersions: [{ version: "4.18.1", ref: "v4.18.1" }],
            },
            {
              requested: "npm:express@5.2.1",
              resolvedRequested: "npm:express@5.2.1",
              availableVersions: [{ version: "5.2.0", ref: "v5.2.0" }],
            },
          ],
        },
        sourceStatus: [
          source({
            targetLabel: "npm:express@4.18.2",
            targetResolution: {
              availableVersions: [],
              availableRefs: [],
            },
          }),
          source({
            targetLabel: "npm:express@5.2.1",
            targetResolution: {
              availableVersions: [],
              availableRefs: [],
            },
          }),
        ],
      }),
    );

    expect(presentation.targetGroups).toHaveLength(2);
    expect(
      presentation.targetGroups.map((group) => ({
        target: group.identity.requested,
        sourceTargets: group.sources.flatMap((sourceGroup) =>
          sourceGroup.entries.map((entry) => entry.target),
        ),
        alternatives: group.alternatives?.versions.map(
          (alternative) => alternative.version,
        ),
      })),
    ).toEqual([
      {
        target: "npm:express@4.18.2",
        sourceTargets: ["npm:express@4.18.2"],
        alternatives: ["4.18.1"],
      },
      {
        target: "npm:express@5.2.1",
        sourceTargets: ["npm:express@5.2.1"],
        alternatives: ["5.2.0"],
      },
    ]);
  });

  it("keeps distinct requested targets separate when they share a served snapshot", () => {
    const presentation = projectUnifiedSearchPresentation(
      incomplete({
        partialResults: false,
        progress: {
          status: "INDEXING",
          targetsReady: 0,
          targetsTotal: 2,
          elapsedMs: 200,
          targets: [
            {
              requested: "npm:express@5.1.0",
              resolvedRequested: "npm:express@5.1.0",
              served: "npm:express@5.1.0",
              availableVersions: [{ version: "5.0.0", ref: "v5.0.0" }],
            },
            {
              requested: "npm:express",
              resolvedRequested: "npm:express@5.2.1",
              served: "npm:express@5.1.0",
              freshness: "INDEXING",
              availableVersions: [{ version: "5.2.0", ref: "v5.2.0" }],
            },
          ],
        },
        sourceStatus: [
          source({
            targetLabel: "npm:express@5.1.0",
            codeIndexState: "CURRENT",
          }),
          source({
            targetLabel: "npm:express@5.1.0",
            requestedTarget: "npm:express",
            freshTarget: "npm:express@5.2.1",
            servedTarget: "npm:express@5.1.0",
            codeIndexState: "STALE",
            coverage: { coverageState: "PARTIAL", pagesCrawled: 5 },
          }),
        ],
      }),
    );

    expect(presentation.targetGroups).toHaveLength(2);
    expect(
      presentation.targetGroups.map((group) => ({
        requested: group.identity.requested,
        fresh: group.identity.fresh,
        served: group.identity.served,
        sourceRequested: group.sources.flatMap((sourceGroup) =>
          sourceGroup.entries.map((entry) => entry.requestedTarget),
        ),
        versions: group.alternatives?.versions.map((entry) => entry.version),
        staleLimits: group.trustLimits.filter((limit) => limit.kind === "stale")
          .length,
        coverageLimits: group.trustLimits.filter(
          (limit) => limit.kind === "coverage",
        ).length,
      })),
    ).toEqual([
      {
        requested: "npm:express@5.1.0",
        fresh: "npm:express@5.1.0",
        served: "npm:express@5.1.0",
        sourceRequested: [undefined],
        versions: ["5.0.0"],
        staleLimits: 0,
        coverageLimits: 0,
      },
      {
        requested: "npm:express",
        fresh: "npm:express@5.2.1",
        served: "npm:express@5.1.0",
        sourceRequested: ["npm:express"],
        versions: ["5.2.0"],
        staleLimits: 1,
        coverageLimits: 1,
      },
    ]);
  });

  it("keeps contributor limits with their target when parent aliases diverge", () => {
    const repositoryUrl = "https://github.com/example/one";
    const presentation = projectUnifiedSearchPresentation(
      incomplete({
        partialResults: false,
        progress: {
          status: "INDEXING",
          targetsReady: 1,
          targetsTotal: 2,
          elapsedMs: 200,
          targets: [
            {
              requested: "npm:one@1.0.0",
              resolvedRequested: "npm:one@1.1.0",
              served: "npm:one@1.0.0",
              freshness: "INDEXING",
            },
            {
              requested: "npm:two@2.0.0",
              resolvedRequested: "npm:two@2.0.0",
              freshness: "CURRENT",
            },
          ],
        },
        sourceStatus: [
          source({
            source: "docs",
            targetLabel: "npm:one@1.0.0",
            freshTarget: "npm:one@1.1.0",
            servedTarget: "npm:one@1.0.0",
            contributors: [
              {
                kind: "REPOSITORY_DOCS",
                state: "SEARCHED",
                freshness: "STALE",
                resultCount: 0,
                repositoryUrl,
                coverage: { coverageState: "PARTIAL", pagesCrawled: 5 },
              },
            ],
          }),
          source({
            targetLabel: "npm:two@2.0.0",
            codeIndexState: "CURRENT",
          }),
        ],
      }),
    );

    expect(presentation.targetGroups).toHaveLength(2);
    const first = presentation.targetGroups.find(
      (group) => group.identity.requested === "npm:one@1.0.0",
    );
    expect(first?.sources).toEqual([
      {
        kind: "repository_docs",
        entries: [
          expect.objectContaining({
            target: repositoryUrl,
            searchTarget: "npm:one@1.0.0",
          }),
        ],
      },
    ]);
    expect(first?.trustLimits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "stale", target: repositoryUrl }),
        expect.objectContaining({ kind: "coverage", target: repositoryUrl }),
      ]),
    );
    expect(
      presentation.targetGroups.some(
        (group) => group.identity.requested === repositoryUrl,
      ),
    ).toBe(false);
  });

  it("normalizes target freshness once in the presentation layer", () => {
    expect(classifyTargetFreshness("STALE")).toBe("stale");
    expect(classifyTargetFreshness("fallback_recent")).toBe("stale");
    expect(classifyTargetFreshness("PENDING")).toBe("pending");
    expect(classifyTargetFreshness("CURRENT")).toBe("current");
    expect(classifyTargetFreshness("INDEXED")).toBe("current");
    expect(classifyTargetFreshness("PROVISIONAL")).toBe("provisional");
    expect(classifyTargetFreshness("FUTURE_STATE")).toBeUndefined();
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

    expect(groupedTrustLimits(presentation)).toEqual(
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
    expect(groupedSiteSuggestions(active)).toEqual(expectedSuggestions);
    expect(active.action).toEqual({
      kind: "poll",
      searchRef: "search-ref-1",
    });

    const completedPresentation = projectUnifiedSearchPresentation(
      completed({ results: [], sourceStatus: [siteStatus] }),
    );
    expect(groupedSiteSuggestions(completedPresentation)).toEqual(
      expectedSuggestions,
    );
    expect(completedPresentation.action).toEqual({ kind: "none" });
    expect(completedPresentation.targetGroups[0]?.recovery).toEqual({
      kind: "try",
      category: "site",
      target: "site:docs.example.com",
      additionalTargets: ["site:api.example.com"],
      truncated: true,
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
      expect(terminal.action).toEqual({ kind: "none" });
      expect(terminal.targetGroups[0]?.recovery).toEqual({
        kind: "try",
        category: "site",
        target: "site:docs.example.com",
        additionalTargets: ["site:api.example.com"],
        truncated: true,
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
    ]);
    expect(
      presentation.targetGroups[0]?.trustLimits.filter(
        (limit) => limit.kind === "constraint",
      ),
    ).toEqual([
      {
        kind: "constraint",
        constraint: "ignored_filter",
        source: "docs",
        target: "site:expressjs.com",
        values: ["category"],
      },
      {
        kind: "constraint",
        constraint: "incompatible_query_feature",
        source: "docs",
        target: "site:expressjs.com",
        values: ["exact_name"],
      },
    ]);
    expect(groupedTrustLimits(presentation)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "coverage", state: "partial" }),
      ]),
    );
    expect(JSON.stringify(presentation)).not.toContain(
      "Source 'code' is indexing",
    );
    expect(presentation.action).toEqual({ kind: "new_search" });
  });

  it("source and warning provenance keeps normalized lanes and targets", () => {
    const presentation = projectUnifiedSearchPresentation(
      completed({
        results: [],
        sourceStatus: [
          source({
            source: "DOCS",
            targetLabel: "npm:express",
            ignoredFilters: ["fileIntent"],
          }),
          source({
            source: "SYMBOL",
            targetLabel: "npm:express",
            incompatibleFilters: ["lang"],
          }),
          source({
            source: "AUTO",
            targetLabel: "site:docs.example.com",
            ignoredQueryFeatures: ["name"],
          }),
          source({
            source: "Future-Lane",
            targetLabel: "opaque-target",
            incompatibleQueryFeatures: ["kind"],
          }),
          source({
            source: "",
            targetLabel: "npm:empty",
            ignoredFilters: ["category"],
          }),
        ],
      }),
    );

    expect(presentation.warnings).toEqual([]);
    expect(groupedTrustLimits(presentation)).toEqual(
      expect.arrayContaining([
        {
          kind: "constraint",
          constraint: "ignored_filter",
          source: "docs",
          target: "npm:express",
          values: ["fileIntent"],
        },
        {
          kind: "constraint",
          constraint: "incompatible_filter",
          source: "symbol",
          target: "npm:express",
          values: ["lang"],
        },
        {
          kind: "constraint",
          constraint: "ignored_query_feature",
          source: "auto",
          target: "site:docs.example.com",
          values: ["name"],
        },
        {
          kind: "constraint",
          constraint: "incompatible_query_feature",
          source: "future-lane",
          target: "opaque-target",
          values: ["kind"],
        },
      ]),
    );
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

    expect(presentation.action).toEqual({ kind: "none" });
    expect(presentation.targetGroups[0]?.recovery).toEqual({
      kind: "try",
      category: "version",
      target: "npm:express@4.17.0",
      additionalTargets: [],
      truncated: false,
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

    expect(groupedAlternatives(presentation)).toEqual([
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

  it("does not invent specificity for unversioned packages or implicit refs", () => {
    const presentation = projectUnifiedSearchPresentation(
      completed({
        results: [],
        sourceStatus: [
          source({
            targetLabel: "npm:express",
            codeIndexState: "UNRESOLVABLE",
          }),
          source({
            targetLabel: "github:owner/repo",
            codeIndexState: "UNRESOLVABLE",
          }),
        ],
      }),
    );

    expect(
      presentation.targetGroups.map((group) =>
        group.sources.flatMap((sourceGroup) =>
          sourceGroup.entries.map((entry) => entry.terminalReason),
        ),
      ),
    ).toEqual([
      [{ kind: "unresolvable", family: "package" }],
      [{ kind: "unresolvable", family: "repository" }],
    ]);
  });

  it("keeps a bare terminal lane reason beside indexing without local recovery", () => {
    const presentation = projectUnifiedSearchPresentation(
      incomplete({
        progress: {
          status: "INDEXING",
          targetsReady: 0,
          targetsTotal: 1,
          elapsedMs: 200,
        },
        sourceStatus: [
          source({ source: "code", codeIndexState: "INDEXING" }),
          source({ source: "symbol", codeIndexState: "NOT_FOUND" }),
        ],
      }),
    );

    expect(presentation.targetGroups[0]?.recovery).toBeUndefined();
    expect(presentation.action).toEqual({
      kind: "poll",
      searchRef: "search-ref-1",
    });
  });

  it.each(["TIMEOUT", "FAILED"] as const)(
    "reruns a terminal response with a bare terminal lane reason: %s",
    (status) => {
      const presentation = projectUnifiedSearchPresentation(
        incomplete({
          partialResults: false,
          progress: {
            status,
            targetsReady: 0,
            targetsTotal: 1,
            elapsedMs: 60_000,
          },
          sourceStatus: [
            source({
              source: "code",
              codeIndexState: "CURRENT",
              resultCount: 0,
            }),
            source({
              source: "symbol",
              codeIndexState: "NOT_FOUND",
              resultCount: 0,
            }),
          ],
        }),
      );

      expect(presentation.targetGroups[0]?.recovery).toBeUndefined();
      expect(presentation.action).toEqual({ kind: "new_search" });
    },
  );

  it("uses query rewrite for completed-empty evidence without a reference", () => {
    const presentation = projectUnifiedSearchPresentation(
      completed({ results: [], evidenceNotice: "mutable evidence" }),
    );

    expect(presentation.action).toEqual({
      kind: "query_rewrite",
      rewrites: ["shorter_or_broader", "symbol", "code_grep"],
    });
  });
});
