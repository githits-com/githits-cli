import { describe, expect, it, mock } from "bun:test";
import { AuthenticationError } from "@githits/core-internal";
import { createMockGitHitsService } from "../services/test-helpers.js";
import { createSearchLanguageTool } from "./search-language.js";
import type { ToolResult } from "./types.js";

/** Extract text from tool result (convenience for tests) */
function getText(result: ToolResult): string {
  return result.content[0]?.text ?? "";
}

describe("searchLanguageTool", () => {
  it("calls service and returns compact text by default", async () => {
    const service = createMockGitHitsService();
    const tool = createSearchLanguageTool(service);

    const result = await tool.handler({ query: "python" }, {});

    expect(result.isError).toBeUndefined();
    expect(getText(result)).toContain("python (Python) aliases: py");
    expect(() => JSON.parse(getText(result))).toThrow();
    expect(service.searchLanguages).toHaveBeenCalledWith("python");
    expect(service.getLanguages).not.toHaveBeenCalled();
  });

  it("returns filtered JSON when format=json", async () => {
    const service = createMockGitHitsService();
    const tool = createSearchLanguageTool(service);

    const result = await tool.handler({ query: "python", format: "json" }, {});
    const parsed = JSON.parse(getText(result));

    expect(parsed).toHaveLength(1);
    expect(parsed[0].name).toBe("python");
  });

  it("returns error result on service failure", async () => {
    const service = createMockGitHitsService({
      searchLanguages: mock(() => Promise.reject(new Error("API error"))),
    });
    const tool = createSearchLanguageTool(service);

    const result = await tool.handler({ query: "python" }, {});

    expect(result.isError).toBe(true);
    expect(getText(result)).toContain("API error");
  });

  it("returns recoverable AUTH_REQUIRED envelope on auth failure", async () => {
    const service = createMockGitHitsService({
      searchLanguages: mock(() =>
        Promise.reject(new AuthenticationError("Authentication required")),
      ),
    });
    const tool = createSearchLanguageTool(service);

    const result = await tool.handler({ query: "python" }, {});
    const parsed = JSON.parse(getText(result));

    expect(result.isError).toBe(true);
    expect(parsed).toEqual({
      error: "Authentication required",
      code: "AUTH_REQUIRED",
      retryable: false,
      details: {
        action:
          "Run `githits login`, or set GITHITS_API_TOKEN, then retry this tool call.",
        authSource: "local",
      },
    });
  });
});
