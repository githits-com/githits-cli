import { describe, expect, it, mock } from "bun:test";
import { ApiRateLimitError, FetchTimeoutError } from "@githits/core-internal";
import { createMockGitHitsService } from "../services/test-helpers.js";
import { createGetExampleTool } from "./get-example.js";

describe("getExampleTool", () => {
  it("tells agents to report source repository provenance", () => {
    const tool = createGetExampleTool(createMockGitHitsService());

    expect(tool.description).toContain("source repository provenance");
    expect(tool.description).toContain("source repositories/citations");
    expect(tool.description).toContain(
      "GitHits' generated references/provenance section",
    );
    expect(tool.schema.format?.description).toContain(
      "source repository provenance",
    );
  });

  it("returns markdown result from service", async () => {
    const service = createMockGitHitsService();
    const tool = createGetExampleTool(service);

    const result = await tool.handler(
      { query: "hello world", language: "javascript" },
      {},
    );

    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toContain("# Example");
    expect(result.content[0]?.text).not.toContain('{"result"');
  });

  it("returns JSON envelope when format=json", async () => {
    const service = createMockGitHitsService();
    const tool = createGetExampleTool(service);

    const result = await tool.handler(
      { query: "hello world", language: "javascript", format: "json" },
      {},
    );

    const payload = JSON.parse(result.content[0]?.text ?? "{}");
    expect(payload.result).toContain("# Example");
    expect(payload.solution_id).toBeUndefined();
  });

  it("passes license_mode to service", async () => {
    const searchFn = mock(() => Promise.resolve("result"));
    const service = createMockGitHitsService({ search: searchFn });
    const tool = createGetExampleTool(service);

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

  it("allows language to be omitted", async () => {
    const searchFn = mock(() => Promise.resolve("result"));
    const service = createMockGitHitsService({ search: searchFn });
    const tool = createGetExampleTool(service);

    await tool.handler({ query: "test" }, {});

    expect(searchFn).toHaveBeenCalledWith({
      query: "test",
      language: undefined,
      licenseMode: undefined,
      includeExplanation: false,
    });
  });

  it("returns error result on service failure", async () => {
    const service = createMockGitHitsService({
      search: mock(() => Promise.reject(new Error("Network error"))),
    });
    const tool = createGetExampleTool(service);

    const result = await tool.handler(
      { query: "test", language: "python" },
      {},
    );

    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0]?.text ?? "{}")).toEqual({
      error: "Failed to get example: Network error",
      code: "UNKNOWN",
      retryable: false,
    });
  });

  it("returns a retryable rate-limit envelope with retry timing", async () => {
    const service = createMockGitHitsService({
      search: mock(() =>
        Promise.reject(new ApiRateLimitError("Request rate limited.", 17)),
      ),
    });
    const tool = createGetExampleTool(service);

    const result = await tool.handler({ query: "test" }, {});

    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0]?.text ?? "{}")).toEqual({
      error: "Request rate limited.",
      code: "RATE_LIMITED",
      retryable: true,
      details: {
        status: 429,
        retryAfterSeconds: 17,
      },
    });
  });

  it("returns a retryable timeout envelope with timeout metadata", async () => {
    const service = createMockGitHitsService({
      search: mock(() => Promise.reject(new FetchTimeoutError(2_500))),
    });
    const tool = createGetExampleTool(service);

    const result = await tool.handler({ query: "test" }, {});

    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0]?.text ?? "{}")).toEqual({
      error: "Failed to get example: Request timed out after 2500ms.",
      code: "TIMEOUT",
      retryable: true,
      details: { timeoutMs: 2_500 },
    });
  });
});
