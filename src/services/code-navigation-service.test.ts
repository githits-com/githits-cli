import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import {
  CodeNavigationBackendError,
  CodeNavigationFileNotFoundError,
  CodeNavigationIndexingError,
  CodeNavigationNetworkError,
  CodeNavigationServiceImpl,
  CodeNavigationTargetNotFoundError,
  CodeNavigationUnresolvableError,
  CodeNavigationValidationError,
  CodeNavigationVersionNotFoundError,
  MalformedCodeNavigationResponseError,
} from "./code-navigation-service.js";
import { AuthenticationError } from "./githits-service.js";
import { createMockTokenProvider } from "./test-helpers.js";

function mockFetch(impl: () => Promise<Response>) {
  const fn = mock(impl);
  globalThis.fetch = fn as unknown as typeof fetch;
  return fn;
}

describe("CodeNavigationServiceImpl", () => {
  const BASE_URL = "https://nav.example.com";
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("sends GraphQL request and normalizes search results", async () => {
    const fn = mockFetch(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            data: {
              searchSymbols: {
                results: [
                  {
                    name: "useMiddleware",
                    kind: "function",
                    category: "callable",
                    filePath: "src/app.js",
                    startLine: 42,
                    preview: "function useMiddleware(fn) {",
                    language: "javascript",
                  },
                ],
                totalMatches: 1,
                hasMore: false,
                indexedVersion: "4.18.0",
                diagnostics: { hint: null },
                warning: null,
                codeIndexState: "CURRENT",
              },
            },
          }),
          { headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    const service = new CodeNavigationServiceImpl(
      BASE_URL,
      createMockTokenProvider(),
      globalThis.fetch,
    );

    const result = await service.searchSymbols({
      target: { registry: "NPM", packageName: "express", version: "4.18.0" },
      query: "middleware",
    });

    expect(result.version).toBe("4.18.0");
    expect(result.totalMatches).toBe(1);
    expect(result.results[0]?.name).toBe("useMiddleware");

    const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${BASE_URL}/api/graphql`);
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer mock-access-token",
    );

    const body = JSON.parse(init.body as string);
    expect(body.variables.registry).toBe("NPM");
    expect(body.variables.packageName).toBe("express");
    expect(body.variables.query).toBe("middleware");
  });

  it("retries once on 401 with refreshed token", async () => {
    const responses = [
      Promise.resolve(new Response("", { status: 401 })),
      Promise.resolve(
        new Response(
          JSON.stringify({
            data: {
              searchSymbols: {
                results: [],
                totalMatches: 0,
                hasMore: false,
                indexedVersion: null,
                diagnostics: { hint: null },
                warning: null,
                codeIndexState: "CURRENT",
              },
            },
          }),
        ),
      ),
    ];
    const fn = mock(
      () => responses.shift() ?? Promise.reject(new Error("no response")),
    );
    globalThis.fetch = fn as unknown as typeof fetch;

    const tokenProvider = createMockTokenProvider({
      forceRefresh: mock(() => Promise.resolve("mock-refreshed-token")),
    });
    const service = new CodeNavigationServiceImpl(
      BASE_URL,
      tokenProvider,
      globalThis.fetch,
    );

    await service.searchSymbols({
      target: { registry: "NPM", packageName: "express" },
      query: "middleware",
    });

    expect(tokenProvider.forceRefresh).toHaveBeenCalledTimes(1);
    const secondCall = fn.mock.calls[1] as unknown as [string, RequestInit];
    expect(
      (secondCall[1].headers as Record<string, string>).Authorization,
    ).toBe("Bearer mock-refreshed-token");
  });

  it("throws indexing error when backend reports indexing in progress", async () => {
    mockFetch(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            data: {
              searchSymbols: {
                results: [],
                totalMatches: 0,
                hasMore: false,
                indexedVersion: null,
                diagnostics: { hint: null },
                warning: null,
                codeIndexState: "INDEXING",
                indexingRef: "idx-123",
                availableVersions: [{ version: "4.18.0", ref: "v4.18.0" }],
              },
            },
          }),
        ),
      ),
    );

    const service = new CodeNavigationServiceImpl(
      BASE_URL,
      createMockTokenProvider(),
      globalThis.fetch,
    );

    await expect(
      service.searchSymbols({
        target: { registry: "NPM", packageName: "express" },
        query: "middleware",
      }),
    ).rejects.toBeInstanceOf(CodeNavigationIndexingError);
  });

  it("throws malformed response error when payload does not match schema", async () => {
    mockFetch(() =>
      Promise.resolve(
        new Response(JSON.stringify({ data: { wrongField: {} } }), {
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    const service = new CodeNavigationServiceImpl(
      BASE_URL,
      createMockTokenProvider(),
      globalThis.fetch,
    );

    await expect(
      service.searchSymbols({
        target: { registry: "NPM", packageName: "express" },
        query: "middleware",
      }),
    ).rejects.toBeInstanceOf(MalformedCodeNavigationResponseError);
  });

  it("retries once when GraphQL returns UNAUTHORIZED", async () => {
    const responses = [
      Promise.resolve(
        new Response(
          JSON.stringify({
            errors: [
              {
                message: "Unauthorized",
                extensions: { code: "UNAUTHORIZED" },
              },
            ],
          }),
          { headers: { "Content-Type": "application/json" } },
        ),
      ),
      Promise.resolve(
        new Response(
          JSON.stringify({
            data: {
              searchSymbols: {
                results: [],
                totalMatches: 0,
                hasMore: false,
                indexedVersion: null,
                diagnostics: { hint: null },
                warning: null,
                codeIndexState: "CURRENT",
              },
            },
          }),
          { headers: { "Content-Type": "application/json" } },
        ),
      ),
    ];
    const fn = mock(
      () => responses.shift() ?? Promise.reject(new Error("no response")),
    );
    globalThis.fetch = fn as unknown as typeof fetch;

    const tokenProvider = createMockTokenProvider({
      forceRefresh: mock(() => Promise.resolve("mock-refreshed-token")),
    });
    const service = new CodeNavigationServiceImpl(
      BASE_URL,
      tokenProvider,
      globalThis.fetch,
    );

    await service.searchSymbols({
      target: { registry: "NPM", packageName: "express" },
      query: "middleware",
    });

    expect(tokenProvider.forceRefresh).toHaveBeenCalledTimes(1);
  });

  it("throws authentication error when refresh does not produce a new token", async () => {
    mockFetch(() => Promise.resolve(new Response("", { status: 401 })));

    const service = new CodeNavigationServiceImpl(
      BASE_URL,
      createMockTokenProvider({
        forceRefresh: mock(() => Promise.resolve(undefined)),
      }),
      globalThis.fetch,
    );

    await expect(
      service.searchSymbols({
        target: { registry: "NPM", packageName: "express" },
        query: "middleware",
      }),
    ).rejects.toBeInstanceOf(AuthenticationError);
  });

  it("maps null data with GraphQL not-found error to CodeNavigationTargetNotFoundError", async () => {
    // Observed live response for unknown packages: { data: null, errors: [...] }
    // without `extensions.code`. Schema accepts null data; createGraphQLError
    // then matches the message heuristically.
    mockFetch(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            data: null,
            errors: [
              {
                message:
                  "Package not found in registry: npm/nosuchpackage-zzzzz. Verify the package name and registry are correct.",
                path: ["searchSymbols"],
              },
            ],
          }),
          { headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    const service = new CodeNavigationServiceImpl(
      BASE_URL,
      createMockTokenProvider(),
      globalThis.fetch,
    );

    await expect(
      service.searchSymbols({
        target: { registry: "NPM", packageName: "nosuchpackage-zzzzz" },
        query: "middleware",
      }),
    ).rejects.toBeInstanceOf(CodeNavigationTargetNotFoundError);
  });

  it("maps NOT_FOUND extensions.code to CodeNavigationTargetNotFoundError", async () => {
    // Forward-compat: once backend starts populating extensions.code
    // (backend request B8), the structured path is preferred over the
    // message heuristic.
    mockFetch(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            errors: [
              {
                message: "No such target",
                extensions: { code: "NOT_FOUND" },
              },
            ],
          }),
          { headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    const service = new CodeNavigationServiceImpl(
      BASE_URL,
      createMockTokenProvider(),
      globalThis.fetch,
    );

    await expect(
      service.searchSymbols({
        target: { registry: "NPM", packageName: "unknown" },
        query: "middleware",
      }),
    ).rejects.toBeInstanceOf(CodeNavigationTargetNotFoundError);
  });

  it("wraps fetch failures in CodeNavigationNetworkError", async () => {
    mockFetch(() =>
      Promise.reject(
        Object.assign(new Error("connect ECONNREFUSED"), {
          code: "ECONNREFUSED",
        }),
      ),
    );

    const service = new CodeNavigationServiceImpl(
      BASE_URL,
      createMockTokenProvider(),
      globalThis.fetch,
    );

    await expect(
      service.searchSymbols({
        target: { registry: "NPM", packageName: "express" },
        query: "middleware",
      }),
    ).rejects.toBeInstanceOf(CodeNavigationNetworkError);
  });

  it("maps 5xx responses to CodeNavigationBackendError with status", async () => {
    mockFetch(() =>
      Promise.resolve(
        new Response("Internal Server Error", {
          status: 502,
          headers: { "Content-Type": "text/plain" },
        }),
      ),
    );

    const service = new CodeNavigationServiceImpl(
      BASE_URL,
      createMockTokenProvider(),
      globalThis.fetch,
    );

    try {
      await service.searchSymbols({
        target: { registry: "NPM", packageName: "express" },
        query: "middleware",
      });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(CodeNavigationBackendError);
      expect((err as CodeNavigationBackendError).status).toBe(502);
    }
  });

  it("dispatches extensions.code VERSION_NOT_FOUND into a typed error with structured fields", async () => {
    mockFetch(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            data: null,
            errors: [
              {
                message:
                  'No version of npm/express matches "4". Available versions: 5.2.1, 5.1.0. Try: express@5.2.1 (exact) or express@^5.0.0 (latest 5.x).',
                extensions: {
                  code: "VERSION_NOT_FOUND",
                  retryable: false,
                  package: "npm/express",
                  requested_version: "4",
                  latest_indexed: "5.2.1",
                  available_versions: [
                    { version: "5.2.1", ref: "v5.2.1" },
                    { version: "5.1.0", ref: "v5.1.0" },
                  ],
                },
              },
            ],
          }),
        ),
      ),
    );

    const service = new CodeNavigationServiceImpl(
      BASE_URL,
      createMockTokenProvider(),
      globalThis.fetch,
    );

    try {
      await service.searchSymbols({
        target: { registry: "NPM", packageName: "express", version: "4" },
        query: "middleware",
      });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(CodeNavigationVersionNotFoundError);
      const typed = err as CodeNavigationVersionNotFoundError;
      expect(typed.packageName).toBe("npm/express");
      expect(typed.requestedVersion).toBe("4");
      expect(typed.latestIndexed).toBe("5.2.1");
      expect(typed.availableVersions).toEqual([
        { version: "5.2.1", ref: "v5.2.1" },
        { version: "5.1.0", ref: "v5.1.0" },
      ]);
    }
  });

  it("dispatches extensions.code VALIDATION_ERROR to CodeNavigationValidationError", async () => {
    mockFetch(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            data: null,
            errors: [
              {
                message: "Query too long.",
                extensions: { code: "VALIDATION_ERROR", retryable: false },
              },
            ],
          }),
        ),
      ),
    );

    const service = new CodeNavigationServiceImpl(
      BASE_URL,
      createMockTokenProvider(),
      globalThis.fetch,
    );

    await expect(
      service.searchSymbols({
        target: { registry: "NPM", packageName: "express" },
        query: "x".repeat(1000),
      }),
    ).rejects.toBeInstanceOf(CodeNavigationValidationError);
  });

  it("dispatches extensions.code TIMEOUT to CodeNavigationBackendError with graphqlCode=TIMEOUT and retryable=true", async () => {
    mockFetch(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            data: null,
            errors: [
              {
                message: "Backend timed out.",
                extensions: { code: "TIMEOUT", retryable: true },
              },
            ],
          }),
        ),
      ),
    );

    const service = new CodeNavigationServiceImpl(
      BASE_URL,
      createMockTokenProvider(),
      globalThis.fetch,
    );

    try {
      await service.searchSymbols({
        target: { registry: "NPM", packageName: "express" },
        query: "middleware",
      });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(CodeNavigationBackendError);
      const typed = err as CodeNavigationBackendError;
      expect(typed.graphqlCode).toBe("TIMEOUT");
      expect(typed.retryable).toBe(true);
    }
  });

  it("ignores legacy message heuristics when extensions.code is present (extensions take precedence)", async () => {
    // Backend emits UPSTREAM_ERROR; the message happens to include
    // "not found" because the upstream complained. The new dispatch
    // must NOT misclassify this as NOT_FOUND.
    mockFetch(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            data: null,
            errors: [
              {
                message: "Upstream registry said: package not found.",
                extensions: { code: "UPSTREAM_ERROR", retryable: true },
              },
            ],
          }),
        ),
      ),
    );

    const service = new CodeNavigationServiceImpl(
      BASE_URL,
      createMockTokenProvider(),
      globalThis.fetch,
    );

    try {
      await service.searchSymbols({
        target: { registry: "NPM", packageName: "express" },
        query: "middleware",
      });
      expect.unreachable();
    } catch (err) {
      expect(err).not.toBeInstanceOf(CodeNavigationTargetNotFoundError);
      expect(err).toBeInstanceOf(CodeNavigationBackendError);
      expect((err as CodeNavigationBackendError).graphqlCode).toBe(
        "UPSTREAM_ERROR",
      );
    }
  });

  it("falls back to message heuristics when extensions.code is absent (legacy backend)", async () => {
    // Pre-deployment backend response shape — still must work
    // during the rollover window.
    mockFetch(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            data: null,
            errors: [
              {
                message:
                  "Package not found in registry: npm/nosuchpackage-zzzzz.",
                path: ["searchSymbols"],
              },
            ],
          }),
        ),
      ),
    );

    const service = new CodeNavigationServiceImpl(
      BASE_URL,
      createMockTokenProvider(),
      globalThis.fetch,
    );

    await expect(
      service.searchSymbols({
        target: { registry: "NPM", packageName: "nosuchpackage-zzzzz" },
        query: "x",
      }),
    ).rejects.toBeInstanceOf(CodeNavigationTargetNotFoundError);
  });

  it("indexing error message guides callers to retry with a longer wait timeout", async () => {
    mockFetch(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            data: {
              searchSymbols: {
                results: [],
                totalMatches: 0,
                hasMore: false,
                indexedVersion: null,
                diagnostics: { hint: null },
                warning: null,
                codeIndexState: "INDEXING",
                indexingRef: "idx-123",
              },
            },
          }),
        ),
      ),
    );

    const service = new CodeNavigationServiceImpl(
      BASE_URL,
      createMockTokenProvider(),
      globalThis.fetch,
    );

    try {
      await service.searchSymbols({
        target: { registry: "NPM", packageName: "express" },
        query: "middleware",
      });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(CodeNavigationIndexingError);
      const message = (err as Error).message;
      expect(message).toContain("Target is still indexing");
      expect(message).toContain("usually completes within 30 seconds");
      expect(message).toContain("--wait 60000");
      expect(message).toContain("wait_timeout_ms: 60000");
      expect(message).toContain("idx-123");
    }
  });

  it("classifies 'could not resolve' messages as UNRESOLVABLE, not NOT_FOUND", async () => {
    // Regression guard on two heuristics: the NOT_FOUND heuristic
    // must not swallow resolution-failure phrasing, and the new
    // UNRESOLVABLE heuristic must catch it so callers can
    // distinguish "target does not exist" from "version/ref cannot
    // be resolved".
    mockFetch(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            data: null,
            errors: [
              {
                message:
                  "Could not resolve version 25.6.0 to a Git ref for npm/@types/node.",
                path: ["searchSymbols"],
              },
            ],
          }),
          { headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    const service = new CodeNavigationServiceImpl(
      BASE_URL,
      createMockTokenProvider(),
      globalThis.fetch,
    );

    await expect(
      service.searchSymbols({
        target: {
          registry: "NPM",
          packageName: "@types/node",
          version: "25.6.0",
        },
        query: "Buffer",
      }),
    ).rejects.toBeInstanceOf(
      // Import it via the module's export so any rename is caught here.
      (await import("./code-navigation-service.js"))
        .CodeNavigationUnresolvableError,
    );
  });

  it("always sends mode: DETAILED and omits the $verbose variable from the GraphQL request", async () => {
    // The service makes this choice once per request so both CLI and
    // MCP consumers get the richest response. Confirm the request
    // body inlines `mode: DETAILED` and carries no `verbose` variable.
    const fn = mockFetch(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            data: {
              searchSymbols: {
                results: [],
                totalMatches: 0,
                hasMore: false,
                indexedVersion: null,
                diagnostics: { hint: null },
                warning: null,
                codeIndexState: "CURRENT",
              },
            },
          }),
          { headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    const service = new CodeNavigationServiceImpl(
      BASE_URL,
      createMockTokenProvider(),
      globalThis.fetch,
    );

    await service.searchSymbols({
      target: { registry: "NPM", packageName: "express" },
      query: "middleware",
    });

    const [, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(Object.keys(body.variables)).not.toContain("verbose");
    expect(Object.keys(body.variables)).not.toContain("mode");
    // mode is inlined as a literal in the query body
    expect(body.query).toContain("mode: DETAILED");
    expect(body.query).not.toContain("@include(if: $verbose)");
  });

  // ------------------------------------------------------------------
  // listFiles
  // ------------------------------------------------------------------

  it("normalises a successful listRepoFiles response", async () => {
    mockFetch(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            data: {
              listRepoFiles: {
                files: [
                  {
                    path: "src/index.js",
                    name: "index.js",
                    language: "javascript",
                    fileType: "SOURCE",
                    byteSize: 1234,
                  },
                  { path: "src/only-path.txt" },
                ],
                total: 2,
                hasMore: false,
                indexedVersion: "v5.2.1",
                resolution: {
                  resolvedRef: "v5.2.1",
                  commitSha: "abc123",
                },
                diagnostics: null,
                codeIndexState: "CURRENT",
              },
            },
          }),
          { status: 200 },
        ),
      ),
    );
    const service = new CodeNavigationServiceImpl(
      BASE_URL,
      createMockTokenProvider(),
    );

    const result = await service.listFiles({
      target: { registry: "NPM", packageName: "express" },
    });

    expect(result.files.length).toBe(2);
    expect(result.files[0]).toEqual({
      path: "src/index.js",
      name: "index.js",
      language: "javascript",
      fileType: "SOURCE",
      byteSize: 1234,
    });
    // null fields are stripped — second entry carries only `path`.
    expect(result.files[1]).toEqual({ path: "src/only-path.txt" });
    expect(result.total).toBe(2);
    expect(result.hasMore).toBe(false);
    expect(result.indexedVersion).toBe("v5.2.1");
    expect(result.resolution?.resolvedRef).toBe("v5.2.1");
  });

  it("throws CodeNavigationIndexingError for data-path INDEXING sentinel on listFiles", async () => {
    mockFetch(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            data: {
              listRepoFiles: {
                files: [],
                total: 0,
                hasMore: false,
                indexedVersion: null,
                resolution: null,
                diagnostics: null,
                codeIndexState: "INDEXING",
                indexingRef: "ref_xyz",
                availableVersions: [{ version: "4.21.0", ref: "v4.21.0" }],
              },
            },
          }),
          { status: 200 },
        ),
      ),
    );
    const service = new CodeNavigationServiceImpl(
      BASE_URL,
      createMockTokenProvider(),
    );

    try {
      await service.listFiles({
        target: { registry: "NPM", packageName: "express" },
      });
      throw new Error("expected listFiles to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(CodeNavigationIndexingError);
      const typed = error as CodeNavigationIndexingError;
      expect(typed.indexingRef).toBe("ref_xyz");
      expect(typed.availableVersions).toEqual([
        { version: "4.21.0", ref: "v4.21.0" },
      ]);
    }
  });

  it("surfaces diagnostics.hint on listFiles empty responses", async () => {
    mockFetch(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            data: {
              listRepoFiles: {
                files: [],
                total: 0,
                hasMore: false,
                indexedVersion: "v5.2.1",
                resolution: null,
                diagnostics: { hint: "No files match that prefix." },
                codeIndexState: "CURRENT",
              },
            },
          }),
          { status: 200 },
        ),
      ),
    );
    const service = new CodeNavigationServiceImpl(
      BASE_URL,
      createMockTokenProvider(),
    );

    const result = await service.listFiles({
      target: { registry: "NPM", packageName: "express" },
      pathPrefix: "no-such-dir/",
    });

    expect(result.files).toEqual([]);
    expect(result.hint).toBe("No files match that prefix.");
  });

  // ------------------------------------------------------------------
  // readFile
  // ------------------------------------------------------------------

  it("normalises a successful fetchCodeContext response", async () => {
    mockFetch(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            data: {
              fetchCodeContext: {
                content: "// hello\nconsole.log('hi');\n",
                filePath: "src/hello.js",
                language: "javascript",
                totalLines: 2,
                startLine: 1,
                endLine: 2,
                isBinary: false,
                codeIndexState: "CURRENT",
              },
            },
          }),
          { status: 200 },
        ),
      ),
    );
    const service = new CodeNavigationServiceImpl(
      BASE_URL,
      createMockTokenProvider(),
    );
    const result = await service.readFile({
      target: { registry: "NPM", packageName: "express" },
      filePath: "src/hello.js",
    });
    expect(result.filePath).toBe("src/hello.js");
    expect(result.content).toContain("console.log");
    expect(result.isBinary).toBe(false);
  });

  it("preserves isBinary + null content from fetchCodeContext", async () => {
    mockFetch(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            data: {
              fetchCodeContext: {
                content: null,
                filePath: "assets/logo.png",
                language: null,
                totalLines: null,
                startLine: null,
                endLine: null,
                isBinary: true,
                codeIndexState: "CURRENT",
              },
            },
          }),
          { status: 200 },
        ),
      ),
    );
    const service = new CodeNavigationServiceImpl(
      BASE_URL,
      createMockTokenProvider(),
    );
    const result = await service.readFile({
      target: { registry: "NPM", packageName: "express" },
      filePath: "assets/logo.png",
    });
    expect(result.isBinary).toBe(true);
    expect(result.content).toBeUndefined();
  });

  it("throws CodeNavigationIndexingError for data-path INDEXING sentinel on readFile", async () => {
    mockFetch(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            data: {
              fetchCodeContext: {
                content: null,
                filePath: null,
                language: null,
                codeIndexState: "INDEXING",
                indexingRef: "ref_read",
              },
            },
          }),
          { status: 200 },
        ),
      ),
    );
    const service = new CodeNavigationServiceImpl(
      BASE_URL,
      createMockTokenProvider(),
    );
    try {
      await service.readFile({
        target: { registry: "NPM", packageName: "express" },
        filePath: "src/x.js",
      });
      throw new Error("expected readFile to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(CodeNavigationIndexingError);
      expect((error as CodeNavigationIndexingError).indexingRef).toBe(
        "ref_read",
      );
    }
  });

  it("throws CodeNavigationFileNotFoundError when backend emits FILE_NOT_FOUND code", async () => {
    mockFetch(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            errors: [
              {
                message: "File not found: nope.js",
                extensions: {
                  code: "FILE_NOT_FOUND",
                  file_path: "nope.js",
                },
              },
            ],
          }),
          { status: 200 },
        ),
      ),
    );
    const service = new CodeNavigationServiceImpl(
      BASE_URL,
      createMockTokenProvider(),
    );
    try {
      await service.readFile({
        target: { registry: "NPM", packageName: "express" },
        filePath: "nope.js",
      });
      throw new Error("expected readFile to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(CodeNavigationFileNotFoundError);
      expect((error as CodeNavigationFileNotFoundError).filePath).toBe(
        "nope.js",
      );
    }
  });

  // ------------------------------------------------------------------
  // grepRepo
  // ------------------------------------------------------------------

  it("normalises a successful grepRepo response", async () => {
    mockFetch(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            data: {
              grepRepo: {
                matches: [
                  {
                    filePath: "src/index.js",
                    line: 10,
                    matchStartByte: 6,
                    matchEndByte: 13,
                    lineContent: "const app = express();",
                    contextBefore: ["", "// setup"],
                    contextAfter: ["", "app.get();"],
                    fileContentHash: "abc123",
                    fileIntent: "production",
                    symbolRowId: "42",
                    symbol: {
                      name: "createRouter",
                      qualifiedPath: "express.createRouter",
                      kind: "function",
                    },
                  },
                ],
                nextCursor: null,
                totalMatches: 1,
                hasMore: false,
                truncatedReason: "NONE",
                routeTaken: "CONTENT_INDEX",
                filesScanned: 1,
                filesInScope: 1,
                binaryFilesSkipped: 0,
                filesTooLargeSkipped: 0,
                uniqueFilesMatched: 1,
                indexedVersion: "v5.2.1",
                resolution: {
                  resolvedRef: "v5.2.1",
                  commitSha: "abc",
                },
                codeIndexState: "CURRENT",
              },
            },
          }),
          { status: 200 },
        ),
      ),
    );
    const service = new CodeNavigationServiceImpl(
      BASE_URL,
      createMockTokenProvider(),
    );
    const result = await service.grepRepo({
      target: { registry: "NPM", packageName: "express" },
      pattern: "middleware",
      pathSelectors: [{ kind: "PREFIX", value: "src/" }],
      symbolFields: ["name", "qualified_path", "kind"],
    });
    expect(result.matches.length).toBe(1);
    expect(result.matches[0]?.line).toBe(10);
    expect(result.matches[0]?.symbol).toMatchObject({
      name: "createRouter",
      qualifiedPath: "express.createRouter",
      kind: "function",
    });
    expect(result.totalMatches).toBe(1);
    expect(result.routeTaken).toBe("CONTENT_INDEX");
    expect(result.resolution?.resolvedRef).toBe("v5.2.1");
  });

  it("normalises unified search highlight spans", async () => {
    const fn = mockFetch(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            data: {
              search: {
                completed: true,
                searchRef: "search-ref-123",
                result: {
                  query: "router middleware",
                  queryWarnings: [],
                  sources: ["CODE"],
                  results: [
                    {
                      id: "hit-1",
                      resultType: "REPOSITORY_CODE",
                      targetLabel: "npm:express@4.18.2",
                      title: "router middleware",
                      summary: "function router(req, res, next) { ... }",
                      score: 0.92,
                      highlights: {
                        title: [[7, 17]],
                        summary: [[9, 15]],
                      },
                      locator: {
                        registry: "npm",
                        packageName: "express",
                        version: "4.18.2",
                        filePath: "lib/router/index.js",
                        startLine: 42,
                        endLine: 57,
                        language: "javascript",
                      },
                    },
                  ],
                  page: {
                    offset: 0,
                    limit: 20,
                    returned: 1,
                    hasMore: false,
                  },
                  partialResults: false,
                  sourceStatus: [],
                },
                progress: null,
              },
            },
          }),
          { headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    const service = new CodeNavigationServiceImpl(
      BASE_URL,
      createMockTokenProvider(),
      globalThis.fetch,
    );

    const result = await service.search({
      targets: [{ registry: "NPM", packageName: "express" }],
      query: "router middleware",
      allowPartialResults: true,
    });

    expect(result.state).toBe("completed");
    if (result.state !== "completed") {
      throw new Error("expected completed search outcome");
    }
    expect(result.result.results[0]?.highlights).toEqual({
      title: [[7, 17]],
      summary: [[9, 15]],
    });
    const [, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.variables.allowPartialResults).toBe(true);
  });

  it("throws CodeNavigationIndexingError for data-path INDEXING sentinel on grepRepo", async () => {
    mockFetch(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            data: {
              grepRepo: {
                matches: [],
                nextCursor: null,
                totalMatches: 0,
                hasMore: false,
                truncatedReason: "NONE",
                filesScanned: 0,
                filesInScope: 0,
                binaryFilesSkipped: 0,
                filesTooLargeSkipped: 0,
                uniqueFilesMatched: 0,
                codeIndexState: "INDEXING",
                indexingRef: "ref_grep",
                availableVersions: [{ version: "4.21.0", ref: "v4.21.0" }],
              },
            },
          }),
          { status: 200 },
        ),
      ),
    );
    const service = new CodeNavigationServiceImpl(
      BASE_URL,
      createMockTokenProvider(),
    );
    try {
      await service.grepRepo({
        target: { registry: "NPM", packageName: "express" },
        pattern: "middleware",
        pathSelectors: [{ kind: "PREFIX", value: "src/" }],
      });
      throw new Error("expected grepRepo to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(CodeNavigationIndexingError);
      expect((error as CodeNavigationIndexingError).indexingRef).toBe(
        "ref_grep",
      );
    }
  });

  it("throws CodeNavigationBackendError when backend emits GREP_FILE_TOO_LARGE", async () => {
    mockFetch(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            errors: [
              {
                message: "File too large to grep: dist/bundle.js",
                extensions: {
                  code: "GREP_FILE_TOO_LARGE",
                  file_path: "dist/bundle.js",
                },
              },
            ],
          }),
          { status: 200 },
        ),
      ),
    );
    const service = new CodeNavigationServiceImpl(
      BASE_URL,
      createMockTokenProvider(),
    );
    try {
      await service.grepRepo({
        target: { registry: "NPM", packageName: "express" },
        pattern: "middleware",
        pathSelectors: [{ kind: "EXACT", value: "dist/bundle.js" }],
      });
      throw new Error("expected grepRepo to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(CodeNavigationBackendError);
      expect((error as CodeNavigationBackendError).graphqlCode).toBe(
        "GREP_FILE_TOO_LARGE",
      );
    }
  });

  it("sends grepRepo variables with the correct shape", async () => {
    const fn = mockFetch(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            data: {
              grepRepo: {
                matches: [],
                nextCursor: null,
                totalMatches: 0,
                hasMore: false,
                truncatedReason: "NONE",
                filesScanned: 0,
                filesInScope: 0,
                binaryFilesSkipped: 0,
                filesTooLargeSkipped: 0,
                uniqueFilesMatched: 0,
                codeIndexState: "CURRENT",
              },
            },
          }),
          { status: 200 },
        ),
      ),
    );
    const service = new CodeNavigationServiceImpl(
      BASE_URL,
      createMockTokenProvider(),
    );
    await service.grepRepo({
      target: { registry: "NPM", packageName: "express", version: "5.2.1" },
      pattern: "middleware",
      patternType: "REGEX",
      caseSensitive: true,
      pathSelectors: [
        { kind: "EXACT", value: "src/index.js" },
        { kind: "GLOB", value: "src/**/*.js" },
      ],
      extensions: ["js"],
      excludeDocFiles: true,
      excludeTestFiles: true,
      contextLinesBefore: 5,
      contextLinesAfter: 2,
      maxMatches: 100,
      maxMatchesPerFile: 3,
      cursor: "cursor-123",
      symbolFields: ["name", "qualified_path", "kind"],
      waitTimeoutMs: 5000,
    });
    const [, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.variables).toMatchObject({
      registry: "NPM",
      packageName: "express",
      version: "5.2.1",
      pattern: "middleware",
      patternType: "REGEX",
      caseSensitive: true,
      pathSelectors: [
        { kind: "EXACT", value: "src/index.js" },
        { kind: "GLOB", value: "src/**/*.js" },
      ],
      extensions: ["js"],
      excludeDocFiles: true,
      excludeTestFiles: true,
      contextLinesBefore: 5,
      contextLinesAfter: 2,
      maxMatches: 100,
      maxMatchesPerFile: 3,
      cursor: "cursor-123",
      symbolFields: ["name", "qualified_path", "kind"],
      waitTimeoutMs: 5000,
    });
    expect(body.query).toContain("symbol {");
    expect(body.query).toContain("name");
    expect(body.query).toContain("qualifiedPath");
    expect(body.query).toContain("kind");
    expect(body.query).not.toContain("symbolRef");
  });

  it("sends GraphQL variables with the correct listRepoFiles shape", async () => {
    const fn = mockFetch(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            data: {
              listRepoFiles: {
                files: [],
                total: 0,
                hasMore: false,
                codeIndexState: "CURRENT",
              },
            },
          }),
          { status: 200 },
        ),
      ),
    );
    const service = new CodeNavigationServiceImpl(
      BASE_URL,
      createMockTokenProvider(),
    );

    await service.listFiles({
      target: { registry: "NPM", packageName: "express", version: "5.2.1" },
      pathPrefix: "src/",
      limit: 100,
      waitTimeoutMs: 5000,
    });

    const [, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.variables).toMatchObject({
      registry: "NPM",
      packageName: "express",
      version: "5.2.1",
      pathPrefix: "src/",
      limit: 100,
      waitTimeoutMs: 5000,
    });
  });
});
