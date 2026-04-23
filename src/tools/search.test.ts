import { describe, expect, it, mock } from "bun:test";
import {
  createMockCodeNavigationService,
  defaultUnifiedSearchOutcome,
} from "../services/test-helpers.js";
import { createSearchTool } from "./search.js";

describe("searchTool", () => {
  it("returns unified search payload from service", async () => {
    const tool = createSearchTool(createMockCodeNavigationService());

    const result = await tool.handler(
      {
        query: "router middleware",
        target: { registry: "npm", package_name: "express" },
      },
      {},
    );

    expect(result.isError).toBeUndefined();
    const payload = JSON.parse(result.content[0]?.text ?? "{}");
    expect(payload.completed).toBe(true);
    expect(payload.results[0].target).toBe("npm:express@4.18.2");
  });

  it("passes compiled request through to code navigation service", async () => {
    const search = mock(() => Promise.resolve(defaultUnifiedSearchOutcome));
    const tool = createSearchTool(createMockCodeNavigationService({ search }));

    await tool.handler(
      {
        query: "handler",
        target: { registry: "npm", package_name: "express" },
        kind: "function",
        language: "typescript",
      },
      {},
    );

    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({
        query: "(handler) AND (lang:typescript)",
        filters: expect.objectContaining({ kind: "FUNCTION" }),
      }),
    );
  });

  it("returns invalid-argument error when target is missing", async () => {
    const tool = createSearchTool(createMockCodeNavigationService());

    const result = await tool.handler({ query: "test" }, {});

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain(
      "At least one target is required",
    );
  });

  it("defaults repo targets to HEAD when git_ref is omitted", async () => {
    const search = mock(() => Promise.resolve(defaultUnifiedSearchOutcome));
    const tool = createSearchTool(createMockCodeNavigationService({ search }));

    await tool.handler(
      {
        query: "router middleware",
        target: { repo_url: "https://github.com/expressjs/express" },
      },
      {},
    );

    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({
        targets: [
          expect.objectContaining({
            repoUrl: "https://github.com/expressjs/express",
            gitRef: "HEAD",
          }),
        ],
      }),
    );
  });
});
