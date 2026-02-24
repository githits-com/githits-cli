import { describe, expect, it, mock } from "bun:test";
import { createMockGitHitsService } from "../services/test-helpers.js";
import { createSearchLanguageTool } from "./search-language.js";
import type { ToolResult } from "./types.js";

/** Extract text from tool result (convenience for tests) */
function getText(result: ToolResult): string {
  return result.content[0]?.text ?? "";
}

describe("searchLanguageTool", () => {
  it("calls service and returns filtered JSON", async () => {
    const service = createMockGitHitsService();
    const tool = createSearchLanguageTool(service);

    const result = await tool.handler({ query: "python" }, {});
    const parsed = JSON.parse(getText(result));

    expect(result.isError).toBeUndefined();
    expect(parsed).toHaveLength(1);
    expect(parsed[0].name).toBe("python");
    expect(service.getLanguages).toHaveBeenCalled();
  });

  it("returns error result on service failure", async () => {
    const service = createMockGitHitsService({
      getLanguages: mock(() => Promise.reject(new Error("API error"))),
    });
    const tool = createSearchLanguageTool(service);

    const result = await tool.handler({ query: "python" }, {});

    expect(result.isError).toBe(true);
    expect(getText(result)).toContain("API error");
  });
});
