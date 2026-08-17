import { describe, expect, it, mock } from "bun:test";
import type {
  UnifiedSearchOutcome,
  UnifiedSearchParams,
} from "@githits/core-internal";
import {
  createMockCodeNavigationService,
  defaultUnifiedSearchOutcome,
} from "../services/test-helpers.js";
import { createSearchTool } from "./search.js";

describe("searchTool", () => {
  it("directs deferred calls to search_status instead of repeated search", () => {
    const tool = createSearchTool(createMockCodeNavigationService());

    expect(tool.description).toContain("do not repeat `search`");
    expect(tool.description).toContain("`search_status`");
    expect(tool.description).toContain("serveable subset");
  });

  it("documents explicit site search and advisory retry targets", () => {
    const tool = createSearchTool(createMockCodeNavigationService());

    expect(tool.description).toContain("site:<host[/path]>");
    expect(tool.description).toContain("suggestedSiteTargets");
    expect(tool.description).toContain(
      "terminal recovery guidance without a `searchRef`",
    );
    expect(tool.description).toContain("Stale-but-serveable evidence");
  });

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
    const search = mock((_: UnifiedSearchParams) =>
      Promise.resolve(defaultUnifiedSearchOutcome),
    );
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
        limit: 10,
        filters: expect.objectContaining({ kind: "FUNCTION" }),
      }),
    );
  });

  it("passes single source selection through to code navigation service", async () => {
    const search = mock((_: UnifiedSearchParams) =>
      Promise.resolve(defaultUnifiedSearchOutcome),
    );
    const tool = createSearchTool(createMockCodeNavigationService({ search }));

    await tool.handler(
      {
        query: "routing",
        target: { registry: "npm", package_name: "express" },
        source: "docs",
      },
      {},
    );

    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({ sources: ["DOCS"] }),
    );
  });

  it("drops docs-incompatible filters for docs-only searches", async () => {
    const search = mock((_: UnifiedSearchParams) =>
      Promise.resolve(defaultUnifiedSearchOutcome),
    );
    const tool = createSearchTool(createMockCodeNavigationService({ search }));

    await tool.handler(
      {
        query: "routing",
        target: { registry: "npm", package_name: "express" },
        source: "docs",
        category: "callable",
        kind: "function",
        file_intent: "production",
        public_only: true,
        path_prefix: "guide/",
      },
      {},
    );

    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({
        sources: ["DOCS"],
        filters: { pathPrefix: "guide/" },
      }),
    );
  });

  it("ignores empty targets arrays when target is provided", async () => {
    const search = mock((_: UnifiedSearchParams) =>
      Promise.resolve(defaultUnifiedSearchOutcome),
    );
    const tool = createSearchTool(createMockCodeNavigationService({ search }));

    await tool.handler(
      {
        query: "routing",
        target: { registry: "npm", package_name: "express" },
        targets: [],
      },
      {},
    );

    const call = search.mock.calls[0]?.[0];
    expect(call?.targets).toEqual([
      { registry: "NPM", packageName: "express" },
    ]);
  });

  it("ignores blank singular target objects when targets are provided", async () => {
    const search = mock((_: UnifiedSearchParams) =>
      Promise.resolve(defaultUnifiedSearchOutcome),
    );
    const tool = createSearchTool(createMockCodeNavigationService({ search }));

    await tool.handler(
      {
        query: "routing",
        target: {
          registry: " " as never,
          package_name: "",
          version: "\t",
          repo_url: "",
          git_ref: " ",
        },
        targets: [{ registry: "npm", package_name: "express" }],
      },
      {},
    );

    const call = search.mock.calls[0]?.[0];
    expect(call?.targets).toEqual([
      { registry: "NPM", packageName: "express" },
    ]);
  });

  it("rejects whitespace-only required fields in structured targets", async () => {
    const search = mock((_: UnifiedSearchParams) =>
      Promise.resolve(defaultUnifiedSearchOutcome),
    );
    const tool = createSearchTool(createMockCodeNavigationService({ search }));

    const result = await tool.handler(
      {
        query: "routing",
        target: { repo_url: " ", git_ref: "HEAD" },
      },
      {},
    );

    expect(result.isError).toBe(true);
    expect(search).not.toHaveBeenCalled();
    expect(JSON.parse(result.content[0]?.text ?? "{}")).toMatchObject({
      code: "INVALID_ARGUMENT",
    });
  });

  it("ignores blank targets array entries", async () => {
    const search = mock((_: UnifiedSearchParams) =>
      Promise.resolve(defaultUnifiedSearchOutcome),
    );
    const tool = createSearchTool(createMockCodeNavigationService({ search }));

    await tool.handler(
      {
        query: "routing",
        targets: [
          {
            registry: " " as never,
            package_name: "",
            repo_url: "",
            git_ref: "\t",
          },
          { repo_url: "https://github.com/expressjs/express" },
        ],
      },
      {},
    );

    const call = search.mock.calls[0]?.[0];
    expect(call?.targets).toEqual([
      { repoUrl: "https://github.com/expressjs/express" },
    ]);
  });

  it("accepts compact package string targets", async () => {
    const search = mock((_: UnifiedSearchParams) =>
      Promise.resolve(defaultUnifiedSearchOutcome),
    );
    const tool = createSearchTool(createMockCodeNavigationService({ search }));

    await tool.handler(
      {
        query: "handler",
        target: "npm:express@4.18.2",
      },
      {},
    );

    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({
        targets: [
          expect.objectContaining({
            registry: "NPM",
            packageName: "express",
            version: "4.18.2",
          }),
        ],
      }),
    );
  });

  it("accepts compact repo string targets inside targets arrays", async () => {
    const search = mock((_: UnifiedSearchParams) =>
      Promise.resolve(defaultUnifiedSearchOutcome),
    );
    const tool = createSearchTool(createMockCodeNavigationService({ search }));

    await tool.handler(
      {
        query: "handler",
        targets: ["https://github.com/expressjs/express#v5.0.0"],
      },
      {},
    );

    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({
        targets: [
          expect.objectContaining({
            repoUrl: "https://github.com/expressjs/express",
            gitRef: "v5.0.0",
          }),
        ],
      }),
    );
  });

  it("accepts compact standalone site string targets", async () => {
    const search = mock((_: UnifiedSearchParams) =>
      Promise.resolve(defaultUnifiedSearchOutcome),
    );
    const tool = createSearchTool(createMockCodeNavigationService({ search }));

    await tool.handler(
      {
        query: "router middleware",
        target: "site:expressjs.com",
      },
      {},
    );

    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({
        targets: [{ site: "site:expressjs.com" }],
      }),
    );
  });

  it("accepts structured standalone site targets", async () => {
    const search = mock((_: UnifiedSearchParams) =>
      Promise.resolve(defaultUnifiedSearchOutcome),
    );
    const tool = createSearchTool(createMockCodeNavigationService({ search }));

    await tool.handler(
      {
        query: "router middleware",
        target: { site: "https://expressjs.com/" },
      },
      {},
    );

    const call = search.mock.calls[0]?.[0];
    expect(call?.targets).toEqual([{ site: "site:expressjs.com" }]);
  });

  it("dedupes equivalent standalone site targets after canonicalization", async () => {
    const search = mock((_: UnifiedSearchParams) =>
      Promise.resolve(defaultUnifiedSearchOutcome),
    );
    const tool = createSearchTool(createMockCodeNavigationService({ search }));

    await tool.handler(
      {
        query: "router middleware",
        targets: ["site:ExpressJS.com", "site:https://expressjs.com/"],
      },
      {},
    );

    const call = search.mock.calls[0]?.[0];
    expect(call?.targets).toEqual([{ site: "site:expressjs.com" }]);
  });

  it("rejects site targets mixed with package fields", async () => {
    const search = mock((_: UnifiedSearchParams) =>
      Promise.resolve(defaultUnifiedSearchOutcome),
    );
    const tool = createSearchTool(createMockCodeNavigationService({ search }));

    const result = await tool.handler(
      {
        query: "router middleware",
        target: {
          registry: "npm",
          package_name: "express",
          site: "expressjs.com",
        },
      },
      {},
    );

    expect(result.isError).toBe(true);
    expect(search).not.toHaveBeenCalled();
    expect(JSON.parse(result.content[0]?.text ?? "{}")).toMatchObject({
      code: "INVALID_ARGUMENT",
    });
  });

  it("returns invalid-argument error when target is missing", async () => {
    const tool = createSearchTool(createMockCodeNavigationService());

    const result = await tool.handler({ query: "test" }, {});

    expect(result.isError).toBe(true);
    // Error names both parameters so an agent can fix the call without
    // re-reading the description.
    expect(result.content[0]?.text).toContain("`target`");
    expect(result.content[0]?.text).toContain("`targets`");
  });

  it("preserves omitted repo refs for backend default-branch discovery", async () => {
    const search = mock((_: UnifiedSearchParams) =>
      Promise.resolve(defaultUnifiedSearchOutcome),
    );
    const tool = createSearchTool(createMockCodeNavigationService({ search }));

    await tool.handler(
      {
        query: "router middleware",
        target: { repo_url: "https://github.com/expressjs/express" },
      },
      {},
    );

    const call = search.mock.calls[0]?.[0];
    expect(call?.targets[0]).toEqual({
      repoUrl: "https://github.com/expressjs/express",
    });
  });

  it("preserves omitted repo refs in compact target strings", async () => {
    const search = mock((_: UnifiedSearchParams) =>
      Promise.resolve(defaultUnifiedSearchOutcome),
    );
    const tool = createSearchTool(createMockCodeNavigationService({ search }));

    await tool.handler(
      {
        query: "router middleware",
        target: "https://github.com/expressjs/express",
      },
      {},
    );

    const call = search.mock.calls[0]?.[0];
    expect(call?.targets[0]).toEqual({
      repoUrl: "https://github.com/expressjs/express",
    });
  });

  it("accepts mixed package and repo targets", async () => {
    const search = mock((_: UnifiedSearchParams) =>
      Promise.resolve(defaultUnifiedSearchOutcome),
    );
    const tool = createSearchTool(createMockCodeNavigationService({ search }));

    await tool.handler(
      {
        query: "router middleware",
        targets: [
          "npm:express@5.1.0",
          { repo_url: "https://github.com/expressjs/express" },
        ],
      },
      {},
    );

    const call = search.mock.calls[0]?.[0];
    expect(call?.targets).toEqual([
      { registry: "NPM", packageName: "express", version: "5.1.0" },
      { repoUrl: "https://github.com/expressjs/express" },
    ]);
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
    expect(payload.results[0].followUp).toContain("docs_read page_id=");
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
