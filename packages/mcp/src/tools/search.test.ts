import { describe, expect, it, mock } from "bun:test";
import type {
  UnifiedSearchOutcome,
  UnifiedSearchParams,
} from "@githits/core-internal";
import { z } from "zod";
import { getMcpToolDescriptors } from "../mcp/server.js";
import {
  createMockCodeNavigationService,
  defaultUnifiedSearchOutcome,
  documentationContributorOutcome,
} from "../services/test-helpers.js";
import { createSearchTool } from "./search.js";

describe("searchTool", () => {
  it("documents canonical target guidance for package and repository scope", () => {
    const descriptor = getMcpToolDescriptors().find(
      (entry) => entry.name === "search",
    );
    expect(descriptor).toBeDefined();
    const jsonSchema = z.toJSONSchema(z.object(descriptor?.schema ?? {}));
    const targetSchema = JSON.stringify(jsonSchema.properties?.target);

    expect(targetSchema).toContain("compact");
    expect(targetSchema).toContain("npm:react");
    expect(targetSchema).toContain("github:facebook/react");
    expect(targetSchema).toContain("site:react.dev");
    expect(descriptor?.description.slice(0, 80)).toBe(
      "Discover relevant docs, code, and symbols in a known public target. Start here f",
    );
    expect(descriptor?.description).toContain(
      "Hosted `[docs page]` HTTP(S) targets address mutable current content",
    );
    expect(descriptor?.description).toContain(
      "generated follow-ups omit search line bounds",
    );
    expect(descriptor?.description).toContain(
      "Repository docs remain snapshot-addressed and keep returned ranges",
    );
    expect(descriptor?.description).toContain(
      "Explicit `read` bounds are caller-selected ranges",
    );
    const readDescriptor = getMcpToolDescriptors().find(
      (entry) => entry.name === "read",
    );
    expect(readDescriptor?.description).toContain(
      "A docs URL fragment needs no bounds",
    );
    expect(readDescriptor?.description).toContain(
      "full subtree through the next equal-or-higher heading",
    );
    expect(readDescriptor?.description).toContain(
      "Hosted/crawled HTTP(S) docs targets read mutable current content",
    );
    expect(readDescriptor?.description).toContain(
      "repository-doc targets address snapshots",
    );
  });

  it("keeps the common path simple and delegates continuation details", () => {
    const tool = createSearchTool(createMockCodeNavigationService());

    expect(tool.description).toContain(
      "A `search` call can return complete results directly",
    );
    expect(tool.description).toContain(
      "Only when its response supplies both a `searchRef` and a `search_status` action",
    );
    expect(tool.description).toContain("never repeat `search` to poll");
    expect(tool.description).toContain("`search_status`");
    expect(tool.description).toContain(
      "Terminal or unrecognized statuses are not polled",
    );
    expect(tool.schema.allow_partial_results?.description).toContain(
      "serveable subset",
    );
    expect(tool.description).not.toContain(
      "`PENDING`, `INDEXING`, or `SEARCHING`",
    );
    expect(tool.description).not.toContain("Stale-but-serveable");
    expect(tool.description).not.toContain(
      "`DEFERRED`, `TIMEOUT`, and `FAILED`",
    );
  });

  it("documents explicit site search and advisory retry targets", () => {
    const tool = createSearchTool(createMockCodeNavigationService());

    expect(tool.description).toContain("site:<host[/path]>");
    expect(tool.description).toContain("suggestedSiteTargets");
    expect(tool.description).toContain("retry one explicitly");
    expect(tool.description).toContain("do not treat suggestions as aliases");
  });

  it("exposes only the remaining search controls", () => {
    const tool = createSearchTool(createMockCodeNavigationService());

    const remainingFields = [
      "allow_partial_results",
      "format",
      "limit",
      "offset",
      "public_only",
      "query",
      "source",
      "target",
      "targets",
      "wait_timeout_ms",
    ];
    expect(Object.keys(tool.schema).sort()).toEqual(remainingFields.sort());
    for (const field of remainingFields) {
      expect(tool.schema[field]?.description, field).toBeTruthy();
    }

    const queryDescription = tool.schema.query?.description ?? "";
    for (const qualifier of [
      "kind:function",
      "category:callable",
      "path:lib/",
      "intent:production",
      "name:Router",
      "lang:typescript",
    ]) {
      expect(
        queryDescription.match(new RegExp(qualifier, "g")),
        qualifier,
      ).toHaveLength(1);
    }
    expect(tool.description).toContain("backend validation");
    expect(tool.description).toContain("warnings");
    expect(tool.description).toContain("`sourceStatus`");
  });

  it("returns unified search payload from service", async () => {
    const tool = createSearchTool(createMockCodeNavigationService());

    const result = await tool.handler(
      {
        query: "router middleware",
        target: "npm:express",
        format: "json",
      },
      {},
    );

    expect(result.isError).toBeUndefined();
    const payload = JSON.parse(result.content[0]?.text ?? "{}");
    expect(payload.completed).toBe(true);
    expect(payload.results[0].target).toBe("npm:express@4.18.2");
    expect(payload.partialResults).toBe(false);
  });

  it.each([false, true] as const)(
    "preserves partialResults=%s in initial JSON",
    async (partialResults) => {
      if (defaultUnifiedSearchOutcome.state !== "completed") {
        throw new Error("expected completed outcome fixture");
      }
      const outcome: UnifiedSearchOutcome = {
        ...defaultUnifiedSearchOutcome,
        result: {
          ...defaultUnifiedSearchOutcome.result,
          partialResults,
        },
      };
      const tool = createSearchTool(
        createMockCodeNavigationService({
          search: mock(() => Promise.resolve(outcome)),
        }),
      );

      const result = await tool.handler(
        {
          query: "router",
          target: "npm:express",
          format: "json",
        },
        {},
      );
      const payload = JSON.parse(result.content[0]?.text ?? "{}");
      expect(payload.partialResults).toBe(partialResults);
    },
  );

  it("returns documentation contributors and evidence metadata in JSON and text", async () => {
    const tool = createSearchTool(
      createMockCodeNavigationService({
        search: mock(() => Promise.resolve(documentationContributorOutcome)),
      }),
    );

    const json = await tool.handler(
      {
        query: "router",
        target: "npm:express",
        format: "json",
      },
      {},
    );
    const payload = JSON.parse(json.content[0]?.text ?? "{}");
    expect(payload.sourceStatus[0].contributors).toEqual(
      documentationContributorOutcome.state === "completed"
        ? documentationContributorOutcome.result.sourceStatus[0]?.contributors
        : [],
    );
    expect(payload.evidenceNotice).toBe(
      documentationContributorOutcome.state === "completed"
        ? documentationContributorOutcome.result.evidenceNotice
        : undefined,
    );

    const text = await tool.handler(
      {
        query: "router",
        target: "npm:express",
      },
      {},
    );
    expect(text.content[0]?.text).toContain(
      "indexing: expressjs.com/en/guide docs",
    );
    expect(text.content[0]?.text).toContain("searched: repository docs");
  });

  it("forwards trimmed inline qualifiers without constructing structured filters", async () => {
    const search = mock((_: UnifiedSearchParams) =>
      Promise.resolve(defaultUnifiedSearchOutcome),
    );
    const tool = createSearchTool(createMockCodeNavigationService({ search }));

    await tool.handler(
      {
        query:
          "  handler kind:function category:callable path:lib/ intent:production name:Router lang:typescript  ",
        target: "npm:express",
        public_only: true,
        allow_partial_results: true,
      },
      {},
    );

    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({
        query:
          "handler kind:function category:callable path:lib/ intent:production name:Router lang:typescript",
        allowPartialResults: true,
        filters: { publicOnly: true },
      }),
      { omitFocusedSource: true },
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
        target: "npm:express",
        source: "docs",
      },
      {},
    );

    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({ sources: ["DOCS"] }),
      { omitFocusedSource: true },
    );
  });

  it("forwards source-incompatible inline qualifiers to the service", async () => {
    const search = mock((_: UnifiedSearchParams) =>
      Promise.resolve(defaultUnifiedSearchOutcome),
    );
    const tool = createSearchTool(createMockCodeNavigationService({ search }));

    await tool.handler(
      {
        query: "routing kind:function category:callable intent:production",
        target: "npm:express",
        source: "docs",
      },
      {},
    );

    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({
        sources: ["DOCS"],
        filters: undefined,
        query: "routing kind:function category:callable intent:production",
      }),
      { omitFocusedSource: true },
    );
  });

  it("forwards path qualifiers for sources that may reject them", async () => {
    for (const format of ["text", "json"] as const) {
      for (const selection of [
        { target: "npm:express", source: "docs" },
        { target: "github:expressjs/express", source: "symbol" },
        { target: "site:expressjs.com" },
      ] as const) {
        const search = mock(() => Promise.resolve(defaultUnifiedSearchOutcome));
        const tool = createSearchTool(
          createMockCodeNavigationService({ search }),
        );
        const result = await tool.handler(
          {
            query: "routing path:guide/",
            ...selection,
            format,
          },
          {},
        );
        expect(result.isError).toBeUndefined();
        expect(search).toHaveBeenCalledWith(
          expect.objectContaining({
            query: "routing path:guide/",
          }),
          { omitFocusedSource: format !== "json" },
        );
      }
    }
  });

  it("ignores empty targets arrays when target is provided", async () => {
    const search = mock((_: UnifiedSearchParams) =>
      Promise.resolve(defaultUnifiedSearchOutcome),
    );
    const tool = createSearchTool(createMockCodeNavigationService({ search }));

    await tool.handler(
      {
        query: "routing",
        target: "npm:express",
        targets: [],
      },
      {},
    );

    const call = search.mock.calls[0]?.[0];
    expect(call?.targets).toEqual([
      { registry: "NPM", packageName: "express" },
    ]);
  });

  it("rejects meaningful target and targets together before calling the service", async () => {
    const search = mock(() => Promise.resolve(defaultUnifiedSearchOutcome));
    const tool = createSearchTool(createMockCodeNavigationService({ search }));

    const result = await tool.handler(
      {
        query: "routing",
        target: "npm:express",
        targets: ["github:expressjs/express"],
        format: "json",
      },
      {},
    );

    expect(result.isError).toBe(true);
    expect(search).not.toHaveBeenCalled();
    expect(JSON.parse(result.content[0]?.text ?? "{}")).toMatchObject({
      code: "INVALID_ARGUMENT",
    });
  });

  it("ignores blank singular target strings when targets are provided", async () => {
    const search = mock((_: UnifiedSearchParams) =>
      Promise.resolve(defaultUnifiedSearchOutcome),
    );
    const tool = createSearchTool(createMockCodeNavigationService({ search }));

    await tool.handler(
      {
        query: "routing",
        target: " ",
        targets: ["npm:express"],
      },
      {},
    );

    const call = search.mock.calls[0]?.[0];
    expect(call?.targets).toEqual([
      { registry: "NPM", packageName: "express" },
    ]);
  });

  it("rejects whitespace-only target strings", async () => {
    const search = mock((_: UnifiedSearchParams) =>
      Promise.resolve(defaultUnifiedSearchOutcome),
    );
    const tool = createSearchTool(createMockCodeNavigationService({ search }));

    const result = await tool.handler(
      {
        query: "routing",
        target: " ",
        format: "json",
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
        targets: ["\t", "https://github.com/expressjs/express"],
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
      { omitFocusedSource: true },
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
        targets: ["https://github.com/expressjs/express@v5.0.0"],
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
      { omitFocusedSource: true },
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
      { omitFocusedSource: true },
    );
  });

  it("accepts a site target with an HTTPS URL", async () => {
    const search = mock((_: UnifiedSearchParams) =>
      Promise.resolve(defaultUnifiedSearchOutcome),
    );
    const tool = createSearchTool(createMockCodeNavigationService({ search }));

    await tool.handler(
      {
        query: "router middleware",
        target: "site:https://expressjs.com/",
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

  it("rejects malformed site targets", async () => {
    const search = mock((_: UnifiedSearchParams) =>
      Promise.resolve(defaultUnifiedSearchOutcome),
    );
    const tool = createSearchTool(createMockCodeNavigationService({ search }));

    const result = await tool.handler(
      {
        query: "router middleware",
        target: "site:",
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
        target: "https://github.com/expressjs/express",
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
        targets: ["npm:express@5.1.0", "https://github.com/expressjs/express"],
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
        target: "npm:express",
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
    expect(payload.results[0].followUp).toContain("read target=");
    expect(payload.results[0]).not.toHaveProperty("alternateFollowUps");
  });

  it("defaults to text output when format is omitted", async () => {
    const tool = createSearchTool(createMockCodeNavigationService());
    const result = await tool.handler(
      {
        query: "router middleware",
        target: "npm:express",
      },
      {},
    );
    expect(result.isError).toBeUndefined();
    const text = result.content[0]?.text ?? "";
    expect(text.split("\n")[0]).not.toContain("search | ");
    expect(() => JSON.parse(text)).toThrow();
  });

  it("renders text output when format=text", async () => {
    const tool = createSearchTool(createMockCodeNavigationService());
    const result = await tool.handler(
      {
        query: "router middleware",
        target: "npm:express",
        format: "text",
      },
      {},
    );
    expect(result.isError).toBeUndefined();
    const text = result.content[0]?.text ?? "";
    expect(text.split("\n")[0]).not.toContain("search | ");
    expect(text.split("\n")[0]).toContain("1 result");
    // Confirm the text payload is not valid JSON.
    expect(() => JSON.parse(text)).toThrow();
  });

  it("accepts explicit format=text", async () => {
    const tool = createSearchTool(createMockCodeNavigationService());
    const result = await tool.handler(
      {
        query: "router",
        target: "npm:express",
        format: "text",
      },
      {},
    );
    const text = result.content[0]?.text ?? "";
    expect(text.split("\n")[0]).not.toContain("search | ");
  });

  it("keeps the JSON envelope when format=json (explicit)", async () => {
    const tool = createSearchTool(createMockCodeNavigationService());
    const result = await tool.handler(
      {
        query: "router",
        target: "npm:express",
        format: "json",
      },
      {},
    );
    const payload = JSON.parse(result.content[0]?.text ?? "{}");
    expect(payload.completed).toBe(true);
  });
});

describe("v31 format selection", () => {
  for (const format of [undefined, "text", "json"] as const) {
    it(`selects MCP source fields for format=${format}`, async () => {
      const call = mock(() => Promise.resolve(defaultUnifiedSearchOutcome));
      const tool = createSearchTool(
        createMockCodeNavigationService({ search: call }),
      );
      await tool.handler(
        { query: "router", target: "npm:express", format },
        {},
      );
      expect(call).toHaveBeenCalledWith(
        expect.objectContaining({ query: "router" }),
        { omitFocusedSource: format !== "json" },
      );
    });
  }
});
