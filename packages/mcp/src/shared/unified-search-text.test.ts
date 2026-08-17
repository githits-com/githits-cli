import { describe, expect, it } from "bun:test";
import type {
  UnifiedSearchCompletedPayload,
  UnifiedSearchErrorPayload,
  UnifiedSearchHitPayload,
  UnifiedSearchIncompletePayload,
} from "./unified-search-response.js";
import {
  renderUnifiedSearchError,
  renderUnifiedSearchSuccess,
} from "./unified-search-text.js";

function codeHit(
  overrides: Partial<UnifiedSearchHitPayload> = {},
): UnifiedSearchHitPayload {
  return {
    type: "repository_code",
    target: "cline/cline@v3.4.2",
    title: "applyEdit",
    summary:
      "Search/replace block parser with fuzzy fallback when exact match fails.",
    locator: {
      registry: "npm",
      packageName: "cline",
      version: "v3.4.2",
      filePath: "src/integrations/diff/strategies/multi-search-replace.ts",
      startLine: 142,
      endLine: 156,
      kind: "function",
    },
    ...overrides,
  };
}

function docsHit(): UnifiedSearchHitPayload {
  return {
    type: "documentation_page",
    target: "aider-AI/aider@v0.55.0",
    title: "Edit Formats",
    summary: "Compares whole-file, diff-fenced, udiff, and editblock formats.",
    locator: {
      pageId: "aider/edit-formats",
      sourceUrl: "https://aider.chat/docs/more/edit-formats.html",
      sourceKind: "hosted",
    },
  };
}

function symbolHit(): UnifiedSearchHitPayload {
  return {
    type: "repository_symbol",
    target: "continuedev/continue@v0.9.42",
    title: "diffLines",
    summary: "Myers diff core; line-level with O(ND) complexity.",
    locator: {
      filePath: "core/diff/myers.ts",
      startLine: 48,
      endLine: 112,
      qualifiedPath: "core.diff.myers.diffLines",
      kind: "function",
      category: "callable",
      language: "typescript",
    },
  };
}

function completed(
  results: UnifiedSearchHitPayload[],
  overrides: Partial<UnifiedSearchCompletedPayload> = {},
): UnifiedSearchCompletedPayload {
  return {
    query: { raw: "diff myers" },
    completed: true,
    hasMore: false,
    results,
    ...overrides,
  };
}

describe("renderUnifiedSearchSuccess", () => {
  it("renders an empty completed envelope with bounded anti-retry guidance", () => {
    const text = renderUnifiedSearchSuccess(
      completed([], {
        query: {
          raw: "diff myers",
          filters: { kind: "function" },
        },
        sourceStatus: [
          {
            source: "code",
            targetLabel: "npm:express@5.2.1",
            requestedTarget: "npm:express latest",
            servedTarget: "npm:express@5.2.1",
            codeIndexState: "CURRENT",
            resultCount: 0,
          },
        ],
      }),
    );
    expect(text).toContain("0 hits");
    expect(text).toContain('query="diff myers"');
    expect(text).toContain(
      "No hits for code on npm:express@5.2.1 (requested npm:express latest; current).",
    );
    expect(text).toContain("Do not repeat this search unchanged.");
    expect(text).toContain("shorten or broaden the query");
    expect(text).toContain("remove restrictive filters");
    expect(text).toContain('source="symbol"');
    expect(text).toContain("known literal or regex");
  });

  it("directs completed indexing results to wait or indexed alternatives", () => {
    const text = renderUnifiedSearchSuccess(
      completed([], {
        sourceStatus: [
          {
            source: "code",
            targetLabel: "npm:express@5.2.1",
            servedTarget: "npm:express@5.2.1",
            indexingStatus: "INDEXING",
            codeIndexState: "INDEXING",
            resultCount: 0,
            targetResolution: {
              freshness: "indexing",
              availableVersions: [{ version: "5.1.0", ref: "v5.1.0" }],
              availableRefs: [],
            },
          },
        ],
      }),
    );

    expect(text).toContain("wait_timeout_ms");
    expect(text).toContain("queryable now");
    expect(text).not.toContain("shorten or broaden the query");
  });

  it("does not suggest symbol search when already using the symbol source", () => {
    const text = renderUnifiedSearchSuccess(
      completed([], {
        query: { raw: "Router", sources: ["symbol"] },
      }),
    );

    expect(text).not.toContain('source="symbol"');
    expect(text).not.toContain("remove restrictive filters");
  });

  it("does not call explicit public_only=false restrictive", () => {
    const text = renderUnifiedSearchSuccess(
      completed([], {
        query: { raw: "Router", filters: { publicOnly: false } },
      }),
    );

    expect(text).not.toContain("remove restrictive filters");
  });

  it("does not suggest code_grep for a standalone docs site", () => {
    const text = renderUnifiedSearchSuccess(
      completed([], {
        query: { raw: "middleware", sources: ["docs"] },
        sourceStatus: [
          {
            source: "docs",
            targetLabel: "site:expressjs.com",
            resultCount: 0,
            targetResolution: {
              requested: { site: "site:expressjs.com" },
              served: { site: "site:expressjs.com" },
              freshness: "current",
              availableVersions: [],
              availableRefs: [],
            },
          },
        ],
      }),
    );

    expect(text).not.toContain("code_grep");
  });

  it("prefers a failed lifecycle state over a healthy sibling", () => {
    const text = renderUnifiedSearchSuccess(
      completed([], {
        warnings: ["Source 'code' for npm:express@5.2.1: status FAILED"],
        sourceStatus: [
          {
            source: "code",
            targetLabel: "npm:express@5.2.1",
            servedTarget: "npm:express@5.2.1",
            indexingStatus: "FAILED",
            codeIndexState: "CURRENT",
            resultCount: 0,
          },
        ],
      }),
    );

    expect(text).toContain("No hits for code on npm:express@5.2.1 (failed).");
    expect(text).not.toContain(
      "No hits for code on npm:express@5.2.1 (current).",
    );
  });

  it("prefers a stale lifecycle state over a healthy sibling", () => {
    const text = renderUnifiedSearchSuccess(
      completed([], {
        sourceStatus: [
          {
            source: "code",
            targetLabel: "npm:express@5.2.1",
            servedTarget: "npm:express@5.2.1",
            indexingStatus: "STALE",
            codeIndexState: "CURRENT",
            resultCount: 0,
          },
        ],
      }),
    );

    expect(text).toContain(
      "No hits for code on npm:express@5.2.1 (previous-snapshot).",
    );
    expect(text).not.toContain(
      "No hits for code on npm:express@5.2.1 (current).",
    );
  });

  it("renders a single code hit with locator, title, and summary", () => {
    const text = renderUnifiedSearchSuccess(completed([codeHit()]));
    expect(text).toContain("[1] cline/cline@v3.4.2  code");
    expect(text).not.toContain("0.87");
    expect(text).toContain(
      '    code_read target="npm:cline@v3.4.2" path="src/integrations/diff/strategies/multi-search-replace.ts" start_line=142 end_line=156  function',
    );
    expect(text).toContain("    applyEdit");
    expect(text).toContain(
      "    Search/replace block parser with fuzzy fallback when exact match fails.",
    );
  });

  it("uses pageId for documentation hits", () => {
    const text = renderUnifiedSearchSuccess(completed([docsHit()]));
    expect(text).toContain("[1] aider/edit-formats aider-AI/aider  docs");
    expect(text).toContain('    docs_read page_id="aider/edit-formats"');
    expect(text).toContain("    Edit Formats");
  });

  it("renders qualifiedPath alongside file location for symbol hits", () => {
    const text = renderUnifiedSearchSuccess(completed([symbolHit()]));
    expect(text).toContain("[1] continuedev/continue@v0.9.42  symbol");
    expect(text).toContain(
      "    follow-up unavailable: missing target  core.diff.myers.diffLines | function",
    );
    expect(text).toContain("    diffLines");
  });

  it("uses ASCII separators throughout (no multi-byte chars)", () => {
    const text = renderUnifiedSearchSuccess(
      completed([codeHit(), symbolHit()]),
    );
    // No common Unicode-Latin1 separator characters in the output.
    expect(text).not.toMatch(/[·…—–]/);
  });

  it("emits a truncation hint with offset when hasMore", () => {
    const text = renderUnifiedSearchSuccess(
      completed([codeHit()], { hasMore: true, nextOffset: 10 }),
    );
    expect(text).toContain("More hits available. Pass offset=10");
  });

  it("falls back to a plain widen hint when nextOffset is missing", () => {
    const text = renderUnifiedSearchSuccess(
      completed([codeHit()], { hasMore: true }),
    );
    expect(text).toContain("More hits available. Pass limit=N to widen.");
  });

  it("renders incomplete payloads with searchRef and progress hint", () => {
    const incomplete: UnifiedSearchIncompletePayload = {
      query: { raw: "myers" },
      completed: false,
      hasMore: false,
      results: [codeHit()],
      searchRef: "ref_abc-123",
      progress: {
        status: "INDEXING",
        targetsReady: 1,
        targetsTotal: 2,
        elapsedMs: 8200,
      },
    };
    const text = renderUnifiedSearchSuccess(incomplete);
    expect(text).toContain("1 partial");
    expect(text).toContain("searchRef=ref_abc-123");
    expect(text).toContain("Indexing in progress.\nDo not repeat search.");
    expect(text).toContain(
      'next: call search_status with search_ref="ref_abc-123" and wait_timeout_ms=20000.',
    );
    expect(text).not.toContain("searchRef=ref_abc-123 to follow up");
  });

  it.each(["FAILED", "TIMEOUT"] as const)(
    "stops polling a terminal %s session",
    (status) => {
      const incomplete: UnifiedSearchIncompletePayload = {
        query: { raw: "myers" },
        completed: false,
        hasMore: false,
        results: [],
        searchRef: `ref-${status.toLowerCase()}`,
        progress: {
          status,
          targetsReady: 0,
          targetsTotal: 1,
          elapsedMs: 20_000,
        },
      };

      const text = renderUnifiedSearchSuccess(incomplete);
      expect(text).toContain(
        "Do not call search_status again for this session.",
      );
      expect(text).toContain("next: rerun search");
      expect(text).not.toContain("next: call search_status");
    },
  );

  it("labels deferred indexed alternatives as immediately queryable", () => {
    const incomplete: UnifiedSearchIncompletePayload = {
      query: { raw: "router" },
      completed: false,
      hasMore: false,
      results: [],
      searchRef: "ref-indexing",
      progress: {
        status: "INDEXING",
        targetsReady: 0,
        targetsTotal: 1,
        elapsedMs: 100,
        targets: [
          {
            requested: "npm:express latest",
            availableVersions: [{ version: "4.18.2", ref: "v4.18.2" }],
            availableRefs: [{ ref: "main" }],
          },
        ],
      },
    };

    const text = renderUnifiedSearchSuccess(incomplete);
    expect(text).toContain("0/1 targets");
    expect(text).toContain(
      "queryable now: versions=4.18.2@v4.18.2 | refs=main",
    );
    expect(text).not.toContain("allow_partial_results");
  });

  it("wraps long summaries at the configured width", () => {
    const longSummary =
      "This summary is intentionally long enough to force the wrap logic to break it across multiple lines so the renderer's wrap behaviour is verified.";
    const text = renderUnifiedSearchSuccess(
      completed([codeHit({ summary: longSummary })]),
    );
    const summaryLines = text
      .split("\n")
      .filter(
        (line) => line.startsWith("    ") && line.includes("intentionally"),
      );
    expect(summaryLines.length).toBeGreaterThanOrEqual(1);
    for (const line of text.split("\n")) {
      if (line.includes("code_read ")) continue;
      // 4-space indent + content; allow some slack for the wrap target.
      expect(line.length).toBeLessThanOrEqual(82);
    }
  });

  it("renders source-status notes when the backend reports them", () => {
    const text = renderUnifiedSearchSuccess(
      completed([codeHit()], {
        sourceStatus: [
          {
            source: "code",
            targetLabel: "npm/cline@v3.4.2",
            ignoredFilters: ["fileIntent"],
            note: "fileIntent unsupported on code source",
          },
        ],
      }),
    );
    expect(text).toContain("source notes:");
    expect(text).toContain("- code (npm/cline@v3.4.2)");
    expect(text).toContain("ignored=fileIntent");
  });

  it("renders structured site recovery guidance in backend order", () => {
    const text = renderUnifiedSearchSuccess(
      completed([], {
        sourceStatus: [
          {
            source: "docs",
            targetLabel: "site:example.com",
            suggestedSiteTargets: [
              "site:example.com/docs",
              "site:example.com/guide",
            ],
            suggestedSiteTargetsTruncated: true,
          },
        ],
      }),
    );

    expect(text).toContain(
      "Suggested site targets: site:example.com/docs, site:example.com/guide",
    );
    expect(text).toContain("Additional site targets were omitted.");
    expect(text.indexOf("site:example.com/docs")).toBeLessThan(
      text.indexOf("site:example.com/guide"),
    );
  });

  it("renders a warnings preamble when payload-level warnings are populated", () => {
    const text = renderUnifiedSearchSuccess(
      completed([], {
        warnings: [
          "Source 'docs' for npm:zod@4.3.6: incompatible query features [kind]",
        ],
        sourceStatus: [
          {
            source: "docs",
            targetLabel: "npm:zod@4.3.6",
            incompatibleQueryFeatures: ["kind"],
          },
        ],
      }),
    );
    expect(text).toContain("warnings:");
    expect(text).toContain(
      "  - Source 'docs' for npm:zod@4.3.6: incompatible query features [kind]",
    );
    // Source notes block still rendered for structured detail.
    expect(text).toContain("source notes:");
    expect(text.indexOf("warnings:")).toBeLessThan(
      text.indexOf("Do not repeat this search unchanged."),
    );
  });

  it("uses a compact headline when every requested source is empty", () => {
    const text = renderUnifiedSearchSuccess(
      completed([], {
        sourceStatus: [
          {
            source: "code",
            targetLabel: "npm:zod@4.3.6",
            resultCount: 0,
          },
          {
            source: "docs",
            targetLabel: "npm:zod@4.3.6",
            resultCount: 0,
          },
        ],
      }),
    );

    expect(text).toContain("No hits from any source (code, docs).");
    expect(text).not.toContain("No hits across");
  });

  it("uses requestedRef when repo follow-up lacks served gitRef", () => {
    const text = renderUnifiedSearchSuccess(
      completed([
        codeHit({
          target: "https://github.com/expressjs/express default branch",
          locator: {
            repoUrl: "https://github.com/expressjs/express",
            filePath: "lib/router/index.js",
            requestedRef: "main",
          },
        }),
      ]),
    );

    expect(text).toContain(
      'code_read target="github:expressjs/express#main" path="lib/router/index.js"',
    );
    expect(text).not.toContain("#HEAD");
  });

  it("renders terminal source status compactly without raw target-resolution details", () => {
    const text = renderUnifiedSearchSuccess(
      completed([], {
        warnings: [
          "Source 'code' for githits-com/no-such-repo: Repository ref cannot be resolved (UNRESOLVABLE)",
        ],
        sourceStatus: [
          {
            source: "code",
            targetLabel: "githits-com/no-such-repo",
            indexingStatus: "UNRESOLVABLE",
            codeIndexState: "UNRESOLVABLE",
            note: "Repository ref cannot be resolved",
            targetResolution: {
              requested: {
                repoUrl: "https://github.com/githits-com/no-such-repo",
              },
              resolvedRequested: {
                repoUrl: "https://github.com/githits-com/no-such-repo",
                gitRef: "HEAD",
              },
              freshness: "indexing",
              freshnessReason: "no_current_fallback",
              availableVersions: [],
              availableRefs: [],
            },
          },
        ],
      }),
    );

    expect(text).toContain(
      "code (githits-com/no-such-repo) | Repository ref cannot be resolved (UNRESOLVABLE)",
    );
    expect(text).not.toContain("state=indexing");
  });

  it("omits the warnings preamble when no warnings are present", () => {
    const text = renderUnifiedSearchSuccess(completed([codeHit()]));
    expect(text).not.toContain("warnings:");
    expect(text).not.toContain("Do not repeat this search unchanged.");
    expect(text).not.toContain('source="symbol"');
  });

  it("separates multiple hits with a blank line", () => {
    const text = renderUnifiedSearchSuccess(
      completed([codeHit(), docsHit(), symbolHit()]),
    );
    const hitHeaders = text.split("\n").filter((line) => /^\[\d\]/.test(line));
    expect(hitHeaders).toHaveLength(3);
    expect(text).toContain("[1] cline/cline@v3.4.2");
    expect(text).toContain("[2] aider/edit-formats aider-AI/aider");
    expect(text).toContain("[3] continuedev/continue@v0.9.42");
  });
});

describe("renderUnifiedSearchError", () => {
  it("renders a basic error", () => {
    const error: UnifiedSearchErrorPayload = {
      error: "Target is indexing.",
      code: "INDEXING",
      retryable: true,
      details: { indexingRef: "ref_xyz" },
    };
    const text = renderUnifiedSearchError(error);
    expect(text).toContain("search | ERROR | code=INDEXING | retryable");
    expect(text).toContain("Target is indexing.");
    expect(text).toContain("details:");
    expect(text).toContain("  indexingRef: ref_xyz");
  });

  it("omits retryable marker when not set", () => {
    const error: UnifiedSearchErrorPayload = {
      error: "Bad request.",
      code: "INVALID_ARGUMENT",
    };
    const text = renderUnifiedSearchError(error);
    expect(text).toBe("search | ERROR | code=INVALID_ARGUMENT\nBad request.");
  });

  it("serialises object detail values via JSON", () => {
    const error: UnifiedSearchErrorPayload = {
      error: "Indexing.",
      code: "INDEXING",
      details: {
        availableVersions: [
          { version: "4.21.0", ref: "v4.21.0" },
          { version: "4.20.0", ref: "v4.20.0" },
        ],
      },
    };
    const text = renderUnifiedSearchError(error);
    expect(text).toContain('"version":"4.21.0"');
  });
});
