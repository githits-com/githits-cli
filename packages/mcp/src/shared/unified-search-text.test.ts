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

const ANSI_SGR_PATTERN = new RegExp(
  `${String.fromCharCode(0x1b)}\\[[0-9;]*m`,
  "g",
);

describe("renderUnifiedSearchSuccess", () => {
  it("renders completed Express results as compact ranked source-backed hits", () => {
    const repoSummary =
      "5.0.0-alpha.4 / 2017-03-01\n" +
      "==========================\n" +
      "  * remove:\n" +
      "    - Remove Express 3.x middleware error stubs\n" +
      "  * deps: router@~1.3.0\n" +
      '    - Add `next("router")` to exit from router';
    const results: UnifiedSearchHitPayload[] = [
      ...Array.from({ length: 5 }, (_, index) =>
        index === 0
          ? {
              type: "repository_doc",
              target: "npm:express@5.2.1",
              title: "5.0.0-alpha.4 / 2017-03-01",
              summary: repoSummary,
              locator: {
                registry: "npm",
                packageName: "express",
                version: "5.2.1",
                filePath: "History.md",
                startLine: 169,
                endLine: 179,
              },
            }
          : {
              type: "repository_doc",
              target: "npm:express@5.2.1",
              title: `History entry ${index}`,
              summary: `History entry ${index} details`,
              locator: {
                filePath: "History.md",
                startLine: 180 + index,
                endLine: 185 + index,
              },
            },
      ),
      ...Array.from({ length: 5 }, (_, index) => ({
        type: "documentation_page",
        target: "npm:express@5.2.1",
        title: index === 0 ? "router.use()" : `Router docs ${index}`,
        summary:
          index === 0 ? "### router.use()" : `Router docs ${index} details`,
        locator: {
          pageId: `opaque-page-${index}`,
          sourceUrl: `https://expressjs.com/en/api/router/${index}`,
        },
      })),
    ];
    const text = renderUnifiedSearchSuccess(
      completed(results, {
        hasMore: true,
        nextOffset: 10,
        sourceStatus: [
          source({
            source: "docs",
            targetLabel: "npm:express@5.2.1",
            contributors: [
              {
                kind: "DOCPACK",
                state: "SEARCHED",
                resultCount: 5,
                siteKey: "expressjs.com",
                siteUrl: "https://expressjs.com",
              },
              {
                kind: "REPOSITORY_DOCS",
                state: "SEARCHED",
                resultCount: 5,
                repositoryUrl: "https://github.com/expressjs/express",
                commitSha: "dbac741a49a5a64336b70c06e85c2e2706e36336",
              },
            ],
          }),
        ],
      }),
    );

    expect(text.split("\n")[0]).toBe(
      "10 results | 5 repo docs, 5 docs pages | next_offset=10",
    );
    expect(text).toContain(
      "Sources: npm:express@5.2.1 - site:expressjs.com,\n  github:expressjs/express#dbac741a",
    );
    expect(text).toContain(
      "[1] npm:express@5.2.1 History.md:169-179 [repo doc] - 5.0.0-alpha.4 / 2017-03-01",
    );
    expect(text).toContain(
      "[6] opaque-page-0 [docs page] npm:express - expressjs.com/en/api/router/0 -\n  router.use()",
    );
    expect(text).toContain("    * remove:");
    expect(text).toContain("      - Remove Express 3.x middleware error stubs");
    expect(text).not.toContain("githits docs read");
    expect(text).not.toContain("docs_read");
    expect(text).toContain("opaque-page-0 [docs page]");
    expect(text).not.toContain("### router.use()");
    expect(text.match(/next_offset=10/g)).toHaveLength(1);
    expect(text.length).toBeLessThan(3459);
  });

  it("keeps contributor-less documentation in detailed target state", () => {
    const text = renderUnifiedSearchSuccess(
      completed([docsHit({ target: "npm:express@5.2.1" })], {
        sourceStatus: [
          source({
            source: "docs",
            targetLabel: "npm:express@5.2.1",
            resultCount: 1,
          }),
        ],
      }),
    );

    expect(text).toContain("- npm:express@5.2.1\n  searched: docs");
    expect(text).not.toContain("Sources:");
  });

  it("does not repeat a standalone site identity in compact output", () => {
    const text = renderUnifiedSearchSuccess(
      completed([docsHit({ target: "site:hono.dev" })], {
        sourceStatus: [
          source({
            source: "docs",
            targetLabel: "site:hono.dev",
            contributors: [
              {
                kind: "DOCPACK",
                state: "SEARCHED",
                resultCount: 1,
                siteUrl: "https://hono.dev",
              },
            ],
          }),
        ],
      }),
    );

    expect(text).toContain("Sources: site:hono.dev");
    expect(text).not.toContain("site:hono.dev - site:hono.dev");
  });

  it("uses the sole pinned repository source instead of its unpinned target", () => {
    const text = renderUnifiedSearchSuccess(
      completed([docsHit({ target: "github:axios/axios" })], {
        sourceStatus: [
          source({
            source: "docs",
            targetLabel: "github:axios/axios",
            contributors: [
              {
                kind: "REPOSITORY_DOCS",
                state: "SEARCHED",
                resultCount: 1,
                repositoryUrl: "https://github.com/axios/axios",
                commitSha: "fede1d1500000000000000000000000000000000",
              },
            ],
          }),
        ],
      }),
    );

    expect(text).toContain("Sources: github:axios/axios#fede1d15");
    expect(text).not.toContain(
      "github:axios/axios - github:axios/axios#fede1d15",
    );
  });

  it("keeps a pinned repository target beside its resolved commit", () => {
    const text = renderUnifiedSearchSuccess(
      completed([docsHit({ target: "github:axios/axios#v1.7.9" })], {
        sourceStatus: [
          source({
            source: "docs",
            targetLabel: "github:axios/axios#v1.7.9",
            contributors: [
              {
                kind: "REPOSITORY_DOCS",
                state: "SEARCHED",
                resultCount: 1,
                repositoryUrl: "https://github.com/axios/axios",
                commitSha: "b2cb45d500000000000000000000000000000000",
              },
            ],
          }),
        ],
      }),
    );

    expect(text).toContain(
      "Sources: github:axios/axios#v1.7.9 - github:axios/axios#b2cb45d5",
    );
  });

  it("keeps repository docs without a commit in detailed target state", () => {
    const text = renderUnifiedSearchSuccess(
      completed([docsHit({ target: "github:axios/axios#main" })], {
        sourceStatus: [
          source({
            source: "docs",
            targetLabel: "github:axios/axios#main",
            contributors: [
              {
                kind: "REPOSITORY_DOCS",
                state: "SEARCHED",
                resultCount: 1,
                repositoryUrl: "https://github.com/axios/axios",
              },
            ],
          }),
        ],
      }),
    );

    expect(text).toContain(
      "- github:axios/axios#main\n  searched: repository docs",
    );
    expect(text).not.toContain("Sources:");
  });

  it("keeps concrete provenance grouped with each healthy target", () => {
    const text = renderUnifiedSearchSuccess(
      completed(
        [
          docsHit({ target: "npm:one@1.0.0" }),
          docsHit({ target: "npm:two@2.0.0" }),
        ],
        {
          sourceStatus: [
            source({
              source: "docs",
              targetLabel: "npm:one@1.0.0",
              contributors: [
                {
                  kind: "DOCPACK",
                  state: "SEARCHED",
                  resultCount: 1,
                  siteUrl: "https://docs.one.example",
                },
              ],
            }),
            source({
              source: "docs",
              targetLabel: "npm:two@2.0.0",
              contributors: [
                {
                  kind: "DOCPACK",
                  state: "SEARCHED",
                  resultCount: 1,
                  siteUrl: "https://docs.two.example",
                },
              ],
            }),
          ],
        },
      ),
      { width: 160 },
    );

    expect(text).toContain(
      "Sources: npm:one@1.0.0 - site:docs.one.example; npm:two@2.0.0 - site:docs.two.example",
    );
    expect(text).not.toContain("\n- npm:one@1.0.0");
    expect(text).not.toContain("\n- npm:two@2.0.0");
  });

  it("starts completed hits with the outcome and preserves hit anatomy", () => {
    const text = renderUnifiedSearchSuccess(completed([codeHit()]));

    expect(firstLine(text)).toContain("1 result");
    expect(firstLine(text)).not.toContain("search |");
    expect(text).toContain(
      "[1] cline/cline@v3.4.2 src/integrations/diff/strategies/multi-search-replace.ts:142-156 [repo code] -\n  applyEdit",
    );
    expect(text).toContain(
      "  Search/replace block parser with fuzzy fallback when exact match fails.",
    );
    expect(text).not.toContain("searchRef=");
  });

  it("does not append a separator when progress is not rendered after hits", () => {
    const payload = completed([codeHit()]);
    const presentation = projectUnifiedSearchPresentation(payload);
    const text = renderUnifiedSearchPresentationText(
      {
        ...presentation,
        progress: { targetsReady: 1, targetsTotal: 1, elapsedMs: 20 },
      },
      { results: payload.results },
    );

    expect(text).toBe(
      "1 result | 1 repo code hit\n\n" +
        "[1] cline/cline@v3.4.2 src/integrations/diff/strategies/multi-search-replace.ts:142-156 [repo code] -\n" +
        "  applyEdit\n" +
        "  Search/replace block parser with fuzzy fallback when exact match fails.",
    );
    expect(text.endsWith("\n")).toBe(false);
  });

  it("uses singular labels for one repository doc and one docs page", () => {
    const repoText = renderUnifiedSearchSuccess(
      completed([
        {
          type: "repository_doc",
          target: "npm:express@5.2.1",
          title: "History.md",
          summary: "Release history",
          locator: { filePath: "History.md", startLine: 169, endLine: 179 },
        },
      ]),
    );
    const docsText = renderUnifiedSearchSuccess(completed([docsHit()]));

    expect(firstLine(repoText)).toBe("1 result | 1 repo doc");
    expect(firstLine(docsText)).toBe("1 result | 1 docs page");
    expect(firstLine(renderUnifiedSearchSuccess(completed([codeHit()])))).toBe(
      "1 result | 1 repo code hit",
    );
    expect(
      firstLine(
        renderUnifiedSearchSuccess(
          completed([codeHit({ type: "repository_symbol" })]),
        ),
      ),
    ).toBe("1 result | 1 repo symbol");
  });

  it("uses ASCII separators without changing Unicode payload text", () => {
    const text = renderUnifiedSearchSuccess(
      completed([
        codeHit({
          title: "Überprüfung · human review",
          summary: "Café — маршрутизация",
        }),
        {
          type: "repository_doc",
          target: "npm:express@5.2.1",
          title: "Résumé",
          summary: "naïve release notes",
          locator: { filePath: "History.md", startLine: 1 },
        },
        docsHit({
          title: "Документация | API - section",
          summary: "Café — маршрутизация",
        }),
      ]),
    );

    expect(text).toContain(
      "[1] cline/cline@v3.4.2 src/integrations/diff/strategies/multi-search-replace.ts:142-156 [repo code] -\n  Überprüfung · human review",
    );
    expect(text).toContain(
      "[2] npm:express@5.2.1 History.md:1 [repo doc] - Résumé",
    );
    expect(text).toContain(
      "[3] aider/edit-formats [docs page] aider-AI/aider - aider.chat/docs/more/edit-formats.html -\n  Документация | API - section",
    );
    expect(text).toContain("Café — маршрутизация");
    expect(text).toContain("Résumé");
  });

  it("keeps documentation targets compact unless multiple targets need attribution", () => {
    const single = renderUnifiedSearchSuccess(completed([docsHit()]));
    expect(single).toContain(
      "[1] aider/edit-formats [docs page] aider-AI/aider - aider.chat/docs/more/edit-formats.html -\n  Edit Formats",
    );

    const multiple = renderUnifiedSearchSuccess(
      completed([
        docsHit(),
        docsHit({
          target: "npm:express@5.2.1",
          title: "Routing",
          locator: {
            pageId: "express/routing",
            sourceUrl: "https://expressjs.com/en/guide/routing",
          },
        }),
      ]),
    );
    expect(multiple).toContain(
      "[1] aider/edit-formats [docs page] aider-AI/aider - aider.chat/docs/more/edit-formats.html -\n  Edit Formats",
    );
    expect(multiple).toContain(
      "[2] express/routing [docs page] npm:express - expressjs.com/en/guide/routing -\n  Routing",
    );
  });

  it("retains a documentation page ID when its source URL is unavailable", () => {
    const text = renderUnifiedSearchSuccess(
      completed([docsHit({ locator: { pageId: "internal-page-id" } })]),
    );

    expect(text).toContain(
      "[1] internal-page-id [docs page] aider-AI/aider - source URL unavailable -\n  Edit Formats",
    );
  });

  it("keeps docs follow-up locators before a free-form title tail", () => {
    const text = renderUnifiedSearchSuccess(
      completed([
        docsHit({
          target: "npm:express@5.2.1",
          title: "router.route() | API - section",
          locator: {
            pageId: "386050",
            registry: "npm",
            packageName: "express",
            version: "5.2.1",
            sourceUrl: "https://expressjs.com/en/4x/api/router/#routerroute",
          },
        }),
      ]),
    );

    expect(text).toContain(
      "[1] 386050 [docs page] npm:express - expressjs.com/en/4x/api/router/#routerroute -\n  router.route() | API - section",
    );
  });

  it("keeps repository symbol locators before a free-form title tail", () => {
    const text = renderUnifiedSearchSuccess(
      completed([
        codeHit({
          type: "repository_symbol",
          title: "parse | request - options",
          locator: { filePath: "src/index.ts", startLine: 10, endLine: 12 },
        }),
      ]),
    );

    expect(text).toContain(
      "[1] cline/cline@v3.4.2 src/index.ts:10-12 [repo symbol] -\n  parse | request - options",
    );
  });

  it("wraps long title tails without wrapping fixed locator prefixes", () => {
    const repoTitle =
      "Repository title that is deliberately long enough to wrap at terminal boundaries";
    const docsTitle =
      "Documentation title | API - deliberately long enough to wrap at terminal boundaries";
    const payload = completed([
      codeHit({ title: repoTitle, summary: undefined }),
      docsHit({ title: docsTitle, summary: undefined }),
    ]);
    const repoPrefix =
      "[1] cline/cline@v3.4.2 src/integrations/diff/strategies/multi-search-replace.ts:142-156 [repo code] -";
    const docsPrefix =
      "[2] aider/edit-formats [docs page] aider-AI/aider - aider.chat/docs/more/edit-formats.html -";

    for (const width of [40, 80]) {
      const text = renderUnifiedSearchSuccess(payload, {
        width,
        useColors: false,
      });
      const lines = text.split("\n");
      const repoPrefixIndex = lines.indexOf(repoPrefix);
      const docsPrefixIndex = lines.indexOf(docsPrefix);
      expect(repoPrefixIndex).toBeGreaterThanOrEqual(0);
      expect(docsPrefixIndex).toBeGreaterThanOrEqual(0);
      expect(lines[repoPrefixIndex + 1]).toMatch(/^ {2}Repository title that/);
      expect(lines[docsPrefixIndex + 1]).toMatch(
        /^ {2}Documentation title \| API -/,
      );
      expect(lines[repoPrefixIndex]).not.toContain(repoTitle);
      expect(lines[docsPrefixIndex]).not.toContain(docsTitle);
      const normalizedTitle = (start: number, end: number) =>
        lines
          .slice(start + 1, end)
          .filter((line) => line.startsWith("  "))
          .map((line) => line.slice(2))
          .join(" ")
          .replace(/\s+/g, " ")
          .trim();
      expect(normalizedTitle(repoPrefixIndex, docsPrefixIndex)).toBe(repoTitle);
      expect(normalizedTitle(docsPrefixIndex, lines.length)).toBe(docsTitle);
      expect(
        lines
          .slice(repoPrefixIndex + 1)
          .filter((line) => line.startsWith("  "))
          .every((line) => line.length <= width),
      ).toBe(true);
    }

    expect(renderUnifiedSearchSuccess(payload)).toBe(
      renderUnifiedSearchSuccess(payload, { width: 80, useColors: false }),
    );

    const multiline = renderUnifiedSearchSuccess(
      completed([
        codeHit({
          title: "First title line\nSecond title line",
          summary: undefined,
        }),
      ]),
      { width: 200, useColors: false },
    );
    expect(multiline).toContain(
      "[1] cline/cline@v3.4.2 src/integrations/diff/strategies/multi-search-replace.ts:142-156 [repo code] -\n" +
        "  First title line\n  Second title line",
    );
  });

  it("keeps semantic ANSI styling and title match highlights in headers", () => {
    const text = renderUnifiedSearchSuccess(
      completed([
        codeHit({
          title: "applyEdit",
          highlights: { title: [[0, 5]] },
        }),
        docsHit({
          title: "Edit Formats",
          highlights: { title: [[0, 4]] },
        }),
      ]),
      { useColors: true, width: 200 },
    );
    const reset = "\u001b[0m";
    const locator = "\u001b[1m\u001b[36m";
    const matched = "\u001b[1m\u001b[33m";
    const secondary = "\u001b[2m";

    expect(text).toContain(
      `[1] ${locator}cline/cline@v3.4.2${reset} ${locator}src/integrations/diff/strategies/multi-search-replace.ts:142-156${reset} ${secondary}[repo code]${reset} - ${matched}apply${reset}Edit`,
    );
    expect(text).toContain(
      `[2] ${locator}aider/edit-formats${reset} ${secondary}[docs page]${reset} ${secondary}aider-AI/aider${reset} - ${secondary}aider.chat/docs/more/edit-formats.html${reset} - ${matched}Edit${reset} Formats`,
    );
    expect(text.replace(ANSI_SGR_PATTERN, "")).toBe(
      renderUnifiedSearchSuccess(
        completed([
          codeHit({
            title: "applyEdit",
            highlights: { title: [[0, 5]] },
          }),
          docsHit({
            title: "Edit Formats",
            highlights: { title: [[0, 4]] },
          }),
        ]),
        { useColors: false, width: 200 },
      ),
    );
  });

  it("marks repository hits whose human location is unavailable", () => {
    const text = renderUnifiedSearchSuccess(
      completed([codeHit({ locator: {} })]),
    );

    expect(text).toContain(
      "[1] cline/cline@v3.4.2 location unavailable [repo code] - applyEdit",
    );
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

    expect(firstLine(text)).toBe("No results");
    expect(text).toContain("\n- npm:express@5.2.1\n  searched: code");
    expect(text).toContain(
      'Next: shorten or broaden query; remove restrictive filters; use source="symbol"; use code_grep.',
    );
    expect(text).not.toContain('query="');
    expect(text).not.toContain("Do not repeat");
  });

  it("source and warning provenance renders symbol readiness separately", () => {
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

    expect(text).toContain("searched: symbols");
    expect(text).not.toContain("repository docs");
  });

  it("source and warning provenance renders mixed code and symbol readiness", () => {
    const text = renderUnifiedSearchSuccess(
      completed([], {
        sourceStatus: [
          source({ source: "CODE", codeIndexState: "CURRENT" }),
          source({ source: "SYMBOL", codeIndexState: "CURRENT" }),
        ],
      }),
    );

    expect(text).toContain("searched: code, symbols");
  });

  it("source and warning provenance renders lane and target attribution", () => {
    const text = renderUnifiedSearchSuccess(
      completed([], {
        sourceStatus: [
          source({
            source: "DOCS",
            targetLabel: "npm:express",
            ignoredFilters: ["fileIntent"],
          }),
          source({
            source: "SYMBOL",
            targetLabel: "npm:express",
            ignoredQueryFeatures: ["name"],
          }),
          source({
            source: "Future-Lane",
            targetLabel: "opaque-target",
            incompatibleFilters: ["lang"],
          }),
        ],
      }),
    );

    expect(text).toContain("ignored filter (docs): fileIntent");
    expect(text).toContain("ignored query\n  feature (symbol): name");
    expect(text).toContain("incompatible filter (future-lane): lang");
  });

  it("terminal target recovery renders one positive line per target family", () => {
    const text = renderUnifiedSearchSuccess(
      completed([], {
        sourceStatus: [
          source({
            targetLabel: "npm:express@4.18.2",
            codeIndexState: "NOT_FOUND",
          }),
          source({
            targetLabel: "github:owner/repo#main",
            indexingStatus: "UNRESOLVABLE",
            targetResolution: {
              freshness: "indexing",
              freshnessReason: "no_current_fallback",
              requested: { repoUrl: "https://github.com/owner/repo" },
              availableVersions: [],
              availableRefs: [],
            },
          }),
          source({
            source: "docs",
            targetLabel: "site:docs.example.com",
            codeIndexState: "UNRESOLVABLE",
          }),
          source({
            targetLabel: "opaque:target",
            indexingStatus: "NOT_FOUND",
          }),
        ],
      }),
    );

    expect(text).toContain(
      "Fix: verify registry coordinate/version; use its public GitHub repo for",
    );
    expect(text).toContain("repo-wide search.");
    expect(text).toContain("Fix: verify public GitHub repository/ref.");
    expect(text).toContain("Fix: verify site host/path.");
    expect(text).toContain("Fix: verify or replace target.");
    expect(text).not.toContain("rerun search later");
    expect(text).not.toContain("searchRef");
    expect(text.match(/Fix:/g)).toHaveLength(4);

    const cliText = renderUnifiedSearchSuccess(
      completed([], {
        sourceStatus: [
          source({
            targetLabel: "npm:express@4.18.2",
            codeIndexState: "NOT_FOUND",
          }),
        ],
      }),
      { actionSyntax: "cli" },
    );
    expect(cliText).toContain(
      "Fix: verify registry coordinate/version; use its public GitHub repo for",
    );
    expect(cliText).toContain("repo-wide search.");
    expect(cliText).not.toContain("search_status");
  });

  it("terminal target recovery uses package guidance for a registry target with repo resolution", () => {
    const text = renderUnifiedSearchSuccess(
      completed([], {
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

    expect(text).toContain(
      "Fix: verify registry coordinate/version; use its public GitHub repo for",
    );
    expect(text).not.toContain("Fix: verify public GitHub repository/ref.");
  });

  it("renders a canonical recovery target for a latest package display identity", () => {
    const text = renderUnifiedSearchSuccess(
      completed([], {
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

    expect(text).toBe(
      "No results\n\n" +
        "- npm:express latest\n" +
        "  package unresolved: code\n" +
        "  Try: npm:express@5.1.0",
    );
    expect(text).not.toContain("npm:express latest@5.1.0");
  });

  it("renders terminal peer recovery beside healthy hits without a global Next", () => {
    const text = renderUnifiedSearchSuccess(
      completed([codeHit({ target: "npm:express@4.18.2" })], {
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

    expect(text).toContain("- npm:missing@1.0.0");
    expect(text).toContain("Fix: verify registry coordinate/version");
    expect(text).not.toContain("Next:");
  });

  it.each(["docs", "auto"] as const)(
    "uses a neutral docs label for contributor-less %s sources",
    (sourceName) => {
      const text = renderUnifiedSearchSuccess(
        completed([], {
          sourceStatus: [source({ source: sourceName, resultCount: 0 })],
        }),
      );

      expect(text).toContain("- npm:express@4.18.2\n  searched: docs");
      expect(text).not.toContain("repository docs");
    },
  );

  it("renders the supplied n8n active empty snapshot with one concise readiness block", () => {
    const text = renderUnifiedSearchSuccess(n8nActiveEmpty());

    expect(text).toBe(
      "No results yet | indexing | 0/1 ready\n\n" +
        "- npm:n8n -> 2.36.7\n" +
        "  indexing: code, repository docs; available: n8n.io docs (1,480 pages; capped);\n" +
        "  indexed: versions 2.26.9, 2.26.5, 2.23.2 +2, refs HEAD, master\n\n" +
        'Next: search_status search_ref="fabUr1S3MEVeSgD93pMoSQ" wait_timeout_ms=20000',
    );
    expect(text).not.toContain("Do not repeat");
    expect(text).not.toContain("indexingRef");
    expect(text).not.toContain("freshnessReason");
    expect(text).not.toContain("Opaque evidence notice");
    expect(text.match(/indexing/g)).toHaveLength(2);
    expect(text.match(/available:/g)).toHaveLength(1);
    expect(text.match(/Next:/g)).toHaveLength(1);
  });

  it("keeps one layout while rendering surface-native commands", () => {
    const payload = n8nActiveEmpty();
    const mcp = renderUnifiedSearchSuccess(payload);
    const cli = renderUnifiedSearchSuccess(payload, { actionSyntax: "cli" });

    expect(cli).toContain(
      "Next: githits search-status fabUr1S3MEVeSgD93pMoSQ --wait 20",
    );
    expect(cli).not.toContain("search_status search_ref=");
    expect(
      cli.replace(
        "Next: githits search-status fabUr1S3MEVeSgD93pMoSQ --wait 20",
        "Next: <status-action>",
      ),
    ).toBe(
      mcp.replace(
        'Next: search_status search_ref="fabUr1S3MEVeSgD93pMoSQ" wait_timeout_ms=20000',
        "Next: <status-action>",
      ),
    );

    const code = renderUnifiedSearchSuccess(completed([codeHit()]), {
      actionSyntax: "cli",
    });
    expect(code).toContain(
      "[1] cline/cline@v3.4.2 src/integrations/diff/strategies/multi-search-replace.ts:142-156 [repo code] -\n  applyEdit",
    );

    const repositoryCode = renderUnifiedSearchSuccess(
      completed([
        codeHit({
          target: "github:cline/cline#main",
          locator: {
            repoUrl: "https://github.com/cline/cline",
            gitRef: "main",
            filePath: "src/index.ts",
            startLine: 10,
            endLine: 20,
          },
        }),
      ]),
      { actionSyntax: "cli" },
    );
    expect(repositoryCode).toContain(
      "[1] github:cline/cline#main src/index.ts:10-20 [repo code] - applyEdit",
    );

    const docs = renderUnifiedSearchSuccess(completed([docsHit()]), {
      actionSyntax: "cli",
    });
    expect(docs).toContain(
      "[1] aider/edit-formats [docs page] aider-AI/aider - aider.chat/docs/more/edit-formats.html -\n  Edit Formats",
    );

    const empty = renderUnifiedSearchSuccess(
      completed([], {
        query: { raw: "router", filters: { kind: "function" } },
        sourceStatus: [source({ codeIndexState: "CURRENT", resultCount: 0 })],
      }),
      { actionSyntax: "cli" },
    );
    expect(empty).toContain("use --source symbol");
    expect(empty).toContain("use githits code grep");
    expect(empty).not.toContain('source="symbol"');
    expect(empty).not.toContain("code_grep");
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

    expect(firstLine(text)).toBe(
      "No result snapshot yet | indexing | 0/2 ready",
    );
    expect(text).toContain(
      'Next: search_status search_ref="ref_abc-123" wait_timeout_ms=20000',
    );
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
      "No result snapshot yet | indexing | 0/1 ready",
    );
    expect(text).not.toContain("Waiting:");
    expect(text).not.toContain("Searched:");
    expect(text).not.toContain("n8n.io");
    expect(text).toContain("indexed: versions 2.26.9");
    expect(text).toContain("versions 2.26.9");
    expect(text).toContain(
      'Next: search_status search_ref="ref_abc-123" wait_timeout_ms=20000',
    );
  });

  it("does not invent a target state when progress omits freshness", () => {
    const text = renderUnifiedSearchSuccess(
      incomplete({
        progress: {
          status: "INDEXING",
          targetsReady: 0,
          targetsTotal: 1,
          elapsedMs: 100,
          targets: [{ requested: "npm:express" }],
        },
      }),
    );

    expect(text).toContain("- npm:express");
    expect(text).not.toContain("Status:");
  });

  it.each([
    ["CURRENT", "ready"],
    ["INDEXED", "ready"],
    ["PENDING", "pending"],
    ["INDEXING", "indexing"],
    ["PROVISIONAL", "provisional"],
  ] as const)(
    "renders explicit target freshness %s accurately",
    (freshness, detail) => {
      const text = renderUnifiedSearchSuccess(
        incomplete({
          progress: {
            status: "SEARCHING",
            targetsReady:
              freshness === "CURRENT" || freshness === "INDEXED" ? 1 : 0,
            targetsTotal: 1,
            elapsedMs: 100,
            targets: [{ requested: "npm:express@5.2.1", freshness }],
          },
        }),
      );

      expect(text).toContain(detail);
    },
  );

  it("keeps shared served snapshots in distinct requested target blocks", () => {
    const text = renderUnifiedSearchSuccess(
      incomplete({
        progress: {
          status: "INDEXING",
          targetsReady: 0,
          targetsTotal: 2,
          elapsedMs: 100,
          targets: [
            {
              requested: "npm:express@5.1.0",
              resolvedRequested: "npm:express@5.1.0",
              served: "npm:express@5.1.0",
            },
            {
              requested: "npm:express",
              resolvedRequested: "npm:express@5.2.1",
              served: "npm:express@5.1.0",
              freshness: "INDEXING",
            },
          ],
        },
      }),
    );

    expect(text).toContain("- npm:express@5.1.0");
    expect(text).toContain("- npm:express");
    expect(text.match(/^- npm:express/gm)).toHaveLength(2);
    expect(text).toContain(
      'Next: search_status search_ref="ref_abc-123" wait_timeout_ms=20000',
    );
  });

  it("renders an initial progress-only parser warning once below the outcome", () => {
    const text = renderUnifiedSearchSuccess(
      incomplete({
        query: { raw: "router", warnings: ["unknown qualifier"] },
      }),
    );

    expect(firstLine(text)).toBe(
      "No result snapshot yet | indexing | 0/1 ready",
    );
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

    expect(text).toContain(
      "searched: example.com/reference docs; available: example.com/guide docs",
    );
    expect(text).not.toContain("not searched");
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
      "available: site:docs.example.com,\n  site:api.example.com",
    );
    expect(text).toContain(
      'Next: search_status search_ref="ref_abc-123" wait_timeout_ms=20000',
    );
    expect(text).not.toContain("Next: retry one suggested site target");
    expect(text.match(/available:/g)).toHaveLength(1);
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

    expect(text).toContain("available: site:docs.example.com");
    expect(text).not.toContain("available: site:example.com");
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
    expect(completedText).toContain("Try: site:docs.example.com");
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
    expect(terminalText).toContain("Try: site:docs.example.com");
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

    expect(firstLine(text)).toBe("No results");
    expect(text).toContain(
      "- npm:one@1.0.0\n  searched: repository docs, docs.one.example docs; indexing: code",
    );
    expect(text).toContain(
      "- npm:two@2.0.0\n  searched: repository docs, docs.two.example docs; indexing: code",
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

    expect(text).toContain("- npm:one@1.0.0\n  indexing: code");
    expect(text).toContain(
      "- site:docs.one.example\n  searched: site:docs.one.example docs",
    );
    expect(text).not.toContain("for site:");
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

    expect(text).toContain("- npm:one@1.0.0\n  unavailable: code");
    expect(text).not.toContain(
      "unavailable: code (npm:one@1.0.0) for npm:one@1.0.0",
    );
    expect(text).toContain("- npm:two@2.0.0\n  searched: code");
    expect(text).toContain(
      "- site:docs.one.example\n  available: site:docs.one.example docs",
    );
    expect(text).not.toContain("for site:");
  });

  it("keeps terminal lane reasons bare beside searched evidence and rewrites once", () => {
    const text = renderUnifiedSearchSuccess(
      completed([], {
        sourceStatus: [
          source({ source: "code", codeIndexState: "CURRENT" }),
          source({ source: "symbol", codeIndexState: "NOT_FOUND" }),
        ],
      }),
    );

    expect(text).toContain("searched: code; not found: symbols");
    expect(text).not.toContain("Fix:");
    expect(text).toContain(
      'Next: shorten or broaden query; use source="symbol"; use code_grep.',
    );
  });

  it("keeps a bare terminal reason and rerun action for terminal mixed lanes", () => {
    const text = renderUnifiedSearchSuccess(
      incomplete({
        partialResults: false,
        progress: {
          status: "FAILED",
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

    expect(text).toBe(
      "No results | failed | 0/1 ready\n\n" +
        "- npm:express@4.18.2\n" +
        "  searched: code; not found: symbols\n\n" +
        "Next: rerun search later.",
    );
  });

  it("prefers rerun when a completed-empty peer target is still indexing", () => {
    const text = renderUnifiedSearchSuccess(
      completed([], {
        sourceStatus: [
          source({
            targetLabel: "npm:one@1.0.0",
            source: "code",
            codeIndexState: "CURRENT",
            resultCount: 0,
          }),
          source({
            targetLabel: "npm:one@1.0.0",
            source: "symbol",
            codeIndexState: "UNRESOLVABLE",
            resultCount: 0,
          }),
          source({
            targetLabel: "npm:two@2.0.0",
            source: "code",
            codeIndexState: "INDEXING",
            resultCount: 0,
          }),
        ],
      }),
    );

    expect(text).toBe(
      "No results\n\n" +
        "- npm:one@1.0.0\n" +
        "  searched: code; unresolved: symbols\n\n" +
        "- npm:two@2.0.0\n" +
        "  indexing: code\n\n" +
        "Next: rerun search later.",
    );
  });

  it("keeps terminal alternatives informational beside a bare lane reason", () => {
    const text = renderUnifiedSearchSuccess(
      incomplete({
        partialResults: false,
        progress: {
          status: "FAILED",
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
            codeIndexState: "UNRESOLVABLE",
            targetResolution: {
              availableVersions: [{ version: "4.17.0", ref: "v4.17.0" }],
              availableRefs: [],
            },
            resultCount: 0,
          }),
        ],
      }),
    );

    expect(text).toBe(
      "No results | failed | 0/1 ready\n\n" +
        "- npm:express@4.18.2\n" +
        "  searched: code; unresolved: symbols; indexed: versions 4.17.0\n\n" +
        "Next: rerun search later.",
    );
  });

  it("omits a singular outcome target when hits span multiple targets", () => {
    const text = renderUnifiedSearchSuccess(
      completed([
        codeHit({ target: "npm:one@1.0.0" }),
        codeHit({ target: "npm:two@2.0.0" }),
      ]),
    );

    expect(firstLine(text)).toBe("2 results | 2 repo code hits");
    expect(firstLine(text)).not.toContain(" from ");
  });

  it.each([
    ["PENDING", "preparing"],
    ["INDEXING", "indexing"],
    ["SEARCHING", "searching"],
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
      expect(firstLine(text)).toBe(
        `No result snapshot yet | ${label} | 0/1 ready`,
      );
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
      expect(firstLine(text)).toBe(
        `No result snapshot | ${status.toLowerCase()} | 0/1 ready`,
      );
      expect(text).toContain("Next: rerun search later.");
      expect(text).not.toContain("Do not poll");
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
      "No result snapshot | status unknown | 1/2 ready",
    );
    expect(text).toContain("Next: rerun search later.");
    expect(text).not.toContain("Do not poll");
    expect(text).not.toContain("Next: search_status");
    expect(text).not.toContain("FUTURE_SESSION_STATE");
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
    expect(text).toContain("- npm:express latest");
    expect(text).toContain("using: 5.1.0 while 5.2.1 indexes; searched: code");
    expect(text).not.toContain("Evidence:");
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

    expect(firstLine(text)).toBe("1 result | 1 repo code hit");
    expect(text).toContain("- npm:express latest");
    expect(text.match(/using:/g)).toHaveLength(1);
    expect(text).toContain("using: 5.1.0 while 5.2.1 indexes");
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

    expect(firstLine(text)).toBe("1 result | 1 repo code hit");
    expect(text).toContain("- npm:express latest");
    expect(text.match(/using:/g)).toHaveLength(1);
    expect(text).toContain("using: 5.1.0 while 5.2.1 indexes");
  });

  it("shows a served older version from progress-only stale identity", () => {
    const text = renderUnifiedSearchSuccess(
      incomplete({
        progress: {
          status: "INDEXING",
          targetsReady: 0,
          targetsTotal: 1,
          elapsedMs: 20,
          targets: [
            {
              requested: "npm:express latest",
              resolvedRequested: "npm:express@5.2.1",
              served: "npm:express@5.1.0",
              freshness: "INDEXING",
            },
          ],
        },
      }),
    );

    expect(text).toContain("- npm:express latest");
    expect(text.match(/using:/g)).toHaveLength(1);
    expect(text).toContain("using: 5.1.0 while 5.2.1 indexes");
    expect(text).not.toContain("(using");
  });

  it("keeps a stale served version in detail when no fresh target exists", () => {
    const text = renderUnifiedSearchSuccess(
      incomplete({
        progress: {
          status: "INDEXING",
          targetsReady: 0,
          targetsTotal: 1,
          elapsedMs: 20,
          targets: [
            {
              requested: "npm:express latest",
              served: "npm:express@5.1.0",
              freshness: "INDEXING",
            },
          ],
        },
      }),
    );

    expect(text).toContain(
      "- npm:express latest\n  using: 5.1.0 (older snapshot)",
    );
    expect(text).not.toContain("- npm:express latest -> 5.1.0");
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

    expect(firstLine(text)).toBe("No results");
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

      expect(firstLine(text)).toBe("No results");
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
    expect(firstLine(text)).toBe("No results");
    expect(text).toContain(
      'Next: search_status search_ref="search-ref-evidence" wait_timeout_ms=20000',
    );
    expect(text).not.toContain("Opaque backend prose");
    expect(text).not.toContain("Evidence may change.");
    expect(text).not.toContain("Do not repeat");
  });

  it("continues completed mutable evidence with hits through the exact reference", () => {
    const text = renderUnifiedSearchSuccess(
      completed([codeHit()], {
        searchRef: "search-ref-results",
        evidenceNotice: "Opaque backend prose must not be copied.",
      }),
    );
    expect(firstLine(text)).toContain("1 result");
    expect(text).toContain(
      'Next: search_status search_ref="search-ref-results" wait_timeout_ms=20000',
    );
    const lines = text.split("\n");
    const actionLine = lines.findIndex((line) => line.startsWith("Next: "));
    expect(actionLine).toBeGreaterThan(0);
    expect(lines[actionLine - 1]).toBe("");
    expect(text).toContain("Search/replace block parser");
    expect(text).not.toContain("Evidence may change.");
    expect(text).not.toContain("Do not repeat");
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
    expect(firstLine(text)).toBe("No results");
    expect(text).toContain("Warnings:");
    expect(text).toContain("kind was ignored by the selected source");
    expect(text).toContain("incompatible query feature\n  (code): kind");
    expect(text).toContain("ignored filter (code): category");
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
    expect(text).toContain("Try: npm:express@5.1.0");
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
    const payload = completed([codeHit(), docsHit()], {
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
    });
    const text = renderUnifiedSearchSuccess(payload);
    const cliText = renderUnifiedSearchSuccess(payload, {
      actionSyntax: "cli",
    });
    expect(text).toContain(
      "[1] cline/cline@v3.4.2 src/integrations/diff/strategies/multi-search-replace.ts:142-156 [repo code] -\n  applyEdit",
    );
    expect(text).toContain(
      "[2] aider/edit-formats [docs page] aider-AI/aider - aider.chat/docs/more/edit-formats.html -\n  Edit Formats",
    );
    expect(text).toContain(
      "indexed: versions 5.2.1, 5.2.0, 5.1.0 +1, refs HEAD, main,",
    );
    expect(text).toContain("next_offset=10");
    expect(cliText).toContain("next_offset=10");
    expect(cliText).not.toContain("More hits available");
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
    expect(text).toContain("No results | next_offset=10");
  });

  it("keeps pagination in active and terminal result headlines", () => {
    const active = renderUnifiedSearchSuccess(
      incomplete({
        partialResults: false,
        hasMore: true,
        nextOffset: 10,
        results: [codeHit()],
      }),
    );
    const terminal = renderUnifiedSearchSuccess(
      incomplete({
        partialResults: false,
        completed: false,
        hasMore: true,
        nextOffset: 10,
        results: [codeHit()],
        progress: {
          status: "DEFERRED",
          targetsReady: 0,
          targetsTotal: 1,
          elapsedMs: 1,
        },
      }),
    );

    expect(firstLine(active)).toContain("next_offset=10");
    expect(firstLine(terminal)).toContain("next_offset=10");
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
      /^( {2})?(indexing|searched|available|indexed)/.test(line),
    );
    expect(summaryLines.length).toBeGreaterThanOrEqual(3);
    expect(summaryLines.every((line) => line.length <= 80)).toBe(true);
    expect(text).toContain(targetOne);
    expect(text).toContain(targetTwo);
    expect(text).not.toContain(longRef);
    expect(text).toContain("Try: npm:one-long-package@1.0.0");

    expect(lines.every((line) => line.length <= 80)).toBe(true);
  });

  it("wraps target details at the caller-supplied full output width", () => {
    const narrow = renderUnifiedSearchSuccess(n8nActiveEmpty(), { width: 60 });
    const wide = renderUnifiedSearchSuccess(n8nActiveEmpty(), { width: 140 });
    const detailLines = (text: string) =>
      text.split("\n").filter((line) => line.startsWith("  "));

    expect(detailLines(narrow).length).toBeGreaterThan(
      detailLines(wide).length,
    );
    expect(detailLines(narrow).every((line) => line.length <= 60)).toBe(true);
    expect(detailLines(wide).every((line) => line.length <= 140)).toBe(true);
    expect(wide).toContain(
      "n8n.io docs (1,480 pages; capped); indexed: versions",
    );
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
      "searched: docs.example.com docs (120 pages; partial)",
    );
    expect(text.match(/120 pages/g)).toHaveLength(1);
  });

  it("wraps long summaries", () => {
    const text = renderUnifiedSearchSuccess(
      completed([
        codeHit({
          summary:
            "This summary is intentionally long enough to force wrapping across multiple lines without using a non-ASCII separator.",
        }),
      ]),
    );
    for (const line of text.split("\n")) {
      if (!line.startsWith("[")) expect(line.length).toBeLessThanOrEqual(82);
    }
  });

  it("does not split unbreakable summary tokens", () => {
    const token = `https://example.com/${"segment".repeat(20)}`;
    const text = renderUnifiedSearchSuccess(
      completed([codeHit({ summary: `Reference ${token} after` })]),
      { width: 40 },
    );

    expect(text).toContain(`  ${token}`);
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
