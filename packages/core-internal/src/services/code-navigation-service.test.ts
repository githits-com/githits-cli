import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  mock,
  spyOn,
} from "bun:test";
import { FetchTimeoutError } from "../shared/fetch-timeout.js";
import {
  CodeNavigationBackendError,
  CodeNavigationFileNotFoundError,
  CodeNavigationIndexingError,
  CodeNavigationRefNotFoundError,
  CodeNavigationServiceImpl,
  CodeNavigationTargetNotFoundError,
  CodeNavigationVersionNotFoundError,
} from "./code-navigation-service.js";
import { TermsAcceptanceRequiredError } from "./githits-service.js";
import { createMockTokenProvider } from "./test-helpers.js";

function mockFetch(impl: () => Promise<Response>) {
  const fn = mock(impl);
  globalThis.fetch = fn as unknown as typeof fetch;
  return fn;
}

describe("CodeNavigationServiceImpl", () => {
  const BASE_URL = "https://nav.example.com";
  let originalFetch: typeof globalThis.fetch;
  const originalDebug = process.env.GITHITS_DEBUG;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  it("recognises HTTP terms gating and does not loop without a refresh token", async () => {
    const fetchFn = mockFetch(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            errors: [
              {
                message: "Terms acceptance required",
                extensions: {
                  code: "TERMS_ACCEPTANCE_REQUIRED",
                  terms_url: "https://githits.com/legal/terms-of-service/",
                  acceptance_url:
                    "https://acceptance.example.test/settings/privacy",
                },
              },
            ],
          }),
          { status: 403 },
        ),
      ),
    );
    const service = new CodeNavigationServiceImpl(
      BASE_URL,
      createMockTokenProvider({
        forceRefresh: mock(() => Promise.resolve(undefined)),
      }),
    );

    await expect(
      service.listFiles({
        target: { registry: "NPM", packageName: "express" },
      }),
    ).rejects.toBeInstanceOf(TermsAcceptanceRequiredError);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalDebug === undefined) delete process.env.GITHITS_DEBUG;
    else process.env.GITHITS_DEBUG = originalDebug;
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

  it("forwards listRepoFiles v7 filters to GraphQL variables", async () => {
    let capturedBody = "";
    globalThis.fetch = mock((_, init?: RequestInit) => {
      capturedBody = String(init?.body ?? "");
      return Promise.resolve(
        new Response(
          JSON.stringify({
            data: {
              listRepoFiles: {
                files: [],
                total: 0,
                hasMore: false,
                indexedVersion: "v5.2.1",
                resolution: null,
                diagnostics: null,
                codeIndexState: "CURRENT",
              },
            },
          }),
          { status: 200 },
        ),
      );
    }) as unknown as typeof fetch;

    const service = new CodeNavigationServiceImpl(
      BASE_URL,
      createMockTokenProvider(),
    );

    await service.listFiles({
      target: { registry: "NPM", packageName: "express", version: "4.18.2" },
      pathPrefix: "src/",
      pathSelectors: [
        { kind: "EXACT", value: "README.md" },
        { kind: "GLOB", value: "test/**/*.js" },
      ],
      extensions: ["js", "mjs"],
      fileTypes: ["source", "doc"],
      languages: ["JavaScript"],
      fileIntent: "PRODUCTION",
      excludeFileIntents: ["TEST", "BENCHMARK"],
      excludeDocFiles: true,
      excludeTestFiles: false,
      includeHidden: true,
      limit: 25,
      waitTimeoutMs: 1234,
    });

    const payload = JSON.parse(capturedBody) as {
      variables: Record<string, unknown>;
    };
    expect(payload.variables).toMatchObject({
      registry: "NPM",
      packageName: "express",
      version: "4.18.2",
      pathPrefix: "src/",
      pathSelectors: [
        { kind: "EXACT", value: "README.md" },
        { kind: "GLOB", value: "test/**/*.js" },
      ],
      extensions: ["js", "mjs"],
      fileTypes: ["source", "doc"],
      languages: ["JavaScript"],
      fileIntent: "PRODUCTION",
      excludeFileIntents: ["TEST", "BENCHMARK"],
      excludeDocFiles: true,
      excludeTestFiles: false,
      includeHidden: true,
      limit: 25,
      waitTimeoutMs: 1234,
    });
  });

  it("classifies client-side timeouts as CodeNavigationBackendError TIMEOUT", async () => {
    globalThis.fetch = mock(() =>
      Promise.reject(new FetchTimeoutError(1)),
    ) as unknown as typeof fetch;
    const service = new CodeNavigationServiceImpl(
      BASE_URL,
      createMockTokenProvider(),
    );

    try {
      await service.listFiles({
        target: { registry: "NPM", packageName: "express" },
      });
      throw new Error("expected timeout error");
    } catch (error) {
      expect(error).toBeInstanceOf(CodeNavigationBackendError);
      expect((error as CodeNavigationBackendError).graphqlCode).toBe("TIMEOUT");
      expect((error as CodeNavigationBackendError).retryable).toBe(true);
    }
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
                indexingEstimate: {
                  lowerSeconds: 7,
                  upperSeconds: 19,
                  elapsedSeconds: 12,
                  sampleCount: 9,
                  source: "same_repository_refs",
                },
                targetResolution: {
                  requested: {
                    repoUrl: "https://github.com/expressjs/express",
                    gitRef: "HEAD",
                  },
                  resolvedRequested: null,
                  served: null,
                  freshness: "indexing",
                  freshnessReason: "requested_ref_indexing",
                  indexingRef: "ref_xyz",
                  availableVersions: [],
                  availableRefs: [{ ref: "main" }, { ref: "v4.18.2" }],
                  suggestedRefs: [{ ref: "express-v4.18.2" }],
                },
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
      expect(typed.message).toContain("--wait 60000");
      expect(typed.message).not.toContain("Running for 12 seconds.");
      expect(typed.message).not.toContain("Similar refs usually index");
      expect(typed.indexingEstimate).toEqual({
        lowerSeconds: 7,
        upperSeconds: 19,
        elapsedSeconds: 12,
        sampleCount: 9,
        source: "same_repository_refs",
      });
      expect(typed.availableVersions).toEqual([
        { version: "4.21.0", ref: "v4.21.0" },
      ]);
      expect(typed.availableRefs).toEqual([
        { ref: "main" },
        { ref: "v4.18.2" },
      ]);
      expect(typed.targetResolution?.freshness).toBe("indexing");
      expect(typed.targetResolution?.suggestedRefs).toEqual([
        { ref: "express-v4.18.2" },
      ]);
    }
  });

  it("retries with a compatibility query on targetResolution schema mismatch", async () => {
    const bodies: string[] = [];
    globalThis.fetch = mock((_, init?: RequestInit) => {
      bodies.push(String(init?.body ?? ""));
      if (bodies.length === 1) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              errors: [
                {
                  message:
                    'Cannot query field "availableRefs" on type "TargetResolution".',
                  extensions: { code: "GRAPHQL_VALIDATION_FAILED" },
                },
              ],
            }),
            { status: 200 },
          ),
        );
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            data: {
              listRepoFiles: {
                files: [],
                total: 0,
                hasMore: false,
                indexedVersion: "v5.2.1",
                resolution: null,
                diagnostics: null,
                codeIndexState: "CURRENT",
              },
            },
          }),
          { status: 200 },
        ),
      );
    }) as unknown as typeof fetch;

    const service = new CodeNavigationServiceImpl(
      BASE_URL,
      createMockTokenProvider(),
    );

    const result = await service.listFiles({
      target: { registry: "NPM", packageName: "express" },
    });

    expect(result.indexedVersion).toBe("v5.2.1");
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toContain("suggestedRefs");
    expect(bodies[0]).toContain("availableRefs");
    expect(bodies[1]).not.toContain("suggestedRefs");
    expect(bodies[1]).toContain("availableRefs");
  });

  it("falls back again when targetResolution availableRefs is also unsupported", async () => {
    const bodies: string[] = [];
    globalThis.fetch = mock((_, init?: RequestInit) => {
      bodies.push(String(init?.body ?? ""));
      const message =
        bodies.length === 1
          ? 'Cannot query field "suggestedRefs" on type "TargetResolution".'
          : 'Cannot query field "availableRefs" on type "TargetResolution".';
      if (bodies.length < 3) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              errors: [
                {
                  message,
                  extensions: { code: "GRAPHQL_VALIDATION_FAILED" },
                },
              ],
            }),
            { status: 200 },
          ),
        );
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            data: {
              listRepoFiles: {
                files: [],
                total: 0,
                hasMore: false,
                indexedVersion: "v5.2.1",
                resolution: null,
                diagnostics: null,
                codeIndexState: "CURRENT",
              },
            },
          }),
          { status: 200 },
        ),
      );
    }) as unknown as typeof fetch;

    const service = new CodeNavigationServiceImpl(
      BASE_URL,
      createMockTokenProvider(),
    );

    const result = await service.listFiles({
      target: { registry: "NPM", packageName: "express" },
    });

    expect(result.indexedVersion).toBe("v5.2.1");
    expect(bodies).toHaveLength(3);
    expect(bodies[0]).toContain("suggestedRefs");
    expect(bodies[1]).not.toContain("suggestedRefs");
    expect(bodies[1]).toContain("availableRefs");
    expect(bodies[2]).not.toContain("suggestedRefs");
    expect(bodies[2]).not.toContain("availableRefs");
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
    const fn = mockFetch(() =>
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
    const [, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.query).toContain("indexingEstimate");
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

  it("forwards the search-status wait window to GraphQL", async () => {
    let capturedBody = "";
    globalThis.fetch = mock((_, init?: RequestInit) => {
      capturedBody = String(init?.body ?? "");
      return Promise.resolve(
        new Response(
          JSON.stringify({
            data: {
              discoverySearchProgress: {
                searchRef: "search-ref-wait",
                status: "SEARCHING",
                targetsTotal: 1,
                targetsReady: 1,
                elapsedMs: 500,
                query: "router",
                queryWarnings: [],
                sources: ["CODE"],
                results: null,
              },
            },
          }),
          { headers: { "Content-Type": "application/json" } },
        ),
      );
    }) as unknown as typeof fetch;
    const service = new CodeNavigationServiceImpl(
      BASE_URL,
      createMockTokenProvider(),
      globalThis.fetch,
    );

    await service.searchStatus("search-ref-wait", 25_000);

    const body = JSON.parse(capturedBody);
    expect(body.query).toContain("$waitTimeoutMs: Int");
    expect(body.query).toContain("waitTimeoutMs: $waitTimeoutMs");
    expect(body.variables).toEqual({
      searchRef: "search-ref-wait",
      includeResults: true,
      waitTimeoutMs: 25_000,
    });
  });

  it("emits safe debug logging for unified search request shape without query text", async () => {
    process.env.GITHITS_DEBUG = "code-nav";
    const stderrSpy = spyOn(process.stderr, "write").mockImplementation(
      () => true as never,
    );
    mockFetch(() =>
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
                  results: [],
                  page: {
                    offset: 0,
                    limit: 20,
                    returned: 0,
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

    await service.search({
      targets: [{ registry: "NPM", packageName: "express" }],
      query: "router middleware secret text",
      allowPartialResults: false,
      waitTimeoutMs: 20_000,
    });

    const call = stderrSpy.mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(call.trimEnd());
    expect(parsed.area).toBe("code-nav");
    expect(parsed.event).toBe("request");
    expect(parsed.operation).toBe("search");
    expect(parsed.fileIntent).toBe("omitted");
    expect(parsed.hasFilters).toBe(false);
    expect(parsed.presentVariableKeys).not.toContain("filters");
    expect(call).not.toContain("router middleware secret text");
    stderrSpy.mockRestore();
  });

  it("emits exact GraphQL and serialized variables for unified search under code-nav-wire", async () => {
    process.env.GITHITS_DEBUG = "code-nav-wire";
    const stderrSpy = spyOn(process.stderr, "write").mockImplementation(
      () => true as never,
    );
    mockFetch(() =>
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
                  results: [],
                  page: {
                    offset: 0,
                    limit: 20,
                    returned: 0,
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

    await service.search({
      targets: [{ registry: "NPM", packageName: "express" }],
      query: "router middleware secret text",
      allowPartialResults: false,
      waitTimeoutMs: 20_000,
    });

    const call = stderrSpy.mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(call.trimEnd());
    expect(parsed.area).toBe("code-nav-wire");
    expect(parsed.event).toBe("wire-request");
    expect(parsed.operation).toBe("search");
    expect(parsed.graphqlQuery).toContain("query UnifiedSearch(");
    expect(parsed.graphqlQuery).toContain("filters: $filters");
    expect(parsed.graphqlQuery).toContain("requestedTargetLabel");
    expect(parsed.graphqlQuery).toContain("freshTargetLabel");
    expect(parsed.graphqlQuery).toContain("servedTargetLabel");
    expect(parsed.graphqlQuery).toContain("freshness");
    expect(parsed.graphqlQuery).toContain("requestedSources");
    expect(parsed.graphqlQuery).toContain("targetMode");
    expect(parsed.graphqlQuery).toContain("requestedTargets");
    expect(parsed.graphqlQuery).toContain("resolvedRequested");
    expect(parsed.graphqlQuery).toContain("requestedRefKind");
    expect(parsed.variables).toEqual({
      targets: [{ registry: "NPM", name: "express" }],
      query: "router middleware secret text",
      allowPartialResults: false,
      waitTimeoutMs: 20_000,
    });
    stderrSpy.mockRestore();
  });

  it("requests documentation coverage and site fields in the search query", async () => {
    const fn = mockFetch(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            data: {
              search: {
                completed: true,
                searchRef: null,
                result: {
                  query: "router",
                  queryWarnings: [],
                  sources: ["DOCS"],
                  results: [],
                  page: { offset: 0, limit: 20, returned: 0, hasMore: false },
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

    await service.search({
      targets: [{ site: "site:expressjs.com" }],
      query: "router",
    });

    const [, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
    const query = JSON.parse(init.body as string).query as string;
    expect(query).toContain("coverageState");
    expect(query).toContain("frontierRemaining");
    // requestedTargets must select `site`, otherwise standalone site
    // targets echo back as empty objects during progress polling.
    expect(query).toMatch(/requestedTargets\s*{[^}]*site/);
  });

  it("normalises documentation coverage on source status", async () => {
    mockFetch(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            data: {
              search: {
                completed: true,
                searchRef: null,
                result: {
                  query: "router",
                  queryWarnings: [],
                  sources: ["DOCS"],
                  results: [],
                  page: { offset: 0, limit: 20, returned: 0, hasMore: false },
                  partialResults: false,
                  sourceStatus: [
                    {
                      source: "DOCS",
                      targetLabel: "site:expressjs.com",
                      appliedFilters: [],
                      ignoredFilters: [],
                      incompatibleFilters: [],
                      appliedQueryFeatures: [],
                      ignoredQueryFeatures: [],
                      incompatibleQueryFeatures: [],
                      coverage: {
                        coverageState: "PARTIAL",
                        pagesCrawled: 42,
                        frontierRemaining: 158,
                        note: "Site crawl is in progress",
                      },
                    },
                  ],
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

    const outcome = await service.search({
      targets: [{ site: "site:expressjs.com" }],
      query: "router",
    });

    if (outcome.state !== "completed") throw new Error("expected completed");
    expect(outcome.result.sourceStatus[0]?.coverage).toEqual({
      coverageState: "PARTIAL",
      pagesCrawled: 42,
      frontierRemaining: 158,
      note: "Site crawl is in progress",
    });
  });

  it("drops NONE documentation coverage as carrying no signal", async () => {
    mockFetch(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            data: {
              search: {
                completed: true,
                searchRef: null,
                result: {
                  query: "router",
                  queryWarnings: [],
                  sources: ["DOCS"],
                  results: [],
                  page: { offset: 0, limit: 20, returned: 0, hasMore: false },
                  partialResults: false,
                  sourceStatus: [
                    {
                      source: "DOCS",
                      targetLabel: "site:expressjs.com",
                      appliedFilters: [],
                      ignoredFilters: [],
                      incompatibleFilters: [],
                      appliedQueryFeatures: [],
                      ignoredQueryFeatures: [],
                      incompatibleQueryFeatures: [],
                      coverage: { coverageState: "NONE", pagesCrawled: 0 },
                    },
                  ],
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

    const outcome = await service.search({
      targets: [{ site: "site:expressjs.com" }],
      query: "router",
    });

    if (outcome.state !== "completed") throw new Error("expected completed");
    expect(outcome.result.sourceStatus[0]?.coverage).toBeUndefined();
  });

  it("serializes standalone site targets for unified search", async () => {
    const fn = mockFetch(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            data: {
              search: {
                completed: true,
                searchRef: null,
                result: {
                  query: "router middleware",
                  queryWarnings: [],
                  sources: ["DOCS"],
                  results: [],
                  page: {
                    offset: 0,
                    limit: 20,
                    returned: 0,
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

    await service.search({
      targets: [{ site: "site:expressjs.com" }],
      query: "router middleware",
      sources: ["DOCS"],
    });

    const [, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.variables.targets).toEqual([{ site: "site:expressjs.com" }]);
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

  it("formats PACKAGE_INDEXING estimates from structured extensions", async () => {
    mockFetch(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            errors: [
              {
                message: "Target is indexing",
                extensions: {
                  code: "PACKAGE_INDEXING",
                  indexing_ref: "idx-error",
                  hint: "Backend says this ref is queued for indexing.",
                  indexingEstimate: {
                    lower_seconds: 1,
                    upper_seconds: 1,
                    elapsed_seconds: 3,
                    sample_count: 4,
                    source: "same_repository_refs",
                  },
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
      await service.listFiles({
        target: { registry: "NPM", packageName: "express" },
      });
      throw new Error("expected listFiles to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(CodeNavigationIndexingError);
      const typed = error as CodeNavigationIndexingError;
      expect(typed.message).toBe("Target is indexing");
      expect(typed.hint).toContain(
        "Backend says this ref is queued for indexing.",
      );
      expect(typed.hint).toContain("--wait 60000");
      expect(typed.hint).toContain("wait_timeout_ms: 60000");
      expect(typed.indexingEstimate).toEqual({
        lowerSeconds: 1,
        upperSeconds: 1,
        elapsedSeconds: 3,
        sampleCount: 4,
        source: "same_repository_refs",
      });
    }
  });

  it("does not repeat a backend hint already present in the indexing message", async () => {
    const backendHint = "Backend says this ref is queued for indexing.";
    mockFetch(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            errors: [
              {
                message: `Target is indexing. ${backendHint}`,
                extensions: {
                  code: "PACKAGE_INDEXING",
                  hint: backendHint,
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
      await service.listFiles({
        target: { registry: "NPM", packageName: "express" },
      });
      throw new Error("expected listFiles to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(CodeNavigationIndexingError);
      const typed = error as CodeNavigationIndexingError;
      expect(
        `${typed.message} ${typed.hint}`.match(new RegExp(backendHint, "g")),
      ).toHaveLength(1);
      expect(typed.hint).toContain("--wait 60000");
      expect(typed.hint).not.toContain(backendHint);
    }
  });

  it("does not append fallback guidance when the message or hint names a wait argument", async () => {
    const cases = [
      {
        message: "Target is indexing",
        hint: "Call again with wait_timeout_ms: 45000.",
        waitArgument: "wait_timeout_ms: 45000",
      },
      {
        message: "Target is indexing. Wait with --wait 60000.",
        hint: "Backend says this ref is queued.",
        waitArgument: "--wait 60000",
      },
    ];

    for (const testCase of cases) {
      mockFetch(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              errors: [
                {
                  message: testCase.message,
                  extensions: {
                    code: "PACKAGE_INDEXING",
                    hint: testCase.hint,
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
        await service.listFiles({
          target: { registry: "NPM", packageName: "express" },
        });
        throw new Error("expected listFiles to throw");
      } catch (error) {
        expect(error).toBeInstanceOf(CodeNavigationIndexingError);
        const typed = error as CodeNavigationIndexingError;
        const combined = `${typed.message} ${typed.hint}`;
        expect(typed.hint).toBe(testCase.hint);
        expect(combined.split(testCase.waitArgument)).toHaveLength(2);
        expect(combined).not.toContain("Wait until ready with CLI");
      }
    }
  });

  it("preserves a bare PACKAGE_INDEXING message and supplies wait guidance", async () => {
    mockFetch(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            errors: [
              {
                message: "Target is indexing",
                extensions: {
                  code: "PACKAGE_INDEXING",
                  indexing_ref: "idx-error",
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
      await service.listFiles({
        target: { registry: "NPM", packageName: "express" },
      });
      throw new Error("expected listFiles to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(CodeNavigationIndexingError);
      const typed = error as CodeNavigationIndexingError;
      expect(typed.message).toBe("Target is indexing");
      expect(typed.hint).toContain("--wait 60000");
      expect(typed.hint).toContain("wait_timeout_ms: 60000");
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
                  hint: "Use a narrower source path.",
                  available_versions: [{ version: "5.2.1", ref: "v5.2.1" }],
                  available_refs: [{ ref: "main", version: null }],
                  suggested_refs: [{ ref: "v5.2.1", version: null }],
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
      expect((error as CodeNavigationBackendError).metadata).toEqual({
        hint: "Use a narrower source path.",
        availableVersions: [{ version: "5.2.1", ref: "v5.2.1" }],
        availableRefs: [{ ref: "main", version: undefined }],
        suggestedRefs: [{ ref: "v5.2.1", version: undefined }],
      });
    }
  });

  it("preserves GraphQL VERSION_NOT_FOUND guidance and alternatives", async () => {
    mockFetch(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            errors: [
              {
                message: "Version 4 is not indexed.",
                extensions: {
                  code: "VERSION_NOT_FOUND",
                  package: "npm/express",
                  requested_version: "4",
                  latest_indexed: "5.2.1",
                  hint: "Use an indexed version.",
                  available_versions: [{ version: "5.2.1", ref: "v5.2.1" }],
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
      await service.search({
        targets: [{ registry: "NPM", packageName: "express", version: "4" }],
        query: "router",
      });
      throw new Error("expected VERSION_NOT_FOUND");
    } catch (error) {
      expect(error).toBeInstanceOf(CodeNavigationVersionNotFoundError);
      const typed = error as CodeNavigationVersionNotFoundError;
      expect(typed.message).toBe("Version 4 is not indexed.");
      expect(typed.availableVersions).toEqual([
        { version: "5.2.1", ref: "v5.2.1" },
      ]);
      expect(typed.metadata?.hint).toBe("Use an indexed version.");
    }
  });

  it("preserves GraphQL NOT_FOUND guidance and alternatives", async () => {
    mockFetch(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            errors: [
              {
                message: "Target not found. Check the package name.",
                extensions: {
                  code: "NOT_FOUND",
                  hint: "Use the canonical registry package name.",
                  available_versions: [{ version: "5.2.1", ref: "v5.2.1" }],
                  available_refs: [{ ref: "main", version: null }],
                  suggested_refs: [{ ref: "v5.2.1", version: null }],
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
      await service.search({
        targets: [{ registry: "NPM", packageName: "missing" }],
        query: "router",
      });
      throw new Error("expected NOT_FOUND");
    } catch (error) {
      expect(error).toBeInstanceOf(CodeNavigationTargetNotFoundError);
      const typed = error as CodeNavigationTargetNotFoundError;
      expect(typed.message).toBe("Target not found. Check the package name.");
      expect(typed.availableVersions).toEqual([
        { version: "5.2.1", ref: "v5.2.1" },
      ]);
      expect(typed.metadata).toEqual({
        hint: "Use the canonical registry package name.",
        availableVersions: [{ version: "5.2.1", ref: "v5.2.1" }],
        availableRefs: [{ ref: "main", version: undefined }],
        suggestedRefs: [{ ref: "v5.2.1", version: undefined }],
      });
    }
  });

  it("classifies GraphQL REF_NOT_FOUND with indexed refs and suggested refs", async () => {
    mockFetch(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            errors: [
              {
                message:
                  "Repository ref cannot be resolved for github:openai/codex#1.2.3. Did you mean codex@1.2.3, v1.2.3?",
                extensions: {
                  code: "REF_NOT_FOUND",
                  retryable: false,
                  repo_url: "https://github.com/openai/codex",
                  git_ref: "1.2.3",
                  hint: "Choose one of the indexed refs.",
                  available_refs: [{ ref: "main", version: null }],
                  suggested_refs: [
                    { ref: "codex@1.2.3", version: null },
                    { ref: "v1.2.3", version: null },
                  ],
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
      await service.search({
        targets: [
          { repoUrl: "https://github.com/openai/codex", gitRef: "1.2.3" },
        ],
        query: "ThreadCompactStartParams",
      });
      throw new Error("expected REF_NOT_FOUND");
    } catch (error) {
      expect(error).toBeInstanceOf(CodeNavigationRefNotFoundError);
      const typed = error as CodeNavigationRefNotFoundError;
      expect(typed.repoUrl).toBe("https://github.com/openai/codex");
      expect(typed.requestedRef).toBe("1.2.3");
      expect(typed.availableRefs).toEqual([
        { ref: "main", version: undefined },
      ]);
      expect(typed.suggestedRefs).toEqual([
        { ref: "codex@1.2.3", version: undefined },
        { ref: "v1.2.3", version: undefined },
      ]);
      expect(typed.metadata?.hint).toBe("Choose one of the indexed refs.");
    }
  });

  it("classifies GraphQL REPOSITORY_NOT_FOUND as target not found with repository details", async () => {
    mockFetch(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            errors: [
              {
                message:
                  "Repository not found or inaccessible: https://github.com/acme/missing.",
                extensions: {
                  code: "REPOSITORY_NOT_FOUND",
                  retryable: false,
                  repo_url: "https://github.com/acme/missing",
                  git_ref: "main",
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
      await service.search({
        targets: [
          { repoUrl: "https://github.com/acme/missing", gitRef: "main" },
        ],
        query: "router middleware",
      });
      throw new Error("expected REPOSITORY_NOT_FOUND");
    } catch (error) {
      expect(error).toBeInstanceOf(CodeNavigationTargetNotFoundError);
      expect(error).not.toBeInstanceOf(CodeNavigationBackendError);
      const typed = error as CodeNavigationTargetNotFoundError;
      expect(typed.repoUrl).toBe("https://github.com/acme/missing");
      expect(typed.requestedRef).toBe("main");
    }
  });

  it("classifies GraphQL schema mismatch as backend protocol error", async () => {
    mockFetch(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            errors: [
              {
                message: 'Cannot query field "search" on type "Query".',
                extensions: { code: "GRAPHQL_VALIDATION_FAILED" },
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

    await expect(
      service.search({
        targets: [{ registry: "NPM", packageName: "express" }],
        query: "middleware",
      }),
    ).rejects.toMatchObject({
      name: "CodeNavigationBackendError",
      message: expect.stringContaining("Backend protocol mismatch"),
    });
  });

  it("exposes GraphQL schema mismatch details when code-nav-wire debug is enabled", async () => {
    process.env.GITHITS_DEBUG = "code-nav-wire";
    const stderrSpy = spyOn(process.stderr, "write").mockImplementation(
      () => true as never,
    );
    mockFetch(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            errors: [
              {
                message: 'Cannot query field "search" on type "Query".',
                extensions: { code: "GRAPHQL_VALIDATION_FAILED" },
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

    await expect(
      service.search({
        targets: [{ registry: "NPM", packageName: "express" }],
        query: "middleware",
      }),
    ).rejects.toMatchObject({
      name: "CodeNavigationBackendError",
      message: 'Cannot query field "search" on type "Query".',
    });
    stderrSpy.mockRestore();
  });

  it("honors explicit backend CLIENT_UPDATE_REQUIRED errors", async () => {
    mockFetch(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            errors: [
              {
                message: "Client version is no longer supported.",
                extensions: { code: "CLIENT_UPDATE_REQUIRED" },
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

    await expect(
      service.search({
        targets: [{ registry: "NPM", packageName: "express" }],
        query: "middleware",
      }),
    ).rejects.toMatchObject({ name: "ClientUpdateRequiredError" });
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
    expect(body.query).toContain("indexingEstimate");
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
    expect(body.query).toContain("indexingEstimate");
  });
});
