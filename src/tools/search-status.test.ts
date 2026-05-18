import { describe, expect, it, mock } from "bun:test";
import type {
  UnifiedSearchIncomplete,
  UnifiedSearchProgress,
  UnifiedSearchSessionStatus,
} from "../services/code-navigation-service.js";
import {
  createMockCodeNavigationService,
  defaultUnifiedSearchOutcome,
} from "../services/test-helpers.js";
import { createSearchStatusTool } from "./search-status.js";

describe("searchStatusTool", () => {
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

  it("returns incomplete progress payload while search is still running", async () => {
    const tool = createSearchStatusTool(
      createMockCodeNavigationService({
        searchStatus: mock(() =>
          Promise.resolve(
            createIncompleteOutcome("SEARCHING", "search-ref-123"),
          ),
        ),
      }),
    );

    const result = await tool.handler(
      { search_ref: "search-ref-123", format: "json" },
      {},
    );

    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0]?.text ?? "{}")).toEqual({
      completed: false,
      searchRef: "search-ref-123",
      progress: expect.objectContaining({ status: "SEARCHING" }),
    });
  });

  it("describes partial-result follow-up behavior", () => {
    const tool = createSearchStatusTool(createMockCodeNavigationService());

    expect(tool.description).toContain("partial hits");
    expect(tool.description).toContain("allow_partial_results");
  });

  it("returns completed payload without fabricating initial query echo", async () => {
    const tool = createSearchStatusTool(createMockCodeNavigationService());

    const result = await tool.handler(
      { search_ref: "search-ref-123", format: "json" },
      {},
    );
    const payload = JSON.parse(result.content[0]?.text ?? "{}");

    expect(result.isError).toBeUndefined();
    expect(payload.completed).toBe(true);
    expect(payload.searchRef).toBe(defaultUnifiedSearchOutcome.searchRef);
    expect(payload.result.results).toHaveLength(1);
    expect(payload).not.toHaveProperty("query");
  });

  it("surfaces TIMEOUT status without pretending the search is still running", async () => {
    const tool = createSearchStatusTool(
      createMockCodeNavigationService({
        searchStatus: mock(() =>
          Promise.resolve(
            createIncompleteOutcome("TIMEOUT", "search-ref-timeout", {
              elapsedMs: 20_000,
            }),
          ),
        ),
      }),
    );

    const result = await tool.handler(
      { search_ref: "search-ref-timeout", format: "json" },
      {},
    );
    const payload = JSON.parse(result.content[0]?.text ?? "{}");

    expect(result.isError).toBeUndefined();
    expect(payload.completed).toBe(false);
    expect(payload.progress.status).toBe("TIMEOUT");
  });

  it("renders TIMEOUT text without claiming active indexing", async () => {
    const tool = createSearchStatusTool(
      createMockCodeNavigationService({
        searchStatus: mock(() =>
          Promise.resolve(createIncompleteOutcome("TIMEOUT", "ref-timeout")),
        ),
      }),
    );

    const result = await tool.handler({ search_ref: "ref-timeout" }, {});
    const text = result.content[0]?.text ?? "";
    expect(text).toContain("search_status | timeout | searchRef=ref-timeout");
    expect(text).not.toContain("search_status | indexing");
  });

  it("surfaces progress freshness warnings", async () => {
    const tool = createSearchStatusTool(
      createMockCodeNavigationService({
        searchStatus: mock(() =>
          Promise.resolve(
            createIncompleteOutcome("INDEXING", "ref-stale", {
              targets: [
                {
                  requested: "npm:express latest",
                  resolvedRequested: "npm:express@5.2.1",
                  served: "npm:express@5.1.0",
                  freshness: "STALE",
                },
              ],
            }),
          ),
        ),
      }),
    );

    const result = await tool.handler({ search_ref: "ref-stale" }, {});
    const text = result.content[0]?.text ?? "";
    expect(text).toContain("warnings:");
    expect(text).toContain(
      "requested npm:express latest; served stale npm:express@5.1.0 while npm:express@5.2.1 indexes.",
    );
  });

  it("renders source targetResolution notes in completed text", async () => {
    if (defaultUnifiedSearchOutcome.state !== "completed") {
      throw new Error("expected completed outcome fixture");
    }
    const completedOutcome = defaultUnifiedSearchOutcome;
    const tool = createSearchStatusTool(
      createMockCodeNavigationService({
        searchStatus: mock(() =>
          Promise.resolve({
            ...completedOutcome,
            result: {
              ...completedOutcome.result,
              sourceStatus: [
                {
                  ...completedOutcome.result.sourceStatus[0]!,
                  targetResolution: {
                    requested: { registry: "NPM", packageName: "express" },
                    resolvedRequested: {
                      registry: "NPM",
                      packageName: "express",
                      version: "5.2.1",
                    },
                    served: {
                      registry: "NPM",
                      packageName: "express",
                      version: "4.18.2",
                    },
                    freshness: "fallback_recent",
                    freshnessReason: "refresh_deferred",
                    availableVersions: [{ version: "4.18.2", ref: "v4.18.2" }],
                    availableRefs: [],
                  },
                },
              ],
            },
          }),
        ),
      }),
    );

    const result = await tool.handler({ search_ref: "search-ref-123" }, {});
    const text = result.content[0]?.text ?? "";
    expect(text).toContain("source notes:");
    expect(text).toContain("using recent index");
    expect(text).toContain("queryable now: versions=4.18.2@v4.18.2");
  });

  it("renders terminal source status compactly in completed text", async () => {
    if (defaultUnifiedSearchOutcome.state !== "completed") {
      throw new Error("expected completed outcome fixture");
    }
    const completedOutcome = defaultUnifiedSearchOutcome;
    const tool = createSearchStatusTool(
      createMockCodeNavigationService({
        searchStatus: mock(() =>
          Promise.resolve({
            ...completedOutcome,
            result: {
              ...completedOutcome.result,
              results: [],
              sourceStatus: [
                {
                  ...completedOutcome.result.sourceStatus[0]!,
                  source: "CODE" as const,
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
            },
          }),
        ),
      }),
    );

    const result = await tool.handler(
      { search_ref: "search-ref-terminal" },
      {},
    );
    const text = result.content[0]?.text ?? "";
    expect(text).toContain(
      "code (githits-com/no-such-repo) | Repository ref cannot be resolved (UNRESOLVABLE)",
    );
    expect(text).not.toContain("indexing fresh target");
  });

  it("defaults to compact text output", async () => {
    const tool = createSearchStatusTool(
      createMockCodeNavigationService({
        searchStatus: mock(() =>
          Promise.resolve(createIncompleteOutcome("SEARCHING", "ref-text")),
        ),
      }),
    );

    const result = await tool.handler({ search_ref: "ref-text" }, {});
    const text = result.content[0]?.text ?? "";

    expect(result.isError).toBeUndefined();
    expect(text).toContain("search_status | searching | searchRef=ref-text");
    expect(text).toContain("progress: SEARCHING, 0/1 targets ready");
    expect(text).toContain('next: call search_status search_ref="ref-text"');
    expect(() => JSON.parse(text)).toThrow();
  });
});
