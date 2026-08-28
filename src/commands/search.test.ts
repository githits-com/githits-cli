import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import type {
  UnifiedSearchIncomplete,
  UnifiedSearchOutcome,
  UnifiedSearchParams,
  UnifiedSearchProgress,
  UnifiedSearchResult,
  UnifiedSearchSessionStatus,
} from "@githits/core-internal";
import {
  AuthenticationError,
  CodeNavigationIndexingError,
  CodeNavigationTargetNotFoundError,
  TermsAcceptanceRequiredError,
} from "@githits/core-internal";
import { AuthRequiredError } from "@githits/mcp/internal";
import {
  createMockCodeNavigationService,
  defaultUnifiedSearchOutcome,
} from "../services/test-helpers.js";
import {
  type SearchDependencies,
  searchAction,
  searchStatusAction,
} from "./search.js";

const DOCUMENTATION_EVIDENCE_NOTICE =
  "Results and status reflect the disclosed snapshots at this response boundary. Pending or required work may change hits and ordering; callers may follow searchRef when present or retry.";
const CLI_TERMS_ERROR_PAYLOAD = {
  error:
    "Terms acceptance required. Run `githits settings terms accept`, then retry.",
  code: "TERMS_ACCEPTANCE_REQUIRED",
  retryable: false,
  details: {
    action: "githits settings terms accept",
    termsUrl: "https://githits.com/legal/terms-of-service/",
    acceptanceUrl: "https://app.githits.com/settings/privacy",
  },
};

afterEach(() => {
  mock.restore();
});

function createDocumentationSearchResult(): UnifiedSearchResult {
  return {
    query: "router",
    queryWarnings: [],
    sources: ["DOCS"],
    results: [],
    page: { offset: 0, limit: 10, returned: 0, hasMore: false },
    partialResults: false,
    evidenceNotice: DOCUMENTATION_EVIDENCE_NOTICE,
    sourceStatus: [
      {
        source: "DOCS",
        targetLabel: "npm:express@5.1.0",
        appliedFilters: [],
        ignoredFilters: [],
        incompatibleFilters: [],
        appliedQueryFeatures: [],
        ignoredQueryFeatures: [],
        incompatibleQueryFeatures: [],
        suggestedSiteTargets: [],
        suggestedSiteTargetsTruncated: false,
        contributors: [
          {
            kind: "REPOSITORY_DOCS",
            state: "SEARCHED",
            freshness: "CURRENT",
            resultCount: 0,
            repositoryUrl: "https://github.com/expressjs/express",
            commitSha: "0123456789abcdef0123456789abcdef01234567",
          },
          {
            kind: "DOCPACK",
            state: "READY",
            freshness: "STALE",
            resultCount: 0,
            siteKey: "34150829eb8a7c57",
            siteUrl: "https://expressjs.com/en/guide",
            coverage: {
              coverageState: "PARTIAL",
              pagesCrawled: 120,
              frontierRemaining: null,
              artifactOverflowPageCount: 0,
              note: "Indexed 120 pages so far; indexing is still in progress.",
            },
          },
        ],
      },
    ],
  };
}

function createDivergentIndexingSearchResult(): UnifiedSearchResult {
  if (defaultUnifiedSearchOutcome.state !== "completed") {
    throw new Error("expected completed outcome fixture");
  }
  return {
    ...defaultUnifiedSearchOutcome.result,
    sourceStatus: defaultUnifiedSearchOutcome.result.sourceStatus.map(
      (entry) => ({
        ...entry,
        indexingStatus: "INDEXING",
        targetResolution: {
          requested: {
            registry: "NPM",
            packageName: "express",
            version: "4.18.2",
            commitSha: "abcdef0123456789",
          },
          freshness: "current",
          availableVersions: [],
          availableRefs: [],
        },
      }),
    ),
  };
}

function stripAnsi(value: string): string {
  return value.replace(ANSI_SGR_PATTERN, "");
}

const ESC = String.fromCharCode(0x1b);
const ANSI_SGR_PATTERN = new RegExp(`${ESC}\\[[0-9;]*m`, "g");

describe("searchAction", () => {
  const mcpUrl = "https://mcp.githits.com";

  function createIncompleteOutcome(
    status: UnifiedSearchSessionStatus,
    searchRef: string,
  ): UnifiedSearchIncomplete {
    return {
      state: "incomplete",
      completed: false,
      searchRef,
      progress: {
        searchRef,
        status,
        targetsTotal: 1,
        targetsReady: 0,
        elapsedMs: 100,
        query: "router",
        queryWarnings: [],
        sources: ["CODE"],
      },
    };
  }

  function createDeps(
    overrides: Partial<SearchDependencies> = {},
  ): SearchDependencies {
    return {
      codeNavigationService: createMockCodeNavigationService(),
      codeNavigationUrl: "https://nav.example.com",
      hasValidToken: true,
      mcpUrl,
      ...overrides,
    };
  }

  it("preserves CLI auth remediation when search service auth fails", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });

    await expect(
      searchAction(
        "router middleware",
        { in: ["npm:express"] },
        createDeps({
          codeNavigationService: createMockCodeNavigationService({
            search: mock(() => Promise.reject(new AuthenticationError())),
          }),
        }),
      ),
    ).rejects.toThrow("process.exit");

    expect(errorSpy.mock.calls[0]?.[0]).toBe(
      "Authentication required. Run `githits login` to authenticate or set GITHITS_API_TOKEN.",
    );
    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("preserves CLI terms remediation in JSON search errors", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });

    try {
      await expect(
        searchAction(
          "router middleware",
          { in: ["npm:express"], json: true },
          createDeps({
            codeNavigationService: createMockCodeNavigationService({
              search: mock(() =>
                Promise.reject(new TermsAcceptanceRequiredError()),
              ),
            }),
          }),
        ),
      ).rejects.toThrow("process.exit");

      expect(JSON.parse(String(errorSpy.mock.calls[0]?.[0]))).toEqual(
        CLI_TERMS_ERROR_PAYLOAD,
      );
    } finally {
      errorSpy.mockRestore();
      exitSpy.mockRestore();
    }
  });

  it("emits the PII-safe classification event for search errors", async () => {
    const previous = process.env.GITHITS_DEBUG;
    process.env.GITHITS_DEBUG = "code-nav";
    const debugSpy = spyOn(process.stderr, "write").mockImplementation(
      () => true,
    );
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });

    try {
      const error = new CodeNavigationTargetNotFoundError(
        "search caller query content",
        [],
        "https://github.com/example/repo",
        "main",
      );
      await expect(
        searchAction(
          "router middleware",
          { in: ["npm:express"], json: true },
          createDeps({
            codeNavigationService: createMockCodeNavigationService({
              search: mock(() => Promise.reject(error)),
            }),
          }),
        ),
      ).rejects.toThrow("process.exit");

      expect(debugSpy).toHaveBeenCalledTimes(1);
      const debugLine = String(debugSpy.mock.calls[0]?.[0]);
      expect(JSON.parse(debugLine)).toMatchObject({
        area: "code-nav",
        event: "error-classified",
        code: "NOT_FOUND",
        errorName: "CodeNavigationTargetNotFoundError",
        detailKeys: ["repoUrl", "requestedRef"],
      });
      expect(debugLine).not.toContain("search caller query content");
      expect(errorSpy).toHaveBeenCalledWith(
        JSON.stringify({
          error: "search caller query content",
          code: "NOT_FOUND",
          retryable: false,
          details: {
            repoUrl: "https://github.com/example/repo",
            requestedRef: "main",
          },
        }),
      );
    } finally {
      debugSpy.mockRestore();
      errorSpy.mockRestore();
      exitSpy.mockRestore();
      if (previous === undefined) delete process.env.GITHITS_DEBUG;
      else process.env.GITHITS_DEBUG = previous;
    }
  });

  it("renders indexing wait guidance and structured details in human output", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    const indexingError = new CodeNavigationIndexingError(
      "Target is indexing.",
      "idx-search",
      [{ version: "5.2.1", ref: "v5.2.1" }],
      undefined,
      undefined,
      { lowerSeconds: 7, upperSeconds: 19, elapsedSeconds: 3 },
      "Wait until ready with CLI `--wait 60000` or MCP `wait_timeout_ms: 60000`.",
    );

    await expect(
      searchAction(
        "router middleware",
        { in: ["npm:express"] },
        createDeps({
          codeNavigationService: createMockCodeNavigationService({
            search: mock(() => Promise.reject(indexingError)),
          }),
        }),
      ),
    ).rejects.toThrow("process.exit");

    const output = String(errorSpy.mock.calls[0]?.[0]);
    expect(output).toContain("--wait 60000");
    expect(output).toContain("indexing ref: idx-search");
    expect(output).toContain("indexing estimate: 7-19s, 3s elapsed");
    expect(output).toContain("indexed refs/versions: 5.2.1");
    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("calls unified search service with parsed targets and filters", async () => {
    const search = mock((_: UnifiedSearchParams) =>
      Promise.resolve(defaultUnifiedSearchOutcome),
    );
    const deps = createDeps({
      codeNavigationService: createMockCodeNavigationService({ search }),
    });
    const consoleSpy = spyOn(console, "log").mockImplementation(() => {});

    await searchAction(
      "router middleware",
      {
        in: ["npm:express", "npm:koa"],
        kind: "function",
        lang: "typescript",
        allowPartial: true,
      },
      deps,
    );

    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({
        targets: [
          { registry: "NPM", packageName: "express", version: undefined },
          { registry: "NPM", packageName: "koa", version: undefined },
        ],
        query: "(router middleware) AND (lang:typescript)",
        allowPartialResults: true,
        filters: expect.objectContaining({ kind: "FUNCTION" }),
      }),
    );
    consoleSpy.mockRestore();
  });

  it("passes --source through as a single source filter", async () => {
    const search = mock((_: UnifiedSearchParams) =>
      Promise.resolve(defaultUnifiedSearchOutcome),
    );
    const deps = createDeps({
      codeNavigationService: createMockCodeNavigationService({ search }),
    });
    const consoleSpy = spyOn(console, "log").mockImplementation(() => {});

    await searchAction(
      "router middleware",
      {
        in: ["npm:express"],
        source: "code",
      },
      deps,
    );

    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({
        sources: ["CODE"],
      }),
    );
    consoleSpy.mockRestore();
  });

  it("passes standalone site targets through unified search", async () => {
    const search = mock((_: UnifiedSearchParams) =>
      Promise.resolve(defaultUnifiedSearchOutcome),
    );
    const deps = createDeps({
      codeNavigationService: createMockCodeNavigationService({ search }),
    });
    const consoleSpy = spyOn(console, "log").mockImplementation(() => {});

    await searchAction(
      "router middleware",
      {
        in: ["site:expressjs.com"],
        source: "docs",
      },
      deps,
    );

    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({
        targets: [{ site: "site:expressjs.com" }],
        sources: ["DOCS"],
      }),
    );
    consoleSpy.mockRestore();
  });

  it("renders site recovery suggestions for an initial search", async () => {
    const consoleSpy = spyOn(console, "log").mockImplementation(() => {});
    if (defaultUnifiedSearchOutcome.state !== "completed") {
      throw new Error("expected completed outcome fixture");
    }
    const outcome: UnifiedSearchOutcome = {
      ...defaultUnifiedSearchOutcome,
      result: {
        ...defaultUnifiedSearchOutcome.result,
        results: [],
        sourceStatus: [
          {
            source: "DOCS",
            targetLabel: "site:example.com",
            appliedFilters: [],
            ignoredFilters: [],
            incompatibleFilters: [],
            appliedQueryFeatures: [],
            ignoredQueryFeatures: [],
            incompatibleQueryFeatures: [],
            suggestedSiteTargets: [
              "site:example.com/docs",
              "site:example.com/guide",
            ],
            suggestedSiteTargetsTruncated: false,
            contributors: [],
          },
        ],
      },
    };

    await searchAction(
      "router",
      { in: ["site:example.com"], source: "docs" },
      createDeps({
        codeNavigationService: createMockCodeNavigationService({
          search: mock(() => Promise.resolve(outcome)),
        }),
      }),
    );

    const output = String(consoleSpy.mock.calls[0]?.[0]);
    expect(output.split("\n")[0]).toBe("No results returned");
    expect(output).toContain(
      "- site:example.com\n  Searched: site:example.com docs | Suggested sites: site:example.com/docs,\n  site:example.com/guide",
    );
    expect(output).not.toContain("Additional site targets were omitted.");
    expect(output).toContain("Search search-ref-123 | completed");
    expect(output).toContain(
      "Next: retry one suggested site target explicitly.",
    );
    consoleSpy.mockRestore();
  });

  it("preserves site recovery suggestions in CLI JSON", async () => {
    const consoleSpy = spyOn(console, "log").mockImplementation(() => {});
    if (defaultUnifiedSearchOutcome.state !== "completed") {
      throw new Error("expected completed outcome fixture");
    }
    const outcome: UnifiedSearchOutcome = {
      ...defaultUnifiedSearchOutcome,
      result: {
        ...defaultUnifiedSearchOutcome.result,
        results: [],
        sourceStatus: [
          {
            source: "DOCS",
            targetLabel: "site:example.com",
            appliedFilters: [],
            ignoredFilters: [],
            incompatibleFilters: [],
            appliedQueryFeatures: [],
            ignoredQueryFeatures: [],
            incompatibleQueryFeatures: [],
            suggestedSiteTargets: ["site:new.example.com/docs"],
            suggestedSiteTargetsTruncated: false,
            contributors: [],
          },
        ],
      },
    };

    await searchAction(
      "router",
      { in: ["site:example.com"], source: "docs", json: true },
      createDeps({
        codeNavigationService: createMockCodeNavigationService({
          search: mock(() => Promise.resolve(outcome)),
        }),
      }),
    );

    const payload = JSON.parse(String(consoleSpy.mock.calls[0]?.[0]));
    expect(payload.sourceStatus[0]).toMatchObject({
      suggestedSiteTargets: ["site:new.example.com/docs"],
      suggestedSiteTargetsTruncated: false,
    });
    consoleSpy.mockRestore();
  });

  it("renders compact documentation evidence for completed initial searches", async () => {
    const consoleSpy = spyOn(console, "log").mockImplementation(() => {});
    const result = createDocumentationSearchResult();
    const outcome: UnifiedSearchOutcome = {
      state: "completed",
      completed: true,
      searchRef: "search-ref-docs",
      result,
    };

    await searchAction(
      "router",
      { in: ["npm:express"], source: "docs" },
      createDeps({
        codeNavigationService: createMockCodeNavigationService({
          search: mock(() => Promise.resolve(outcome)),
        }),
      }),
    );

    const output = String(consoleSpy.mock.calls[0]?.[0]);
    expect(output.split("\n")[0]).toBe("No results returned");
    expect(output).toContain("- npm:express@5.1.0");
    expect(output).toMatch(/Searched:\s+repository\s+docs/);
    expect(output).toMatch(
      /Available now: expressjs\.com\/en\/guide docs \(120 pages; partial\)/,
    );
    expect(output).not.toContain("Documentation sources:");
    expect(output).not.toContain("Documentation corpora");
    expect(output).not.toContain("indexing is still in progress");
    expect(output).not.toContain("Do not repeat");
    expect(output).not.toContain("Try a shorter or broader query");
    expect(output).not.toContain("Run again with a larger --wait");
    expect(output).not.toContain("Evidence may change.");
    expect(output).toContain("Search search-ref-docs | completed");
    expect(output).toContain(
      "Next: githits search-status search-ref-docs --wait 20",
    );
    consoleSpy.mockRestore();
  });

  it("scopes empty CLI claims with searched and unsearched evidence", async () => {
    const consoleSpy = spyOn(console, "log").mockImplementation(() => {});
    const result = createDocumentationSearchResult();
    result.evidenceNotice = undefined;
    const outcome: UnifiedSearchOutcome = {
      state: "completed",
      completed: true,
      result,
    };

    await searchAction(
      "router",
      { in: ["npm:express"], source: "docs" },
      createDeps({
        codeNavigationService: createMockCodeNavigationService({
          search: mock(() => Promise.resolve(outcome)),
        }),
      }),
    );

    const output = String(consoleSpy.mock.calls[0]?.[0]);
    expect(output.split("\n")[0]).toBe("No results returned");
    expect(output).toContain("- npm:express@5.1.0");
    expect(output).toMatch(/Searched:\s+repository\s+docs/);
    expect(output).toContain("Available now: expressjs.com/en/guide docs");
    expect(output).not.toContain("Do not repeat");
    consoleSpy.mockRestore();
  });

  it("keeps CLI indexing guidance when documentation was not searched", async () => {
    const consoleSpy = spyOn(console, "log").mockImplementation(() => {});
    const result = createDocumentationSearchResult();
    result.evidenceNotice = undefined;
    result.sourceStatus.push({
      source: "CODE",
      targetLabel: "npm:express@5.1.0",
      indexingStatus: "INDEXING",
      appliedFilters: [],
      ignoredFilters: [],
      incompatibleFilters: [],
      appliedQueryFeatures: [],
      ignoredQueryFeatures: [],
      incompatibleQueryFeatures: [],
      suggestedSiteTargets: [],
      suggestedSiteTargetsTruncated: false,
      contributors: [],
    });
    const outcome: UnifiedSearchOutcome = {
      state: "completed",
      completed: true,
      result,
    };

    await searchAction(
      "router",
      { in: ["npm:express"] },
      createDeps({
        codeNavigationService: createMockCodeNavigationService({
          search: mock(() => Promise.resolve(outcome)),
        }),
      }),
    );

    const output = String(consoleSpy.mock.calls[0]?.[0]);
    expect(output).toContain("Indexing: code");
    expect(output).toContain("- npm:express@5.1.0");
    expect(output).toContain("Searched: repository docs");
    expect(output).toContain("Next: rerun search later.");
    consoleSpy.mockRestore();
  });

  it("does not suggest another source for an empty standalone-site search", async () => {
    const consoleSpy = spyOn(console, "log").mockImplementation(() => {});
    if (defaultUnifiedSearchOutcome.state !== "completed") {
      throw new Error("expected completed outcome fixture");
    }
    const outcome: UnifiedSearchOutcome = {
      ...defaultUnifiedSearchOutcome,
      result: {
        ...defaultUnifiedSearchOutcome.result,
        results: [],
        page: {
          ...defaultUnifiedSearchOutcome.result.page,
          returned: 0,
        },
        sourceStatus: [
          {
            source: "DOCS",
            targetLabel: "site:docs.example.com",
            appliedFilters: [],
            ignoredFilters: [],
            incompatibleFilters: [],
            appliedQueryFeatures: [],
            ignoredQueryFeatures: [],
            incompatibleQueryFeatures: [],
            suggestedSiteTargets: [],
            suggestedSiteTargetsTruncated: false,
            contributors: [],
          },
        ],
      },
    };

    await searchAction(
      "router",
      { in: ["site:docs.example.com"] },
      createDeps({
        codeNavigationService: createMockCodeNavigationService({
          search: mock(() => Promise.resolve(outcome)),
        }),
      }),
    );

    const output = String(consoleSpy.mock.calls[0]?.[0]);
    expect(output).toContain("Next: shorten or broaden site query.");
    expect(output).not.toContain("search another source");
    consoleSpy.mockRestore();
  });

  it("renders healthy documentation as references only", async () => {
    const consoleSpy = spyOn(console, "log").mockImplementation(() => {});
    const result = createDocumentationSearchResult();
    result.results = [
      {
        id: "docs-express-routing",
        resultType: "DOCUMENTATION_PAGE",
        targetLabel: "npm:express@5.1.0",
        title: "Routing",
        locator: {
          pageId: "express/routing",
          sourceUrl: "https://expressjs.com/en/guide/routing.html",
        },
      },
    ];
    result.page.returned = 1;
    const contributors = result.sourceStatus[0]?.contributors;
    if (!contributors?.[0] || !contributors[1]) {
      throw new Error("expected documentation contributors");
    }
    contributors[1].state = "SEARCHED";
    contributors[1].freshness = "CURRENT";
    contributors[1].resultCount = 1;
    contributors[1].siteKey = "34150829eb8a7c57";
    contributors[1].siteUrl = "https://expressjs.com/en/guide";
    contributors[1].coverage = {
      coverageState: "COMPLETE",
      pagesCrawled: 124,
      frontierRemaining: 0,
      artifactOverflowPageCount: 0,
    };
    const outcome: UnifiedSearchOutcome = {
      state: "completed",
      completed: true,
      result,
    };

    await searchAction(
      "router",
      { in: ["npm:express"], source: "docs" },
      createDeps({
        codeNavigationService: createMockCodeNavigationService({
          search: mock(() => Promise.resolve(outcome)),
        }),
      }),
    );

    const output = String(consoleSpy.mock.calls[0]?.[0]);
    expect(output.split("\n")[0]).toBe("1 result | 1 docs page");
    expect(output).toContain("- npm:express@5.1.0");
    expect(output).toContain(
      "Searched: repository docs, expressjs.com/en/guide docs",
    );
    expect(output).toContain(
      "[1] express/routing [docs page] npm:express - expressjs.com/en/guide/routing.html - Routing",
    );
    expect(output).toContain("expressjs.com/en/guide/routing.html");
    expect(output).not.toContain("Documentation sources");
    expect(output).not.toContain("hits on this page");
    expect(output).not.toContain("124 pages");
    consoleSpy.mockRestore();
  });

  it("preserves lossless documentation contributor JSON", async () => {
    const consoleSpy = spyOn(console, "log").mockImplementation(() => {});
    const result = createDocumentationSearchResult();
    const outcome: UnifiedSearchOutcome = {
      state: "completed",
      completed: true,
      result,
    };

    await searchAction(
      "router",
      { in: ["npm:express"], source: "docs", json: true },
      createDeps({
        codeNavigationService: createMockCodeNavigationService({
          search: mock(() => Promise.resolve(outcome)),
        }),
      }),
    );

    const payload = JSON.parse(String(consoleSpy.mock.calls[0]?.[0]));
    expect(payload.sourceStatus[0].contributors).toEqual(
      result.sourceStatus[0]?.contributors,
    );
    expect(payload.sourceStatus[0]).not.toHaveProperty("resultCount");
    expect(payload.sourceStatus[0]).not.toHaveProperty("coverage");
    expect(payload.evidenceNotice).toBe(DOCUMENTATION_EVIDENCE_NOTICE);
    consoleSpy.mockRestore();
  });

  it("preserves omitted repo refs for CLI discovery search targets", async () => {
    const search = mock((_: UnifiedSearchParams) =>
      Promise.resolve(defaultUnifiedSearchOutcome),
    );
    const deps = createDeps({
      codeNavigationService: createMockCodeNavigationService({ search }),
    });
    const consoleSpy = spyOn(console, "log").mockImplementation(() => {});

    await searchAction(
      "router middleware",
      { in: ["https://github.com/expressjs/express"] },
      deps,
    );

    const call = search.mock.calls[0]?.[0];
    expect(call?.targets[0]).toEqual({
      repoUrl: "https://github.com/expressjs/express",
    });
    consoleSpy.mockRestore();
  });

  it("passes GitHub repo refs containing @ through to the backend", async () => {
    const search = mock((_: UnifiedSearchParams) =>
      Promise.resolve(defaultUnifiedSearchOutcome),
    );
    const deps = createDeps({
      codeNavigationService: createMockCodeNavigationService({ search }),
    });
    const consoleSpy = spyOn(console, "log").mockImplementation(() => {});

    await searchAction(
      "human review approval node output",
      { in: ["https://github.com/n8n-io/n8n#n8n@2.26.5"] },
      deps,
    );

    const call = search.mock.calls[0]?.[0];
    expect(call?.targets[0]).toEqual({
      repoUrl: "https://github.com/n8n-io/n8n",
      gitRef: "n8n@2.26.5",
    });
    consoleSpy.mockRestore();
  });

  it("treats github.com shorthand as a CLI discovery repo target without warning", async () => {
    const search = mock((_: UnifiedSearchParams) =>
      Promise.resolve(defaultUnifiedSearchOutcome),
    );
    const deps = createDeps({
      codeNavigationService: createMockCodeNavigationService({ search }),
    });
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});

    await searchAction(
      "duckdb",
      { in: ["github.com/expressjs/express"] },
      deps,
    );

    const call = search.mock.calls[0]?.[0];
    expect(call?.targets[0]).toEqual({
      repoUrl: "https://github.com/expressjs/express",
    });
    expect(errorSpy).not.toHaveBeenCalled();
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("uses the shared search default limit and preserves explicit limits", async () => {
    const search = mock((_: UnifiedSearchParams) =>
      Promise.resolve(defaultUnifiedSearchOutcome),
    );
    const deps = createDeps({
      codeNavigationService: createMockCodeNavigationService({ search }),
    });
    const consoleSpy = spyOn(console, "log").mockImplementation(() => {});

    await searchAction("router middleware", { in: ["npm:express"] }, deps);
    expect(search.mock.calls[0]?.[0]?.limit).toBe(10);

    search.mockClear();
    await searchAction(
      "router middleware",
      { in: ["npm:express"], limit: "25" },
      deps,
    );
    expect(search.mock.calls[0]?.[0]?.limit).toBe(25);

    consoleSpy.mockRestore();
  });

  it.each([
    [{ limit: "10abc" }, "--limit"],
    [{ limit: "5.5" }, "--limit"],
    [{ offset: "2.5" }, "--offset"],
    [{ wait: "1szzz" }, "--wait"],
  ] as const)("rejects partial numeric option %p", async (partial, flag) => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });

    try {
      await expect(
        searchAction(
          "router middleware",
          { in: ["npm:express"], json: true, ...partial },
          createDeps(),
        ),
      ).rejects.toThrow("process.exit");

      const payload = JSON.parse(String(errorSpy.mock.calls[0]?.[0]));
      expect(payload.code).toBe("INVALID_ARGUMENT");
      expect(payload.error).toContain(flag);
    } finally {
      errorSpy.mockRestore();
      exitSpy.mockRestore();
    }
  });

  it("does not send a file-intent filter unless the caller explicitly set one", async () => {
    const search = mock<
      (
        params: import("@githits/core-internal").UnifiedSearchParams,
      ) => Promise<import("@githits/core-internal").UnifiedSearchOutcome>
    >(() => Promise.resolve(defaultUnifiedSearchOutcome));
    const deps = createDeps({
      codeNavigationService: createMockCodeNavigationService({ search }),
    });
    const consoleSpy = spyOn(console, "log").mockImplementation(() => {});

    await searchAction(
      "router middleware",
      {
        in: ["npm:express"],
      },
      deps,
    );
    expect(search.mock.calls[0]?.[0]?.filters?.fileIntent).toBeUndefined();

    search.mockClear();
    await searchAction(
      "router middleware",
      {
        in: ["npm:express"],
        intent: "test",
      },
      deps,
    );
    expect(search.mock.calls[0]?.[0]?.filters?.fileIntent).toBe("TEST");

    consoleSpy.mockRestore();
  });

  it("outputs JSON when --json flag provided", async () => {
    const consoleSpy = spyOn(console, "log").mockImplementation(() => {});

    await searchAction(
      "router middleware",
      { in: ["npm:express"], json: true },
      createDeps(),
    );

    const output = consoleSpy.mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(output);
    expect(parsed.completed).toBe(true);
    expect(parsed.results[0].target).toBe("npm:express@4.18.2");
    expect(parsed.results[0].highlights).toEqual({
      title: [[7, 17]],
      summary: [[9, 15]],
    });
    consoleSpy.mockRestore();
  });

  it("prints friendly result labels and per-type summary in terminal output", async () => {
    const consoleSpy = spyOn(console, "log").mockImplementation(() => {});

    await searchAction(
      "router middleware",
      { in: ["npm:express"] },
      createDeps(),
    );

    const output = String(consoleSpy.mock.calls[0]?.[0]);
    expect(output.split("\n")[0]).toBe("1 result | 1 code");
    expect(output).toContain(
      "[1] npm:express@4.18.2 lib/router/index.js:42-57 [repo code] - router middleware",
    );
    expect(output).not.toContain("githits code read");
    expect(output).toContain("router middleware");
    consoleSpy.mockRestore();
  });

  it("throws AuthRequiredError on auth failure", async () => {
    await expect(
      searchAction(
        "router",
        { in: ["npm:express"] },
        createDeps({ hasValidToken: false }),
      ),
    ).rejects.toThrow(AuthRequiredError);
  });

  it("prints incomplete status when backend returns searchRef", async () => {
    const consoleSpy = spyOn(console, "log").mockImplementation(() => {});

    await searchAction(
      "router",
      { in: ["npm:express"] },
      createDeps({
        codeNavigationService: createMockCodeNavigationService({
          search: mock(() =>
            Promise.resolve(
              createIncompleteOutcome("INDEXING", "search-ref-123"),
            ),
          ),
        }),
      }),
    );

    const output = String(consoleSpy.mock.calls[0]?.[0]);
    expect(output.split("\n")[0]).toBe("Indexing - no result snapshot yet");
    expect(output).toContain("Search search-ref-123 | 0/1 target ready");
    expect(output).toContain(
      "Next: githits search-status search-ref-123 --wait 20",
    );
    consoleSpy.mockRestore();
  });

  it("uses the shared n8n hierarchy with CLI-native status actions", async () => {
    const consoleSpy = spyOn(console, "log").mockImplementation(() => {});
    if (defaultUnifiedSearchOutcome.state !== "completed") {
      throw new Error("expected completed outcome fixture");
    }
    const source = defaultUnifiedSearchOutcome.result.sourceStatus[0];
    if (!source) throw new Error("expected source fixture");
    const outcome: UnifiedSearchIncomplete = {
      ...createIncompleteOutcome("INDEXING", "n8n-search-ref"),
      progress: {
        searchRef: "n8n-search-ref",
        status: "INDEXING",
        targetsTotal: 1,
        targetsReady: 0,
        elapsedMs: 8200,
        query: "human review approval node output",
        queryWarnings: [],
        sources: ["CODE"],
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
      result: {
        ...defaultUnifiedSearchOutcome.result,
        query: "human review approval node output",
        results: [],
        page: {
          ...defaultUnifiedSearchOutcome.result.page,
          returned: 0,
        },
        sourceStatus: [
          {
            ...source,
            targetLabel: "npm:n8n@2.36.7",
            resultCount: 0,
            indexingStatus: "INDEXING",
            codeIndexState: "PENDING",
          },
          {
            ...source,
            source: "DOCS",
            targetLabel: "npm:n8n@2.36.7",
            resultCount: 0,
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
          },
        ],
      },
    };
    const deps = createDeps({
      codeNavigationService: createMockCodeNavigationService({
        search: mock(() => Promise.resolve(outcome)),
        searchStatus: mock(() => Promise.resolve(outcome)),
      }),
    });

    await searchAction(
      "human review approval node output",
      { in: ["npm:n8n"] },
      deps,
    );
    const initial = String(consoleSpy.mock.calls[0]?.[0]);
    expect(initial).toBe(
      [
        "Indexing - no results yet",
        "",
        "- npm:n8n -> 2.36.7",
        "  Indexing: code, repository docs | Available now: n8n.io docs (1,480 pages;",
        "  capped), versions 2.26.9, 2.26.5, 2.23.2 +2, refs HEAD, master",
        "",
        "Search n8n-search-ref | 0/1 target ready",
        "Next: githits search-status n8n-search-ref --wait 20",
      ].join("\n"),
    );
    expect(initial.match(/^Indexing\b/gm)).toHaveLength(1);
    expect(initial.match(/^Search /gm)).toHaveLength(1);
    expect(initial.match(/^Next:/gm)).toHaveLength(1);
    expect(initial.match(/n8n-search-ref/g)).toHaveLength(2);
    expect(initial).not.toContain("search_status search_ref=");
    expect(initial).not.toContain("Warning:");
    expect(initial).not.toContain("Evidence may change");
    expect(initial).not.toContain("Do not repeat");
    expect(initial).not.toContain("Do not poll");

    await searchStatusAction("n8n-search-ref", {}, deps);
    const status = String(consoleSpy.mock.calls[1]?.[0]);
    expect(status).toBe(initial);
    consoleSpy.mockRestore();
  });

  it("renders documentation evidence on incomplete initial searches", async () => {
    const consoleSpy = spyOn(console, "log").mockImplementation(() => {});
    const incomplete = createIncompleteOutcome("INDEXING", "search-ref-docs");
    incomplete.result = createDocumentationSearchResult();

    await searchAction(
      "router",
      { in: ["npm:express"], source: "docs" },
      createDeps({
        codeNavigationService: createMockCodeNavigationService({
          search: mock(() => Promise.resolve(incomplete)),
        }),
      }),
    );

    const output = String(consoleSpy.mock.calls[0]?.[0]);
    expect(output.split("\n")[0]).toBe("Indexing - no results yet");
    expect(output).toContain("- npm:express@5.1.0");
    expect(output).toMatch(/Searched:\s+repository\s+docs/);
    expect(output).toMatch(
      /Available now: expressjs\.com\/en\/guide docs \(120 pages; partial\)/,
    );
    expect(output).not.toContain("Evidence may change.");
    expect(output).toContain("githits search-status search-ref-docs");
    consoleSpy.mockRestore();
  });

  it("renders terminal deferred initial evidence with a positive recovery action", async () => {
    const consoleSpy = spyOn(console, "log").mockImplementation(() => {});
    const incomplete = createIncompleteOutcome("DEFERRED", "ref-deferred");
    incomplete.result = {
      ...createDivergentIndexingSearchResult(),
      evidenceNotice: "Stored evidence remains usable.",
    };

    await searchAction(
      "router",
      { in: ["npm:express"] },
      createDeps({
        codeNavigationService: createMockCodeNavigationService({
          search: mock(() => Promise.resolve(incomplete)),
        }),
      }),
    );

    const output = String(consoleSpy.mock.calls[0]?.[0]);
    expect(output.split("\n")[0]).toBe("DEFERRED - 1 result returned");
    expect(output).toContain("- npm:express@4.18.2");
    expect(output).toContain(
      "[1] npm:express@4.18.2 lib/router/index.js:42-57 [repo code] - router middleware",
    );
    expect(output).toContain("Search ref-deferred | 0/1 target ready");
    expect(output).toContain("Next: rerun search later.");
    expect(output).not.toContain("githits search-status");
    expect(output).not.toContain("re-run with the searchRef");
    expect(output).not.toContain("still indexing");
    expect(output).not.toContain("No results");
    expect(output).not.toContain("Indexing/search still in progress");
    consoleSpy.mockRestore();
  });

  it("preserves initial evidence for an unrecognized status with a positive recovery action", async () => {
    const consoleSpy = spyOn(console, "log").mockImplementation(() => {});
    const incomplete = createIncompleteOutcome(
      "FUTURE_SESSION_STATE",
      "ref-future",
    );
    incomplete.result = {
      ...createDivergentIndexingSearchResult(),
      evidenceNotice: "Stored evidence remains usable.",
    };

    await searchAction(
      "router",
      { in: ["npm:express"] },
      createDeps({
        codeNavigationService: createMockCodeNavigationService({
          search: mock(() => Promise.resolve(incomplete)),
        }),
      }),
    );

    const output = String(consoleSpy.mock.calls[0]?.[0]);
    expect(output.split("\n")[0]).toBe(
      "FUTURE_SESSION_STATE - 1 result returned",
    );
    expect(output).toContain("- npm:express@4.18.2");
    expect(output).toContain(
      "[1] npm:express@4.18.2 lib/router/index.js:42-57 [repo code] - router middleware",
    );
    expect(output).toContain("Search ref-future | 0/1 target ready");
    expect(output).toContain("Next: rerun search later.");
    expect(output).not.toContain("githits search-status");
    expect(output).not.toContain("re-run with the searchRef");
    expect(output).not.toContain("still indexing");
    expect(output).not.toContain("No results");
    expect(output).not.toContain("terminal");
    consoleSpy.mockRestore();
  });

  it("preserves warnings and attributed site guidance for empty incomplete results", async () => {
    const consoleSpy = spyOn(console, "log").mockImplementation(() => {});
    if (defaultUnifiedSearchOutcome.state !== "completed") {
      throw new Error("expected completed outcome fixture");
    }
    const incomplete = createIncompleteOutcome("INDEXING", "search-ref-site");
    incomplete.result = {
      ...defaultUnifiedSearchOutcome.result,
      results: [],
      sourceStatus: [
        {
          source: "DOCS",
          targetLabel: "site:example.com",
          indexingStatus: "INDEXING",
          appliedFilters: [],
          ignoredFilters: [],
          incompatibleFilters: ["language"],
          appliedQueryFeatures: [],
          ignoredQueryFeatures: [],
          incompatibleQueryFeatures: [],
          suggestedSiteTargets: ["site:docs.example.com"],
          suggestedSiteTargetsTruncated: true,
          contributors: [],
        },
      ],
    };

    await searchAction(
      "router",
      { in: ["site:example.com"], source: "docs" },
      createDeps({
        codeNavigationService: createMockCodeNavigationService({
          search: mock(() => Promise.resolve(incomplete)),
        }),
      }),
    );

    const output = String(consoleSpy.mock.calls[0]?.[0]);
    expect(output.split("\n")[0]).toBe("Indexing - no results yet");
    expect(output).toContain("- site:example.com");
    expect(output).toContain("Indexing: site:example.com docs");
    expect(output).toContain(
      "Incompatible filter (site:example.com): language",
    );
    expect(output).toContain("Suggested sites: site:docs.example.com");
    expect(output).toContain("More suggested sites omitted");
    expect(output).toContain("Search search-ref-site | 0/1 target ready");
    expect(output).toContain(
      "Next: githits search-status search-ref-site --wait 20",
    );
    consoleSpy.mockRestore();
  });

  it("prints one compact source-status warning when a filter is ignored", async () => {
    const consoleSpy = spyOn(console, "log").mockImplementation(() => {});

    if (defaultUnifiedSearchOutcome.state !== "completed") {
      throw new Error("expected completed outcome fixture");
    }
    const completedOutcome = defaultUnifiedSearchOutcome;
    const outcomeWithIgnoredFilters: UnifiedSearchOutcome = {
      ...completedOutcome,
      result: {
        ...completedOutcome.result,
        sourceStatus: [
          {
            source: "DOCS",
            targetLabel: "npm:express@4.18.2",
            indexingStatus: "INDEXED",
            resultCount: 1,
            ignoredFilters: ["fileIntent"],
            incompatibleFilters: [],
            appliedFilters: [],
            appliedQueryFeatures: [],
            ignoredQueryFeatures: [],
            incompatibleQueryFeatures: [],
            suggestedSiteTargets: [],
            suggestedSiteTargetsTruncated: false,
            contributors: [],
          },
        ],
      },
    };

    await searchAction(
      "router middleware",
      { in: ["npm:express"], intent: "production" },
      createDeps({
        codeNavigationService: createMockCodeNavigationService({
          search: mock(() => Promise.resolve(outcomeWithIgnoredFilters)),
        }),
      }),
    );

    const output = String(consoleSpy.mock.calls[0]?.[0]);
    expect(output).toContain("Ignored filter (npm:express@4.18.2): fileIntent");
    expect(output).not.toContain("Note: docs on npm:express@4.18.2");
    consoleSpy.mockRestore();
  });

  it("renders ignored and incompatible query-feature warnings once", async () => {
    const consoleSpy = spyOn(console, "log").mockImplementation(() => {});

    if (defaultUnifiedSearchOutcome.state !== "completed") {
      throw new Error("expected completed outcome fixture");
    }
    const completedOutcome = defaultUnifiedSearchOutcome;
    const outcomeWithQueryFeatures: UnifiedSearchOutcome = {
      ...completedOutcome,
      result: {
        ...completedOutcome.result,
        sourceStatus: [
          {
            source: "DOCS",
            targetLabel: "npm:express@4.18.2",
            indexingStatus: "INDEXED",
            resultCount: 1,
            ignoredFilters: [],
            incompatibleFilters: [],
            appliedFilters: [],
            appliedQueryFeatures: [],
            ignoredQueryFeatures: ["kind"],
            incompatibleQueryFeatures: ["name"],
            suggestedSiteTargets: [],
            suggestedSiteTargetsTruncated: false,
            contributors: [],
          },
        ],
      },
    };

    await searchAction(
      "router middleware",
      { in: ["npm:express"] },
      createDeps({
        codeNavigationService: createMockCodeNavigationService({
          search: mock(() => Promise.resolve(outcomeWithQueryFeatures)),
        }),
      }),
    );

    const output = String(consoleSpy.mock.calls[0]?.[0]);
    expect(output).toContain(
      "Ignored query feature (npm:express@4.18.2): kind",
    );
    expect(output).toContain(
      "Incompatible query feature (npm:express@4.18.2): name",
    );
    expect(output).not.toContain("Note: docs on npm:express@4.18.2");
    consoleSpy.mockRestore();
  });

  it("prints promoted freshness warnings in terminal output", async () => {
    const consoleSpy = spyOn(console, "log").mockImplementation(() => {});

    if (defaultUnifiedSearchOutcome.state !== "completed") {
      throw new Error("expected completed outcome fixture");
    }

    const outcomeWithStaleFreshness: UnifiedSearchOutcome = {
      ...defaultUnifiedSearchOutcome,
      result: {
        ...defaultUnifiedSearchOutcome.result,
        results: defaultUnifiedSearchOutcome.result.results.map(
          (entry, index) =>
            index === 0
              ? {
                  ...entry,
                  requestedTargetLabel: "npm:express latest",
                  freshTargetLabel: "npm:express@5.2.1",
                  servedTargetLabel: "npm:express@5.1.0",
                  freshness: "STALE",
                }
              : entry,
        ),
      },
    };

    await searchAction(
      "router middleware",
      { in: ["npm:express"] },
      createDeps({
        codeNavigationService: createMockCodeNavigationService({
          search: mock(() => Promise.resolve(outcomeWithStaleFreshness)),
        }),
      }),
    );

    const output = String(consoleSpy.mock.calls[0]?.[0]);
    expect(output).toContain("- npm:express latest -> 5.2.1");
    expect(output).toContain("Using: 5.1.0 while 5.2.1 indexes");
    expect(output).not.toContain("Evidence:");
    consoleSpy.mockRestore();
  });

  it("does not treat stale sourceStatus target metadata as incomplete when results completed", async () => {
    const consoleSpy = spyOn(console, "log").mockImplementation(() => {});

    if (defaultUnifiedSearchOutcome.state !== "completed") {
      throw new Error("expected completed outcome fixture");
    }

    const outcomeWithStaleSourceStatus: UnifiedSearchOutcome = {
      ...defaultUnifiedSearchOutcome,
      result: {
        ...defaultUnifiedSearchOutcome.result,
        sourceStatus: [
          {
            ...defaultUnifiedSearchOutcome.result.sourceStatus[0]!,
            indexingStatus: "INDEXING",
            codeIndexState: "INDEXING",
            targetResolution: {
              requested: {
                repoUrl: "https://github.com/expressjs/express",
                gitRef: "master",
              },
              resolvedRequested: {
                repoUrl: "https://github.com/expressjs/express",
                gitRef: "master",
                commitSha: "def456789abc",
              },
              served: {
                repoUrl: "https://github.com/expressjs/express",
                gitRef: "master",
                commitSha: "abc123789def",
              },
              freshness: "indexing",
              freshnessReason: "requested_ref_indexing",
              indexingRef: "idx_123",
              availableVersions: [],
              availableRefs: [{ ref: "master" }],
            },
          },
        ],
      },
    };

    await searchAction(
      "router middleware",
      { in: ["github:expressjs/express#master"] },
      createDeps({
        codeNavigationService: createMockCodeNavigationService({
          search: mock(() => Promise.resolve(outcomeWithStaleSourceStatus)),
        }),
      }),
    );

    const output = String(consoleSpy.mock.calls[0]?.[0]);
    expect(output).toContain("1 result");
    expect(output).not.toContain("Search still in progress");
    expect(output).not.toContain("Indexing/search still in progress");
    expect(output).not.toContain("Warning: Search completed");
    consoleSpy.mockRestore();
  });

  it("keeps completed provisional hits visible with indexing guidance", async () => {
    const consoleSpy = spyOn(console, "log").mockImplementation(() => {});

    if (defaultUnifiedSearchOutcome.state !== "completed") {
      throw new Error("expected completed outcome fixture");
    }

    const outcomeWithProvisionalSourceStatus: UnifiedSearchOutcome = {
      ...defaultUnifiedSearchOutcome,
      result: {
        ...defaultUnifiedSearchOutcome.result,
        evidenceNotice:
          "Results may change while the provisional index continues indexing.",
        sourceStatus: [
          {
            ...defaultUnifiedSearchOutcome.result.sourceStatus[0]!,
            codeIndexState: "PROVISIONAL",
            targetResolution: {
              requested: {
                repoUrl: "https://github.com/expressjs/express",
                gitRef: "main",
              },
              served: {
                repoUrl: "https://github.com/expressjs/express",
                gitRef: "main",
                commitSha: "abc123789def",
              },
              freshness: "provisional",
              freshnessReason: "exact_provisional",
              indexingRef: "idx_123",
              availableVersions: [],
              availableRefs: [],
            },
          },
        ],
      },
    };

    await searchAction(
      "router middleware",
      { in: ["github:expressjs/express#main"] },
      createDeps({
        codeNavigationService: createMockCodeNavigationService({
          search: mock(() =>
            Promise.resolve(outcomeWithProvisionalSourceStatus),
          ),
        }),
      }),
    );

    const output = String(consoleSpy.mock.calls[0]?.[0]);
    expect(output).toContain("1 result");
    expect(output).toContain(
      "- npm:express@4.18.2\n  Indexing: provisional snapshot is searchable | Searched: code",
    );
    expect(output).not.toContain("Evidence may change.");
    expect(output).not.toContain("Evidence:");
    expect(output).toContain(
      "Next: githits search-status search-ref-123 --wait 20",
    );
    consoleSpy.mockRestore();
  });

  it("explains completed fallback_recent sourceStatus as a recent snapshot", async () => {
    const consoleSpy = spyOn(console, "log").mockImplementation(() => {});

    if (defaultUnifiedSearchOutcome.state !== "completed") {
      throw new Error("expected completed outcome fixture");
    }

    const outcomeWithFallbackSourceStatus: UnifiedSearchOutcome = {
      ...defaultUnifiedSearchOutcome,
      result: {
        ...defaultUnifiedSearchOutcome.result,
        sourceStatus: [
          {
            ...defaultUnifiedSearchOutcome.result.sourceStatus[0]!,
            targetLabel: "github:expressjs/express#refs/heads/master",
            targetResolution: {
              requested: {
                repoUrl: "https://github.com/expressjs/express",
                gitRef: "refs/heads/master",
              },
              resolvedRequested: {
                repoUrl: "https://github.com/expressjs/express",
                gitRef: "refs/heads/master",
                commitSha: "def456789abc",
              },
              served: {
                repoUrl: "https://github.com/expressjs/express",
                gitRef: "master",
                commitSha: "abc123789def",
              },
              freshness: "fallback_recent",
              freshnessReason: "ref_resolution_deferred",
              availableVersions: [],
              availableRefs: [{ ref: "master" }],
            },
          },
        ],
      },
    };

    await searchAction(
      "router middleware",
      { in: ["github:expressjs/express#refs/heads/master"] },
      createDeps({
        codeNavigationService: createMockCodeNavigationService({
          search: mock(() => Promise.resolve(outcomeWithFallbackSourceStatus)),
        }),
      }),
    );

    const output = String(consoleSpy.mock.calls[0]?.[0]);
    expect(output).toContain("- github:expressjs/express#refs/heads/master");
    expect(output).toContain("Using: refs/heads/master (older snapshot)");
    expect(output).toMatch(/Available now:\s+refs master/);
    expect(output).not.toContain("Evidence:");
    expect(output).not.toContain("Indexed alternatives:");
    expect(output).not.toContain("Next: githits search-status");
    consoleSpy.mockRestore();
  });

  it("renders backend summaries verbatim in terminal output", async () => {
    const consoleSpy = spyOn(console, "log").mockImplementation(() => {});

    if (defaultUnifiedSearchOutcome.state !== "completed") {
      throw new Error("expected completed outcome fixture");
    }

    const outcomeWithLongSummary: UnifiedSearchOutcome = {
      ...defaultUnifiedSearchOutcome,
      result: {
        ...defaultUnifiedSearchOutcome.result,
        results: [
          {
            ...defaultUnifiedSearchOutcome.result.results[0]!,
            summary: [
              "line 1",
              "line 2",
              "line 3",
              "line 4",
              "line 5",
              "line 6",
              "line 7",
            ].join("\n"),
          },
        ],
      },
    };

    await searchAction(
      "router middleware",
      { in: ["npm:express"] },
      createDeps({
        codeNavigationService: createMockCodeNavigationService({
          search: mock(() => Promise.resolve(outcomeWithLongSummary)),
        }),
      }),
    );

    const output = String(consoleSpy.mock.calls[0]?.[0]);
    expect(output).toContain("  line 6");
    expect(output).toContain("  line 7");
    consoleSpy.mockRestore();
  });

  it("renders search highlight spans in terminal output when colors are enabled", async () => {
    const consoleSpy = spyOn(console, "log").mockImplementation(() => {});
    const originalIsTTY = process.stdout.isTTY;
    const noColor = process.env.NO_COLOR;
    try {
      delete process.env.NO_COLOR;
      Object.defineProperty(process.stdout, "isTTY", {
        value: true,
        configurable: true,
      });

      await searchAction(
        "router middleware",
        { in: ["npm:express"] },
        createDeps(),
      );

      const output = String(consoleSpy.mock.calls[0]?.[0]);
      expect(output).toContain(
        "\u001b[1m\u001b[36mnpm:express@4.18.2 lib/router/index.js:42-57 [repo code] - router middleware\u001b[0m",
      );
      expect(output).toContain(
        "function \u001b[1m\u001b[33mrouter\u001b[0m(req, res, next) { ... }",
      );
      expect(output).toContain(
        "\u001b[1m\u001b[36mnpm:express@4.18.2 lib/router/index.js:42-57 [repo code] - router middleware\u001b[0m",
      );
    } finally {
      consoleSpy.mockRestore();
      Object.defineProperty(process.stdout, "isTTY", {
        value: originalIsTTY,
        configurable: true,
      });
      if (noColor === undefined) {
        delete process.env.NO_COLOR;
      } else {
        process.env.NO_COLOR = noColor;
      }
    }
  });

  it("keeps color output text-identical after ANSI is stripped", async () => {
    const consoleSpy = spyOn(console, "log").mockImplementation(() => {});
    const originalIsTTY = process.stdout.isTTY;
    const noColor = process.env.NO_COLOR;
    try {
      delete process.env.NO_COLOR;
      Object.defineProperty(process.stdout, "isTTY", {
        value: true,
        configurable: true,
      });

      await searchAction(
        "router middleware",
        { in: ["npm:express"] },
        createDeps(),
      );

      const colorOutput = String(consoleSpy.mock.calls[0]?.[0]);

      process.env.NO_COLOR = "1";
      await searchAction(
        "router middleware",
        { in: ["npm:express"] },
        createDeps(),
      );

      const plainOutput = String(consoleSpy.mock.calls[1]?.[0]);
      expect(colorOutput).toContain("\u001b[");
      expect(plainOutput).not.toContain("\u001b[");
      expect(stripAnsi(colorOutput)).toBe(plainOutput);
    } finally {
      consoleSpy.mockRestore();
      Object.defineProperty(process.stdout, "isTTY", {
        value: originalIsTTY,
        configurable: true,
      });
      if (noColor === undefined) {
        delete process.env.NO_COLOR;
      } else {
        process.env.NO_COLOR = noColor;
      }
    }
  });

  it("preserves CRLF-based summary highlight offsets", async () => {
    const consoleSpy = spyOn(console, "log").mockImplementation(() => {});
    const originalIsTTY = process.stdout.isTTY;
    const noColor = process.env.NO_COLOR;

    if (defaultUnifiedSearchOutcome.state !== "completed") {
      throw new Error("expected completed outcome fixture");
    }

    const crlfOutcome: UnifiedSearchOutcome = {
      ...defaultUnifiedSearchOutcome,
      result: {
        ...defaultUnifiedSearchOutcome.result,
        results: [
          {
            ...defaultUnifiedSearchOutcome.result.results[0]!,
            summary: "line 1\r\nline 2",
            highlights: {
              summary: [[8, 14]],
            },
          },
        ],
      },
    };

    try {
      delete process.env.NO_COLOR;
      Object.defineProperty(process.stdout, "isTTY", {
        value: true,
        configurable: true,
      });

      await searchAction(
        "router middleware",
        { in: ["npm:express"] },
        createDeps({
          codeNavigationService: createMockCodeNavigationService({
            search: mock(() => Promise.resolve(crlfOutcome)),
          }),
        }),
      );

      const output = String(consoleSpy.mock.calls[0]?.[0]);
      expect(output).toContain("  line 1");
      expect(output).toContain(
        `  ${"\u001b[1m\u001b[33m"}line 2${"\u001b[0m"}`,
      );
    } finally {
      consoleSpy.mockRestore();
      Object.defineProperty(process.stdout, "isTTY", {
        value: originalIsTTY,
        configurable: true,
      });
      if (noColor === undefined) {
        delete process.env.NO_COLOR;
      } else {
        process.env.NO_COLOR = noColor;
      }
    }
  });

  it("shows direct source URLs and retains page IDs for documentation pages", async () => {
    const consoleSpy = spyOn(console, "log").mockImplementation(() => {});

    if (defaultUnifiedSearchOutcome.state !== "completed") {
      throw new Error("expected completed outcome fixture");
    }

    const docsOutcome: UnifiedSearchOutcome = {
      ...defaultUnifiedSearchOutcome,
      result: {
        ...defaultUnifiedSearchOutcome.result,
        results: [
          {
            ...defaultUnifiedSearchOutcome.result.results[0]!,
            resultType: "DOCUMENTATION_PAGE",
            title: "Using Express middleware",
            highlights: undefined,
            locator: {
              registry: "npm",
              packageName: "express",
              version: "5.2.1",
              pageId: "docs-123",
              sourceKind: "CRAWLED",
              sourceUrl: "https://hexdocs.pm/express/getting-started.html",
            },
          },
        ],
      },
    };

    await searchAction(
      "router middleware",
      { in: ["npm:express"] },
      createDeps({
        codeNavigationService: createMockCodeNavigationService({
          search: mock(() => Promise.resolve(docsOutcome)),
        }),
      }),
    );

    const output = String(consoleSpy.mock.calls[0]?.[0]);
    expect(output).toContain(
      "[1] docs-123 [docs page] npm:express - hexdocs.pm/express/getting-started.html - Using Express middleware",
    );
    expect(output).toContain("hexdocs.pm/express/getting-started.html");
    expect(output).toContain("docs-123");
    expect(output).toContain("Using Express middleware");
    expect(output).not.toContain("source:");
    expect(output).not.toContain("npm:express@4.18.2 [docs page]");
    expect(output).not.toContain("read:");
    consoleSpy.mockRestore();
  });

  it("falls back to target attribution for docs pages without package locator fields", async () => {
    const consoleSpy = spyOn(console, "log").mockImplementation(() => {});

    if (defaultUnifiedSearchOutcome.state !== "completed") {
      throw new Error("expected completed outcome fixture");
    }

    const docsOutcome: UnifiedSearchOutcome = {
      ...defaultUnifiedSearchOutcome,
      result: {
        ...defaultUnifiedSearchOutcome.result,
        results: [
          {
            ...defaultUnifiedSearchOutcome.result.results[0]!,
            resultType: "DOCUMENTATION_PAGE",
            targetLabel: "docs.example@stable",
            title: "Routing",
            highlights: undefined,
            locator: {
              pageId: "docs-routing",
              sourceKind: "CRAWLED",
              sourceUrl: "https://docs.example/routing",
            },
          },
        ],
      },
    };

    await searchAction(
      "router middleware",
      { in: ["npm:express"] },
      createDeps({
        codeNavigationService: createMockCodeNavigationService({
          search: mock(() => Promise.resolve(docsOutcome)),
        }),
      }),
    );

    const output = String(consoleSpy.mock.calls[0]?.[0]);
    expect(output).toContain(
      "[1] docs-routing [docs page] docs.example - docs.example/routing - Routing",
    );
    expect(output).toContain("docs.example/routing");
    expect(output).toContain("Routing");
    consoleSpy.mockRestore();
  });
});

describe("searchStatusAction", () => {
  const mcpUrl = "https://mcp.githits.com";

  function createIncompleteOutcome(
    status: UnifiedSearchSessionStatus,
    searchRef: string,
    progressOverrides: Partial<UnifiedSearchProgress> = {},
  ): UnifiedSearchIncomplete {
    return {
      state: "incomplete",
      completed: false,
      searchRef,
      progress: {
        searchRef,
        status,
        targetsTotal: 1,
        targetsReady: 0,
        elapsedMs: 100,
        query: "router",
        queryWarnings: [],
        sources: ["CODE"],
        ...progressOverrides,
      },
    };
  }

  function createDeps(
    overrides: Partial<SearchDependencies> = {},
  ): SearchDependencies {
    return {
      codeNavigationService: createMockCodeNavigationService(),
      codeNavigationUrl: "https://nav.example.com",
      hasValidToken: true,
      mcpUrl,
      ...overrides,
    };
  }

  it("preserves CLI auth remediation when search-status service auth fails", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });

    await expect(
      searchStatusAction(
        "search-ref-123",
        {},
        createDeps({
          codeNavigationService: createMockCodeNavigationService({
            searchStatus: mock(() => Promise.reject(new AuthenticationError())),
          }),
        }),
      ),
    ).rejects.toThrow("process.exit");

    expect(errorSpy.mock.calls[0]?.[0]).toBe(
      "Authentication required. Run `githits login` to authenticate or set GITHITS_API_TOKEN.",
    );
    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("preserves CLI terms remediation in JSON search-status errors", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });

    try {
      await expect(
        searchStatusAction(
          "search-ref-123",
          { json: true },
          createDeps({
            codeNavigationService: createMockCodeNavigationService({
              searchStatus: mock(() =>
                Promise.reject(new TermsAcceptanceRequiredError()),
              ),
            }),
          }),
        ),
      ).rejects.toThrow("process.exit");

      expect(JSON.parse(String(errorSpy.mock.calls[0]?.[0]))).toEqual(
        CLI_TERMS_ERROR_PAYLOAD,
      );
    } finally {
      errorSpy.mockRestore();
      exitSpy.mockRestore();
    }
  });

  it("outputs progress for incomplete search refs", async () => {
    const consoleSpy = spyOn(console, "log").mockImplementation(() => {});

    await searchStatusAction(
      "search-ref-123",
      {},
      createDeps({
        codeNavigationService: createMockCodeNavigationService({
          searchStatus: mock(() =>
            Promise.resolve(
              createIncompleteOutcome("SEARCHING", "search-ref-123", {
                targetsReady: 1,
                elapsedMs: 300,
              }),
            ),
          ),
        }),
      }),
    );

    const output = String(consoleSpy.mock.calls[0]?.[0]);
    expect(output.split("\n")[0]).toBe("Searching - no result snapshot yet");
    expect(output).toContain("Search search-ref-123 | 1/1 target ready");
    expect(output).toContain(
      "Next: githits search-status search-ref-123 --wait 20",
    );
    consoleSpy.mockRestore();
  });

  it("renders progress warnings when incomplete status has no result", async () => {
    const consoleSpy = spyOn(console, "log").mockImplementation(() => {});

    await searchStatusAction(
      "search-ref-stale",
      {},
      createDeps({
        codeNavigationService: createMockCodeNavigationService({
          searchStatus: mock(() =>
            Promise.resolve(
              createIncompleteOutcome("INDEXING", "search-ref-stale", {
                targets: [
                  {
                    requested: "site:example.com",
                    resolvedRequested: "site:example.com",
                    served: "site:example.com/old",
                    freshness: "STALE",
                  },
                ],
              }),
            ),
          ),
        }),
      }),
    );

    const output = String(consoleSpy.mock.calls[0]?.[0]);
    expect(output.split("\n")[0]).toBe("Indexing - no result snapshot yet");
    expect(output).toContain("- site:example.com");
    expect(output).toContain("Search search-ref-stale | 0/1 target ready");
    expect(output).toContain(
      "Next: githits search-status search-ref-stale --wait 20",
    );
    consoleSpy.mockRestore();
  });

  it("merges progress warnings with incomplete site recovery guidance", async () => {
    const consoleSpy = spyOn(console, "log").mockImplementation(() => {});
    if (defaultUnifiedSearchOutcome.state !== "completed") {
      throw new Error("expected completed outcome fixture");
    }
    const incomplete = createIncompleteOutcome("INDEXING", "search-ref-site", {
      targets: [
        {
          requested: "site:example.com",
          resolvedRequested: "site:example.com",
          served: "site:example.com/old",
          freshness: "STALE",
        },
      ],
    });
    incomplete.result = {
      ...defaultUnifiedSearchOutcome.result,
      results: [],
      sourceStatus: [
        {
          source: "DOCS",
          targetLabel: "site:example.com",
          appliedFilters: [],
          ignoredFilters: [],
          incompatibleFilters: [],
          appliedQueryFeatures: [],
          ignoredQueryFeatures: [],
          incompatibleQueryFeatures: [],
          suggestedSiteTargets: ["site:docs.example.com"],
          suggestedSiteTargetsTruncated: false,
          contributors: [],
        },
      ],
    };

    await searchStatusAction(
      incomplete.searchRef,
      {},
      createDeps({
        codeNavigationService: createMockCodeNavigationService({
          searchStatus: mock(() => Promise.resolve(incomplete)),
        }),
      }),
    );

    const output = String(consoleSpy.mock.calls[0]?.[0]);
    expect(output.split("\n")[0]).toBe("Indexing - no results yet");
    expect(output).toContain("- site:example.com");
    expect(output).toMatch(/Searched:\s+site:example.com docs/);
    expect(output).toContain("Suggested sites: site:docs.example.com");
    expect(output).toContain("Search search-ref-site | 0/1 target ready");
    expect(output).toContain(
      "Next: githits search-status search-ref-site --wait 20",
    );
    consoleSpy.mockRestore();
  });

  it("waits up to the shared default and forwards an explicit status wait", async () => {
    const searchStatus = mock((_searchRef: string, _waitTimeoutMs?: number) =>
      Promise.resolve(createIncompleteOutcome("SEARCHING", "search-ref-wait")),
    );
    const deps = createDeps({
      codeNavigationService: createMockCodeNavigationService({ searchStatus }),
    });
    const consoleSpy = spyOn(console, "log").mockImplementation(() => {});

    await searchStatusAction("search-ref-wait", {}, deps);
    expect(searchStatus.mock.calls[0]).toEqual(["search-ref-wait", 20_000]);

    searchStatus.mockClear();
    await searchStatusAction("search-ref-wait", { wait: "45" }, deps);
    expect(searchStatus.mock.calls[0]).toEqual(["search-ref-wait", 45_000]);

    consoleSpy.mockRestore();
  });

  it("rejects an out-of-range search-status wait", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });

    try {
      await expect(
        searchStatusAction("search-ref-wait", { wait: "61" }, createDeps()),
      ).rejects.toThrow("process.exit");
      expect(String(errorSpy.mock.calls[0]?.[0])).toContain(
        "--wait expects an integer between 0 and 60. Got 61.",
      );
    } finally {
      errorSpy.mockRestore();
      exitSpy.mockRestore();
    }
  });

  it("includes target details for incomplete search refs", async () => {
    const consoleSpy = spyOn(console, "log").mockImplementation(() => {});

    await searchStatusAction(
      "search-ref-123",
      {},
      createDeps({
        codeNavigationService: createMockCodeNavigationService({
          searchStatus: mock(() =>
            Promise.resolve(
              createIncompleteOutcome("INDEXING", "search-ref-123", {
                targets: [
                  {
                    requested: "github:expressjs/express#refs/heads/master",
                    resolvedRequested: "github:expressjs/express#master",
                    served: "github:expressjs/express#master",
                    freshness: "indexing",
                    requestedRefKind: "BRANCH",
                    indexingRef: "idx_123",
                    targetResolution: {
                      requested: {
                        repoUrl: "https://github.com/expressjs/express",
                        gitRef: "refs/heads/master",
                      },
                      resolvedRequested: {
                        repoUrl: "https://github.com/expressjs/express",
                        gitRef: "master",
                        commitSha: "def456789abc",
                      },
                      freshness: "indexing",
                      freshnessReason: "requested_ref_indexing",
                      indexingRef: "idx_123",
                      availableVersions: [],
                      availableRefs: [{ ref: "master" }],
                    },
                    availableRefs: [{ ref: "master" }],
                  },
                ],
              }),
            ),
          ),
        }),
      }),
    );

    const output = String(consoleSpy.mock.calls[0]?.[0]);
    expect(output.split("\n")[0]).toBe("Indexing - no result snapshot yet");
    expect(output).toContain(
      "- github:expressjs/express#refs/heads/master -> master",
    );
    expect(output).toContain("Status: indexing | Available now: refs master");
    expect(output).toContain("Search search-ref-123 | 0/1 target ready");
    expect(output).toContain(
      "Next: githits search-status search-ref-123 --wait 20",
    );
    consoleSpy.mockRestore();
  });

  it("renders TIMEOUT as terminal status instead of in-progress", async () => {
    const consoleSpy = spyOn(console, "log").mockImplementation(() => {});

    await searchStatusAction(
      "search-ref-timeout",
      {},
      createDeps({
        codeNavigationService: createMockCodeNavigationService({
          searchStatus: mock(() =>
            Promise.resolve(
              createIncompleteOutcome("TIMEOUT", "search-ref-timeout", {
                elapsedMs: 20_000,
              }),
            ),
          ),
        }),
      }),
    );

    const output = String(consoleSpy.mock.calls[0]?.[0]);
    expect(output.split("\n")[0]).toBe("TIMEOUT - no result snapshot returned");
    expect(output).toContain("Search search-ref-timeout | 0/1 target ready");
    expect(output).toContain("Next: rerun search later.");
    expect(output).not.toContain("longer wait");
    expect(output).not.toContain("Search still in progress.");
    consoleSpy.mockRestore();
  });

  it("replaces polling guidance in terminal search-status JSON", async () => {
    const consoleSpy = spyOn(console, "log").mockImplementation(() => {});

    await searchStatusAction(
      "search-ref-timeout",
      { json: true },
      createDeps({
        codeNavigationService: createMockCodeNavigationService({
          searchStatus: mock(() =>
            Promise.resolve(
              createIncompleteOutcome("TIMEOUT", "search-ref-timeout"),
            ),
          ),
        }),
      }),
    );

    const payload = JSON.parse(String(consoleSpy.mock.calls[0]?.[0]));
    expect(payload.progress.next).toBe("rerun search");
    expect(payload.progress.next).not.toContain("search_status");
    consoleSpy.mockRestore();
  });

  it("renders terminal deferred search-status evidence without polling it", async () => {
    const consoleSpy = spyOn(console, "log").mockImplementation(() => {});
    if (defaultUnifiedSearchOutcome.state !== "completed") {
      throw new Error("expected completed outcome fixture");
    }
    const incomplete = createIncompleteOutcome("DEFERRED", "ref-deferred", {
      targetsReady: 1,
      targetsTotal: 2,
      elapsedMs: 600_000,
    });
    incomplete.result = {
      ...defaultUnifiedSearchOutcome.result,
      evidenceNotice: "Stored evidence remains usable.",
    };

    await searchStatusAction(
      "ref-deferred",
      {},
      createDeps({
        codeNavigationService: createMockCodeNavigationService({
          searchStatus: mock(() => Promise.resolve(incomplete)),
        }),
      }),
    );

    const output = String(consoleSpy.mock.calls[0]?.[0]);
    expect(output.split("\n")[0]).toBe("DEFERRED - 1 result returned");
    expect(output).toContain(
      "[1] npm:express@4.18.2 lib/router/index.js:42-57 [repo code] - router middleware",
    );
    expect(output).toContain("Search ref-deferred | 1/2 targets ready");
    expect(output).toContain("Next: rerun search later.");
    expect(output).not.toContain("githits search-status");
    expect(output).not.toContain("No results");
    expect(output).not.toContain("Indexing/search still in progress");
    consoleSpy.mockRestore();
  });

  it("preserves search-status evidence for an unrecognized status", async () => {
    const consoleSpy = spyOn(console, "log").mockImplementation(() => {});
    if (defaultUnifiedSearchOutcome.state !== "completed") {
      throw new Error("expected completed outcome fixture");
    }
    const incomplete = createIncompleteOutcome(
      "FUTURE_SESSION_STATE",
      "ref-future",
    );
    incomplete.result = {
      ...defaultUnifiedSearchOutcome.result,
      evidenceNotice: "Stored evidence remains usable.",
    };

    await searchStatusAction(
      "ref-future",
      {},
      createDeps({
        codeNavigationService: createMockCodeNavigationService({
          searchStatus: mock(() => Promise.resolve(incomplete)),
        }),
      }),
    );

    const output = String(consoleSpy.mock.calls[0]?.[0]);
    expect(output.split("\n")[0]).toBe(
      "FUTURE_SESSION_STATE - 1 result returned",
    );
    expect(output).toContain(
      "[1] npm:express@4.18.2 lib/router/index.js:42-57 [repo code] - router middleware",
    );
    expect(output).toContain("Search ref-future | 0/1 target ready");
    expect(output).toContain("Next: rerun search later.");
    expect(output).not.toContain("githits search-status");
    expect(output).not.toContain("No results");
    expect(output).not.toContain("Indexing/search still in progress");
    expect(output).not.toContain("terminal");
    consoleSpy.mockRestore();
  });

  it("does not invent results or indexing for deferred search-status", async () => {
    const consoleSpy = spyOn(console, "log").mockImplementation(() => {});

    await searchStatusAction(
      "ref-deferred-empty",
      {},
      createDeps({
        codeNavigationService: createMockCodeNavigationService({
          searchStatus: mock(() =>
            Promise.resolve(
              createIncompleteOutcome("DEFERRED", "ref-deferred-empty"),
            ),
          ),
        }),
      }),
    );

    const output = String(consoleSpy.mock.calls[0]?.[0]);
    expect(output.split("\n")[0]).toBe(
      "DEFERRED - no result snapshot returned",
    );
    expect(output).toContain("Search ref-deferred-empty | 0/1 target ready");
    expect(output).toContain("Next: rerun search later.");
    expect(output).not.toContain("No results");
    expect(output).not.toContain("Indexing/search still in progress");
    expect(output).not.toContain("githits search-status");
    consoleSpy.mockRestore();
  });

  it("renders FAILED as terminal status instead of in-progress", async () => {
    const consoleSpy = spyOn(console, "log").mockImplementation(() => {});

    await searchStatusAction(
      "search-ref-failed",
      {},
      createDeps({
        codeNavigationService: createMockCodeNavigationService({
          searchStatus: mock(() =>
            Promise.resolve(
              createIncompleteOutcome("FAILED", "search-ref-failed", {
                elapsedMs: 500,
              }),
            ),
          ),
        }),
      }),
    );

    const output = String(consoleSpy.mock.calls[0]?.[0]);
    expect(output.split("\n")[0]).toBe("FAILED - no result snapshot returned");
    expect(output).not.toContain("Search still in progress.");
    consoleSpy.mockRestore();
  });

  it.each(["TIMEOUT", "FAILED"] as const)(
    "does not add active indexing follow-up to terminal %s evidence",
    async (status) => {
      const consoleSpy = spyOn(console, "log").mockImplementation(() => {});
      const incomplete = createIncompleteOutcome(
        status,
        `search-ref-${status.toLowerCase()}`,
      );
      incomplete.result = createDivergentIndexingSearchResult();

      await searchStatusAction(
        incomplete.searchRef,
        {},
        createDeps({
          codeNavigationService: createMockCodeNavigationService({
            searchStatus: mock(() => Promise.resolve(incomplete)),
          }),
        }),
      );

      const output = String(consoleSpy.mock.calls[0]?.[0]);
      expect(output).not.toContain("re-run with the searchRef");
      expect(output).not.toContain("still indexing");
      expect(output).not.toContain("githits search-status");
      consoleSpy.mockRestore();
    },
  );

  it("outputs final JSON when completed", async () => {
    const consoleSpy = spyOn(console, "log").mockImplementation(() => {});

    await searchStatusAction("search-ref-123", { json: true }, createDeps());

    const payload = JSON.parse(String(consoleSpy.mock.calls[0]?.[0]));
    expect(payload.completed).toBe(true);
    expect(payload.searchRef).toBe("search-ref-123");
    expect(payload.result.query.raw).toBe("router middleware");
    expect(payload.result.results).toHaveLength(1);
    expect(payload).not.toHaveProperty("query.raw");
    consoleSpy.mockRestore();
  });

  it("renders stored documentation evidence without repeating completed status", async () => {
    const consoleSpy = spyOn(console, "log").mockImplementation(() => {});
    const result = createDocumentationSearchResult();
    const sourceStatus = result.sourceStatus[0];
    if (!sourceStatus) throw new Error("expected documentation source status");
    sourceStatus.indexingStatus = "INDEXING";
    const outcome: UnifiedSearchOutcome = {
      state: "completed",
      completed: true,
      searchRef: "search-ref-docs",
      result,
    };

    await searchStatusAction(
      "search-ref-docs",
      {},
      createDeps({
        codeNavigationService: createMockCodeNavigationService({
          searchStatus: mock(() => Promise.resolve(outcome)),
        }),
      }),
    );

    const output = String(consoleSpy.mock.calls[0]?.[0]);
    expect(output.split("\n")[0]).toBe("No results returned");
    expect(output).toContain("- npm:express@5.1.0");
    expect(output).toMatch(/Searched:\s+repository\s+docs/);
    expect(output).toMatch(
      /Available now: expressjs\.com\/en\/guide docs \(120 pages; partial\)/,
    );
    expect(output).not.toContain("Evidence may change.");
    expect(
      output.match(/githits search-status search-ref-docs --wait 20/g),
    ).toHaveLength(1);
    expect(output).not.toContain("Search completed");
    expect(output).not.toContain("re-run with the searchRef");
    consoleSpy.mockRestore();
  });

  it("gives stored unavailable documentation results a useful next step", async () => {
    const consoleSpy = spyOn(console, "log").mockImplementation(() => {});
    const result = createDocumentationSearchResult();
    result.evidenceNotice = undefined;
    const contributor = result.sourceStatus[0]?.contributors?.[1];
    if (!contributor) throw new Error("expected documentation contributor");
    contributor.state = "UNAVAILABLE";
    const outcome: UnifiedSearchOutcome = {
      state: "completed",
      completed: true,
      searchRef: "search-ref-docs",
      result,
    };

    await searchStatusAction(
      "search-ref-docs",
      {},
      createDeps({
        codeNavigationService: createMockCodeNavigationService({
          searchStatus: mock(() => Promise.resolve(outcome)),
        }),
      }),
    );

    const output = String(consoleSpy.mock.calls[0]?.[0]);
    expect(output.split("\n")[0]).toBe("No results returned");
    expect(output).toContain("- npm:express@5.1.0");
    expect(output).toMatch(/Searched:\s+repository\s+docs/);
    expect(output).toContain("Unavailable: expressjs.com/en/guide docs");
    consoleSpy.mockRestore();
  });

  it("keeps stored standalone-site guidance within applicable sources", async () => {
    const consoleSpy = spyOn(console, "log").mockImplementation(() => {});
    if (defaultUnifiedSearchOutcome.state !== "completed") {
      throw new Error("expected completed outcome fixture");
    }
    const outcome: UnifiedSearchOutcome = {
      ...defaultUnifiedSearchOutcome,
      result: {
        ...defaultUnifiedSearchOutcome.result,
        results: [],
        page: {
          ...defaultUnifiedSearchOutcome.result.page,
          returned: 0,
        },
        sourceStatus: [
          {
            source: "DOCS",
            targetLabel: "site:docs.example.com",
            appliedFilters: [],
            ignoredFilters: [],
            incompatibleFilters: [],
            appliedQueryFeatures: [],
            ignoredQueryFeatures: [],
            incompatibleQueryFeatures: [],
            suggestedSiteTargets: [],
            suggestedSiteTargetsTruncated: false,
            contributors: [],
          },
        ],
      },
    };

    await searchStatusAction(
      "search-ref-site",
      {},
      createDeps({
        codeNavigationService: createMockCodeNavigationService({
          searchStatus: mock(() => Promise.resolve(outcome)),
        }),
      }),
    );

    const output = String(consoleSpy.mock.calls[0]?.[0]);
    expect(output).toContain("Next: shorten or broaden site query.");
    expect(output).not.toContain("search another source");
    consoleSpy.mockRestore();
  });

  it("renders truncated site recovery suggestions for search-status", async () => {
    const consoleSpy = spyOn(console, "log").mockImplementation(() => {});
    if (defaultUnifiedSearchOutcome.state !== "completed") {
      throw new Error("expected completed outcome fixture");
    }
    const outcome: UnifiedSearchOutcome = {
      ...defaultUnifiedSearchOutcome,
      result: {
        ...defaultUnifiedSearchOutcome.result,
        results: [],
        sourceStatus: [
          {
            source: "DOCS",
            targetLabel: "site:example.com",
            appliedFilters: [],
            ignoredFilters: [],
            incompatibleFilters: [],
            appliedQueryFeatures: [],
            ignoredQueryFeatures: [],
            incompatibleQueryFeatures: [],
            suggestedSiteTargets: ["site:example.com/docs"],
            suggestedSiteTargetsTruncated: true,
            contributors: [],
          },
        ],
      },
    };

    await searchStatusAction(
      "search-ref-123",
      {},
      createDeps({
        codeNavigationService: createMockCodeNavigationService({
          searchStatus: mock(() => Promise.resolve(outcome)),
        }),
      }),
    );

    const output = String(consoleSpy.mock.calls[0]?.[0]);
    expect(output).toContain("- site:example.com");
    expect(output).toContain("Suggested sites: site:example.com/docs");
    expect(output).toContain("More suggested sites omitted");
    expect(output).toContain("Search search-ref-123 | completed");
    expect(output).toContain(
      "Next: retry one suggested site target explicitly.",
    );
    consoleSpy.mockRestore();
  });

  it("renders location term highlights for completed search-status results", async () => {
    const consoleSpy = spyOn(console, "log").mockImplementation(() => {});
    const originalIsTTY = process.stdout.isTTY;
    const noColor = process.env.NO_COLOR;
    try {
      delete process.env.NO_COLOR;
      Object.defineProperty(process.stdout, "isTTY", {
        value: true,
        configurable: true,
      });

      await searchStatusAction("search-ref-123", {}, createDeps());

      const output = String(consoleSpy.mock.calls[0]?.[0]);
      expect(output).toContain(
        "function \u001b[1m\u001b[33mrouter\u001b[0m(req, res, next) { ... }",
      );
      expect(output).toContain(
        "\u001b[1m\u001b[36mnpm:express@4.18.2 lib/router/index.js:42-57 [repo code] - router middleware\u001b[0m",
      );
    } finally {
      consoleSpy.mockRestore();
      Object.defineProperty(process.stdout, "isTTY", {
        value: originalIsTTY,
        configurable: true,
      });
      if (noColor === undefined) {
        delete process.env.NO_COLOR;
      } else {
        process.env.NO_COLOR = noColor;
      }
    }
  });
});
