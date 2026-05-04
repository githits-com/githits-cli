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
    expect(text).toContain("search_status | indexing | searchRef=ref-text");
    expect(text).toContain("progress: SEARCHING, 0/1 targets ready");
    expect(text).toContain('next: call search_status search_ref="ref-text"');
    expect(() => JSON.parse(text)).toThrow();
  });
});
