import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import {
  CodeNavigationBackendError,
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
                indexingStatus: "INDEXED",
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
                indexingStatus: "INDEXED",
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
                indexingStatus: "INDEXING",
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
                indexingStatus: "INDEXED",
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
                indexingStatus: "INDEXING",
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
      expect(message).toContain("--wait 60");
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
                indexingStatus: "INDEXED",
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
});
