import { describe, expect, it, mock } from "bun:test";
import {
  createMockCodeNavigationService,
  defaultUnifiedSearchOutcome,
} from "../services/test-helpers.js";
import { createSearchStatusTool } from "./search-status.js";

describe("searchStatusTool", () => {
  it("returns incomplete progress payload while search is still running", async () => {
    const tool = createSearchStatusTool(
      createMockCodeNavigationService({
        searchStatus: mock(() =>
          Promise.resolve({
            state: "incomplete",
            completed: false,
            searchRef: "search-ref-123",
            progress: {
              searchRef: "search-ref-123",
              status: "SEARCHING",
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
    );

    const result = await tool.handler({ search_ref: "search-ref-123" }, {});

    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0]?.text ?? "{}")).toEqual({
      completed: false,
      searchRef: "search-ref-123",
      progress: expect.objectContaining({ status: "SEARCHING" }),
    });
  });

  it("returns completed payload without fabricating initial query echo", async () => {
    const tool = createSearchStatusTool(createMockCodeNavigationService());

    const result = await tool.handler({ search_ref: "search-ref-123" }, {});
    const payload = JSON.parse(result.content[0]?.text ?? "{}");

    expect(result.isError).toBeUndefined();
    expect(payload.completed).toBe(true);
    expect(payload.searchRef).toBe(defaultUnifiedSearchOutcome.searchRef);
    expect(payload.result.query).toBe("router middleware");
    expect(payload.result.returnedCount).toBe(1);
    expect(payload).not.toHaveProperty("query");
  });
});
