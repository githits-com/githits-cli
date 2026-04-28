import { describe, expect, it, mock } from "bun:test";
import type { UnifiedSearchOutcome } from "../services/index.js";
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
        format: "json",
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
        allow_partial_results: true,
      },
      {},
    );

    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({
        query: "(handler) AND (lang:typescript)",
        allowPartialResults: true,
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

  it("preserves locator fields on repository_doc hits so agents can call read_package_doc or read_file", async () => {
    if (defaultUnifiedSearchOutcome.state !== "completed") {
      throw new Error("expected completed outcome fixture");
    }

    const baseHit = defaultUnifiedSearchOutcome.result.results[0]!;

    const outcome: UnifiedSearchOutcome = {
      ...defaultUnifiedSearchOutcome,
      result: {
        ...defaultUnifiedSearchOutcome.result,
        results: [
          {
            ...baseHit,
            resultType: "REPOSITORY_DOC" as const,
            locator: {
              ...baseHit.locator,
              pageId: "github:expressjs/express@abc123/README.md",
              sourceKind: "REPOSITORY",
              sourceUrl:
                "https://github.com/expressjs/express/blob/abc123/README.md",
              repoUrl: "https://github.com/expressjs/express",
              gitRef: "abc123",
              requestedRef: "v5.2.1",
              filePath: "README.md",
            },
          },
        ],
      },
    };
    const tool = createSearchTool(
      createMockCodeNavigationService({
        search: mock(() => Promise.resolve(outcome)),
      }),
    );

    const result = await tool.handler(
      {
        query: "middleware",
        target: { registry: "npm", package_name: "express" },
        format: "json",
      },
      {},
    );

    const payload = JSON.parse(result.content[0]?.text ?? "{}");
    expect(payload.results[0].type).toBe("repository_doc");
    expect(payload.results[0].locator).toMatchObject({
      pageId: "github:expressjs/express@abc123/README.md",
      repoUrl: "https://github.com/expressjs/express",
      gitRef: "abc123",
      filePath: "README.md",
    });
    expect(payload.results[0]).not.toHaveProperty("followUp");
    expect(payload.results[0]).not.toHaveProperty("alternateFollowUps");
  });

  it("defaults to text output when format is omitted", async () => {
    const tool = createSearchTool(createMockCodeNavigationService());
    const result = await tool.handler(
      {
        query: "router middleware",
        target: { registry: "npm", package_name: "express" },
      },
      {},
    );
    expect(result.isError).toBeUndefined();
    const text = result.content[0]?.text ?? "";
    expect(text).toContain("search | ");
    expect(() => JSON.parse(text)).toThrow();
  });

  it("renders text output when format=text-v1", async () => {
    const tool = createSearchTool(createMockCodeNavigationService());
    const result = await tool.handler(
      {
        query: "router middleware",
        target: { registry: "npm", package_name: "express" },
        format: "text-v1",
      },
      {},
    );
    expect(result.isError).toBeUndefined();
    const text = result.content[0]?.text ?? "";
    expect(text).toContain("search | ");
    expect(text).toContain('query="router middleware"');
    // Confirm the text payload is not valid JSON.
    expect(() => JSON.parse(text)).toThrow();
  });

  it("accepts format=text as an alias for text-v1", async () => {
    const tool = createSearchTool(createMockCodeNavigationService());
    const result = await tool.handler(
      {
        query: "router",
        target: { registry: "npm", package_name: "express" },
        format: "text",
      },
      {},
    );
    const text = result.content[0]?.text ?? "";
    expect(text).toContain("search | ");
  });

  it("keeps the JSON envelope when format=json (explicit)", async () => {
    const tool = createSearchTool(createMockCodeNavigationService());
    const result = await tool.handler(
      {
        query: "router",
        target: { registry: "npm", package_name: "express" },
        format: "json",
      },
      {},
    );
    const payload = JSON.parse(result.content[0]?.text ?? "{}");
    expect(payload.completed).toBe(true);
  });
});
