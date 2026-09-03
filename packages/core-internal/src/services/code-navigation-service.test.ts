import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { FetchTimeoutError } from "../shared/fetch-timeout.js";
import {
  CodeDiffError,
  type CodeDiffParams,
  CodeNavigationAccessError,
  CodeNavigationBackendError,
  CodeNavigationFeatureFlagRequiredError,
  CodeNavigationFileNotFoundError,
  CodeNavigationIndexingError,
  CodeNavigationRefNotFoundError,
  CodeNavigationServiceImpl,
  CodeNavigationTargetNotFoundError,
  CodeNavigationValidationError,
  CodeNavigationVersionNotFoundError,
  GREP_REPO_SYMBOL_FIELDS,
  MalformedCodeNavigationResponseError,
  type UnifiedSearchDocumentationContributor,
} from "./code-navigation-service.js";
import {
  AuthenticationError,
  TermsAcceptanceRequiredError,
} from "./githits-service.js";
import type { ServiceDiagnostics } from "./runtime-diagnostics.js";
import { createMockTokenProvider } from "./test-helpers.js";

function mockFetch(impl: () => Promise<Response>) {
  const fn = mock(impl);
  globalThis.fetch = fn as unknown as typeof fetch;
  return fn;
}

function createDiagnostics(
  enabledArea: string,
  events: Array<{ area: string; event: Record<string, unknown> }>,
): ServiceDiagnostics {
  return {
    withOperation: async <T>(_name: string, operation: () => Promise<T>) =>
      operation(),
    isEnabled: (area) => area === enabledArea,
    debug: (area, event) => events.push({ area, event }),
  };
}

interface SuggestedSiteTargetsFixture {
  name: string;
  note?: string;
  targets: string[];
  truncated: boolean;
}

const suggestedSiteTargetsFixtures: SuggestedSiteTargetsFixture[] = [
  { name: "empty", targets: [], truncated: false },
  {
    name: "ambiguous",
    note: "Multiple indexed site scopes match the requested host.",
    targets: ["site:example.com/docs", "site:example.com/guide"],
    truncated: false,
  },
  {
    name: "redirected",
    note: "The requested site redirected to another documentation site.",
    targets: ["site:new.example.com/docs"],
    truncated: false,
  },
  {
    name: "truncated",
    targets: Array.from(
      { length: 10 },
      (_, index) => `site:example.com/docs-${index + 1}`,
    ),
    truncated: true,
  },
];

function buildSuggestedSiteSearchResult(
  fixture: SuggestedSiteTargetsFixture,
): Record<string, unknown> {
  return {
    query: "router",
    queryWarnings: [],
    sources: ["DOCS"],
    results: [],
    page: { offset: 0, limit: 20, returned: 0, hasMore: false },
    partialResults: false,
    sourceStatus: [
      {
        source: "DOCS",
        targetLabel: "site:example.com",
        appliedFilters: [],
        ignoredFilters: [],
        incompatibleFilters: [],
        appliedQueryFeatures: [],
        ignoredQueryFeatures: [],
        incompatibleQueryFeatures: [],
        suggestedSiteTargets: fixture.targets,
        suggestedSiteTargetsTruncated: fixture.truncated,
        contributors: [],
        note: fixture.note,
      },
    ],
  };
}

function codeDiffPayload(
  rawOverrides: Record<string, unknown> = {},
  resultOverrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    data: {
      codeDiff: {
        package: {
          registry: "NPM",
          name: "express",
          repoUrl: "https://github.com/expressjs/express",
        },
        fromResolution: {
          requested: "4.18.1",
          resolvedVersion: "4.18.1",
          ref: "v4.18.1",
          commitSha: "from-sha",
          refKind: "TAG",
          versionSource: "REGISTRY",
        },
        toResolution: {
          requested: "4.18.2",
          resolvedVersion: "4.18.2",
          ref: "v4.18.2",
          refKind: "TAG",
          versionSource: "REGISTRY",
          commitSha: "to-sha",
        },
        raw: {
          summary: {
            filesChanged: 1,
            added: 0,
            deleted: 0,
            modified: 1,
            modeChanged: 0,
            typeChanged: 0,
            inventoryComplete: true,
            unprojectableFiles: 0,
          },
          scope: {
            status: "PACKAGE",
            fromSubpath: "",
            toSubpath: "",
            pathPrefix: null,
            pathGlob: null,
          },
          contentCoverage: "COMPLETE",
          contentFailure: null,
          files: [
            {
              path: "lib/express.js",
              pathEncoding: "UTF8",
              status: "MODIFIED",
              modeChanged: false,
              typeChanged: false,
              additions: 1,
              deletions: 1,
              patch: "@@ -1 +1 @@\n-old\n+new",
              contentStatus: "PATCH",
              contentOmissionReason: null,
              contentSafety: { filtered: false, modifications: [] },
            },
          ],
          hasMoreFiles: false,
          ...rawOverrides,
        },
        ...resultOverrides,
      },
    },
  };
}

function codeDiffRootErrorPayload(
  extensions: Record<string, unknown>,
  message = "CodeDiff resolution failed",
): Record<string, unknown> {
  return {
    data: { codeDiff: null },
    errors: [{ message, path: ["codeDiff"], extensions }],
  };
}

function expectBalancedSelectionBraces(query: string): void {
  let depth = 0;

  for (const character of query) {
    if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
      expect(depth).toBeGreaterThanOrEqual(0);
    }
  }

  expect(depth).toBe(0);
}

const UNPROJECTABLE_CODE_DIFF_PATH = `packages/old/${"a".repeat(4_085)}`;
const BYTE_ESCAPED_CODE_DIFF_PATH =
  "\\x6C\\x69\\x62\\x2F\\xFF\\x2F\\x78\\x2E\\x65\\x78";

describe("CodeNavigationServiceImpl", () => {
  const BASE_URL = "https://nav.example.com";
  let originalFetch: typeof globalThis.fetch;

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

  it.each([
    ["FILE_PATH_EXCLUDED", "generated_or_large", "bench/data/issue-90.json"],
    [
      "SOURCE_FILE_INVENTORY_UNKNOWN",
      "inventory_unavailable",
      "src/missing.ts",
    ],
  ] as const)(
    "preserves exact-path authority metadata for %s",
    async (code, exclusionReason, filePath) => {
      mockFetch(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              errors: [
                {
                  message: `Exact path unavailable: ${filePath}`,
                  extensions: {
                    code,
                    retryable: false,
                    file_path: filePath,
                    exclusion_reason: exclusionReason,
                    target_resolution: {
                      requested: {
                        registry: "HEX",
                        packageName: "jason",
                        version: "1.4.4",
                      },
                      served: {
                        registry: "HEX",
                        packageName: "jason",
                        version: "1.4.4",
                      },
                      freshness: "current",
                      freshnessReason: "exact_current",
                      availableVersions: [],
                      availableRefs: [],
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
        await service.grepRepo({
          target: {
            registry: "HEX",
            packageName: "jason",
            version: "1.4.4",
          },
          pattern: "{",
          pathSelectors: [{ kind: "EXACT", value: filePath }],
        });
        throw new Error("expected grepRepo to throw");
      } catch (error) {
        expect(error).toBeInstanceOf(CodeNavigationBackendError);
        expect(error).toMatchObject({
          graphqlCode: code,
          retryable: false,
          metadata: {
            filePath,
            exclusionReason,
            targetResolution: {
              freshness: "current",
              freshnessReason: "exact_current",
            },
          },
        });
      }
    },
  );

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

  for (const operation of ["search", "searchStatus"] as const) {
    it(`selects and normalises bounded evidence locators from ${operation}`, async () => {
      const searchResult = {
        query: "context compaction compact conversation history",
        queryWarnings: [],
        sources: ["CODE"],
        results: [
          {
            id: "pi-mono-compact",
            resultType: "REPOSITORY_CODE",
            targetLabel: "badlogic/pi-mono@main",
            title: "compact",
            summary: "// Merge into single summary",
            locator: {
              repoUrl: "https://github.com/badlogic/pi-mono",
              gitRef: "main",
              commitSha: "853a80d0000000000000000000000000000000000",
              requestedRef: "main",
              filePath:
                "packages/coding-agent/src/core/compaction/compaction.ts",
              repositoryFilePath:
                "packages/coding-agent/src/core/compaction/compaction.ts",
              startLine: 920,
              endLine: 930,
              evidenceRange: {
                startLine: 920,
                endLine: 930,
                matchLine: 924,
                rangeKind: "match_window",
                matchSpansTruncated: false,
              },
              indexedRange: { startLine: 858, endLine: 964 },
              symbolContext: {
                name: "compact",
                qualifiedPath: "Compaction.compact",
                kind: "function",
                relation: "ENCLOSES_MATCH",
                definitionRange: {
                  filePath:
                    "packages/coding-agent/src/core/compaction/compaction.ts",
                  repositoryFilePath:
                    "packages/coding-agent/src/core/compaction/compaction.ts",
                  startLine: 858,
                  endLine: 964,
                },
              },
            },
          },
        ],
        page: { offset: 0, limit: 15, returned: 1, hasMore: false },
        partialResults: false,
        sourceStatus: [],
      };
      const fn = mockFetch(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              data:
                operation === "search"
                  ? {
                      search: {
                        completed: true,
                        searchRef: "search-ref-evidence",
                        result: searchResult,
                        progress: null,
                      },
                    }
                  : {
                      discoverySearchProgress: {
                        searchRef: "search-ref-evidence",
                        status: "COMPLETED",
                        targetsTotal: 1,
                        targetsReady: 1,
                        elapsedMs: 12,
                        query: searchResult.query,
                        queryWarnings: [],
                        sources: ["CODE"],
                        results: searchResult,
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

      const outcome =
        operation === "search"
          ? await service.search({
              targets: [{ repoUrl: "https://github.com/badlogic/pi-mono" }],
              query: searchResult.query,
            })
          : await service.searchStatus("search-ref-evidence");

      if (outcome.state !== "completed") {
        throw new Error("expected completed search outcome");
      }
      expect(outcome.result.results[0]?.locator).toMatchObject({
        startLine: 920,
        endLine: 930,
        commitSha: "853a80d0000000000000000000000000000000000",
        repositoryFilePath:
          "packages/coding-agent/src/core/compaction/compaction.ts",
        evidenceRange: {
          startLine: 920,
          endLine: 930,
          matchLine: 924,
          rangeKind: "match_window",
          matchSpansTruncated: false,
        },
        indexedRange: { startLine: 858, endLine: 964 },
        symbolContext: {
          relation: "encloses_match",
          definitionRange: {
            startLine: 858,
            endLine: 964,
          },
        },
      });
      const [, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
      const query = JSON.parse(init.body as string).query as string;
      for (const field of [
        "commitSha",
        "repositoryFilePath",
        "evidenceRange",
        "matchSpansTruncated",
        "indexedRange",
        "symbolContext",
        "definitionRange",
        "relation",
      ]) {
        expect(query).toContain(field);
      }
      expect(query).not.toMatch(/\b(?:definitionBody|fileBody|body|content)\b/);
    });
  }

  it.each([
    {
      name: "an enclosing relation without a definition range",
      symbolContext: {
        name: "compact",
        relation: "ENCLOSES_MATCH",
      },
    },
    {
      name: "a partial associated definition locator",
      symbolContext: {
        name: "compact",
        relation: "ASSOCIATED_WITH_INDEXED_CHUNK",
        definitionRange: {
          filePath: "src/compact.ts",
          startLine: 1,
          endLine: 2,
        },
      },
    },
  ])("rejects $name", async ({ symbolContext }) => {
    mockFetch(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            data: {
              search: {
                completed: true,
                searchRef: null,
                result: {
                  query: "compact",
                  queryWarnings: [],
                  sources: ["CODE"],
                  results: [
                    {
                      id: "bad-symbol-context",
                      resultType: "REPOSITORY_CODE",
                      targetLabel: "badlogic/pi-mono@main",
                      locator: {
                        filePath: "src/compact.ts",
                        startLine: 1,
                        endLine: 1,
                        symbolContext,
                      },
                    },
                  ],
                  page: { offset: 0, limit: 10, returned: 1, hasMore: false },
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
    );

    await expect(
      service.search({
        targets: [{ repoUrl: "https://github.com/badlogic/pi-mono" }],
        query: "compact",
      }),
    ).rejects.toBeInstanceOf(MalformedCodeNavigationResponseError);
  });

  it("accepts identity-only, absent-symbol, and one-line boundary evidence", async () => {
    mockFetch(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            data: {
              search: {
                completed: true,
                searchRef: null,
                result: {
                  query: "compact",
                  queryWarnings: [],
                  sources: ["CODE"],
                  results: [
                    {
                      id: "identity-only",
                      resultType: "REPOSITORY_CODE",
                      targetLabel: "badlogic/pi-mono@main",
                      locator: {
                        filePath: "src/compact.ts",
                        startLine: 1,
                        endLine: 1,
                        evidenceRange: {
                          startLine: 1,
                          endLine: 1,
                          matchLine: 1,
                          rangeKind: "match_window",
                          matchSpansTruncated: true,
                        },
                        indexedRange: { startLine: 1, endLine: 1 },
                        symbolContext: {
                          name: "compact",
                          relation: "ASSOCIATED_WITH_INDEXED_CHUNK",
                        },
                      },
                    },
                    {
                      id: "absent-symbol",
                      resultType: "REPOSITORY_CODE",
                      targetLabel: "badlogic/pi-mono@main",
                      locator: {
                        filePath: "src/top-level.ts",
                        startLine: 1,
                        endLine: 1,
                        symbolContext: null,
                      },
                    },
                  ],
                  page: { offset: 0, limit: 10, returned: 2, hasMore: false },
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
    );

    const outcome = await service.search({
      targets: [{ repoUrl: "https://github.com/badlogic/pi-mono" }],
      query: "compact",
    });
    if (outcome.state !== "completed") {
      throw new Error("expected completed search outcome");
    }
    expect(outcome.result.results[0]?.locator.symbolContext).toEqual({
      name: "compact",
      qualifiedPath: undefined,
      kind: undefined,
      relation: "associated_with_indexed_chunk",
      definitionRange: undefined,
    });
    expect(outcome.result.results[0]?.locator.evidenceRange).toMatchObject({
      startLine: 1,
      endLine: 1,
      matchSpansTruncated: true,
    });
    expect(outcome.result.results[1]?.locator.symbolContext).toBeUndefined();
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

  for (const operation of ["search", "searchStatus"] as const) {
    it.each(["DEFERRED", "FUTURE_SESSION_STATE"])(
      `accepts %s ${operation} responses with stored results`,
      async (status) => {
        const searchRef = `search-ref-deferred-${operation}`;
        const result = {
          query: "router",
          queryWarnings: [],
          sources: ["CODE"],
          results: [],
          page: { offset: 0, limit: 10, returned: 0, hasMore: false },
          partialResults: false,
          sourceStatus: [],
          evidenceNotice: "Stored evidence remains usable.",
        };
        const progress = {
          searchRef,
          status,
          targetsTotal: 2,
          targetsReady: 1,
          elapsedMs: 600_000,
          query: "router",
          queryWarnings: [],
          sources: ["CODE"],
        };
        mockFetch(() =>
          Promise.resolve(
            new Response(
              JSON.stringify(
                operation === "search"
                  ? {
                      data: {
                        search: {
                          completed: false,
                          searchRef,
                          result,
                          progress,
                        },
                      },
                    }
                  : {
                      data: {
                        discoverySearchProgress: {
                          ...progress,
                          results: result,
                        },
                      },
                    },
              ),
              { headers: { "Content-Type": "application/json" } },
            ),
          ),
        );
        const service = new CodeNavigationServiceImpl(
          BASE_URL,
          createMockTokenProvider(),
          globalThis.fetch,
        );

        const outcome =
          operation === "search"
            ? await service.search({
                targets: [{ registry: "NPM", packageName: "express" }],
                query: "router",
              })
            : await service.searchStatus(searchRef);

        expect(outcome).toMatchObject({
          state: "incomplete",
          completed: false,
          searchRef,
          progress: { status, targetsReady: 1, targetsTotal: 2 },
          result: {
            query: "router",
            results: [],
            evidenceNotice: "Stored evidence remains usable.",
          },
        });
      },
    );
  }

  it("emits safe debug logging for unified search request shape without query text", async () => {
    const events: Array<{ area: string; event: Record<string, unknown> }> = [];
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
      { diagnostics: createDiagnostics("code-nav", events) },
    );

    await service.search({
      targets: [{ registry: "NPM", packageName: "express" }],
      query: "router middleware secret text",
      allowPartialResults: false,
      waitTimeoutMs: 20_000,
    });

    const event = events[0];
    expect(event?.area).toBe("code-nav");
    expect(event?.event.event).toBe("request");
    expect(event?.event.operation).toBe("search");
    expect(event?.event.fileIntent).toBe("omitted");
    expect(event?.event.hasFilters).toBe(false);
    expect(event?.event.presentVariableKeys).not.toContain("filters");
    expect(JSON.stringify(events)).not.toContain(
      "router middleware secret text",
    );
  });

  it("emits exact GraphQL and serialized variables for unified search under code-nav-wire", async () => {
    const events: Array<{ area: string; event: Record<string, unknown> }> = [];
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
      { diagnostics: createDiagnostics("code-nav-wire", events) },
    );

    await service.search({
      targets: [{ registry: "NPM", packageName: "express" }],
      query: "router middleware secret text",
      allowPartialResults: false,
      waitTimeoutMs: 20_000,
    });

    const event = events[0]?.event;
    expect(events[0]?.area).toBe("code-nav-wire");
    expect(event?.event).toBe("wire-request");
    expect(event?.operation).toBe("search");
    expect(event?.graphqlQuery).toContain("query UnifiedSearch(");
    expect(event?.graphqlQuery).toContain("filters: $filters");
    expect(event?.graphqlQuery).toContain("requestedTargetLabel");
    expect(event?.graphqlQuery).toContain("freshTargetLabel");
    expect(event?.graphqlQuery).toContain("servedTargetLabel");
    expect(event?.graphqlQuery).toContain("freshness");
    expect(event?.graphqlQuery).toContain("requestedSources");
    expect(event?.graphqlQuery).toContain("targetMode");
    expect(event?.graphqlQuery).toContain("requestedTargets");
    expect(event?.graphqlQuery).toContain("resolvedRequested");
    expect(event?.graphqlQuery).toContain("requestedRefKind");
    expect(event?.variables).toEqual({
      targets: [{ registry: "NPM", name: "express" }],
      query: "router middleware secret text",
      allowPartialResults: false,
      waitTimeoutMs: 20_000,
    });
  });

  it("requests documentation coverage, site fields, and recovery suggestions in the search query", async () => {
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
    expect(query).toContain("suggestedSiteTargets");
    expect(query).toContain("suggestedSiteTargetsTruncated");
    // requestedTargets must select `site`, otherwise standalone site
    // targets echo back as empty objects during progress polling.
    expect(query).toMatch(/requestedTargets\s*{[^}]*site/);
  });

  for (const operation of ["search", "searchStatus"] as const) {
    it(`selects and normalises documentation contributors from ${operation}`, async () => {
      const result = {
        query: "router",
        queryWarnings: [],
        sources: ["DOCS"],
        results: [],
        page: { offset: 0, limit: 20, returned: 0, hasMore: false },
        partialResults: false,
        evidenceNotice:
          "Pending work may change the disclosed documentation evidence.",
        sourceStatus: [
          {
            source: "DOCS",
            targetLabel: "npm:express@5.1.0",
            appliedFilters: [],
            ignoredFilters: [],
            incompatibleFilters: [],
            appliedQueryFeatures: [],
            ignoredQueryFeatures: [],
            incompatibleQueryFeatures: [],
            suggestedSiteTargets: [],
            suggestedSiteTargetsTruncated: false,
            contributors: [
              {
                kind: "REPOSITORY_DOCS",
                state: "SEARCHED",
                freshness: "CURRENT",
                resultCount: 2,
                repositoryUrl: "https://github.com/expressjs/express",
                commitSha: "0123456789abcdef0123456789abcdef01234567",
                coverage: {
                  coverageState: "NONE",
                  pagesCrawled: 69,
                },
              },
              {
                kind: "DOCPACK",
                state: "READY",
                freshness: "STALE",
                resultCount: 0,
                siteKey: "expressjs.com",
                siteUrl: "https://expressjs.com/en/guide",
                coverage: {
                  coverageState: "CAPPED",
                  coverageReason: "artifact_size",
                  pagesCrawled: 480,
                  frontierRemaining: null,
                  artifactOverflowPageCount: 12,
                  estimatedTotalPages: 700,
                  note: "Published documentation reached the artifact limit.",
                },
              },
              {
                kind: "REPOSITORY_DOCS",
                state: "SEARCHED",
                freshness: "PROVISIONAL",
                resultCount: 1,
                repositoryUrl: "https://github.com/expressjs/express",
                commitSha: "abcdef0123456789abcdef0123456789abcdef01",
              },
            ],
          },
        ],
      };
      const fn = mockFetch(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              data:
                operation === "search"
                  ? {
                      search: {
                        completed: true,
                        searchRef: "search-ref-contributors",
                        result,
                        progress: null,
                      },
                    }
                  : {
                      discoverySearchProgress: {
                        searchRef: "search-ref-contributors",
                        status: "COMPLETED",
                        targetsTotal: 1,
                        targetsReady: 1,
                        elapsedMs: 10,
                        query: "router",
                        queryWarnings: [],
                        sources: ["DOCS"],
                        results: result,
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

      const outcome =
        operation === "search"
          ? await service.search({
              targets: [{ registry: "NPM", packageName: "express" }],
              sources: ["DOCS"],
              query: "router",
            })
          : await service.searchStatus("search-ref-contributors");

      if (outcome.state !== "completed") {
        throw new Error("expected completed search outcome");
      }
      expect(outcome.result.evidenceNotice).toBe(
        "Pending work may change the disclosed documentation evidence.",
      );
      expect(outcome.result.sourceStatus[0]?.contributors).toEqual(
        result.sourceStatus[0]
          ?.contributors as UnifiedSearchDocumentationContributor[],
      );
      expect(
        outcome.result.sourceStatus[0]?.contributors?.[1]?.coverage,
      ).toMatchObject({
        frontierRemaining: null,
        artifactOverflowPageCount: 12,
      });
      expect(
        outcome.result.sourceStatus[0]?.contributors?.[0]?.coverage,
      ).toEqual({
        coverageState: "NONE",
        pagesCrawled: 69,
      });
      const [, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
      const query = JSON.parse(init.body as string).query as string;
      for (const field of [
        "contributors",
        "repositoryUrl",
        "commitSha",
        "siteKey",
        "siteUrl",
        "artifactOverflowPageCount",
        "evidenceNotice",
      ]) {
        expect(query).toContain(field);
      }
      expect(query).toMatch(
        /contributors\s*\{\s*kind\s+state\s+freshness\s+resultCount\s+repositoryUrl\s+commitSha\s+siteKey\s+siteUrl\s+coverage\s*\{\s*coverageState\s+coverageReason\s+pagesCrawled\s+frontierRemaining\s+artifactOverflowPageCount\s+estimatedTotalPages\s+note\s*\}\s*\}/,
      );
    });
  }

  for (const operation of ["search", "searchStatus"] as const) {
    for (const fixture of suggestedSiteTargetsFixtures) {
      it(`normalises ${fixture.name} site recovery suggestions from ${operation}`, async () => {
        const result = buildSuggestedSiteSearchResult(fixture);
        const fn = mockFetch(() =>
          Promise.resolve(
            new Response(
              JSON.stringify({
                data:
                  operation === "search"
                    ? {
                        search: {
                          completed: true,
                          searchRef: "search-ref-site",
                          result,
                          progress: null,
                        },
                      }
                    : {
                        discoverySearchProgress: {
                          searchRef: "search-ref-site",
                          status: "COMPLETED",
                          targetsTotal: 1,
                          targetsReady: 1,
                          elapsedMs: 25,
                          query: "router",
                          queryWarnings: [],
                          sources: ["DOCS"],
                          results: result,
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

        const outcome =
          operation === "search"
            ? await service.search({
                targets: [{ site: "site:example.com" }],
                query: "router",
              })
            : await service.searchStatus("search-ref-site");

        if (outcome.state !== "completed") {
          throw new Error("expected completed search outcome");
        }
        expect(outcome.result.sourceStatus[0]).toMatchObject({
          suggestedSiteTargets: fixture.targets,
          suggestedSiteTargetsTruncated: fixture.truncated,
        });
        const [, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
        const query = JSON.parse(init.body as string).query as string;
        expect(query).toContain("suggestedSiteTargets");
        expect(query).toContain("suggestedSiteTargetsTruncated");
      });
    }
  }

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
                      suggestedSiteTargets: [],
                      suggestedSiteTargetsTruncated: false,
                      contributors: [],
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
                      suggestedSiteTargets: [],
                      suggestedSiteTargetsTruncated: false,
                      contributors: [],
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
        filePath: "dist/bundle.js",
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
    const events: Array<{ area: string; event: Record<string, unknown> }> = [];
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
      undefined,
      { diagnostics: createDiagnostics("code-nav-wire", events) },
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
    expect(
      events.some((entry) => entry.event.event === "graphql-schema-mismatch"),
    ).toBe(false);
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
      symbolFields: [...GREP_REPO_SYMBOL_FIELDS],
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
      symbolFields: [...GREP_REPO_SYMBOL_FIELDS],
      waitTimeoutMs: 5000,
    });
    expect(body.query).toContain("indexingEstimate");
    const symbolBlock = body.query.match(/symbol \{\n([\s\S]*?)\n {6}\}/)?.[1];
    expect(symbolBlock?.trim().split(/\s+/)).toEqual([
      "symbolRef",
      "name",
      "qualifiedPath",
      "kind",
      "category",
      "arity",
      "isPublic",
      "filePath",
      "startLine",
      "endLine",
      "contentHash",
      "parentPath",
    ]);
  });

  it("selects only requested grepRepo symbol fields", async () => {
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
      symbolFields: ["name", "qualified_path"],
    });
    const [, subsetInit] = fn.mock.calls[0] as unknown as [string, RequestInit];
    const subsetBody = JSON.parse(subsetInit.body as string);
    const subsetSymbolBlock = subsetBody.query.match(
      /symbol \{\n([\s\S]*?)\n {6}\}/,
    )?.[1];
    expect(subsetSymbolBlock?.trim().split(/\s+/)).toEqual([
      "name",
      "qualifiedPath",
    ]);
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

  it("sends exclusive package variables and inventory-minimal file fields", async () => {
    const fn = mock((_url: string, _init?: RequestInit) =>
      Promise.resolve(
        new Response(JSON.stringify(codeDiffPayload()), { status: 200 }),
      ),
    );
    globalThis.fetch = fn as unknown as typeof fetch;
    const service = new CodeNavigationServiceImpl(
      BASE_URL,
      createMockTokenProvider(),
    );

    await service.codeDiff({
      target: { registry: "NPM", packageName: "express" },
      from: "4.18.1",
      to: "4.18.2",
      mode: "inventory",
      options: { maxFiles: 20, pathGlob: "src/**/*.js" },
    });

    const [, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(init.body as string) as {
      variables: Record<string, unknown>;
      query: string;
    };
    expectBalancedSelectionBraces(body.query);
    expect(body.variables).toEqual({
      registry: "NPM",
      name: "express",
      fromVersion: "4.18.1",
      toVersion: "4.18.2",
      rawOptions: { maxFiles: 20, pathGlob: "src/**/*.js" },
    });
    expect(body.variables).not.toHaveProperty("repoUrl");
    expect(body.variables).not.toHaveProperty("fromRef");
    expect(body.variables).not.toHaveProperty("toRef");
    const summarySelection = body.query.slice(
      body.query.indexOf("summary {"),
      body.query.indexOf("scope {"),
    );
    expect(summarySelection).toContain("\n        added\n");
    expect(summarySelection).toContain("\n        deleted\n");
    const fileSelection = body.query.slice(
      body.query.indexOf("files {"),
      body.query.indexOf("hasMoreFiles"),
    );
    expect(fileSelection).toContain("contentStatus");
    expect(fileSelection).toContain("contentSafety");
    expect(fileSelection).not.toContain("additions");
    expect(fileSelection).not.toContain("deletions");
    expect(fileSelection).not.toContain("patch");
    expect(fileSelection).not.toContain("contentOmissionReason");
  });

  it("selects stats fields without patch content", async () => {
    const fn = mock((_url: string, _init?: RequestInit) =>
      Promise.resolve(
        new Response(JSON.stringify(codeDiffPayload()), { status: 200 }),
      ),
    );
    globalThis.fetch = fn as unknown as typeof fetch;
    const service = new CodeNavigationServiceImpl(
      BASE_URL,
      createMockTokenProvider(),
    );

    await service.codeDiff({
      target: { repoUrl: "https://github.com/expressjs/express" },
      from: "v4.18.1",
      to: "v4.18.2",
      mode: "stats",
    });

    const [, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(init.body as string) as {
      variables: Record<string, unknown>;
      query: string;
    };
    expectBalancedSelectionBraces(body.query);
    expect(body.variables).toEqual({
      repoUrl: "https://github.com/expressjs/express",
      fromRef: "v4.18.1",
      toRef: "v4.18.2",
    });
    expect(body.variables).not.toHaveProperty("registry");
    expect(body.variables).not.toHaveProperty("name");
    const fileSelection = body.query.slice(
      body.query.indexOf("files {"),
      body.query.indexOf("hasMoreFiles"),
    );
    expect(fileSelection).toContain("additions");
    expect(fileSelection).toContain("deletions");
    expect(fileSelection).not.toContain("patch");
    expect(fileSelection).not.toContain("contentOmissionReason");
  });

  it("selects patch fields and normalizes exact identity and content safety", async () => {
    const fn = mock((_url: string, _init?: RequestInit) =>
      Promise.resolve(
        new Response(
          JSON.stringify(
            codeDiffPayload({
              contentCoverage: "PARTIAL",
              contentFailure: {
                code: "RAW_DIFF_LIMIT_EXCEEDED",
                retryable: false,
                retryAfterMs: 0,
                stage: "content",
                limitKind: "patch_bytes",
              },
              files: [
                {
                  path: "src/main.ts",
                  pathEncoding: "BYTE_ESCAPED",
                  status: "ADDED",
                  modeChanged: true,
                  typeChanged: false,
                  additions: 5,
                  deletions: 0,
                  patch: null,
                  contentStatus: "OMITTED",
                  contentOmissionReason: "invalid_utf8",
                  contentSafety: {
                    filtered: true,
                    modifications: ["HTML_COMMENTS_STRIPPED"],
                  },
                },
              ],
              hasMoreFiles: true,
            }),
          ),
          { status: 200 },
        ),
      ),
    );
    globalThis.fetch = fn as unknown as typeof fetch;
    const service = new CodeNavigationServiceImpl(
      BASE_URL,
      createMockTokenProvider(),
    );

    const result = await service.codeDiff({
      target: { registry: "NPM", packageName: "express" },
      from: "4.18.1",
      to: "4.18.2",
      mode: "patches",
      options: {},
    });

    const [, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(init.body as string) as {
      variables: Record<string, unknown>;
      query: string;
    };
    expectBalancedSelectionBraces(body.query);
    expect(body.variables).not.toHaveProperty("rawOptions");
    const fileSelection = body.query.slice(
      body.query.indexOf("files {"),
      body.query.indexOf("hasMoreFiles"),
    );
    expect(fileSelection).toContain("additions");
    expect(fileSelection).toContain("deletions");
    expect(fileSelection).toContain("patch");
    expect(fileSelection).toContain("contentOmissionReason");
    expect(result.fromResolution.commitSha).toBe("from-sha");
    expect(result.toResolution.commitSha).toBe("to-sha");
    expect(result.raw.contentCoverage).toBe("PARTIAL");
    expect(result.raw.contentFailure).toEqual({
      code: "RAW_DIFF_LIMIT_EXCEEDED",
      retryable: false,
      retryAfterMs: 0,
      stage: "content",
      limitKind: "patch_bytes",
    });
    expect(result.raw.files[0]).toMatchObject({
      path: "src/main.ts",
      pathEncoding: "BYTE_ESCAPED",
      contentStatus: "OMITTED",
      contentOmissionReason: "invalid_utf8",
      contentSafety: {
        filtered: true,
        modifications: ["HTML_COMMENTS_STRIPPED"],
      },
    });
  });

  it("accepts CodeDiff option boundaries and sends them on the wire", async () => {
    const exact1024BytePath = "a".repeat(1024);
    const cases = [
      { mode: "inventory" as const, options: { maxFiles: 1 } },
      { mode: "inventory" as const, options: { maxFiles: 300 } },
      { mode: "patches" as const, options: { maxPatchBytes: 1024 } },
      {
        mode: "patches" as const,
        options: { maxPatchBytes: 2_097_152 },
      },
      {
        mode: "inventory" as const,
        options: { pathPrefix: exact1024BytePath },
      },
    ];
    const fn = mock((_url: string, _init?: RequestInit) =>
      Promise.resolve(
        new Response(JSON.stringify(codeDiffPayload()), { status: 200 }),
      ),
    );
    globalThis.fetch = fn as unknown as typeof fetch;
    const service = new CodeNavigationServiceImpl(
      BASE_URL,
      createMockTokenProvider(),
    );

    for (const fixture of cases) {
      await service.codeDiff({
        target: { repoUrl: "https://github.com/expressjs/express" },
        from: "v1",
        to: "v2",
        mode: fixture.mode,
        options: fixture.options,
      });
    }

    expect(fn).toHaveBeenCalledTimes(cases.length);
    for (const [index, fixture] of cases.entries()) {
      const [, init] = fn.mock.calls[index] as unknown as [string, RequestInit];
      const body = JSON.parse(init.body as string) as {
        variables: Record<string, unknown>;
      };
      expect(body.variables.rawOptions).toEqual(fixture.options);
    }
  });

  it("normalizes authoritative inventory, scope, and content-status edge cases", async () => {
    const fixtures = [
      {
        target: { registry: "NPM", packageName: "express" } as const,
        from: "1.0.0",
        to: "2.0.0",
        mode: "patches" as const,
        sourcePaths: [
          "packages/old/lib/a.ex",
          "packages/new/lib/a.ex",
          UNPROJECTABLE_CODE_DIFF_PATH,
        ],
        raw: {
          summary: {
            filesChanged: 3,
            added: 1,
            deleted: 2,
            modified: 0,
            modeChanged: 0,
            typeChanged: 0,
            inventoryComplete: true,
            unprojectableFiles: 1,
          },
          scope: {
            status: "PACKAGE",
            fromSubpath: "packages/old",
            toSubpath: "packages/new",
            pathPrefix: null,
            pathGlob: null,
          },
          contentCoverage: "FAILED",
          contentFailure: {
            code: "RAW_DIFF_LIMIT_EXCEEDED",
            retryable: false,
            retryAfterMs: null,
            stage: "content",
            limitKind: "max_patch_bytes",
          },
          files: [
            {
              path: "packages/new/lib/a.ex",
              pathEncoding: "UTF8",
              status: "ADDED",
              modeChanged: false,
              typeChanged: false,
              additions: null,
              deletions: null,
              patch: null,
              contentStatus: "UNAVAILABLE",
              contentOmissionReason: null,
              contentSafety: { filtered: false, modifications: [] },
            },
            {
              path: "packages/old/lib/a.ex",
              pathEncoding: "UTF8",
              status: "DELETED",
              modeChanged: false,
              typeChanged: false,
              additions: null,
              deletions: null,
              patch: null,
              contentStatus: "UNAVAILABLE",
              contentOmissionReason: null,
              contentSafety: { filtered: false, modifications: [] },
            },
          ],
          hasMoreFiles: false,
        },
        result: {
          fromResolution: {
            requested: "1.0.0",
            resolvedVersion: "1.0.0",
            ref: "v1.0.0",
            commitSha: "old-sha",
            refKind: "TAG",
            versionSource: "REGISTRY",
          },
          toResolution: {
            requested: "2.0.0",
            resolvedVersion: "2.0.0",
            ref: "v2.0.0",
            commitSha: "new-sha",
            refKind: "TAG",
            versionSource: "REGISTRY",
          },
        },
        expected: {
          fromSha: "old-sha",
          toSha: "new-sha",
          fromVersion: "1.0.0",
          toVersion: "2.0.0",
          versionSource: "REGISTRY",
          scopeStatus: "PACKAGE",
          fromSubpath: "packages/old",
          toSubpath: "packages/new",
          coverage: "FAILED",
          paths: ["packages/new/lib/a.ex", "packages/old/lib/a.ex"],
          statuses: ["UNAVAILABLE", "UNAVAILABLE"],
          omissions: [undefined, undefined],
          filesChanged: 3,
          added: 1,
          deleted: 2,
          modified: 0,
          unprojectableFiles: 1,
        },
      },
      {
        target: { registry: "NPM", packageName: "express" } as const,
        from: "1.0.0",
        to: "1.0.0",
        mode: "inventory" as const,
        raw: {
          summary: {
            filesChanged: 0,
            added: 0,
            deleted: 0,
            modified: 0,
            modeChanged: 0,
            typeChanged: 0,
            inventoryComplete: true,
            unprojectableFiles: 0,
          },
          scope: {
            status: "PACKAGE",
            fromSubpath: "",
            toSubpath: "",
            pathPrefix: null,
            pathGlob: null,
          },
          contentCoverage: "NOT_REQUESTED",
          contentFailure: null,
          files: [],
          hasMoreFiles: false,
        },
        result: {
          fromResolution: {
            requested: "1.0.0",
            resolvedVersion: "1.0.0",
            ref: "v1.0.0",
            commitSha: "same-sha",
            refKind: "TAG",
            versionSource: "REGISTRY",
          },
          toResolution: {
            requested: "1.0.0",
            resolvedVersion: "1.0.0",
            ref: "v1.0.0",
            commitSha: "same-sha",
            refKind: "TAG",
            versionSource: "REGISTRY",
          },
        },
        expected: {
          fromSha: "same-sha",
          toSha: "same-sha",
          fromVersion: "1.0.0",
          toVersion: "1.0.0",
          versionSource: "REGISTRY",
          scopeStatus: "PACKAGE",
          fromSubpath: "",
          toSubpath: "",
          coverage: "NOT_REQUESTED",
          paths: [],
          statuses: [],
          omissions: [],
          filesChanged: 0,
          added: 0,
          deleted: 0,
          modified: 0,
          unprojectableFiles: 0,
        },
      },
      {
        target: { registry: "NPM", packageName: "express" } as const,
        from: "1.0.0",
        to: "2.0.0",
        mode: "inventory" as const,
        raw: {
          summary: {
            filesChanged: 1,
            added: 0,
            deleted: 0,
            modified: 1,
            modeChanged: 0,
            typeChanged: 0,
            inventoryComplete: true,
            unprojectableFiles: 0,
          },
          scope: {
            status: "UNKNOWN",
            fromSubpath: null,
            toSubpath: null,
            pathPrefix: null,
            pathGlob: null,
          },
          contentCoverage: "NOT_REQUESTED",
          contentFailure: null,
          files: [
            {
              path: "src/unknown.ts",
              pathEncoding: "UTF8",
              status: "MODIFIED",
              modeChanged: false,
              typeChanged: false,
              additions: null,
              deletions: null,
              patch: null,
              contentStatus: "NOT_REQUESTED",
              contentOmissionReason: null,
              contentSafety: { filtered: false, modifications: [] },
            },
          ],
          hasMoreFiles: false,
        },
        result: {
          fromResolution: {
            requested: "1.0.0",
            resolvedVersion: "1.0.0",
            ref: "v1.0.0",
            commitSha: "unknown-from-sha",
            refKind: "TAG",
            versionSource: "REGISTRY",
          },
          toResolution: {
            requested: "2.0.0",
            resolvedVersion: "2.0.0",
            ref: "v2.0.0",
            commitSha: "unknown-to-sha",
            refKind: "TAG",
            versionSource: "REGISTRY",
          },
        },
        expected: {
          fromSha: "unknown-from-sha",
          toSha: "unknown-to-sha",
          fromVersion: "1.0.0",
          toVersion: "2.0.0",
          versionSource: "REGISTRY",
          scopeStatus: "UNKNOWN",
          fromSubpath: undefined,
          toSubpath: undefined,
          coverage: "NOT_REQUESTED",
          paths: ["src/unknown.ts"],
          statuses: ["NOT_REQUESTED"],
          omissions: [undefined],
          filesChanged: 1,
          added: 0,
          deleted: 0,
          modified: 1,
          unprojectableFiles: 0,
        },
      },
      {
        target: { registry: "NPM", packageName: "express" } as const,
        from: "1.0.0",
        to: "2.0.0",
        mode: "patches" as const,
        raw: {
          summary: {
            filesChanged: 3,
            added: 0,
            deleted: 0,
            modified: 3,
            modeChanged: 0,
            typeChanged: 0,
            inventoryComplete: true,
            unprojectableFiles: 0,
          },
          scope: {
            status: "UNKNOWN",
            fromSubpath: null,
            toSubpath: null,
            pathPrefix: null,
            pathGlob: null,
          },
          contentCoverage: "PARTIAL",
          contentFailure: null,
          files: [
            {
              path: BYTE_ESCAPED_CODE_DIFF_PATH,
              pathEncoding: "BYTE_ESCAPED",
              status: "MODIFIED",
              modeChanged: false,
              typeChanged: false,
              additions: null,
              deletions: null,
              patch: null,
              contentStatus: "BINARY",
              contentOmissionReason: null,
              contentSafety: { filtered: false, modifications: [] },
            },
            {
              path: "package.json",
              pathEncoding: "UTF8",
              status: "MODIFIED",
              modeChanged: false,
              typeChanged: false,
              additions: null,
              deletions: null,
              patch: null,
              contentStatus: "METADATA_ONLY",
              contentOmissionReason: null,
              contentSafety: { filtered: false, modifications: [] },
            },
            {
              path: "README.md",
              pathEncoding: "UTF8",
              status: "MODIFIED",
              modeChanged: false,
              typeChanged: false,
              additions: null,
              deletions: null,
              patch: null,
              contentStatus: "OMITTED",
              contentOmissionReason: "content_budget",
              contentSafety: { filtered: false, modifications: [] },
            },
          ],
          hasMoreFiles: false,
        },
        result: {
          fromResolution: {
            requested: "1.0.0",
            resolvedVersion: "1.0.0",
            ref: "v1.0.0",
            commitSha: "content-from-sha",
            refKind: "TAG",
            versionSource: "REGISTRY",
          },
          toResolution: {
            requested: "2.0.0",
            resolvedVersion: "2.0.0",
            ref: "v2.0.0",
            commitSha: "content-to-sha",
            refKind: "TAG",
            versionSource: "REGISTRY",
          },
        },
        expected: {
          fromSha: "content-from-sha",
          toSha: "content-to-sha",
          fromVersion: "1.0.0",
          toVersion: "2.0.0",
          versionSource: "REGISTRY",
          scopeStatus: "UNKNOWN",
          fromSubpath: undefined,
          toSubpath: undefined,
          coverage: "PARTIAL",
          paths: [BYTE_ESCAPED_CODE_DIFF_PATH, "package.json", "README.md"],
          statuses: ["BINARY", "METADATA_ONLY", "OMITTED"],
          omissions: [undefined, undefined, "content_budget"],
          filesChanged: 3,
          added: 0,
          deleted: 0,
          modified: 3,
          unprojectableFiles: 0,
        },
      },
    ] as const;

    expect(fixtures[0].sourcePaths).toHaveLength(
      fixtures[0].expected.filesChanged,
    );
    expect(
      fixtures[0].sourcePaths.filter((path) => path.length > 4_096),
    ).toHaveLength(fixtures[0].expected.unprojectableFiles);
    expect(fixtures[0].raw.files).toHaveLength(
      fixtures[0].expected.filesChanged -
        fixtures[0].expected.unprojectableFiles,
    );

    for (const fixture of fixtures) {
      const fn = mock(() =>
        Promise.resolve(
          new Response(
            JSON.stringify(codeDiffPayload(fixture.raw, fixture.result)),
            { status: 200 },
          ),
        ),
      );
      globalThis.fetch = fn as unknown as typeof fetch;
      const service = new CodeNavigationServiceImpl(
        BASE_URL,
        createMockTokenProvider(),
      );

      const result = await service.codeDiff({
        target: fixture.target,
        from: fixture.from,
        to: fixture.to,
        mode: fixture.mode,
      });

      expect(result.fromResolution.commitSha).toBe(fixture.expected.fromSha);
      expect(result.toResolution.commitSha).toBe(fixture.expected.toSha);
      expect(result.fromResolution.resolvedVersion).toBe(
        fixture.expected.fromVersion,
      );
      expect(result.toResolution.resolvedVersion).toBe(
        fixture.expected.toVersion,
      );
      expect(result.fromResolution.versionSource).toBe(
        fixture.expected.versionSource,
      );
      expect(result.toResolution.versionSource).toBe(
        fixture.expected.versionSource,
      );
      expect(result.raw.scope).toMatchObject({
        status: fixture.expected.scopeStatus,
      });
      expect(result.raw.scope.fromSubpath).toBe(fixture.expected.fromSubpath);
      expect(result.raw.scope.toSubpath).toBe(fixture.expected.toSubpath);
      expect(result.raw.contentCoverage).toBe(fixture.expected.coverage);
      expect(result.raw.summary.filesChanged).toBe(
        fixture.expected.filesChanged,
      );
      expect(result.raw.summary.added).toBe(fixture.expected.added);
      expect(result.raw.summary.deleted).toBe(fixture.expected.deleted);
      expect(result.raw.summary.modified).toBe(fixture.expected.modified);
      expect(result.raw.summary.unprojectableFiles).toBe(
        fixture.expected.unprojectableFiles,
      );
      expect(result.raw.files.map((file) => file.path)).toEqual([
        ...fixture.expected.paths,
      ]);
      expect(result.raw.files.map((file) => file.contentStatus)).toEqual([
        ...fixture.expected.statuses,
      ]);
      expect(
        result.raw.files.map((file) => file.contentOmissionReason),
      ).toEqual([...fixture.expected.omissions]);
      expect(fn).toHaveBeenCalledTimes(1);
    }
  });

  it("maps raw field errors to a bounded CodeDiffError with partial root identity", async () => {
    const fn = mock(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            data: {
              codeDiff: {
                package: {
                  registry: "NPM",
                  name: "express",
                  repoUrl: "https://github.com/expressjs/express",
                },
                fromResolution: {
                  requested: "4.18.1",
                  resolvedVersion: "4.18.1",
                  ref: "v4.18.1",
                  commitSha: "from-sha",
                  refKind: "TAG",
                  versionSource: "REGISTRY",
                },
                toResolution: {
                  requested: "4.18.2",
                  ref: "v4.18.2",
                  commitSha: "to-sha",
                  refKind: "TAG",
                  versionSource: "REGISTRY",
                },
                raw: null,
              },
            },
            errors: [
              {
                message: "The raw diff source was unavailable",
                path: ["codeDiff", "raw"],
                extensions: {
                  code: "RAW_DIFF_UNAVAILABLE",
                  retryable: false,
                  side: "from",
                  registry: "NPM",
                  repo_url: "https://github.com/expressjs/express",
                  git_ref: "v4.18.1",
                  available_versions: [],
                  available_refs: [{ ref: "main", version: null }],
                  suggested_refs: [{ ref: "v4.18.2" }],
                  ref_kinds: ["TAG", "BRANCH"],
                  secret: "must-not-survive",
                },
              },
            ],
          }),
          { status: 200 },
        ),
      ),
    );
    globalThis.fetch = fn as unknown as typeof fetch;
    const service = new CodeNavigationServiceImpl(
      BASE_URL,
      createMockTokenProvider(),
    );

    try {
      await service.codeDiff({
        target: { registry: "NPM", packageName: "express" },
        from: "4.18.1",
        to: "4.18.2",
        mode: "inventory",
      });
      throw new Error("expected CodeDiffError");
    } catch (error) {
      expect(error).toBeInstanceOf(CodeDiffError);
      const typed = error as CodeDiffError;
      expect(typed.details).toEqual({
        code: "RAW_DIFF_UNAVAILABLE",
        retryable: false,
        side: "from",
        registry: "NPM",
        repoUrl: "https://github.com/expressjs/express",
        gitRef: "v4.18.1",
        availableVersions: [],
        availableRefs: [{ ref: "main", version: undefined }],
        suggestedRefs: [{ ref: "v4.18.2", version: undefined }],
        refKinds: ["TAG", "BRANCH"],
      });
      expect(typed.partial?.fromResolution.commitSha).toBe("from-sha");
      expect(typed.partial?.toResolution.commitSha).toBe("to-sha");
      expect(typed.partial?.raw).toBeUndefined();
      expect(JSON.stringify(typed)).not.toContain("must-not-survive");
    }
  });

  it("keeps AUTHENTICATION_REQUIRED on the existing authentication boundary", async () => {
    const forceRefresh = mock(() => Promise.resolve(undefined));
    const fn = mock(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            data: { codeDiff: null },
            errors: [
              {
                message: "Authentication required",
                extensions: {
                  code: "AUTHENTICATION_REQUIRED",
                  retryable: false,
                },
              },
            ],
          }),
          { status: 200 },
        ),
      ),
    );
    globalThis.fetch = fn as unknown as typeof fetch;
    const service = new CodeNavigationServiceImpl(
      BASE_URL,
      createMockTokenProvider({ forceRefresh }),
    );

    await expect(
      service.codeDiff({
        target: { repoUrl: "https://github.com/expressjs/express" },
        from: "main",
        to: "release",
        mode: "inventory",
      }),
    ).rejects.toBeInstanceOf(AuthenticationError);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(forceRefresh).toHaveBeenCalledTimes(1);
  });

  it("keeps root GraphQL access errors on the existing boundaries", async () => {
    for (const [code, errorClass] of [
      ["FORBIDDEN", CodeNavigationAccessError],
      ["FEATURE_FLAG_REQUIRED", CodeNavigationFeatureFlagRequiredError],
    ] as const) {
      const fn = mock(() =>
        Promise.resolve(
          new Response(
            JSON.stringify(
              codeDiffRootErrorPayload({ code, retryable: false }),
            ),
            { status: 200 },
          ),
        ),
      );
      globalThis.fetch = fn as unknown as typeof fetch;
      const service = new CodeNavigationServiceImpl(
        BASE_URL,
        createMockTokenProvider(),
      );

      await expect(
        service.codeDiff({
          target: { repoUrl: "https://github.com/expressjs/express" },
          from: "main",
          to: "release",
          mode: "inventory",
        }),
      ).rejects.toBeInstanceOf(errorClass);
      expect(fn).toHaveBeenCalledTimes(1);
    }
  });

  it("maps root version errors to CodeDiffError with bounded publication metadata", async () => {
    const fn = mock(() =>
      Promise.resolve(
        new Response(
          JSON.stringify(
            codeDiffRootErrorPayload({
              code: "VERSION_NOT_FOUND",
              retryable: false,
              side: "from",
              registry: "NPM",
              published_versions: [],
              published_versions_truncated: true,
              available_versions: [
                { version: "2.1.1", ref: "2.1.1", ignored: "discard-me" },
                { version: "4.0.0", ref: "4.0.0" },
                {
                  version: null,
                  ref: "0123456789abcdef0123456789abcdef01234567",
                },
              ],
              retry_after_ms: 1200,
              secret: "must-not-survive",
            }),
          ),
          { status: 200 },
        ),
      ),
    );
    globalThis.fetch = fn as unknown as typeof fetch;
    const service = new CodeNavigationServiceImpl(
      BASE_URL,
      createMockTokenProvider(),
    );

    let caught: unknown;
    try {
      await service.codeDiff({
        target: { registry: "NPM", packageName: "express" },
        from: "9.9.9",
        to: "10.0.0",
        mode: "inventory",
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(CodeDiffError);
    const error = caught as CodeDiffError;
    expect(error.details).toEqual({
      code: "VERSION_NOT_FOUND",
      retryable: false,
      side: "from",
      publishedVersions: [],
      publishedVersionsTruncated: true,
      availableVersions: [
        { version: "2.1.1", ref: "2.1.1" },
        { version: "4.0.0", ref: "4.0.0" },
        {
          version: undefined,
          ref: "0123456789abcdef0123456789abcdef01234567",
        },
      ],
      registry: "NPM",
      retryAfterMs: 1200,
    });
    expect(error.partial).toBeUndefined();
    expect(JSON.stringify(error)).not.toContain("must-not-survive");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("maps root ambiguous-ref errors with empty candidate arrays and kinds", async () => {
    const fn = mock(() =>
      Promise.resolve(
        new Response(
          JSON.stringify(
            codeDiffRootErrorPayload({
              code: "AMBIGUOUS_REF",
              retryable: false,
              repo_url: "https://github.com/expressjs/express",
              git_ref: "release",
              available_refs: [],
              suggested_refs: [],
              ref_kinds: ["TAG", "BRANCH"],
              secret: { should: "not survive" },
            }),
          ),
          { status: 200 },
        ),
      ),
    );
    globalThis.fetch = fn as unknown as typeof fetch;
    const service = new CodeNavigationServiceImpl(
      BASE_URL,
      createMockTokenProvider(),
    );

    let caught: unknown;
    try {
      await service.codeDiff({
        target: { repoUrl: "https://github.com/expressjs/express" },
        from: "release",
        to: "main",
        mode: "inventory",
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(CodeDiffError);
    const error = caught as CodeDiffError;
    expect(error.details).toEqual({
      code: "AMBIGUOUS_REF",
      retryable: false,
      repoUrl: "https://github.com/expressjs/express",
      gitRef: "release",
      availableRefs: [],
      suggestedRefs: [],
      refKinds: ["TAG", "BRANCH"],
    });
    expect(error.partial).toBeUndefined();
    expect(JSON.stringify(error)).not.toContain("should");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("drops malformed error arrays instead of treating them as empty", async () => {
    const fn = mock(() =>
      Promise.resolve(
        new Response(
          JSON.stringify(
            codeDiffRootErrorPayload({
              code: "AMBIGUOUS_REF",
              retryable: false,
              published_versions: ["1.0.0", 2],
              available_versions: [
                { version: "1.0.0", ref: "v1.0.0" },
                { version: "2.0.0", ref: 2 },
              ],
              ref_kinds: ["TAG", 3],
              available_refs: [{ ref: "main" }, null],
              suggested_refs: [{ ref: "release", version: 4 }],
            }),
          ),
          { status: 200 },
        ),
      ),
    );
    globalThis.fetch = fn as unknown as typeof fetch;
    const service = new CodeNavigationServiceImpl(
      BASE_URL,
      createMockTokenProvider(),
    );

    let caught: unknown;
    try {
      await service.codeDiff({
        target: { repoUrl: "https://github.com/expressjs/express" },
        from: "release",
        to: "main",
        mode: "inventory",
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(CodeDiffError);
    expect((caught as CodeDiffError).details).toEqual({
      code: "AMBIGUOUS_REF",
      retryable: false,
    });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("validates malformed CodeDiff params before authentication or fetch", async () => {
    const getToken = mock(() => Promise.resolve("mock-access-token"));
    const forceRefresh = mock(() => Promise.resolve("mock-refreshed-token"));
    const fetchFn = mock((_url: string, _init?: RequestInit) =>
      Promise.resolve(new Response(null, { status: 200 })),
    );
    const service = new CodeNavigationServiceImpl(
      BASE_URL,
      { getToken, forceRefresh },
      fetchFn as unknown as typeof fetch,
    );
    const validParams = {
      target: { repoUrl: "https://github.com/expressjs/express" },
      from: "main",
      to: "release",
      mode: "inventory" as const,
    };
    const invalidParams: unknown[] = [
      null,
      { ...validParams, target: null },
      { ...validParams, target: "https://github.com/expressjs/express" },
      { ...validParams, mode: "unknown" },
      { ...validParams, from: "" },
      { ...validParams, from: 123 },
      { ...validParams, to: "" },
      { ...validParams, to: 123 },
      {
        ...validParams,
        target: { registry: "UNKNOWN", packageName: "express" },
      },
      { ...validParams, target: { registry: "NPM", packageName: "" } },
      { ...validParams, target: { repoUrl: "" } },
      {
        ...validParams,
        target: {
          registry: "NPM",
          packageName: "express",
          repoUrl: "https://github.com/expressjs/express",
        },
      },
      { ...validParams, options: null },
      { ...validParams, options: { maxFiles: "50" } },
      { ...validParams, options: { maxFiles: 50.5 } },
      { ...validParams, options: { maxFiles: 0 } },
      { ...validParams, options: { maxFiles: 301 } },
      { ...validParams, options: { maxPatchBytes: 2_097_153 } },
      { ...validParams, options: { pathPrefix: "" } },
      { ...validParams, options: { pathPrefix: "a".repeat(1_025) } },
      { ...validParams, options: { pathPrefix: "é".repeat(513) } },
      { ...validParams, options: { pathGlob: "" } },
      { ...validParams, options: { pathGlob: "a".repeat(1_025) } },
      { ...validParams, options: { pathGlob: null } },
      { ...validParams, options: { unknownOption: true } },
    ];

    for (const params of invalidParams) {
      await expect(
        service.codeDiff(params as CodeDiffParams),
      ).rejects.toBeInstanceOf(CodeNavigationValidationError);
    }

    const invalidTargetMessages = [
      {
        target: {
          repoUrl: "https://github.com/expressjs/express",
          registry: undefined,
        },
        message:
          "CodeDiff target has conflicting present keys: registry, repoUrl. Target shape is determined by key presence, even when a value is undefined.",
      },
      {
        target: {
          registry: "NPM",
          packageName: "express",
          repoUrl: undefined,
        },
        message:
          "CodeDiff target has conflicting present keys: registry, packageName, repoUrl. Target shape is determined by key presence, even when a value is undefined.",
      },
      {
        target: {
          packageName: "express",
          repoUrl: "https://github.com/expressjs/express",
        },
        message:
          "CodeDiff target has conflicting present keys: packageName, repoUrl. Target shape is determined by key presence, even when a value is undefined.",
      },
      {
        target: { registry: "NPM" },
        message: "CodeDiff target must be a package or repository target.",
      },
      {
        target: { packageName: "express" },
        message: "CodeDiff target must be a package or repository target.",
      },
    ];

    for (const { target, message } of invalidTargetMessages) {
      await expect(
        service.codeDiff({ ...validParams, target } as CodeDiffParams),
      ).rejects.toThrow(message);
    }

    expect(getToken).not.toHaveBeenCalled();
    expect(forceRefresh).not.toHaveBeenCalled();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("rejects unknown response enums and invalid raw bounds", async () => {
    const unknownEnumFetch = mockFetch(() =>
      Promise.resolve(
        new Response(
          JSON.stringify(
            codeDiffPayload({
              contentCoverage: "NOT_A_COVERAGE",
            }),
          ),
          { status: 200 },
        ),
      ),
    );
    const service = new CodeNavigationServiceImpl(
      BASE_URL,
      createMockTokenProvider(),
    );
    await expect(
      service.codeDiff({
        target: { repoUrl: "https://github.com/expressjs/express" },
        from: "v1",
        to: "v2",
        mode: "inventory",
      }),
    ).rejects.toBeInstanceOf(MalformedCodeNavigationResponseError);
    expect(unknownEnumFetch).toHaveBeenCalledTimes(1);

    await expect(
      service.codeDiff({
        target: { repoUrl: "https://github.com/expressjs/express" },
        from: "v1",
        to: "v2",
        mode: "stats",
        options: { maxPatchBytes: 1023 },
      }),
    ).rejects.toThrow("maxPatchBytes");
    expect(unknownEnumFetch).toHaveBeenCalledTimes(1);
  });
});
