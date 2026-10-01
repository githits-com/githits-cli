import { describe, expect, it } from "bun:test";
import type { UnifiedSearchIncompletePresentation } from "./unified-search-response.js";
import { renderUnifiedSearchStatusText } from "./unified-search-status-text.js";
import { renderUnifiedSearchSuccess } from "./unified-search-text.js";

// Recorded dev provenance and first read action from anomalyco/opencode,
// 2026-10-01. No timestamps or commit-distance information was supplied.
const servedSha = "bbd72fb8b0bb6de580d2041a0150016227c63ac0";
const headSha = "0112a92c416f5ad833d96e7a8308441f0a875d94";
const repoUrl = "https://github.com/anomalyco/opencode";
const target = "github:anomalyco/opencode@HEAD";
const path =
  "packages/app/e2e/performance/timeline/session-timeline-benchmark.fixture.ts";

function snapshot(): UnifiedSearchIncompletePresentation {
  return {
    completed: false,
    query: { raw: "Session", sources: ["code"] },
    searchRef: "recorded-search",
    partialResults: false,
    hasMore: true,
    nextOffset: 3,
    progress: {
      status: "INDEXING",
      targetsReady: 1,
      targetsTotal: 1,
      elapsedMs: 100,
      indexingEstimates: [
        {
          kind: "REPOSITORY",
          repositoryUrl: repoUrl,
          targets: [target],
          estimate: { lowerSeconds: 100, upperSeconds: 120 },
        },
      ],
    },
    evidenceNotice:
      "Results from commit: github:anomalyco/opencode@bbd72fb8b0bb6de580d2041a0150016227c63ac0 (indexed from ref HEAD; requested HEAD resolves to a different commit). Read the linked files now for code lookup; wait for HEAD only if its freshness matters. Indexing may change results and their order. If you need updated results, check search status while this search is running; after it ends, search again. For an exact version or Git ref, include it in the search target.",
    sourceStatus: [
      {
        source: "code",
        targetLabel: target,
        servedTarget: target,
        codeIndexState: "STALE",
        resultCount: 1,
        targetResolution: {
          requested: { kind: "repo_default_branch" },
          resolvedRequested: { gitRef: "HEAD", commitSha: headSha },
          served: { repoUrl, gitRef: "HEAD", commitSha: servedSha },
          freshness: "fallback_recent",
          freshnessReason: "requested_ref_indexing",
          availableVersions: [],
          availableRefs: [],
        },
      },
    ],
    results: [
      {
        type: "repository_code",
        target,
        title: "session",
        locator: {
          repoUrl,
          gitRef: servedSha,
          commitSha: servedSha,
          filePath: path,
          startLine: 480,
          endLine: 490,
        },
        readTarget: {
          target: "github:anomalyco/opencode@bbd72fb8",
          path,
          startLine: 480,
          endLine: 490,
        },
      },
    ],
  };
}

function both(
  payload: UnifiedSearchIncompletePresentation,
  syntax: "mcp" | "cli" = "mcp",
): string[] {
  const initial = renderUnifiedSearchSuccess(payload, { actionSyntax: syntax });
  const status = renderUnifiedSearchStatusText(
    {
      completed: false,
      searchRef: payload.searchRef,
      progress: payload.progress,
      result: {
        query: payload.query,
        partialResults: payload.partialResults ?? false,
        hasMore: payload.hasMore,
        nextOffset: payload.nextOffset,
        results: payload.results,
        sourceStatus: payload.sourceStatus,
        evidenceNotice: payload.evidenceNotice,
      },
    },
    { actionSyntax: syntax },
  );
  expect(status).toBe(initial);
  return [initial, status];
}

function resolution(payload: UnifiedSearchIncompletePresentation) {
  return payload.sourceStatus![0]!.targetResolution!;
}

describe("snapshot search text received by agents", () => {
  it.each(["mcp", "cli"] as const)(
    "reads the served snapshot before optional HEAD waiting: %s",
    (syntax) => {
      for (const text of both(snapshot(), syntax)) {
        expect(text).toContain(
          "using commit: github:anomalyco/opencode@bbd72fb8",
        );
        expect(text).toContain("indexed from ref HEAD");
        expect(text).toContain("requested HEAD resolves to a different commit");
        expect(text).toContain("HEAD is indexing");
        expect(text).toContain("next_offset=3");
        expect(text).toContain("1 interim result");
        expect(text).not.toContain("partial result");
        expect(text).toContain(
          "Next: use these hits for lookup, or read a linked file now.",
        );
        const read =
          syntax === "mcp"
            ? `read target="github:anomalyco/opencode@bbd72fb8" path="${path}" start_line=480 end_line=490`
            : `githits read 'github:anomalyco/opencode@bbd72fb8' '${path}' --lines 480-490`;
        expect(text).toContain(read);
        expect(text.indexOf(read)).toBeLessThan(
          text.indexOf("If fresh HEAD matters"),
        );
        expect(text).toContain(
          syntax === "mcp"
            ? 'search_status search_ref="recorded-search" wait_timeout_ms=120000'
            : "githits search-status recorded-search --wait 120",
        );
        expect(text).not.toContain("Next: search_status");
        expect(text).not.toContain("Next: githits search-status");
        expect(text).toContain(
          "For an exact version or ref, include it in the search target.",
        );
        expect(text).not.toContain("Results from commit:"); // No duplicated backend notice.
        expect(text).not.toContain("older snapshot");
      }
    },
  );

  it.each(["main", "other-branch", "HEAD", undefined, servedSha] as const)(
    "labels the historical indexing ref accurately: %s",
    (ref) => {
      const payload = snapshot();
      resolution(payload).served!.gitRef = ref;
      for (const text of both(payload)) {
        if (ref && ref !== servedSha)
          expect(text.replace(/\s+/g, " ")).toContain(
            `indexed from ref ${ref}`,
          );
        else expect(text).not.toContain("indexed from ref");
        expect(text).not.toContain("same branch");
      }
    },
  );

  it.each(["repo_head", "repo_default_branch"])(
    "uses structured intent, not notice wording: %s",
    (kind) => {
      const payload = snapshot();
      payload.evidenceNotice = "An unrelated notice with no HEAD keyword.";
      resolution(payload).requested = {
        kind,
        gitRef: kind === "repo_head" ? "HEAD" : undefined,
      };
      expect(both(payload)[0]).toContain("If fresh HEAD matters");
    },
  );

  it.each(["repo_branch", "repo_tag", "repo_commit"])(
    "keeps explicit %s distinct from HEAD",
    (kind) => {
      const payload = snapshot();
      const ref = kind === "repo_commit" ? headSha : "v1";
      resolution(payload).requested = { kind, gitRef: ref };
      resolution(payload).resolvedRequested!.gitRef = ref;
      for (const text of both(payload)) {
        expect(text).not.toContain("If fresh HEAD matters");
        expect(text).not.toContain("HEAD is indexing");
        expect(text.replace(/\s+/g, " ")).toContain(
          `requested ${ref} resolves to a different commit`,
        );
        expect(text).toContain("If updated results matter");
      }
    },
  );

  it.each(["current", "provisional", "fallback_recent"])(
    "does not call a same-SHA %s refresh an older commit",
    (freshness) => {
      const payload = snapshot();
      resolution(payload).resolvedRequested!.commitSha = servedSha;
      resolution(payload).freshness = freshness;
      payload.sourceStatus![0]!.codeIndexState = "PROVISIONAL";
      for (const text of both(payload)) {
        expect(text).toContain("using commit:");
        expect(text).not.toContain("different commit");
        expect(text).not.toContain("older snapshot");
        expect(text).not.toContain("If fresh HEAD matters");
      }
    },
  );

  it("does not prove prior HEAD when either commit SHA is missing", () => {
    for (const missing of ["served", "resolvedRequested"] as const) {
      const payload = snapshot();
      resolution(payload)[missing]!.commitSha = undefined;
      expect(both(payload)[0]).not.toContain("If fresh HEAD matters");
    }
  });

  it("waits when no hits are returned, without treating source counts as evidence", () => {
    const payload = snapshot();
    payload.results = [];
    for (const text of both(payload)) {
      expect(text).toContain("No results yet");
      expect(text).toContain(
        'Next: search_status search_ref="recorded-search" wait_timeout_ms=120000',
      );
      expect(text).not.toContain("read target=");
      expect(text).not.toContain("using commit:");
      expect(text).not.toContain("older snapshot");
    }
    resolution(payload).served = undefined;
    resolution(payload).freshness = "indexing";
    expect(both(payload)[0]).not.toContain("using commit:");
  });

  it("preserves withheld pairs and mixed docs readiness alongside usable hits", () => {
    const payload = snapshot();
    payload.partialResults = true;
    payload.progress!.targetsReady = 1;
    payload.progress!.targetsTotal = 2;
    payload.sourceStatus!.push({
      source: "docs",
      targetLabel: "site:example.com",
      indexingStatus: "PENDING",
      resultCount: 0,
    });
    for (const text of both(payload)) {
      expect(text).toContain("1 partial result");
      expect(text).toContain("1/2 ready");
      expect(text).toContain("indexing: site:example.com docs");
      expect(text).toContain("Next: use these hits");
    }
  });

  it.each(["COMPLETED", "DEFERRED", "TIMEOUT", "FAILED"])(
    "never polls stored terminal %s results",
    (status) => {
      const payload = snapshot();
      payload.progress!.status = status;
      for (const text of both(payload)) {
        expect(text).toContain("Next: use these hits");
        expect(text).toContain("run a new search");
        expect(text).not.toContain("search_status");
      }
      const text = renderUnifiedSearchStatusText({
        completed: true,
        searchRef: payload.searchRef,
        result: {
          partialResults: false,
          hasMore: false,
          results: payload.results,
          sourceStatus: payload.sourceStatus,
          evidenceNotice: payload.evidenceNotice,
        },
      });
      expect(text).not.toContain("search_status");
    },
  );
});
