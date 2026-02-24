import { describe, expect, it, mock } from "bun:test";
import { createMockGitHitsService } from "../services/test-helpers.js";
import { createSearchTool } from "./search.js";

describe("searchTool", () => {
  it("returns markdown result from service", async () => {
    const service = createMockGitHitsService();
    const tool = createSearchTool(service);

    const result = await tool.handler(
      { query: "hello world", language: "javascript" },
      {},
    );

    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toContain("# Example");
  });

  it("passes license_mode to service", async () => {
    const searchFn = mock(() => Promise.resolve("result"));
    const service = createMockGitHitsService({ search: searchFn });
    const tool = createSearchTool(service);

    await tool.handler(
      { query: "test", language: "python", license_mode: "yolo" },
      {},
    );

    expect(searchFn).toHaveBeenCalledWith({
      query: "test",
      language: "python",
      licenseMode: "yolo",
      includeExplanation: false,
    });
  });

  it("returns error result on service failure", async () => {
    const service = createMockGitHitsService({
      search: mock(() => Promise.reject(new Error("Network error"))),
    });
    const tool = createSearchTool(service);

    const result = await tool.handler(
      { query: "test", language: "python" },
      {},
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("Network error");
  });
});
