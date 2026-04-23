import { describe, expect, it, mock, spyOn } from "bun:test";
import { AuthRequiredError } from "../shared/require-auth.js";
import {
  createMockCodeNavigationService,
  defaultUnifiedSearchOutcome,
} from "../services/test-helpers.js";
import {
  type SearchDependencies,
  searchAction,
  searchStatusAction,
} from "./search.js";

describe("searchAction", () => {
  const mcpUrl = "https://mcp.githits.com";

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
    consoleSpy.mockRestore();
  });

  it("throws AuthRequiredError on auth failure", async () => {
    await expect(
      searchAction("router", { in: ["npm:express"] }, createDeps({ hasValidToken: false })),
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
            Promise.resolve({
              state: "incomplete",
              completed: false,
              searchRef: "search-ref-123",
              progress: {
                searchRef: "search-ref-123",
                status: "INDEXING",
                targetsTotal: 1,
                targetsReady: 0,
                elapsedMs: 100,
                query: "router",
                queryWarnings: [],
                sources: ["CODE"],
              },
            }),
          ),
        }),
      }),
    );

    expect(String(consoleSpy.mock.calls[0]?.[0])).toContain("Search still in progress");
    expect(String(consoleSpy.mock.calls[0]?.[0])).toContain("search-ref-123");
    consoleSpy.mockRestore();
  });
});

describe("searchStatusAction", () => {
  const mcpUrl = "https://mcp.githits.com";

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
            Promise.resolve({
              state: "incomplete",
              completed: false,
              searchRef: "search-ref-123",
              progress: {
                searchRef: "search-ref-123",
                status: "SEARCHING",
                targetsTotal: 1,
                targetsReady: 1,
                elapsedMs: 300,
                query: "router",
                queryWarnings: [],
                sources: ["CODE"],
              },
            }),
          ),
        }),
      }),
    );

    expect(String(consoleSpy.mock.calls[0]?.[0])).toContain("search-ref-123");
    expect(String(consoleSpy.mock.calls[0]?.[0])).toContain("searching");
    consoleSpy.mockRestore();
  });

  it("outputs final JSON when completed", async () => {
    const consoleSpy = spyOn(console, "log").mockImplementation(() => {});

    await searchStatusAction(
      "search-ref-123",
      { json: true },
      createDeps(),
    );

    const payload = JSON.parse(String(consoleSpy.mock.calls[0]?.[0]));
    expect(payload.completed).toBe(true);
    expect(payload.searchRef).toBe("search-ref-123");
    expect(payload.result.query).toBe("router middleware");
    expect(payload.result.returnedCount).toBe(1);
    expect(payload).not.toHaveProperty("query.raw");
    consoleSpy.mockRestore();
  });
});
