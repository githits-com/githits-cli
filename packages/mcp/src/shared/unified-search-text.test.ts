import { describe, expect, it } from "bun:test";
import { projectUnifiedSearchPresentation } from "./unified-search-presentation.js";
import type {
  UnifiedSearchCompletedPayload,
  UnifiedSearchErrorPayload,
  UnifiedSearchHitPayload,
  UnifiedSearchIncompletePayload,
  UnifiedSearchSourceStatusPayload,
} from "./unified-search-response.js";
import {
  renderUnifiedSearchError,
  renderUnifiedSearchPresentationText,
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

function completed(
  results: UnifiedSearchHitPayload[],
  overrides: Partial<UnifiedSearchCompletedPayload> = {},
): UnifiedSearchCompletedPayload {
  return {
    query: { raw: "diff myers" },
    completed: true,
    partialResults: false,
    hasMore: false,
    results,
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
    searchRef: "ref_abc-123",
    progress: {
      status: "INDEXING",
      targetsReady: 0,
      targetsTotal: 1,
      elapsedMs: 8200,
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

function n8nActiveEmpty(): UnifiedSearchIncompletePayload {
  return incomplete({
    query: { raw: "human review approval node output" },
    searchRef: "fabUr1S3MEVeSgD93pMoSQ",
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
            { version: "2.21.7", ref: "v2.21.7" },
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
            coverage: { coverageState: "CAPPED", pagesCrawled: 1480 },
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
  });
}

function firstLine(text: string): string {
  return text.split("\n")[0] ?? "";
}

describe("renderUnifiedSearchSuccess", () => {
  it("starts completed hits with the outcome and preserves hit anatomy", () => {
    const text = renderUnifiedSearchSuccess(completed([codeHit()]));

    expect(firstLine(text)).toContain("1 result");
    expect(firstLine(text)).not.toContain("search |");
    expect(text).toContain("[1] cline/cline@v3.4.2  code");
    expect(text).toContain(
      '    code_read target="npm:cline@v3.4.2" path="src/integrations/diff/strategies/multi-search-replace.ts" start_line=142 end_line=156  function',
    );
    expect(text).toContain("    applyEdit");
    expect(text).not.toContain("searchRef=");
  });

  it("renders completed empty evidence once and uses model pivots", () => {
    const text = renderUnifiedSearchSuccess(
      completed([], {
        query: {
          raw: "diff myers",
          filters: { kind: "function" },
        },
        sourceStatus: [
          source({
            source: "code",
            targetLabel: "npm:express@5.2.1",
            codeIndexState: "CURRENT",
            resultCount: 0,
          }),
        ],
      }),
    );

    expect(firstLine(text)).toContain("No results returned");
    expect(text).toContain("Searched: code");
    expect(text).toContain("Do not repeat this search unchanged.");
    expect(text).toContain("shorten or broaden query");
    expect(text).toContain("remove restrictive filters");
    expect(text).toContain('source="symbol"');
    expect(text).toContain("code_grep");
    expect(text).not.toContain('query="');
    expect(text.match(/Do not repeat this search unchanged\./g)).toHaveLength(
      1,
    );
  });

  it("renders symbol source readiness as code", () => {
    const text = renderUnifiedSearchSuccess(
      completed([], {
        query: { raw: "router", sources: ["symbol"] },
        sourceStatus: [
          source({
            source: "symbol",
            codeIndexState: "CURRENT",
            resultCount: 0,
          }),
        ],
      }),
    );

    expect(text).toContain("Searched: code");
    expect(text).not.toContain("repository docs");
  });

  it.each(["docs", "auto"] as const)(
    "uses a neutral docs label for contributor-less %s sources",
    (sourceName) => {
      const text = renderUnifiedSearchSuccess(
        completed([], {
          sourceStatus: [source({ source: sourceName, resultCount: 0 })],
        }),
      );

      expect(text).toContain("Searched: docs (npm:express@4.18.2)");
      expect(text).not.toContain("repository docs");
    },
  );

  it("renders the supplied n8n active empty snapshot with one concise readiness block", () => {
    const text = renderUnifiedSearchSuccess(n8nActiveEmpty());
    const lines = text.split("\n");

    expect(lines[0]).toBe("Indexing npm:n8n@2.36.7 - no results returned yet");
    expect(text).toContain("Ready: 0/1 targets");
    expect(text).toContain("Waiting: code, repository docs");
    expect(text).toContain(
      "Available but not searched: n8n.io docs (1,480 pages; capped)",
    );
    expect(text).toContain(
      "Indexed alternatives: versions 2.26.9, 2.26.5, 2.23.2 +2 more; refs HEAD,\nmaster",
    );
    expect(text).toContain(
      'Next: search_status search_ref="fabUr1S3MEVeSgD93pMoSQ" wait_timeout_ms=20000',
    );
    expect(text).toContain("Do not repeat search.\nNext:");
    expect(text).not.toContain("indexingRef");
    expect(text).not.toContain("freshnessReason");
    expect(text).not.toContain("Opaque evidence notice");
    expect(text.match(/Indexing/g)).toHaveLength(1);
    expect(text.match(/Ready:/g)).toHaveLength(1);
    expect(text.match(/Next:/g)).toHaveLength(1);
  });

  it("omits a singular target for multiple active progress targets", () => {
    const text = renderUnifiedSearchSuccess(
      incomplete({
        progress: {
          status: "INDEXING",
          targetsReady: 0,
          targetsTotal: 2,
          elapsedMs: 100,
          targets: [
            { requested: "npm:one@1.0.0", freshness: "INDEXING" },
            { requested: "npm:two@2.0.0", freshness: "INDEXING" },
          ],
        },
      }),
    );

    expect(firstLine(text)).toBe("Indexing - no result snapshot returned yet");
    expect(text).toContain("Ready: 0/2 targets");
  });

  it("does not invent source details for a true progress-only response", () => {
    const text = renderUnifiedSearchSuccess(
      incomplete({
        progress: {
          status: "INDEXING",
          targetsReady: 0,
          targetsTotal: 1,
          elapsedMs: 100,
          targets: [
            {
              requested: "npm:n8n",
              resolvedRequested: "npm:n8n@2.36.7",
              freshness: "INDEXING",
              availableVersions: [{ version: "2.26.9", ref: "v2.26.9" }],
            },
          ],
        },
      }),
    );

    expect(firstLine(text)).toBe(
      "Indexing npm:n8n@2.36.7 - no result snapshot returned yet",
    );
    expect(text).toContain("Ready: 0/1 targets");
    expect(text).not.toContain("Waiting:");
    expect(text).not.toContain("Available but not searched:");
    expect(text).not.toContain("n8n.io");
    expect(text).toContain("Indexed alternatives: versions 2.26.9");
    expect(text).toContain("Do not repeat search.\nNext:");
  });

  it("renders an initial progress-only parser warning once below the outcome", () => {
    const text = renderUnifiedSearchSuccess(
      incomplete({
        query: { raw: "router", warnings: ["unknown qualifier"] },
      }),
    );

    expect(firstLine(text)).toBe("Indexing - no result snapshot returned yet");
    expect(text).toContain("Warnings:\n  - unknown qualifier");
    expect(text.match(/unknown qualifier/g)).toHaveLength(1);
    expect(text.indexOf("Warnings:")).toBeGreaterThan(0);
  });

  it("uses the scoped site URL before the site key for searched and available docs", () => {
    const text = renderUnifiedSearchSuccess(
      completed([], {
        sourceStatus: [
          source({
            source: "docs",
            targetLabel: "npm:example@1.0.0",
            contributors: [
              {
                kind: "DOCPACK",
                state: "SEARCHED",
                resultCount: 0,
                siteKey: "example.com",
                siteUrl: "https://example.com/reference",
              },
              {
                kind: "DOCPACK",
                state: "READY",
                resultCount: 0,
                siteKey: "example.com",
                siteUrl: "https://example.com/guide",
              },
            ],
          }),
        ],
      }),
    );

    expect(text).toContain("Searched: site docs (example.com/reference)");
    expect(text).toContain(
      "Available but not searched: example.com/guide docs",
    );
    expect(text).not.toContain("for npm:example@1.0.0");
  });

  it("renders site suggestions once without selecting them during active polling", () => {
    const sourceStatus = [
      source({
        source: "docs",
        targetLabel: "site:example.com",
        suggestedSiteTargets: ["site:docs.example.com", "site:api.example.com"],
        suggestedSiteTargetsTruncated: true,
      }),
    ];
    const text = renderUnifiedSearchSuccess(
      incomplete({ partialResults: false, sourceStatus }),
    );

    expect(text).toContain(
      "Suggested site targets: site:docs.example.com, site:api.example.com",
    );
    expect(text).toContain("Additional site targets were omitted.");
    expect(text).toContain("Do not repeat search.\nNext: search_status");
    expect(text).not.toContain("Next: retry one suggested site target");
    expect(text.match(/Suggested site targets:/g)).toHaveLength(1);
    expect(text.match(/Additional site targets were omitted\./g)).toHaveLength(
      1,
    );
  });

  it("does not suffix deduplicated site suggestions with a target", () => {
    const sourceStatus = [
      source({
        source: "docs",
        targetLabel: "site:example.com",
        suggestedSiteTargets: ["site:docs.example.com"],
      }),
      source({
        source: "docs",
        targetLabel: "site:example.com",
        suggestedSiteTargets: ["site:docs.example.com"],
      }),
    ];
    const text = renderUnifiedSearchSuccess(
      incomplete({ partialResults: false, sourceStatus }),
    );

    expect(text).toContain("Suggested site targets: site:docs.example.com");
    expect(text).not.toContain("Suggested site targets for site:example.com:");
  });

  it("renders site retry guidance for completed and terminal site recovery", () => {
    const sourceStatus = [
      source({
        source: "docs",
        targetLabel: "site:example.com",
        suggestedSiteTargets: ["site:docs.example.com"],
        suggestedSiteTargetsTruncated: false,
      }),
    ];
    const completedText = renderUnifiedSearchSuccess(
      completed([], { sourceStatus }),
    );
    expect(completedText).toContain(
      "Suggested site targets: site:docs.example.com",
    );
    expect(completedText).toContain(
      "Next: retry one suggested site target explicitly.",
    );
    expect(completedText).not.toContain("search_status");

    const terminalText = renderUnifiedSearchSuccess(
      incomplete({
        partialResults: false,
        sourceStatus,
        progress: {
          status: "DEFERRED",
          targetsReady: 0,
          targetsTotal: 1,
          elapsedMs: 60_000,
        },
      }),
    );
    expect(terminalText).toContain(
      "Suggested site targets: site:docs.example.com",
    );
    expect(terminalText).toContain(
      "Next: retry one suggested site target explicitly.",
    );
    expect(terminalText).toContain(
      "Do not call search_status again for this session.",
    );
    expect(terminalText).not.toContain("Next: search_status");
  });

  it("disambiguates multi-target readiness and preserves docs provenance", () => {
    const text = renderUnifiedSearchSuccess(
      completed([], {
        sourceStatus: [
          source({
            source: "code",
            targetLabel: "npm:one@1.0.0",
            codeIndexState: "INDEXING",
          }),
          source({
            source: "code",
            targetLabel: "npm:two@2.0.0",
            codeIndexState: "INDEXING",
          }),
          source({
            source: "docs",
            targetLabel: "npm:one@1.0.0",
            contributors: [
              {
                kind: "REPOSITORY_DOCS",
                state: "SEARCHED",
                resultCount: 1,
                repositoryUrl: "https://github.com/one/repo",
                commitSha: "commit-one",
              },
              {
                kind: "DOCPACK",
                state: "SEARCHED",
                resultCount: 1,
                siteKey: "docs.one.example",
              },
            ],
          }),
          source({
            source: "docs",
            targetLabel: "npm:two@2.0.0",
            contributors: [
              {
                kind: "REPOSITORY_DOCS",
                state: "SEARCHED",
                resultCount: 1,
                repositoryUrl: "https://github.com/two/repo",
                commitSha: "commit-two",
              },
              {
                kind: "DOCPACK",
                state: "SEARCHED",
                resultCount: 1,
                siteKey: "docs.two.example",
              },
            ],
          }),
        ],
      }),
    );

    expect(firstLine(text)).toBe("No results returned");
    expect(text).toContain(
      "Waiting: code for npm:one@1.0.0, code for npm:two@2.0.0",
    );
    expect(text).toMatch(
      /repository docs \(https:\/\/github\.com\/one\/repo @ commit-one\) for\nnpm:one@1\.0\.0/,
    );
    expect(text).toMatch(
      /repository docs \(https:\/\/github\.com\/two\/repo @ commit-two\)\nfor npm:two@2\.0\.0/,
    );
    expect(text).toMatch(
      /site docs \(docs\.one\.example\) for npm:one@1\.0\.0/,
    );
    expect(text).toMatch(
      /site docs\n\(docs\.two\.example\) for npm:two@2\.0\.0/,
    );
  });

  it("does not repeat a standalone site target in its readiness identity", () => {
    const text = renderUnifiedSearchSuccess(
      completed([], {
        sourceStatus: [
          source({
            source: "code",
            targetLabel: "npm:one@1.0.0",
            codeIndexState: "INDEXING",
          }),
          source({
            source: "docs",
            targetLabel: "site:docs.one.example",
            targetResolution: {
              requested: { site: "site:docs.one.example" },
              served: { site: "site:docs.one.example" },
              freshness: "current",
              availableVersions: [],
              availableRefs: [],
            },
          }),
        ],
      }),
    );

    expect(text).toContain("Waiting: code for npm:one@1.0.0");
    expect(text).toContain("Searched: site docs (site:docs.one.example)");
    expect(text).not.toContain("site docs (site:docs.one.example) for site:");
  });

  it("does not repeat exact identities for unavailable code or available sites", () => {
    const text = renderUnifiedSearchSuccess(
      completed([], {
        sourceStatus: [
          source({
            targetLabel: "npm:one@1.0.0",
            codeIndexState: "MISSING",
          }),
          source({
            targetLabel: "npm:two@2.0.0",
            codeIndexState: "CURRENT",
          }),
          source({
            source: "docs",
            targetLabel: "site:docs.one.example",
            contributors: [
              {
                kind: "DOCPACK",
                state: "READY",
                resultCount: 0,
                siteKey: "site:docs.one.example",
              },
            ],
          }),
        ],
      }),
    );

    expect(text).toContain("Unavailable: code (npm:one@1.0.0)");
    expect(text).not.toContain(
      "Unavailable: code (npm:one@1.0.0) for npm:one@1.0.0",
    );
    expect(text).toContain("Searched: code for npm:two@2.0.0");
    expect(text).toContain(
      "Available but not searched: site:docs.one.example docs",
    );
    expect(text).not.toMatch(
      /Available but not searched: site:docs\.one\.example docs for\s+site:docs\.one\.example/,
    );
  });

  it("omits a singular outcome target when hits span multiple targets", () => {
    const text = renderUnifiedSearchSuccess(
      completed([
        codeHit({ target: "npm:one@1.0.0" }),
        codeHit({ target: "npm:two@2.0.0" }),
      ]),
    );

    expect(firstLine(text)).toBe("2 results");
    expect(firstLine(text)).not.toContain(" from ");
  });

  it.each([
    ["PENDING", "Preparing"],
    ["INDEXING", "Indexing"],
    ["SEARCHING", "Searching"],
  ] as const)(
    "keeps %s lifecycle distinct without a snapshot",
    (status, label) => {
      const text = renderUnifiedSearchSuccess(
        incomplete({
          progress: {
            status,
            targetsReady: 0,
            targetsTotal: 1,
            elapsedMs: 20,
          },
        }),
      );
      expect(firstLine(text)).toStartWith(label);
      expect(firstLine(text)).toContain("no result snapshot returned yet");
      expect(firstLine(text)).not.toContain("No results returned yet");
    },
  );

  it.each([
    [false, "interim"],
    [true, "partial"],
  ] as const)(
    "distinguishes atomic interim from %s results",
    (partial, label) => {
      const text = renderUnifiedSearchSuccess(
        incomplete({
          partialResults: partial,
          results: [codeHit()],
          progress: {
            status: "INDEXING",
            targetsReady: 1,
            targetsTotal: 1,
            elapsedMs: 20,
          },
        }),
      );
      expect(firstLine(text)).toContain(`1 ${label} result`);
      expect(firstLine(text)).not.toContain("final");
    },
  );

  it.each(["DEFERRED", "TIMEOUT", "FAILED"] as const)(
    "renders terminal %s exactly once and never polls",
    (status) => {
      const text = renderUnifiedSearchSuccess(
        incomplete({
          progress: {
            status,
            targetsReady: 0,
            targetsTotal: 1,
            elapsedMs: 60_000,
          },
        }),
      );
      expect(firstLine(text)).toStartWith(status);
      expect(text).toContain(
        "Do not call search_status again for this session.",
      );
      expect(text).not.toContain("Next: search_status");
    },
  );

  it("keeps an unknown lifecycle raw and conservative", () => {
    const text = renderUnifiedSearchSuccess(
      incomplete({
        progress: {
          status: "FUTURE_SESSION_STATE",
          targetsReady: 1,
          targetsTotal: 2,
          elapsedMs: 60_000,
        },
      }),
    );
    expect(firstLine(text)).toBe(
      "FUTURE_SESSION_STATE - no result snapshot returned",
    );
    expect(text).toContain("Do not call search_status again for this session.");
    expect(text).not.toContain("Next: search_status");
    expect(text).not.toContain("indexing");
  });

  it("renders stale and provisional evidence as trust limits without raw diagnostics", () => {
    const text = renderUnifiedSearchSuccess(
      completed([], {
        sourceStatus: [
          source({
            targetLabel: "npm:express@5.2.1",
            requestedTarget: "npm:express latest",
            freshTarget: "npm:express@5.2.1",
            servedTarget: "npm:express@5.1.0",
            codeIndexState: "PROVISIONAL",
            targetResolution: {
              freshness: "fallback_recent",
              freshnessReason: "exact_provisional",
              indexingRef: "idx-hidden",
              availableVersions: [],
              availableRefs: [],
            },
          }),
        ],
      }),
    );
    expect(text).toContain("Evidence:");
    expect(text).toContain("older snapshot");
    expect(text).toContain("provisional");
    expect(text).not.toContain("idx-hidden");
    expect(text).not.toContain("exact_provisional");
    expect(text).not.toContain("shorten or broaden query");
  });

  it("deduplicates stale evidence for the same served target", () => {
    const text = renderUnifiedSearchSuccess(
      completed(
        [
          codeHit({
            target: "npm:express@5.1.0",
            requestedTarget: "npm:express latest",
            freshTarget: "npm:express@5.2.1",
            servedTarget: "npm:express@5.1.0",
            freshness: "STALE",
          }),
        ],
        {
          sourceStatus: [
            source({
              targetLabel: "npm:express@5.1.0",
              requestedTarget: "npm:express latest",
              freshTarget: "npm:express@5.2.1",
              servedTarget: "npm:express@5.1.0",
              codeIndexState: "STALE",
            }),
          ],
        },
      ),
    );

    expect(firstLine(text)).toBe("1 result from npm:express@5.1.0");
    expect(text.match(/Evidence:/g)).toHaveLength(1);
    expect(text).toContain(
      "requested npm:express latest; served older snapshot npm:express@5.1.0 while npm:express@5.2.1 indexes.",
    );
  });

  it("treats indexing hit freshness as stale served evidence", () => {
    const text = renderUnifiedSearchSuccess(
      completed([
        codeHit({
          target: "npm:express@5.1.0",
          requestedTarget: "npm:express latest",
          freshTarget: "npm:express@5.2.1",
          servedTarget: "npm:express@5.1.0",
          freshness: "INDEXING",
        }),
      ]),
    );

    expect(firstLine(text)).toBe("1 result from npm:express@5.1.0");
    expect(text.match(/Evidence:/g)).toHaveLength(1);
    expect(text).toContain(
      "requested npm:express latest; served older snapshot npm:express@5.1.0 while npm:express@5.2.1 indexes.",
    );
  });

  it("uses the searched package context for a lone docpack outcome", () => {
    const text = renderUnifiedSearchSuccess(
      completed([], {
        sourceStatus: [
          source({
            source: "docs",
            targetLabel: "npm:express@5.2.1",
            contributors: [
              {
                kind: "DOCPACK",
                state: "SEARCHED",
                resultCount: 0,
                siteKey: "expressjs.com",
                siteUrl: "https://expressjs.com/docs",
              },
            ],
          }),
        ],
      }),
    );

    expect(firstLine(text)).toBe("No results returned from npm:express@5.2.1");
  });

  it.each([
    [
      "github:expressjs/express#main",
      "github:expressjs/express#main",
      "npm:express@5.2.1",
      "npm:express@5.1.0",
    ],
    [
      "npm:express@5.2.1",
      "npm:express latest",
      "npm:express@5.2.1",
      "npm:express@5.1.0",
    ],
  ] as const)(
    "uses the served package for a requested %s source",
    (targetLabel, requestedTarget, freshTarget, servedTarget) => {
      const text = renderUnifiedSearchSuccess(
        completed([], {
          sourceStatus: [
            source({
              targetLabel,
              requestedTarget,
              freshTarget,
              servedTarget,
              codeIndexState: "INDEXING",
            }),
          ],
        }),
      );

      expect(firstLine(text)).toBe(
        "No results returned from npm:express@5.1.0",
      );
      expect(firstLine(text)).not.toContain(targetLabel);
      expect(firstLine(text)).not.toContain(freshTarget);
    },
  );

  it("turns an evidence notice into one concise mutable-evidence action", () => {
    const text = renderUnifiedSearchSuccess(
      completed([], {
        searchRef: "search-ref-evidence",
        evidenceNotice: "Opaque backend prose must not be copied.",
      }),
    );
    expect(firstLine(text)).toBe("No results returned");
    expect(text).toContain("Evidence may change.");
    expect(text).toContain("Do not repeat immediately.\nNext:");
    expect(text).toContain(
      'Next: search_status search_ref="search-ref-evidence" wait_timeout_ms=20000',
    );
    expect(text).not.toContain("Opaque backend prose");
    expect(text).not.toContain("Do not repeat this search unchanged.");
  });

  it("continues completed mutable evidence with hits through the exact reference", () => {
    const text = renderUnifiedSearchSuccess(
      completed([codeHit()], {
        searchRef: "search-ref-results",
        evidenceNotice: "Opaque backend prose must not be copied.",
      }),
    );
    expect(firstLine(text)).toContain("1 result");
    expect(text).toContain("Evidence may change.");
    expect(text).toContain("Do not repeat immediately.\nNext:");
    expect(text).toContain(
      'Next: search_status search_ref="search-ref-results" wait_timeout_ms=20000',
    );
    const lines = text.split("\n");
    const actionLine = lines.indexOf("Do not repeat immediately.");
    expect(actionLine).toBeGreaterThan(0);
    expect(lines[actionLine - 1]).toBe("");
  });

  it("prints query and structured constraint warnings once below the outcome", () => {
    const text = renderUnifiedSearchSuccess(
      completed([], {
        query: {
          raw: "router kind:function",
          warnings: ["kind was ignored by the selected source"],
        },
        warnings: ["duplicated promoted warning must not render"],
        sourceStatus: [
          source({
            incompatibleQueryFeatures: ["kind"],
            ignoredFilters: ["category"],
          }),
        ],
      }),
    );
    expect(firstLine(text)).toContain("No results returned");
    expect(text).toContain("Warnings:");
    expect(text).toContain("kind was ignored by the selected source");
    expect(text).toContain("Incompatible query feature");
    expect(text).toContain("Ignored filter");
    expect(text).not.toContain("duplicated promoted warning");
    expect(text.match(/Warnings:/g)).toHaveLength(1);
  });

  it("uses only the standalone-site query pivot", () => {
    const text = renderUnifiedSearchSuccess(
      completed([], {
        query: { raw: "middleware", sources: ["docs"] },
        sourceStatus: [
          source({
            source: "docs",
            targetLabel: "site:expressjs.com",
            targetResolution: {
              requested: { site: "site:expressjs.com" },
              served: { site: "site:expressjs.com" },
              freshness: "current",
              availableVersions: [],
              availableRefs: [],
            },
          }),
        ],
      }),
    );
    expect(text).toContain("shorten or broaden site query");
    expect(text).not.toContain('source="symbol"');
    expect(text).not.toContain("code_grep");
  });

  it("prefers an indexed alternative while indexing instead of query rewrites", () => {
    const text = renderUnifiedSearchSuccess(
      completed([], {
        sourceStatus: [
          source({
            targetLabel: "npm:express@5.2.1",
            indexingStatus: "INDEXING",
            targetResolution: {
              freshness: "indexing",
              availableVersions: [{ version: "5.1.0", ref: "v5.1.0" }],
              availableRefs: [],
            },
          }),
        ],
      }),
    );
    expect(text).toContain("Next: search indexed version 5.1.0");
    expect(text).not.toContain("shorten or broaden query");
    expect(text).not.toContain("code_grep");
  });

  it("only includes applicable filter and symbol/code_grep pivots", () => {
    const filtered = renderUnifiedSearchSuccess(
      completed([], {
        query: { raw: "router", filters: { kind: "function" } },
      }),
    );
    expect(filtered).toContain("remove restrictive filters");
    expect(filtered).toContain('source="symbol"');
    expect(filtered).toContain("code_grep");

    const symbol = renderUnifiedSearchSuccess(
      completed([], { query: { raw: "Router", sources: ["symbol"] } }),
    );
    expect(symbol).not.toContain('source="symbol"');
    expect(symbol).toContain("code_grep");
  });

  it("bounds alternatives and preserves pagination and result ordering", () => {
    const text = renderUnifiedSearchSuccess(
      completed([codeHit(), docsHit()], {
        hasMore: true,
        nextOffset: 10,
        sourceStatus: [
          source({
            targetLabel: "npm:express",
            targetResolution: {
              availableVersions: [
                { version: "5.2.1", ref: "v5.2.1" },
                { version: "5.2.0", ref: "v5.2.0" },
                { version: "5.1.0", ref: "v5.1.0" },
                { version: "5.0.0", ref: "v5.0.0" },
              ],
              availableRefs: [
                { ref: "HEAD" },
                { ref: "main" },
                { ref: "next" },
                { ref: "dev" },
              ],
            },
          }),
        ],
      }),
    );
    expect(text).toContain("[1] cline/cline@v3.4.2");
    expect(text).toContain("[2] aider/edit-formats aider-AI/aider");
    expect(text).toContain(
      "Indexed alternatives: versions 5.2.1, 5.2.0, 5.1.0 +1 more; refs HEAD, main,\nnext +1 more",
    );
    expect(text).toContain("More hits available. Pass offset=10");
    expect(text).not.toContain("v5.0.0");
    expect(text).not.toContain("dev");
  });

  it("uses the presentation pagination flag as the rendering authority", () => {
    const payload = completed([], { hasMore: true, nextOffset: 10 });
    const presentation = projectUnifiedSearchPresentation(payload);
    const text = renderUnifiedSearchPresentationText(presentation, {
      results: payload.results,
      nextOffset: payload.nextOffset,
    });

    expect(presentation.hasMore).toBe(true);
    expect(text).toContain("More hits available. Pass offset=10");
  });

  it("wraps bounded summaries without splitting exact tokens", () => {
    const targetOne = "npm:one-long-package@1.0.0";
    const targetTwo = "npm:two-long-package@2.0.0";
    const suggestions = [
      "site:docs.example.com/guide/one",
      "site:docs.example.com/guide/two",
      "site:docs.example.com/guide/three",
    ];
    const longRef = `refs/${"x".repeat(90)}`;
    const text = renderUnifiedSearchSuccess(
      completed([], {
        sourceStatus: [
          source({
            targetLabel: targetOne,
            codeIndexState: "INDEXING",
            targetResolution: {
              availableVersions: [{ version: "1.0.0", ref: "v1.0.0" }],
              availableRefs: [{ ref: longRef }],
            },
          }),
          source({
            targetLabel: targetTwo,
            codeIndexState: "INDEXING",
            targetResolution: {
              availableVersions: [{ version: "2.0.0", ref: "v2.0.0" }],
              availableRefs: [{ ref: "main" }],
            },
          }),
          source({
            source: "docs",
            targetLabel: "site:docs.example.com",
            suggestedSiteTargets: suggestions,
            suggestedSiteTargetsTruncated: true,
          }),
        ],
      }),
    );

    const lines = text.split("\n");
    const summaryLines = lines.filter((line) =>
      /^(Waiting|Searched|Indexed alternatives|Suggested site targets)/.test(
        line,
      ),
    );
    expect(summaryLines.length).toBeGreaterThan(3);
    expect(summaryLines.every((line) => line.length <= 76)).toBe(true);
    expect(text).toContain(targetOne);
    expect(text).toContain(targetTwo);
    expect(text).toContain(longRef);
    expect(text).toContain("Additional site targets were omitted.");

    const overlongLines = lines.filter((line) => line.length > 76);
    expect(overlongLines).toHaveLength(1);
    expect(overlongLines[0]).toContain(longRef);
  });

  it("shows capped searched coverage without repeating the trust limit", () => {
    const text = renderUnifiedSearchSuccess(
      completed([], {
        sourceStatus: [
          source({
            source: "docs",
            targetLabel: "site:docs.example.com",
            contributors: [
              {
                kind: "DOCPACK",
                state: "SEARCHED",
                freshness: "CURRENT",
                resultCount: 0,
                siteKey: "docs.example.com",
                siteUrl: "https://docs.example.com",
                coverage: {
                  coverageState: "PARTIAL",
                  pagesCrawled: 120,
                },
              },
            ],
          }),
        ],
      }),
    );
    expect(text).toContain(
      "Searched: site docs (docs.example.com; 120 pages; partial)",
    );
    expect(text.match(/120 pages/g)).toHaveLength(1);
  });

  it("retains ASCII output and wraps long summaries", () => {
    const text = renderUnifiedSearchSuccess(
      completed([
        codeHit({
          summary:
            "This summary is intentionally long enough to force wrapping across multiple lines without using a non-ASCII separator.",
        }),
      ]),
    );
    expect(text).not.toMatch(/[·…—–]/);
    for (const line of text.split("\n")) {
      if (!line.includes("code_read "))
        expect(line.length).toBeLessThanOrEqual(82);
    }
  });
});

describe("renderUnifiedSearchError", () => {
  it("renders an error without changing the envelope contract", () => {
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
    expect(renderUnifiedSearchError(error)).toBe(
      "search | ERROR | code=INVALID_ARGUMENT\nBad request.",
    );
  });

  it("serialises object detail values via JSON", () => {
    const error: UnifiedSearchErrorPayload = {
      error: "Indexing.",
      code: "INDEXING",
      details: {
        availableVersions: [{ version: "4.21.0", ref: "v4.21.0" }],
      },
    };
    expect(renderUnifiedSearchError(error)).toContain('"version":"4.21.0"');
  });
});
