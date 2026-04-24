import { describe, expect, it, mock, spyOn } from "bun:test";
import { CodeNavigationIndexingError } from "../../services/index.js";
import {
  createMockCodeNavigationService,
  defaultSearchSymbolsResult,
} from "../../services/test-helpers.js";
import { AuthRequiredError } from "../../shared/require-auth.js";
import {
  type SearchSymbolsCommandDependencies,
  searchSymbolsAction,
} from "./search-symbols.js";

describe("searchSymbolsAction", () => {
  const mcpUrl = "https://mcp.githits.com";

  function createDeps(
    overrides: Partial<SearchSymbolsCommandDependencies> = {},
  ): SearchSymbolsCommandDependencies {
    return {
      codeNavigationService: createMockCodeNavigationService(),
      codeNavigationUrl: "https://nav.example.com",
      hasValidToken: true,
      mcpUrl,
      ...overrides,
    };
  }

  it("prints human-readable results by default", async () => {
    const consoleSpy = spyOn(console, "log").mockImplementation(() => {});

    await searchSymbolsAction("npm:express", "middleware", {}, createDeps());

    const output = consoleSpy.mock.calls.map((call) => call[0]).join("\n");
    expect(output).toContain("1 match(es)");
    expect(output).toContain("useMiddleware");
    // Entry leads with `filePath:startLine-endLine [kind]`.
    expect(output).toContain("src/app.js:42-48");
    expect(output).toContain("[function]");
    // Snippet is built from `code` and dedented, preserving structure.
    expect(output).toContain("function useMiddleware(fn) {");
    consoleSpy.mockRestore();
  });

  it("prints the shared JSON envelope when --json is provided", async () => {
    const consoleSpy = spyOn(console, "log").mockImplementation(() => {});

    await searchSymbolsAction(
      "npm:express",
      "middleware",
      { json: true },
      createDeps(),
    );

    const output = consoleSpy.mock.calls[0]?.[0] as string;
    const payload = JSON.parse(output);
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
    expect(payload.query.fileIntent).toBe("all");
    expect(payload.query.defaulted).not.toContain("fileIntent");
    expect(payload.query.defaulted).toContain("waitTimeoutMs");
    expect(payload._warning).toBeUndefined();
    consoleSpy.mockRestore();
  });

  it("prints the shared JSON error envelope on --json when the service fails", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });

    try {
      await searchSymbolsAction(
        "npm:express",
        "middleware",
        { json: true },
        createDeps({
          codeNavigationService: createMockCodeNavigationService({
            searchSymbols: mock(() =>
              Promise.reject(
                new CodeNavigationIndexingError(
                  "Target is being indexed.",
                  "idx-123",
                ),
              ),
            ),
          }),
        }),
      );
    } catch {
      // expected process.exit throw
    }

    const output = errorSpy.mock.calls[0]?.[0] as string;
    expect(JSON.parse(output)).toEqual({
      error: "Target is being indexed.",
      code: "INDEXING",
      retryable: true,
      details: { indexingRef: "idx-123" },
    });
    expect(exitSpy).toHaveBeenCalledWith(1);
    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("surfaces the backend zero-result hint verbatim when it arrives", async () => {
    const consoleSpy = spyOn(console, "log").mockImplementation(() => {});

    await searchSymbolsAction(
      "npm:express",
      "nonexistentterm12345",
      {},
      createDeps({
        codeNavigationService: createMockCodeNavigationService({
          searchSymbols: mock(() =>
            Promise.resolve({
              results: [],
              totalMatches: 0,
              hasMore: false,
              version: "5.2.1",
              hint: "120 chunks indexed across 45 files. Try broader search terms or use fetch_code_context to read specific files directly.",
            }),
          ),
        }),
      }),
    );

    const output = consoleSpy.mock.calls.map((call) => call[0]).join("\n");
    expect(output).toContain('No matches for "nonexistentterm12345"');
    expect(output).toContain("120 chunks indexed across 45 files");
    // Server hint replaces the client-side suggestion list.
    expect(output).not.toContain("Try: drop --kind");
    consoleSpy.mockRestore();
  });

  it("still filters the legacy '0 searchable chunks' phrasing when backend regresses", async () => {
    const consoleSpy = spyOn(console, "log").mockImplementation(() => {});

    await searchSymbolsAction(
      "npm:express",
      "nonexistentterm12345",
      {},
      createDeps({
        codeNavigationService: createMockCodeNavigationService({
          searchSymbols: mock(() =>
            Promise.resolve({
              results: [],
              totalMatches: 0,
              hasMore: false,
              version: "5.2.1",
              hint: "Repository indexed but contains 0 searchable chunks.",
            }),
          ),
        }),
      }),
    );

    const output = consoleSpy.mock.calls.map((call) => call[0]).join("\n");
    expect(output).not.toContain("0 searchable chunks");
    // Falls back to the client-side suggestion list.
    expect(output).toContain("Try:");
    consoleSpy.mockRestore();
  });

  it("rejects unknown registry prefixes with a clean error", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });

    try {
      await searchSymbolsAction("foobar:baz", "middleware", {}, createDeps());
    } catch {
      // expected process.exit throw
    }

    expect(errorSpy.mock.calls.map((call) => call[0]).join("\n")).toContain(
      'Unsupported registry "foobar"',
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("sends no file-intent filter by default and preserves explicit intent choices", async () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    const searchSymbols = mock<
      (
        params: import("../../services/index.js").SearchSymbolsParams,
      ) => Promise<import("../../services/index.js").SearchSymbolsResult>
    >(() => Promise.resolve({ results: [], totalMatches: 0, hasMore: false }));
    const deps = createDeps({
      codeNavigationService: createMockCodeNavigationService({
        searchSymbols,
      }),
    });

    await searchSymbolsAction("npm:express", "middleware", {}, deps);
    expect(searchSymbols.mock.calls[0]?.[0]?.fileIntent).toBeUndefined();

    searchSymbols.mockClear();
    await searchSymbolsAction(
      "npm:express",
      "middleware",
      { intent: "all" },
      deps,
    );
    // `--intent all` resolves to "omit the GraphQL variable" —
    // service call sees undefined fileIntent.
    expect(searchSymbols.mock.calls[0]?.[0]?.fileIntent).toBeUndefined();

    searchSymbols.mockClear();
    await searchSymbolsAction(
      "npm:express",
      "middleware",
      { intent: "test" },
      deps,
    );
    expect(searchSymbols.mock.calls[0]?.[0]?.fileIntent).toBe("TEST");

    logSpy.mockRestore();
  });

  it('echoes fileIntent: "all" in JSON output when --intent all is passed', async () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});

    await searchSymbolsAction(
      "npm:express",
      "middleware",
      { intent: "all", json: true },
      createDeps(),
    );

    const payload = JSON.parse(logSpy.mock.calls[0]?.[0] as string);
    expect(payload.query.fileIntent).toBe("all");
    expect(payload.query.defaulted).not.toContain("fileIntent");
    logSpy.mockRestore();
  });

  it("parses --wait in seconds and converts to milliseconds at the service boundary", async () => {
    const searchSymbols = mock<
      (
        params: import("../../services/index.js").SearchSymbolsParams,
      ) => Promise<import("../../services/index.js").SearchSymbolsResult>
    >(() => Promise.resolve({ results: [], totalMatches: 0, hasMore: false }));
    const deps = createDeps({
      codeNavigationService: createMockCodeNavigationService({
        searchSymbols,
      }),
    });

    const logSpy = spyOn(console, "log").mockImplementation(() => {});

    await searchSymbolsAction(
      "npm:express",
      "middleware",
      { wait: "15" },
      deps,
    );
    expect(searchSymbols.mock.calls[0]?.[0]?.waitTimeoutMs).toBe(15_000);

    searchSymbols.mockClear();
    await searchSymbolsAction(
      "npm:express",
      "middleware",
      { wait: "5s" },
      deps,
    );
    expect(searchSymbols.mock.calls[0]?.[0]?.waitTimeoutMs).toBe(5_000);

    logSpy.mockRestore();
  });

  it("rejects invalid --wait inputs", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });

    const cases: Array<[string, string]> = [
      ["10ms", "seconds"],
      ["abc", "between 0 and 60"],
      ["-1", "between 0 and 60"],
      ["61", "between 0 and 60"],
    ];

    for (const [value, substring] of cases) {
      errorSpy.mockClear();
      try {
        await searchSymbolsAction(
          "npm:express",
          "middleware",
          { wait: value },
          createDeps(),
        );
      } catch {
        // expected process.exit throw
      }
      const output = errorSpy.mock.calls.map((call) => call[0]).join("\n");
      expect(output).toContain(substring);
    }

    expect(exitSpy).toHaveBeenCalledWith(1);
    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("CLI parser errors classify as INVALID_ARGUMENT in JSON output", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });

    try {
      await searchSymbolsAction(
        "npm:express",
        "middleware",
        { wait: "61", json: true },
        createDeps(),
      );
    } catch {
      // expected process.exit throw
    }

    const output = errorSpy.mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(output);
    expect(parsed.code).toBe("INVALID_ARGUMENT");
    expect(parsed.error).toContain("--wait");
    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("suppresses the (requested X) annotation on trivial v-prefix differences", async () => {
    const consoleSpy = spyOn(console, "log").mockImplementation(() => {});

    await searchSymbolsAction(
      "npm:express",
      "middleware",
      {},
      createDeps({
        codeNavigationService: createMockCodeNavigationService({
          searchSymbols: mock(() =>
            Promise.resolve({
              results: [{ filePath: "lib/x.js", startLine: 1 }],
              totalMatches: 1,
              hasMore: false,
              version: "v2.32.3",
              resolution: {
                requestedVersion: "2.32.3",
                resolvedRef: "v2.32.3",
              },
            }),
          ),
        }),
      }),
    );

    const output = consoleSpy.mock.calls.map((call) => call[0]).join("\n");
    expect(output).toContain("indexed v2.32.3");
    expect(output).not.toContain("(requested 2.32.3)");
    consoleSpy.mockRestore();
  });

  it("truncates 40-char commit SHA refs to 7 characters in the header", async () => {
    const consoleSpy = spyOn(console, "log").mockImplementation(() => {});

    await searchSymbolsAction(
      "npm:lodash",
      "debounce",
      {},
      createDeps({
        codeNavigationService: createMockCodeNavigationService({
          searchSymbols: mock(() =>
            Promise.resolve({
              results: [{ filePath: "lodash.js", startLine: 1 }],
              totalMatches: 1,
              hasMore: false,
              version: "4f0b76e2eca13de1c1fe8b4305abc1f7d63f4b86",
            }),
          ),
        }),
      }),
    );

    const output = consoleSpy.mock.calls.map((call) => call[0]).join("\n");
    expect(output).toContain("indexed 4f0b76e");
    expect(output).not.toContain("4f0b76e2eca13de1c1fe8b4305abc1f7d63f4b86");
    consoleSpy.mockRestore();
  });

  it("suggests --intent all only when the caller explicitly narrowed file intent", async () => {
    const consoleSpy = spyOn(console, "log").mockImplementation(() => {});

    await searchSymbolsAction(
      "npm:express",
      "Router",
      { file: "nonexistent/", kind: "function", intent: "test" },
      createDeps({
        codeNavigationService: createMockCodeNavigationService({
          searchSymbols: mock(() =>
            Promise.resolve({
              results: [],
              totalMatches: 0,
              hasMore: false,
              version: "v5.2.1",
            }),
          ),
        }),
      }),
    );

    const output = consoleSpy.mock.calls.map((call) => call[0]).join("\n");
    expect(output).toContain("drop --kind");
    expect(output).toContain("broaden or remove --file");
    expect(output).toContain("try --intent all");
    consoleSpy.mockRestore();
  });

  it("omits `try --intent all` from the zero-result suggestion when the caller already chose all", async () => {
    const consoleSpy = spyOn(console, "log").mockImplementation(() => {});

    await searchSymbolsAction(
      "npm:express",
      "Router",
      { intent: "all" },
      createDeps({
        codeNavigationService: createMockCodeNavigationService({
          searchSymbols: mock(() =>
            Promise.resolve({
              results: [],
              totalMatches: 0,
              hasMore: false,
              version: "v5.2.1",
            }),
          ),
        }),
      }),
    );

    const output = consoleSpy.mock.calls.map((call) => call[0]).join("\n");
    expect(output).toContain("try broader keywords");
    expect(output).not.toContain("try --intent all");
    consoleSpy.mockRestore();
  });

  it("omits `try --intent all` from the zero-result suggestion when no intent filter was sent", async () => {
    const consoleSpy = spyOn(console, "log").mockImplementation(() => {});

    await searchSymbolsAction(
      "npm:express",
      "Router",
      {},
      createDeps({
        codeNavigationService: createMockCodeNavigationService({
          searchSymbols: mock(() =>
            Promise.resolve({
              results: [],
              totalMatches: 0,
              hasMore: false,
              version: "v5.2.1",
            }),
          ),
        }),
      }),
    );

    const output = consoleSpy.mock.calls.map((call) => call[0]).join("\n");
    expect(output).toContain("try broader keywords");
    expect(output).not.toContain("try --intent all");
    consoleSpy.mockRestore();
  });

  it("accepts --category and passes through to the service and echo", async () => {
    const searchSymbols = mock<
      (
        params: import("../../services/index.js").SearchSymbolsParams,
      ) => Promise<import("../../services/index.js").SearchSymbolsResult>
    >(() => Promise.resolve({ results: [], totalMatches: 0, hasMore: false }));
    const deps = createDeps({
      codeNavigationService: createMockCodeNavigationService({
        searchSymbols,
      }),
    });
    const logSpy = spyOn(console, "log").mockImplementation(() => {});

    await searchSymbolsAction(
      "npm:express",
      "Router",
      { category: "callable", json: true },
      deps,
    );
    expect(searchSymbols.mock.calls[0]?.[0]?.category).toBe("CALLABLE");

    const payload = JSON.parse(logSpy.mock.calls[0]?.[0] as string);
    expect(payload.query.category).toBe("callable");
    logSpy.mockRestore();
  });

  it("rejects unknown --category values with a clean error", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });

    try {
      await searchSymbolsAction(
        "npm:express",
        "Router",
        { category: "xyzzy" },
        createDeps(),
      );
    } catch {
      // expected process.exit throw
    }

    const output = errorSpy.mock.calls.map((call) => call[0]).join("\n");
    expect(output).toContain("--category must be one of");
    expect(output).toContain("callable");
    expect(exitSpy).toHaveBeenCalledWith(1);
    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("accepts expanded --kind values from the unified taxonomy", async () => {
    const searchSymbols = mock<
      (
        params: import("../../services/index.js").SearchSymbolsParams,
      ) => Promise<import("../../services/index.js").SearchSymbolsResult>
    >(() => Promise.resolve({ results: [], totalMatches: 0, hasMore: false }));
    const deps = createDeps({
      codeNavigationService: createMockCodeNavigationService({
        searchSymbols,
      }),
    });
    const logSpy = spyOn(console, "log").mockImplementation(() => {});

    await searchSymbolsAction(
      "crates:serde",
      "Serialize",
      { kind: "trait" },
      deps,
    );
    expect(searchSymbols.mock.calls[0]?.[0]?.kind).toBe("TRAIT");

    searchSymbols.mockClear();
    await searchSymbolsAction(
      "npm:express",
      "Router",
      { kind: "namespace" },
      deps,
    );
    expect(searchSymbols.mock.calls[0]?.[0]?.kind).toBe("NAMESPACE");

    logSpy.mockRestore();
  });

  it("adds `drop --category` to zero-result suggestions when a category was used", async () => {
    const consoleSpy = spyOn(console, "log").mockImplementation(() => {});

    await searchSymbolsAction(
      "npm:express",
      "Router",
      { category: "type" },
      createDeps({
        codeNavigationService: createMockCodeNavigationService({
          searchSymbols: mock(() =>
            Promise.resolve({
              results: [],
              totalMatches: 0,
              hasMore: false,
              version: "v5.2.1",
            }),
          ),
        }),
      }),
    );

    const output = consoleSpy.mock.calls.map((call) => call[0]).join("\n");
    expect(output).toContain("drop --category");
    consoleSpy.mockRestore();
  });

  it("suppresses the `[fallback]` kind label in terminal output", async () => {
    const consoleSpy = spyOn(console, "log").mockImplementation(() => {});

    await searchSymbolsAction(
      "npm:express",
      "middleware",
      {},
      createDeps({
        codeNavigationService: createMockCodeNavigationService({
          searchSymbols: mock(() =>
            Promise.resolve({
              results: [
                {
                  filePath: "lib/middleware/init.js",
                  startLine: 1,
                  endLine: 43,
                  kind: "fallback",
                  code: "module.exports = function () { return true; };",
                },
              ],
              totalMatches: 1,
              hasMore: false,
              version: "v5.2.1",
            }),
          ),
        }),
      }),
    );

    const output = consoleSpy.mock.calls.map((call) => call[0]).join("\n");
    expect(output).toContain("lib/middleware/init.js:1-43");
    expect(output).not.toContain("[fallback]");
    consoleSpy.mockRestore();
  });

  it("accepts --kind, --intent, and --match-mode values case-insensitively", async () => {
    const searchSymbols = mock<
      (
        params: import("../../services/index.js").SearchSymbolsParams,
      ) => Promise<import("../../services/index.js").SearchSymbolsResult>
    >(() => Promise.resolve({ results: [], totalMatches: 0, hasMore: false }));
    const deps = createDeps({
      codeNavigationService: createMockCodeNavigationService({
        searchSymbols,
      }),
    });
    const logSpy = spyOn(console, "log").mockImplementation(() => {});

    await searchSymbolsAction(
      "npm:express",
      "middleware",
      { kind: "FUNCTION", intent: "TEST", matchMode: "AND" },
      deps,
    );

    expect(searchSymbols.mock.calls[0]?.[0]).toMatchObject({
      kind: "FUNCTION",
      fileIntent: "TEST",
      matchMode: "AND",
    });
    logSpy.mockRestore();
  });

  it("merges repeatable --keyword with comma-separated --keywords", async () => {
    const searchSymbols = mock<
      (
        params: import("../../services/index.js").SearchSymbolsParams,
      ) => Promise<import("../../services/index.js").SearchSymbolsResult>
    >(() => Promise.resolve({ results: [], totalMatches: 0, hasMore: false }));
    const deps = createDeps({
      codeNavigationService: createMockCodeNavigationService({
        searchSymbols,
      }),
    });

    const logSpy = spyOn(console, "log").mockImplementation(() => {});

    await searchSymbolsAction(
      "npm:express",
      undefined,
      { keywords: "router,handler", keyword: ["middleware", "router"] },
      deps,
    );

    // De-duplicates "router" while preserving first-seen order.
    expect(searchSymbols.mock.calls[0]?.[0]?.keywords).toEqual([
      "router",
      "handler",
      "middleware",
    ]);

    logSpy.mockRestore();
  });

  it("throws AuthRequiredError when no valid token is available", async () => {
    const consoleSpy = spyOn(console, "log").mockImplementation(() => {});

    await expect(
      searchSymbolsAction(
        "npm:express",
        "middleware",
        {},
        createDeps({ hasValidToken: false }),
      ),
    ).rejects.toThrow(AuthRequiredError);

    consoleSpy.mockRestore();
  });

  it("exits when indexing is still in progress", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });

    try {
      await searchSymbolsAction(
        "npm:express",
        "middleware",
        {},
        createDeps({
          codeNavigationService: createMockCodeNavigationService({
            searchSymbols: mock(() =>
              Promise.reject(
                new CodeNavigationIndexingError(
                  "Target is being indexed.",
                  "idx-123",
                ),
              ),
            ),
          }),
        }),
      );
    } catch {
      // expected process.exit throw
    }

    expect(errorSpy.mock.calls.map((call) => call[0]).join("\n")).toContain(
      "Target is being indexed",
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("exits when both query and keywords are missing", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });

    try {
      await searchSymbolsAction("npm:express", undefined, {}, createDeps());
    } catch {
      // expected process.exit throw
    }

    expect(errorSpy.mock.calls.map((call) => call[0]).join("\n")).toContain(
      "Provide a query argument, or pass keywords via --keywords or repeated --keyword.",
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });
});
