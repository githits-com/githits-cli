import { describe, expect, it, mock, spyOn } from "bun:test";
import type {
  UnifiedSearchIncomplete,
  UnifiedSearchOutcome,
  UnifiedSearchProgress,
  UnifiedSearchSessionStatus,
} from "../services/code-navigation-service.js";
import {
  createMockCodeNavigationService,
  defaultUnifiedSearchOutcome,
} from "../services/test-helpers.js";
import { AuthRequiredError } from "../shared/require-auth.js";
import {
  type SearchDependencies,
  searchAction,
  searchStatusAction,
} from "./search.js";

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

  function createIncompleteOutcomeWithProgress(
    status: UnifiedSearchSessionStatus,
    searchRef: string,
    progressOverrides: Partial<UnifiedSearchProgress> = {},
  ): UnifiedSearchIncomplete {
    const baseProgress: UnifiedSearchProgress = {
      searchRef,
      status,
      targetsTotal: 1,
      targetsReady: 0,
      elapsedMs: 100,
      query: "router",
      queryWarnings: [],
      sources: ["CODE"],
    };

    return {
      state: "incomplete",
      completed: false,
      searchRef,
      progress: {
        ...baseProgress,
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

  it("calls unified search service with parsed targets and filters", async () => {
    const search = mock(() => Promise.resolve(defaultUnifiedSearchOutcome));
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
        filters: expect.objectContaining({ kind: "FUNCTION" }),
      }),
    );
    consoleSpy.mockRestore();
  });

  it("passes repeatable --source values through as source filters", async () => {
    const search = mock(() => Promise.resolve(defaultUnifiedSearchOutcome));
    const deps = createDeps({
      codeNavigationService: createMockCodeNavigationService({ search }),
    });
    const consoleSpy = spyOn(console, "log").mockImplementation(() => {});

    await searchAction(
      "router middleware",
      {
        in: ["npm:express"],
        source: ["code", "docs"],
      },
      deps,
    );

    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({
        sources: ["CODE", "DOCS"],
      }),
    );
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
    expect(output).toContain("1 repo code hit");
    expect(output).toContain(
      "npm:express@4.18.2 lib/router/index.js:42-57 [repo code] - router middleware",
    );
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

    expect(String(consoleSpy.mock.calls[0]?.[0])).toContain(
      "Search still in progress",
    );
    expect(String(consoleSpy.mock.calls[0]?.[0])).toContain("search-ref-123");
    consoleSpy.mockRestore();
  });

  it("prints source-status notes when the backend ignored filters", async () => {
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
          },
        ],
      },
    };

    await searchAction(
      "router middleware",
      { in: ["npm:express"] },
      createDeps({
        codeNavigationService: createMockCodeNavigationService({
          search: mock(() => Promise.resolve(outcomeWithIgnoredFilters)),
        }),
      }),
    );

    const output = String(consoleSpy.mock.calls[0]?.[0]);
    expect(output).toContain(
      "Note: docs on npm:express@4.18.2 ignored filters: fileIntent",
    );
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
      expect(output).toContain("\u001b[1m\u001b[36mmiddleware\u001b[0m");
      expect(output).toContain(
        "function \u001b[1m\u001b[36mrouter\u001b[0m(req, res, next) { ... }",
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
        `  ${"\u001b[1m\u001b[36m"}line 2${"\u001b[0m"}`,
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

  it("prints compact docs hint when full doc fetch is unavailable in CLI", async () => {
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
      "npm:express@4.18.2 [docs page] - Using Express middleware",
    );
    expect(output).toContain(
      "Full doc fetch not exposed in CLI yet (pageId=docs-123)",
    );
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

    expect(String(consoleSpy.mock.calls[0]?.[0])).toContain("search-ref-123");
    expect(String(consoleSpy.mock.calls[0]?.[0])).toContain("searching");
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
    expect(output).toContain("Search timed out.");
    expect(output).not.toContain("Search still in progress.");
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
    expect(output).toContain("Search failed.");
    expect(output).not.toContain("Search still in progress.");
    consoleSpy.mockRestore();
  });

  it("outputs final JSON when completed", async () => {
    const consoleSpy = spyOn(console, "log").mockImplementation(() => {});

    await searchStatusAction("search-ref-123", { json: true }, createDeps());

    const payload = JSON.parse(String(consoleSpy.mock.calls[0]?.[0]));
    expect(payload.completed).toBe(true);
    expect(payload.searchRef).toBe("search-ref-123");
    expect(payload.result.query).toBe("router middleware");
    expect(payload.result.returnedCount).toBe(1);
    expect(payload).not.toHaveProperty("query.raw");
    consoleSpy.mockRestore();
  });
});
