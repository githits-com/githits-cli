// PARITY TEST — enforces rule IDs from docs/implementation/mcp-cli-parity.md:
//   PARITY-JSON-KEYS       CLI --json output and MCP text payload parse to
//                          deepEqual JSON objects for equivalent inputs.
//   PARITY-ERROR-ENVELOPE  Both surfaces emit { error, code, details? } on
//                          every error path; MCP error text is always valid
//                          JSON.
//
// Rule IDs are stable; changes to either this test or the parity doc
// are coordinated (renaming a rule ID here without updating the doc,
// or vice versa, should fail review).

import { describe, expect, it, mock, spyOn } from "bun:test";
import {
  type SearchSymbolsCommandDependencies,
  searchSymbolsAction,
} from "../commands/code/search-symbols.js";
import {
  CodeNavigationIndexingError,
  CodeNavigationTargetNotFoundError,
} from "../services/index.js";
import {
  createMockCodeNavigationService,
  defaultSearchSymbolsResult,
} from "../services/test-helpers.js";
import { createSearchSymbolsTool } from "./search-symbols.js";

function cliDeps(
  overrides: Partial<SearchSymbolsCommandDependencies> = {},
): SearchSymbolsCommandDependencies {
  return {
    codeNavigationService: createMockCodeNavigationService(),
    codeNavigationUrl: "https://nav.example.com",
    hasValidToken: true,
    mcpUrl: "https://mcp.example.com",
    ...overrides,
  };
}

async function cliJson(
  packageArg: string,
  query: string | undefined,
  options: Parameters<typeof searchSymbolsAction>[2] = {},
  deps: SearchSymbolsCommandDependencies = cliDeps(),
): Promise<unknown> {
  const logSpy = spyOn(console, "log").mockImplementation(() => {});
  const errSpy = spyOn(console, "error").mockImplementation(() => {});
  const exitSpy = spyOn(process, "exit").mockImplementation(() => {
    throw new Error("process.exit");
  });
  try {
    try {
      await searchSymbolsAction(
        packageArg,
        query,
        { ...options, json: true },
        deps,
      );
    } catch {
      // CLI error paths call process.exit — caught.
    }
    const fromLog = logSpy.mock.calls[0]?.[0] as string | undefined;
    const fromErr = errSpy.mock.calls[0]?.[0] as string | undefined;
    const raw = fromLog ?? fromErr;
    return raw ? JSON.parse(raw) : undefined;
  } finally {
    logSpy.mockRestore();
    errSpy.mockRestore();
    exitSpy.mockRestore();
  }
}

async function mcpJson(
  args: Parameters<ReturnType<typeof createSearchSymbolsTool>["handler"]>[0],
  searchMock?: () => Promise<unknown>,
): Promise<unknown> {
  const service = createMockCodeNavigationService(
    searchMock ? { searchSymbols: mock(searchMock) as never } : {},
  );
  const tool = createSearchSymbolsTool(service);
  const result = await tool.handler(args, {});
  const text = result.content[0]?.text ?? "";
  return JSON.parse(text);
}

describe("search_symbols CLI ↔ MCP JSON parity", () => {
  it("PARITY-JSON-KEYS: successful search produces the same envelope", async () => {
    const cliPayload = await cliJson("npm:express", "middleware");
    const mcpPayload = await mcpJson({
      target: { registry: "npm", package_name: "express" },
      query: "middleware",
    });

    expect(cliPayload).toEqual(mcpPayload);
  });

  it("PARITY-JSON-KEYS: zero-result search omits the `hint` key when server hint is empty", async () => {
    const emptyResult = { results: [], totalMatches: 0, hasMore: false };
    const cliPayload = await cliJson(
      "npm:express",
      "nonexistent-token",
      {},
      cliDeps({
        codeNavigationService: createMockCodeNavigationService({
          searchSymbols: mock(() => Promise.resolve(emptyResult)),
        }),
      }),
    );
    const mcpPayload = await mcpJson(
      {
        target: { registry: "npm", package_name: "express" },
        query: "nonexistent-token",
      },
      () => Promise.resolve(emptyResult),
    );

    expect(cliPayload).toEqual(mcpPayload);
    expect((cliPayload as Record<string, unknown>).hint).toBeUndefined();
  });

  it("PARITY-ERROR-ENVELOPE: NOT_FOUND emits the same envelope on both surfaces", async () => {
    const err = new CodeNavigationTargetNotFoundError("Package not found", [
      { version: "5.2.1", ref: "v5.2.1" },
    ]);
    const cliPayload = await cliJson(
      "npm:nonexistent",
      "middleware",
      {},
      cliDeps({
        codeNavigationService: createMockCodeNavigationService({
          searchSymbols: mock(() => Promise.reject(err)),
        }),
      }),
    );
    const mcpPayload = await mcpJson(
      {
        target: { registry: "npm", package_name: "nonexistent" },
        query: "middleware",
      },
      () => Promise.reject(err),
    );

    expect(cliPayload).toEqual(mcpPayload);
    expect(cliPayload).toEqual({
      error: "Package not found",
      code: "NOT_FOUND",
      retryable: false,
      details: { availableVersions: [{ version: "5.2.1", ref: "v5.2.1" }] },
    });
  });

  it("PARITY-ERROR-ENVELOPE: INVALID_ARGUMENT produces a valid-JSON envelope on both surfaces", async () => {
    // CLI: unknown-registry prefix rejected by the package-spec parser.
    const cliPayload = await cliJson("foobar:baz", "middleware");
    expect(cliPayload).toMatchObject({
      code: "INVALID_ARGUMENT",
      error: expect.stringContaining("Unsupported registry"),
    });

    // MCP: resolveCodeTarget rejects an invalid target shape and emits
    // the same envelope rather than a free-form error string.
    const tool = createSearchSymbolsTool(createMockCodeNavigationService());
    const result = await tool.handler({ target: {}, query: "middleware" }, {});
    expect(result.isError).toBe(true);
    const mcpPayload = JSON.parse(result.content[0]?.text ?? "");
    expect(mcpPayload).toMatchObject({
      code: "INVALID_ARGUMENT",
      error: expect.stringContaining("Missing target"),
    });
  });

  it("PARITY-ERROR-ENVELOPE: INDEXING errors carry identical details", async () => {
    const err = new CodeNavigationIndexingError(
      "Target is being indexed.",
      "idx-42",
    );
    const cliPayload = await cliJson(
      "npm:express",
      "middleware",
      {},
      cliDeps({
        codeNavigationService: createMockCodeNavigationService({
          searchSymbols: mock(() => Promise.reject(err)),
        }),
      }),
    );
    const mcpPayload = await mcpJson(
      {
        target: { registry: "npm", package_name: "express" },
        query: "middleware",
      },
      () => Promise.reject(err),
    );

    expect(cliPayload).toEqual(mcpPayload);
    expect(cliPayload).toEqual({
      error: "Target is being indexed.",
      code: "INDEXING",
      retryable: true,
      details: { indexingRef: "idx-42" },
    });
  });

  it("PARITY-JSON-KEYS: query.defaulted lists the client-applied fields on both surfaces", async () => {
    const cliPayload = (await cliJson("npm:express", "middleware")) as {
      query: { defaulted: string[] };
    };
    const mcpPayload = (await mcpJson({
      target: { registry: "npm", package_name: "express" },
      query: "middleware",
    })) as { query: { defaulted: string[] } };

    expect(cliPayload.query.defaulted).toEqual(mcpPayload.query.defaulted);
    expect(cliPayload.query.defaulted).toContain("fileIntent");
    expect(cliPayload.query.defaulted).toContain("waitTimeoutMs");
  });

  it("PARITY-JSON-KEYS: no leading-underscore keys in success or default payloads", async () => {
    const payload = (await cliJson("npm:express", "middleware")) as Record<
      string,
      unknown
    >;

    const assertNoUnderscoreKeys = (value: unknown, path = "") => {
      if (value === null || typeof value !== "object") return;
      for (const key of Object.keys(value as Record<string, unknown>)) {
        expect(key).not.toMatch(/^_/);
        assertNoUnderscoreKeys(
          (value as Record<string, unknown>)[key],
          `${path}.${key}`,
        );
      }
    };

    assertNoUnderscoreKeys(payload);
    // And the fixture definitely exercises at least one success field
    // so the assertion is not vacuous.
    expect(payload.results).toEqual(defaultSearchSymbolsResult.results);
  });
});
