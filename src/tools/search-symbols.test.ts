import { describe, expect, it, mock } from "bun:test";
import { CodeNavigationIndexingError } from "../services/index.js";
import {
  createMockCodeNavigationService,
  defaultSearchSymbolsResult,
} from "../services/test-helpers.js";
import { createSearchSymbolsTool } from "./search-symbols.js";

describe("searchSymbolsTool", () => {
  it("returns tool metadata", () => {
    const tool = createSearchSymbolsTool(createMockCodeNavigationService());
    expect(tool.name).toBe("search_symbols");
    expect(tool.description).toContain("exact-token matches");
    expect(tool.description).toContain("across all intents");
    expect(tool.description).toContain("`all`");
    // Category is the preferred filtering surface per the April 2026
    // backend taxonomy split.
    expect(tool.description).toContain("category");
  });

  it("calls service with normalized target and search params", async () => {
    const searchSymbols = mock(() =>
      Promise.resolve({ results: [], totalMatches: 0, hasMore: false }),
    );
    const tool = createSearchSymbolsTool(
      createMockCodeNavigationService({ searchSymbols }),
    );

    await tool.handler(
      {
        target: { registry: "npm", package_name: "express", version: "4.18.0" },
        query: "middleware",
        kind: "function",
        limit: 10,
        wait_timeout_ms: 5000,
      },
      {},
    );

    expect(searchSymbols).toHaveBeenCalledWith({
      target: { registry: "NPM", packageName: "express", version: "4.18.0" },
      query: "middleware",
      keywords: undefined,
      matchMode: undefined,
      kind: "FUNCTION",
      filePath: undefined,
      limit: 10,
      fileIntent: undefined,
      waitTimeoutMs: 5000,
    });
  });

  it("returns the shared success envelope on success", async () => {
    const tool = createSearchSymbolsTool(createMockCodeNavigationService());

    const result = await tool.handler(
      {
        target: { registry: "npm", package_name: "express" },
        query: "middleware",
      },
      {},
    );

    expect(result.isError).toBeUndefined();
    const payload = JSON.parse(result.content[0]?.text ?? "");
    expect(payload.results).toEqual(defaultSearchSymbolsResult.results);
    expect(payload.returnedCount).toBe(1);
    expect(payload.totalMatches).toBe(1);
    expect(payload.hasMore).toBe(false);
    expect(payload.version).toBe("4.18.0");
    expect(payload.query.target).toEqual({
      registry: "NPM",
      packageName: "express",
      version: undefined,
    });
    expect(payload.query.query).toBe("middleware");
    expect(payload.query.fileIntent).toBe("all");
    expect(payload.query.defaulted).not.toContain("fileIntent");
    expect(payload.query.defaulted).toContain("waitTimeoutMs");
    // No underscore-prefixed keys in the shared envelope.
    expect(payload._warning).toBeUndefined();
    expect(payload._hint).toBeUndefined();
  });

  it("emits the shared error envelope on indexing errors", async () => {
    const tool = createSearchSymbolsTool(
      createMockCodeNavigationService({
        searchSymbols: mock(() =>
          Promise.reject(
            new CodeNavigationIndexingError(
              "Target is being indexed.",
              "idx-123",
              [{ version: "4.18.0", ref: "v4.18.0" }],
            ),
          ),
        ),
      }),
    );

    const result = await tool.handler(
      {
        target: { registry: "npm", package_name: "express" },
        query: "middleware",
      },
      {},
    );

    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0]?.text ?? "")).toEqual({
      error: "Target is being indexed.",
      code: "INDEXING",
      retryable: true,
      details: {
        indexingRef: "idx-123",
        availableVersions: [{ version: "4.18.0", ref: "v4.18.0" }],
      },
    });
  });

  it("emits a valid-JSON error envelope when query and keywords are missing", async () => {
    const tool = createSearchSymbolsTool(createMockCodeNavigationService());
    const result = await tool.handler(
      { target: { registry: "npm", package_name: "express" } },
      {},
    );

    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0]?.text ?? "")).toEqual({
      error: "Provide either query or keywords.",
      code: "INVALID_ARGUMENT",
    });
  });

  it("treats file_intent 'all' as the FILE_INTENT_ALL sentinel and echoes 'all'", async () => {
    const searchSymbols = mock<
      (
        params: import("../services/index.js").SearchSymbolsParams,
      ) => Promise<import("../services/index.js").SearchSymbolsResult>
    >(() => Promise.resolve({ results: [], totalMatches: 0, hasMore: false }));
    const tool = createSearchSymbolsTool(
      createMockCodeNavigationService({ searchSymbols }),
    );
    const result = await tool.handler(
      {
        target: { registry: "npm", package_name: "express" },
        query: "middleware",
        file_intent: "all",
      },
      {},
    );

    // Service receives undefined fileIntent — omit the GraphQL variable.
    expect(searchSymbols.mock.calls[0]?.[0]?.fileIntent).toBeUndefined();
    const payload = JSON.parse(result.content[0]?.text ?? "");
    expect(payload.query.fileIntent).toBe("all");
    expect(payload.query.defaulted).not.toContain("fileIntent");
  });

  it("echoes an explicit non-default file_intent without marking it as defaulted", async () => {
    const tool = createSearchSymbolsTool(createMockCodeNavigationService());
    const result = await tool.handler(
      {
        target: { registry: "npm", package_name: "express" },
        query: "middleware",
        file_intent: "test",
      },
      {},
    );

    const payload = JSON.parse(result.content[0]?.text ?? "");
    expect(payload.query.fileIntent).toBe("test");
    expect(payload.query.defaulted).not.toContain("fileIntent");
  });

  it("rejects `mode` and `verbose` as unknown inputs (removed from schema)", () => {
    const tool = createSearchSymbolsTool(createMockCodeNavigationService());
    // The compile-time SearchSymbolsArgs no longer declares these keys.
    // At runtime the Zod schema also omits them; a defensive runtime
    // assertion keeps us honest:
    const schemaKeys = Object.keys(tool.schema);
    expect(schemaKeys).not.toContain("mode");
    expect(schemaKeys).not.toContain("verbose");
  });

  it("passes category and kind through to the service and echoes category lowercase", async () => {
    const searchSymbols = mock<
      (
        params: import("../services/index.js").SearchSymbolsParams,
      ) => Promise<import("../services/index.js").SearchSymbolsResult>
    >(() => Promise.resolve({ results: [], totalMatches: 0, hasMore: false }));
    const tool = createSearchSymbolsTool(
      createMockCodeNavigationService({ searchSymbols }),
    );

    const result = await tool.handler(
      {
        target: { registry: "npm", package_name: "express" },
        query: "Router",
        category: "callable",
        kind: "trait",
      },
      {},
    );

    expect(searchSymbols.mock.calls[0]?.[0]?.category).toBe("CALLABLE");
    expect(searchSymbols.mock.calls[0]?.[0]?.kind).toBe("TRAIT");
    const payload = JSON.parse(result.content[0]?.text ?? "");
    expect(payload.query.category).toBe("callable");
    expect(payload.query.kind).toBe("trait");
  });
});
