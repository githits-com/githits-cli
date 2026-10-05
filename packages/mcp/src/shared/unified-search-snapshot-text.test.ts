import { describe, expect, it } from "bun:test";
import { projectUnifiedSearchPresentation } from "./unified-search-presentation.js";
import type { UnifiedSearchIncompletePresentation } from "./unified-search-response.js";
import { renderUnifiedSearchStatusText } from "./unified-search-status-text.js";
import { renderUnifiedSearchSuccess } from "./unified-search-text.js";

// Recorded dev provenance and first read action from anomalyco/opencode,
// 2026-10-01. No timestamps or commit-distance information was supplied;
// date cases add independent timestamps without changing that baseline identity.
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
  it.each([
    ["2026-09-01T23:59:59Z", "2026-10-05T00:00:01Z"],
    ["2026-09-01T23:59:59Z", null],
    [null, "2026-10-05T00:00:01Z"],
    [null, null],
    [undefined, undefined],
    ["2099-12-31T23:59:59Z", "2000-01-01T00:00:00Z"],
  ])(
    "attributes independent UTC dates (%s / %s) without changing actions",
    (servedDate, requestedDate) => {
      const payload = snapshot();
      const baseline = projectUnifiedSearchPresentation(payload);
      const readTarget = structuredClone(payload.results[0]!.readTarget);
      resolution(payload).served!.committedAt = servedDate ?? undefined;
      resolution(payload).resolvedRequested!.committedAt =
        requestedDate ?? undefined;
      const dated = projectUnifiedSearchPresentation(payload);
      expect(dated.action).toEqual(baseline.action);
      expect(dated.lifecycle).toEqual(baseline.lifecycle);
      expect(dated.availability).toEqual(baseline.availability);
      expect(payload.results[0]!.readTarget).toEqual(readTarget);
      for (const syntax of ["mcp", "cli"] as const) {
        const text = both(payload, syntax)[0]!.replace(/\s+/g, " ");
        expect(text).toContain(
          `commit: github:anomalyco/opencode@bbd72fb8 (${servedDate ? `committed ${servedDate.slice(0, 10)}, ` : ""}indexed from ref HEAD)`,
        );
        expect(text).toContain(
          `requested HEAD resolves to a different commit${requestedDate ? ` (committed ${requestedDate.slice(0, 10)})` : ""} and is indexing`,
        );
        expect(text.match(/committed \d{4}-\d{2}-\d{2}/g) ?? []).toHaveLength(
          Number(Boolean(servedDate)) + Number(Boolean(requestedDate)),
        );
        expect(text).toContain("Next: use these hits now; read for details:");
        expect(text).toContain("If you need current HEAD");
        expect(text).not.toContain("T23:");
        expect(text).not.toContain("unknown date");
        expect(text).not.toContain("days ago");
      }
    },
  );

  it("keeps date punctuation clean without a historical ref", () => {
    const payload = snapshot();
    resolution(payload).served!.gitRef = undefined;
    resolution(payload).served!.committedAt = "2026-09-01T12:00:00Z";
    expect(both(payload)[0]).toContain(
      "commit: github:anomalyco/opencode@bbd72fb8 (committed 2026-09-01)",
    );
  });

  it.each([null, "2026-09-01T00:00:00Z"])(
    "does not borrow requested date for same-SHA provisional evidence (%s)",
    (servedDate) => {
      const payload = snapshot();
      resolution(payload).resolvedRequested!.commitSha = servedSha;
      resolution(payload).resolvedRequested!.committedAt =
        "2026-10-05T00:00:00Z";
      resolution(payload).served!.committedAt = servedDate ?? undefined;
      resolution(payload).freshness = "provisional";
      payload.sourceStatus![0]!.codeIndexState = "PROVISIONAL";
      for (const text of both(payload)) {
        expect(text).not.toContain("2026-10-05");
        expect(text).not.toContain("different commit");
        expect(text).not.toContain("If you need current HEAD");
        expect(text).toContain("Next: use these hits now");
        if (servedDate) expect(text).toContain("committed 2026-09-01");
        else expect(text).not.toContain("committed");
      }
    },
  );

  it.each(["2000-01-01T00:00:00Z", "2099-12-31T00:00:00Z"])(
    "keeps healthy current evidence compact and wait-free despite date %s",
    (date) => {
      const payload = snapshot();
      payload.evidenceNotice = undefined;
      payload.progress!.status = "COMPLETED";
      payload.sourceStatus![0]!.codeIndexState = "CURRENT";
      resolution(payload).freshness = "current";
      resolution(payload).freshnessReason = "exact_current";
      resolution(payload).resolvedRequested!.commitSha = servedSha;
      const completed = {
        ...payload,
        completed: true as const,
        partialResults: false,
      };
      const baseline = renderUnifiedSearchSuccess(completed);
      resolution(payload).served!.committedAt = date;
      resolution(payload).resolvedRequested!.committedAt = date;
      const text = renderUnifiedSearchSuccess(completed);
      expect(text).toBe(baseline);
      expect(text).not.toContain("wait");
      expect(text).not.toContain("committed");
    },
  );

  it.each(["mcp", "cli"] as const)(
    "reads the served snapshot before optional HEAD waiting: %s",
    (syntax) => {
      for (const text of both(snapshot(), syntax)) {
        expect(text).toContain("commit: github:anomalyco/opencode@bbd72fb8");
        expect(text).toContain("indexed from ref HEAD");
        expect(text.replace(/\s+/g, " ")).toContain(
          "requested HEAD resolves to a different commit",
        );
        expect(text.replace(/\s+/g, " ")).toContain(
          "different commit and is indexing",
        );
        expect(text).toContain("next_offset=3");
        expect(text).toContain("1 result");
        expect(text).not.toContain("partial result");
        expect(text).toContain("Next: use these hits now; read for details:");
        const read =
          syntax === "mcp"
            ? `read target="github:anomalyco/opencode@bbd72fb8" path="${path}" start_line=480 end_line=490`
            : `githits read 'github:anomalyco/opencode@bbd72fb8' '${path}' --lines 480-490`;
        expect(text).toContain(read);
        expect(text.indexOf(read)).toBeLessThan(
          text.indexOf("If you need current HEAD"),
        );
        expect(text).toContain(
          syntax === "mcp"
            ? 'search_status search_ref="recorded-search" wait_timeout_ms=120000'
            : "githits search-status recorded-search --wait 120",
        );
        expect(text).not.toContain("Next: search_status");
        expect(text).not.toContain("Next: githits search-status");
        expect(text).toContain(
          "For a specific ref, search github:anomalyco/opencode@<ref>.",
        );
        expect(text).not.toContain("Results from commit:"); // No duplicated backend notice.
        expect(text).not.toContain("older snapshot");
      }
    },
  );

  it.each([
    ["https://github.com/anomalyco/opencode", "github:anomalyco/opencode"],
    ["https://codeberg.org/owner/project", "codeberg:owner/project"],
    [
      "https://gitlab.com/group/subgroup/project",
      "gitlab:group/subgroup/project",
    ],
  ])(
    "uses the repository's own name in specific-ref advice: %s",
    (url, base) => {
      const payload = snapshot();
      const label = `${base}@HEAD`;
      payload.sourceStatus![0]!.targetLabel = label;
      payload.sourceStatus![0]!.servedTarget = label;
      resolution(payload).served!.repoUrl = url;
      payload.results[0]!.target = label;
      payload.results[0]!.locator.repoUrl = url;
      for (const text of both(payload)) {
        expect(text.replace(/\s+/g, " ")).toContain(
          `For a specific ref, search ${base}@<ref>.`,
        );
        expect(text).not.toContain("target@ref");
        expect(text).not.toContain("target@version");
      }
    },
  );

  it("does not offer a read when no hit supplies a read target", () => {
    const payload = snapshot();
    payload.results[0]!.readTarget = undefined;
    for (const text of both(payload)) {
      expect(text).toContain("Next: use these hits now.");
      expect(text).not.toContain("read for details:");
      expect(text).not.toContain("read target=");
      expect(text).toContain("If you need current HEAD");
    }
  });

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
      resolution(payload).resolvedRequested!.gitRef = undefined;
      const text = both(payload)[0]!;
      expect(text).toContain("If you need current HEAD");
      expect(text.replace(/\s+/g, " ")).toContain(
        "different commit and is indexing",
      );
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
        expect(text).not.toContain("If you need current HEAD");
        expect(text).not.toContain("HEAD is indexing");
        expect(text.replace(/\s+/g, " ")).toContain(
          `requested ${ref} resolves to a different commit`,
        );
        expect(text).toContain("If you need updated results");
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
        expect(text).toContain("commit:");
        expect(text).not.toContain("different commit");
        expect(text).not.toContain("older snapshot");
        expect(text).not.toContain("If you need current HEAD");
      }
    },
  );

  it("does not prove prior HEAD when either commit SHA is missing", () => {
    for (const missing of ["served", "resolvedRequested"] as const) {
      const payload = snapshot();
      resolution(payload)[missing]!.commitSha = undefined;
      resolution(payload).resolvedRequested!.committedAt =
        "2026-10-05T00:00:00Z";
      expect(both(payload)[0]).not.toContain("2026-10-05");
      expect(both(payload)[0]).not.toContain("If you need current HEAD");
    }
  });

  it("waits when no hits are returned, without treating source counts as evidence", () => {
    const payload = snapshot();
    payload.results = [];
    resolution(payload).served!.committedAt = "2026-09-01T00:00:00Z";
    for (const text of both(payload)) {
      expect(text).toContain("No results yet");
      expect(text).toContain(
        'Next: search_status search_ref="recorded-search" wait_timeout_ms=120000',
      );
      expect(text).not.toContain("read target=");
      expect(text).not.toContain("commit:");
      expect(text).not.toContain("older snapshot");
    }
    resolution(payload).served = undefined;
    resolution(payload).freshness = "indexing";
    expect(both(payload)[0]).not.toContain("commit:");
  });

  it.each(["INDEXING", "COMPLETED", "DEFERRED", "TIMEOUT", "FAILED"])(
    "discloses the searched commit for zero-hit %s pairs without use advice",
    (status) => {
      const payload = snapshot();
      payload.results = [];
      payload.sourceStatus![0]!.resultCount = 0;
      resolution(payload).served!.committedAt = "2026-09-01T00:00:00Z";
      payload.progress!.status = status;
      resolution(payload).served!.committedAt = "2026-09-01T00:00:00Z";
      for (const text of both(payload)) {
        expect(text).toContain("commit: github:anomalyco/opencode@bbd72fb8");
        expect(text.replace(/\s+/g, " ")).toContain(
          "requested HEAD resolves to a different commit",
        );
        expect(text.replace(/\s+/g, " ")).toContain(
          "different commit and is indexing",
        );
        expect(text).toContain("committed 2026-09-01");
        expect(text).not.toContain("Next: use these hits");
        expect(text).not.toContain("read target=");
        expect(text).not.toContain("If you need current HEAD");
        if (status === "INDEXING")
          expect(text).toContain("Next: search_status");
        else {
          expect(text).toContain("search again later");
          expect(text).not.toContain("search_status");
        }
      }
    },
  );

  it("does not disclose served evidence for a withheld zero-hit pair", () => {
    const payload = snapshot();
    payload.results = [];
    payload.sourceStatus![0]!.resultCount = 0;
    payload.sourceStatus![0]!.codeIndexState = "PENDING";
    // Withheld pairs clear served provenance; do not manufacture it.
    resolution(payload).served = undefined;
    resolution(payload).resolvedRequested!.committedAt = "2026-10-05T00:00:00Z";
    for (const text of both(payload)) {
      expect(text).not.toContain("commit:");
      expect(text).not.toContain("committed");
    }
  });

  it("attributes bare request labels alongside a historical served HEAD alias", () => {
    const payload = snapshot();
    const bareTarget = "github:anomalyco/opencode";
    payload.sourceStatus![0]!.targetLabel = bareTarget;
    payload.results[0]!.target = bareTarget;
    payload.results[0]!.servedTarget = target;
    for (const text of both(payload)) {
      expect(text).toContain("commit: github:anomalyco/opencode@bbd72fb8");
      expect(text).toContain("If you need current HEAD");
    }
  });

  it.each([0, undefined, 1])(
    "does not borrow another target's same-repo/commit hits (source count=%s)",
    (resultCount) => {
      const payload = snapshot();
      payload.sourceStatus![0]!.resultCount = resultCount;
      const explicitTarget = `github:anomalyco/opencode@${servedSha}`;
      payload.results[0]!.target = explicitTarget;
      payload.results[0]!.servedTarget = target; // Historical alias is not attribution.
      payload.sourceStatus!.push({
        source: "code",
        targetLabel: explicitTarget,
        resultCount: 1,
        codeIndexState: "CURRENT",
        targetResolution: {
          requested: { kind: "repo_commit", gitRef: servedSha },
          resolvedRequested: {
            repoUrl,
            gitRef: servedSha,
            commitSha: servedSha,
          },
          served: { repoUrl, gitRef: "HEAD", commitSha: servedSha },
          freshness: "current",
          availableVersions: [],
          availableRefs: [],
        },
      });
      for (const text of both(payload)) {
        if (resultCount === 0) {
          expect(text).toContain("commit:"); // Its own zero-hit search provenance.
          expect(text.replace(/\s+/g, " ")).toContain(
            "requested HEAD resolves to a different commit",
          );
        } else {
          expect(text).not.toContain("commit:");
          expect(text.replace(/\s+/g, " ")).not.toContain(
            "requested HEAD resolves to a different commit",
          );
        }
        expect(text).not.toContain("If you need current HEAD");
        expect(text).toContain("Next: use these hits");
        expect(text).toContain(explicitTarget);
      }
    },
  );

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
      resolution(payload).served!.committedAt = "2026-09-01T00:00:00Z";
      for (const text of both(payload)) {
        expect(text).toContain("Next: use these hits");
        expect(text).toContain("committed 2026-09-01");
        expect(text).toContain("search again");
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
