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

function docsHit(
  overrides: Partial<UnifiedSearchHitPayload> = {},
): UnifiedSearchHitPayload {
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
    ...overrides,
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

  it("keeps standalone docs site pivots within applicable sources", () => {
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
    expect(text).not.toContain('source="symbol"');
    expect(text).toContain("next: shorten or broaden the query.");
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

  it("lists healthy documentation references without repeating result metadata", () => {
    const text = renderUnifiedSearchSuccess(
      completed(
        [
          docsHit({
            target: "npm:express@5.2.1",
            locator: {
              pageId: "express/routing",
              sourceUrl: "https://wrong.example.net/inferred-from-hit",
              sourceKind: "hosted",
            },
          }),
        ],
        {
          sourceStatus: [
            {
              source: "docs",
              targetLabel: "npm:express@5.2.1",
              contributors: [
                {
                  kind: "DOCPACK",
                  state: "SEARCHED",
                  freshness: "CURRENT",
                  resultCount: 4,
                  siteKey: "34150829eb8a7c57",
                  siteUrl: "https://expressjs.com/en/guide/",
                  coverage: {
                    coverageState: "COMPLETE",
                    pagesCrawled: 124,
                    frontierRemaining: 0,
                    artifactOverflowPageCount: 0,
                  },
                },
                {
                  kind: "REPOSITORY_DOCS",
                  state: "SEARCHED",
                  freshness: "CURRENT",
                  resultCount: 1,
                  repositoryUrl: "https://github.com/expressjs/express",
                  commitSha: "0123456789abcdef0123456789abcdef01234567",
                },
              ],
            },
            {
              source: "code",
              targetLabel: "npm:express@5.2.1",
              contributors: [],
            },
          ],
        },
      ),
    );

    const searchedLine = text
      .split("\n")
      .find((line) => line.startsWith("searched:"));
    expect(searchedLine).toBe(
      "searched: site expressjs.com/en/guide; repo https://github.com/expressjs/express @ 0123456789abcdef0123456789abcdef01234567",
    );
    expect(text).not.toContain("wrong.example.net");
    expect(text).toContain(
      "repo https://github.com/expressjs/express @ 0123456789abcdef0123456789abcdef01234567\n\n[1]",
    );
    expect(text.indexOf("searched:")).toBeLessThan(text.indexOf("[1]"));
    expect(text).not.toContain("documentation corpora");
    expect(text).not.toContain("hits on this page");
    expect(text).not.toContain("current");
    expect(text).not.toContain("124");
  });

  it("labels documentation sources only when multiple targets need disambiguation", () => {
    const text = renderUnifiedSearchSuccess(
      completed([docsHit()], {
        sourceStatus: [
          {
            source: "docs",
            targetLabel: "npm:express@5.2.1",
            contributors: [
              {
                kind: "REPOSITORY_DOCS",
                state: "SEARCHED",
                freshness: "CURRENT",
                resultCount: 1,
                repositoryUrl: "https://github.com/expressjs/express",
                commitSha: "0123456789abcdef0123456789abcdef01234567",
              },
            ],
          },
          {
            source: "docs",
            targetLabel: "npm:koa@3.0.1",
            contributors: [
              {
                kind: "REPOSITORY_DOCS",
                state: "SEARCHED",
                freshness: "CURRENT",
                resultCount: 0,
                repositoryUrl: "https://github.com/koajs/koa",
                commitSha: "abcdef0123456789abcdef0123456789abcdef01",
              },
            ],
          },
        ],
      }),
    );

    expect(text).toContain(
      "searched:\n  npm:express@5.2.1: repo https://github.com/expressjs/express @ 0123456789abcdef0123456789abcdef01234567\n  npm:koa@3.0.1: repo https://github.com/koajs/koa @ abcdef0123456789abcdef0123456789abcdef01",
    );
    expect(text.indexOf("searched:")).toBeLessThan(text.indexOf("[1]"));
  });

  it("renders a root docpack URL without a redundant trailing slash", () => {
    const text = renderUnifiedSearchSuccess(
      completed([], {
        sourceStatus: [
          {
            source: "docs",
            targetLabel: "npm:express@5.2.1",
            contributors: [
              {
                kind: "DOCPACK",
                state: "SEARCHED",
                freshness: "CURRENT",
                resultCount: 0,
                siteKey: "34150829eb8a7c57",
                siteUrl: "https://expressjs.com/",
                coverage: { coverageState: "COMPLETE" },
              },
            ],
          },
        ],
      }),
    );

    expect(text.split("\n").find((line) => line.startsWith("searched:"))).toBe(
      "searched: site expressjs.com",
    );
  });

  it("keeps malformed optional site metadata from failing text output", () => {
    for (const siteUrl of [
      "expressjs.com/en/guide",
      "file:///opt/docs/index.html",
    ]) {
      const text = renderUnifiedSearchSuccess(
        completed([], {
          sourceStatus: [
            {
              source: "docs",
              targetLabel: "npm:express@5.2.1",
              contributors: [
                {
                  kind: "DOCPACK",
                  state: "PENDING",
                  resultCount: 0,
                  siteKey: "34150829eb8a7c57",
                  siteUrl,
                },
              ],
            },
          ],
        }),
      );

      expect(text).toContain(
        "site documentation - not ready, so it was not searched",
      );
    }
  });

  it("numbers docpack labels only when their displayed identities collide", () => {
    const text = renderUnifiedSearchSuccess(
      completed([], {
        sourceStatus: [
          {
            source: "docs",
            targetLabel: "npm:express@5.2.1",
            contributors: [
              {
                kind: "DOCPACK",
                state: "PENDING",
                resultCount: 0,
                siteKey: "1111111111111111",
                siteUrl: "https://docs.example.com/",
              },
              {
                kind: "DOCPACK",
                state: "READY",
                freshness: "CURRENT",
                resultCount: 0,
                siteKey: "2222222222222222",
                siteUrl: "https://other.example.com",
                coverage: { coverageState: "COMPLETE" },
              },
              {
                kind: "DOCPACK",
                state: "UNAVAILABLE",
                resultCount: 0,
                siteKey: "3333333333333333",
                siteUrl: "https://docs.example.com",
              },
            ],
          },
        ],
      }),
    );

    expect(text).toContain(
      "site docs.example.com 1 - not ready, so it was not searched",
    );
    expect(text).toContain(
      "site other.example.com - available, but not searched for this response",
    );
    expect(text).toContain(
      "site docs.example.com 2 - unavailable and was not searched",
    );
  });

  it("retains the source target when another response target has no contributors", () => {
    const text = renderUnifiedSearchSuccess(
      completed(
        [
          codeHit({
            target: "npm:express@5.2.1",
          }),
        ],
        {
          sourceStatus: [
            {
              source: "docs",
              targetLabel: "npm:koa@3.0.1",
              contributors: [
                {
                  kind: "DOCPACK",
                  state: "PENDING",
                  resultCount: 0,
                  siteKey: "1111111111111111",
                },
              ],
            },
            {
              source: "code",
              targetLabel: "npm:express@5.2.1",
              contributors: [],
            },
          ],
        },
      ),
    );

    expect(text).toContain(
      "documentation sources:\n  npm:koa@3.0.1:\n    - site documentation - not ready, so it was not searched\n\n[1]",
    );
  });

  it("groups mixed source health by target without repeating section labels", () => {
    const text = renderUnifiedSearchSuccess(
      completed([docsHit()], {
        sourceStatus: [
          {
            source: "docs",
            targetLabel: "npm:express@5.2.1",
            contributors: [
              {
                kind: "REPOSITORY_DOCS",
                state: "SEARCHED",
                freshness: "CURRENT",
                resultCount: 1,
                repositoryUrl: "https://github.com/expressjs/express",
                commitSha: "0123456789abcdef0123456789abcdef01234567",
              },
            ],
          },
          {
            source: "docs",
            targetLabel: "npm:koa@3.0.1",
            contributors: [
              {
                kind: "DOCPACK",
                state: "PENDING",
                resultCount: 0,
                siteKey: "1111111111111111",
              },
            ],
          },
          {
            source: "docs",
            targetLabel: "npm:react@19.1.1",
            contributors: [
              {
                kind: "DOCPACK",
                state: "UNAVAILABLE",
                resultCount: 0,
                siteKey: "2222222222222222",
              },
            ],
          },
        ],
      }),
    );

    expect(text).toContain(
      "searched:\n  npm:express@5.2.1: repo https://github.com/expressjs/express @ 0123456789abcdef0123456789abcdef01234567\n\ndocumentation sources:\n  npm:koa@3.0.1:\n    - site documentation - not ready, so it was not searched\n  npm:react@19.1.1:\n    - site documentation - unavailable and was not searched",
    );
    expect(text.match(/documentation sources:/g)).toHaveLength(1);
  });

  it("states searched contributors and missing coverage inside an exception block", () => {
    const text = renderUnifiedSearchSuccess(
      completed(
        [
          docsHit({
            target: "npm:express@5.2.1",
            locator: {
              pageId: "express/routing",
              sourceUrl: "https://expressjs.com/en/guide/routing.html",
            },
          }),
        ],
        {
          sourceStatus: [
            {
              source: "docs",
              targetLabel: "npm:express@5.2.1",
              contributors: [
                {
                  kind: "REPOSITORY_DOCS",
                  state: "SEARCHED",
                  freshness: "CURRENT",
                  resultCount: 1,
                  repositoryUrl: "https://github.com/expressjs/express",
                  commitSha: "0123456789abcdef0123456789abcdef01234567",
                },
                {
                  kind: "DOCPACK",
                  state: "SEARCHED",
                  freshness: "CURRENT",
                  resultCount: 0,
                  siteKey: "34150829eb8a7c57",
                },
              ],
            },
          ],
        },
      ),
    );

    expect(text).toContain("documentation sources:");
    expect(text).toContain(
      "repo https://github.com/expressjs/express @ 0123456789abcdef0123456789abcdef01234567 - searched",
    );
    expect(text).toContain(
      "site documentation - searched; published coverage details unavailable",
    );
    expect(text).not.toContain("searched: repo");
  });

  it("explains capped page coverage without repeating the limit reason", () => {
    const text = renderUnifiedSearchSuccess(
      completed([], {
        sourceStatus: [
          {
            source: "docs",
            targetLabel: "npm:express@5.2.1",
            contributors: [
              {
                kind: "DOCPACK",
                state: "SEARCHED",
                freshness: "CURRENT",
                resultCount: 0,
                siteKey: "34150829eb8a7c57",
                coverage: {
                  coverageState: "CAPPED",
                  coverageReason: "max_pages",
                  pagesCrawled: 500,
                  frontierRemaining: 24,
                  artifactOverflowPageCount: 0,
                },
              },
            ],
          },
        ],
      }),
    );

    expect(text).toContain(
      "site documentation - searched; published snapshot reached its page limit: 500 pages included, 24 discovered pages not included",
    );
    expect(text).not.toContain("limited by max pages");
    expect(text).not.toContain("34150829eb8a7c57");
  });

  it("explains documentation source exceptions without implying progress from coverage", () => {
    const notice =
      "Results reflect disclosed snapshots; pending work may change hits and ordering.";
    const text = renderUnifiedSearchSuccess(
      completed([docsHit()], {
        searchRef: "search-ref-docs",
        evidenceNotice: notice,
        sourceStatus: [
          {
            source: "docs",
            targetLabel: "npm:express@5.1.0",
            contributors: [
              {
                kind: "REPOSITORY_DOCS",
                state: "SEARCHED",
                freshness: "CURRENT",
                resultCount: 1,
                repositoryUrl: "https://github.com/expressjs/express",
                commitSha: "0123456789abcdef0123456789abcdef01234567",
              },
              {
                kind: "DOCPACK",
                state: "SEARCHED",
                freshness: "STALE",
                resultCount: 2,
                siteKey: "34150829eb8a7c57",
                siteUrl: "https://expressjs.com/en/guide",
                coverage: {
                  coverageState: "CAPPED",
                  coverageReason: "artifact_size",
                  pagesCrawled: 480,
                  frontierRemaining: null,
                  artifactOverflowPageCount: 12,
                  estimatedTotalPages: 700,
                  note: "Indexing is still in progress.",
                },
              },
              {
                kind: "DOCPACK",
                state: "READY",
                freshness: "CURRENT",
                resultCount: 0,
                siteKey: "1111111111111111",
                siteUrl: "https://koajs.com/docs",
                coverage: {
                  coverageState: "COMPLETE",
                  pagesCrawled: 75,
                  frontierRemaining: 0,
                  artifactOverflowPageCount: 0,
                },
              },
              {
                kind: "DOCPACK",
                state: "SEARCHED",
                freshness: "STALE",
                resultCount: 0,
                siteKey: "2222222222222222",
                siteUrl: "https://react.dev/reference",
                coverage: {
                  coverageState: "NONE",
                  pagesCrawled: 69,
                  frontierRemaining: null,
                  artifactOverflowPageCount: 0,
                  note: "Coverage has not been computed.",
                },
              },
              {
                kind: "DOCPACK",
                state: "PENDING",
                resultCount: 0,
                siteKey: "3333333333333333",
                siteUrl: "https://docs.example.com/pending",
              },
              {
                kind: "DOCPACK",
                state: "UNAVAILABLE",
                resultCount: 0,
                siteKey: "4444444444444444",
                siteUrl: "https://docs.example.com/unavailable",
              },
              {
                kind: "DOCPACK",
                state: "SEARCHED",
                freshness: "CURRENT",
                resultCount: 0,
                siteKey: "5555555555555555",
                siteUrl: "https://docs.example.com/capped",
                coverage: {
                  coverageState: "CAPPED",
                  coverageReason: "trap_suspected",
                  pagesCrawled: 20,
                  frontierRemaining: null,
                  artifactOverflowPageCount: 0,
                },
              },
            ],
          },
        ],
      }),
    );

    expect(text).toContain("documentation sources:");
    expect(text.indexOf("documentation sources:")).toBeLessThan(
      text.indexOf("[1]"),
    );
    expect(text).not.toContain("source notes:");
    expect(text).toContain(
      "repo https://github.com/expressjs/express @ 0123456789abcdef0123456789abcdef01234567 - searched",
    );
    expect(text).toContain(
      "site expressjs.com/en/guide - searched an older snapshot; published snapshot hit its size cap: 480 pages included, 12 pages omitted, about 700 estimated total",
    );
    expect(text).toContain(
      "site koajs.com/docs - available, but not searched for this response",
    );
    expect(text).toContain(
      "site react.dev/reference - searched an older snapshot; published coverage was not measured: 69 pages included",
    );
    expect(text).not.toContain("Coverage has not been computed");
    expect(text).toContain(
      "site docs.example.com/pending - not ready, so it was not searched",
    );
    expect(text).toContain(
      "site docs.example.com/unavailable - unavailable and was not searched",
    );
    expect(text).toContain(
      "site docs.example.com/capped - searched; published snapshot is capped: 20 pages included, limited by a suspected crawl trap",
    );
    expect(text).not.toContain("hits on this page");
    expect(text).not.toContain("documentation corpora");
    expect(text).not.toContain("34150829eb8a7c57");
    expect(text).not.toContain("Indexing is still in progress");
    expect(text.match(new RegExp(notice, "g"))).toHaveLength(1);
    expect(text).toContain(
      'next: call search_status with search_ref="search-ref-docs"',
    );
  });

  it("does not give query-pivot advice for empty evidence-bearing results", () => {
    const text = renderUnifiedSearchSuccess(
      completed([], {
        searchRef: "search-ref-docs",
        evidenceNotice: "Pending work may change hits and ordering.",
      }),
    );

    expect(text).toContain("No hits in the searched evidence on this page.");
    expect(text).toContain("Do not repeat immediately.");
    expect(text).not.toContain("Do not repeat this search unchanged.");
    expect(text).not.toContain("shorten or broaden the query");
    expect(text).toContain(
      'next: call search_status with search_ref="search-ref-docs"',
    );
  });

  it("scopes empty claims to searched evidence when a source was not searched", () => {
    const text = renderUnifiedSearchSuccess(
      completed([], {
        sourceStatus: [
          {
            source: "docs",
            targetLabel: "npm:express@5.2.1",
            contributors: [
              {
                kind: "DOCPACK",
                state: "READY",
                freshness: "CURRENT",
                resultCount: 0,
                siteKey: "34150829eb8a7c57",
              },
            ],
          },
        ],
      }),
    );

    expect(text).toContain("No hits in the searched evidence on this page.");
    expect(text).not.toContain("No hits for docs");
    expect(text).toContain("Do not repeat this search unchanged.");
    expect(text).toContain("next: shorten or broaden the query");
  });

  it("keeps indexing guidance when documentation contributors were not searched", () => {
    const text = renderUnifiedSearchSuccess(
      completed([], {
        sourceStatus: [
          {
            source: "docs",
            targetLabel: "npm:express@5.2.1",
            contributors: [
              {
                kind: "DOCPACK",
                state: "READY",
                freshness: "CURRENT",
                resultCount: 0,
                siteKey: "34150829eb8a7c57",
              },
            ],
          },
          {
            source: "code",
            targetLabel: "npm:express@5.2.1",
            contributors: [],
            indexingStatus: "INDEXING",
          },
        ],
      }),
    );

    expect(text).toContain("No hits in the searched evidence on this page.");
    expect(text).toContain("Do not repeat this search unchanged.");
    expect(text).toContain("indexState=INDEXING\n\ndocumentation sources:");
    expect(text).toContain(
      "next: rerun with a larger wait_timeout_ms to wait for indexing.",
    );
    expect(text).not.toContain("shorten or broaden the query");
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
