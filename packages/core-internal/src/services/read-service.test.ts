import { describe, expect, it, mock } from "bun:test";
import {
  CodeNavigationAccessError,
  CodeNavigationBackendError,
  CodeNavigationFileNotFoundError,
  CodeNavigationIndexingError,
  CodeNavigationNetworkError,
  CodeNavigationTargetNotFoundError,
  CodeNavigationVersionNotFoundError,
  MalformedCodeNavigationResponseError,
} from "./code-navigation-service.js";
import { AuthenticationError } from "./githits-service.js";
import { PackageIntelligenceDocumentationSectionUnresolvedError } from "./package-intelligence-service.js";
import { ReadServiceImpl } from "./read-service.js";
import { createMockTokenProvider } from "./test-helpers.js";

const ENDPOINT = "https://pkgseer.dev";

interface SelectionTree {
  [field: string]: SelectionTree | null;
}

const CODE_READ_SELECTION: SelectionTree = {
  content: null,
  filePath: null,
  language: null,
  totalLines: null,
  startLine: null,
  endLine: null,
  isBinary: null,
  codeIndexState: null,
  indexingRef: null,
  availableVersions: {
    version: null,
    ref: null,
  },
  indexingEstimate: {
    lowerSeconds: null,
    upperSeconds: null,
    elapsedSeconds: null,
    sampleCount: null,
    source: null,
  },
  targetResolution: {
    requested: {
      kind: null,
      registry: null,
      packageName: null,
      version: null,
      repoUrl: null,
      gitRef: null,
      commitSha: null,
    },
    resolvedRequested: {
      kind: null,
      registry: null,
      packageName: null,
      version: null,
      repoUrl: null,
      gitRef: null,
      commitSha: null,
    },
    served: {
      kind: null,
      registry: null,
      packageName: null,
      version: null,
      repoUrl: null,
      gitRef: null,
      commitSha: null,
    },
    freshness: null,
    freshnessReason: null,
    indexingRef: null,
    availableVersions: {
      version: null,
      ref: null,
    },
    availableRefs: {
      version: null,
      ref: null,
    },
    suggestedRefs: {
      version: null,
      ref: null,
    },
  },
};

const DOCS_READ_SELECTION: SelectionTree = {
  registry: null,
  packageName: null,
  version: null,
  sourceKind: null,
  contentRange: {
    startLine: null,
    endLine: null,
    totalLines: null,
    anchor: null,
  },
  page: {
    id: null,
    docsReadTarget: null,
    title: null,
    content: null,
    contentFormat: null,
    breadcrumbs: null,
    lastUpdatedAt: null,
    sourceKind: null,
    source: {
      url: null,
      label: null,
    },
    repoUrl: null,
    gitRef: null,
    requestedRef: null,
    filePath: null,
    baseUrl: null,
  },
};

function parseFragmentSelection(
  query: string,
  fragmentName: string,
): SelectionTree {
  const marker = `... on ${fragmentName} {`;
  const markerIndex = query.indexOf(marker);
  if (markerIndex < 0) throw new Error(`Missing ${fragmentName} fragment`);
  const tokens = query
    .slice(markerIndex + marker.length - 1)
    .match(/[A-Za-z_][A-Za-z0-9_]*|[{}]/g);
  if (!tokens) throw new Error(`Empty ${fragmentName} fragment`);

  let cursor = 0;
  function parseBlock(): SelectionTree {
    if (tokens?.[cursor] !== "{") {
      throw new Error(`Expected opening brace for ${fragmentName}`);
    }
    cursor += 1;
    const selection: SelectionTree = {};
    while (tokens?.[cursor] !== "}") {
      const field = tokens?.[cursor];
      if (!field || field === "{") {
        throw new Error(`Expected field in ${fragmentName} fragment`);
      }
      cursor += 1;
      selection[field] = tokens?.[cursor] === "{" ? parseBlock() : null;
    }
    cursor += 1;
    return selection;
  }

  return parseBlock();
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function codeResult(overrides: Record<string, unknown> = {}): unknown {
  return {
    __typename: "CodeContextResult",
    content: "export const value = 1;\n",
    filePath: "src/index.ts",
    language: "TypeScript",
    totalLines: 1,
    startLine: 1,
    endLine: 1,
    isBinary: false,
    codeIndexState: "CURRENT",
    ...overrides,
  };
}

function docsResult(overrides: Record<string, unknown> = {}): unknown {
  return {
    __typename: "GetDocPageResult",
    registry: "NPM",
    packageName: "express",
    version: "5.1.0",
    sourceKind: "CRAWLED",
    contentRange: {
      startLine: 10,
      endLine: 20,
      totalLines: 100,
      anchor: "routing",
    },
    page: {
      id: "page-id",
      docsReadTarget: "https://expressjs.com/en/guide/routing.html#routing",
      title: "Routing",
      content: "routing content",
      contentFormat: "MARKDOWN",
      breadcrumbs: ["Guide", "Routing"],
      lastUpdatedAt: "2026-09-14T00:00:00Z",
      sourceKind: "CRAWLED",
      source: {
        url: "https://expressjs.com/en/guide/routing.html#routing",
        label: "Express routing",
      },
      repoUrl: null,
      gitRef: null,
      requestedRef: null,
      filePath: null,
      baseUrl: "https://expressjs.com",
    },
    ...overrides,
  };
}

function readRequest(fetchFn: ReturnType<typeof mock>): {
  query: string;
  variables: Record<string, unknown>;
} {
  const [, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
  return JSON.parse(String(init.body)) as {
    query: string;
    variables: Record<string, unknown>;
  };
}

describe("ReadServiceImpl", () => {
  it.each([undefined, " index.js "])(
    "forwards a compact symbol fragment unchanged with path %s",
    async (path) => {
      const fetchFn = mock(() =>
        Promise.resolve(jsonResponse({ data: { read: codeResult() } })),
      );
      const service = new ReadServiceImpl(
        ENDPOINT,
        createMockTokenProvider(),
        fetchFn as unknown as typeof fetch,
      );
      const target = "npm:express@5.2.1#create%41pplication";
      const response = await service.read({ target, path, waitTimeoutMs: 0 });
      expect(response.source).toBe("code");
      expect(readRequest(fetchFn).variables).toEqual({
        target,
        ...(path ? { path: "index.js" } : {}),
        waitTimeoutMs: 0,
      });
    },
  );

  it("uses code errors for invalid compact fragments without retrying docs", async () => {
    const fetchFn = mock(() =>
      Promise.resolve(
        jsonResponse({
          errors: [
            {
              message: "Invalid fragment",
              extensions: { code: "INVALID_ARGUMENT" },
            },
          ],
        }),
      ),
    );
    const service = new ReadServiceImpl(
      ENDPOINT,
      createMockTokenProvider(),
      fetchFn as unknown as typeof fetch,
    );
    await expect(
      service.read({ target: "npm:express@5.2.1#" }),
    ).rejects.toBeInstanceOf(CodeNavigationBackendError);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
  it("selects and parses bounded symbol resolution without content fields", async () => {
    const fetchFn = mock(() =>
      Promise.resolve(
        jsonResponse({
          data: {
            read: {
              __typename: "CodeSymbolResolutionResult",
              status: "AMBIGUOUS",
              candidates: [
                {
                  name: "main",
                  qualifiedPath: "main",
                  kind: "function",
                  arity: null,
                  filePath: "eval/run.ts",
                  startLine: 57,
                  endLine: 241,
                },
              ],
              suggestions: [],
              hasMore: false,
              repoUrl: "https://github.com/githits-com/githits-cli",
              gitRef: "abc",
              message: null,
              codeIndexState: "CURRENT",
            },
          },
        }),
      ),
    );
    const service = new ReadServiceImpl(
      ENDPOINT,
      createMockTokenProvider(),
      fetchFn as unknown as typeof fetch,
    );
    const result = await service.read({
      target: "github:githits-com/githits-cli@abc",
      selector: "main",
      path: "eval/run.ts",
      waitTimeoutMs: 0,
    });
    expect(result).toMatchObject({
      source: "symbol_resolution",
      result: {
        status: "AMBIGUOUS",
        candidates: [{ filePath: "eval/run.ts" }],
      },
    });
    const request = readRequest(fetchFn);
    expect(request.variables).toEqual({
      target: "github:githits-com/githits-cli@abc",
      selector: "main",
      path: "eval/run.ts",
      waitTimeoutMs: 0,
    });
    expect(request.query).toContain("... on CodeSymbolResolutionResult");
    expect(request.query).toContain("selector: $selector");
  });

  it("forwards wait to the backend for docs selector requests", async () => {
    const fetchFn = mock(() =>
      Promise.resolve(jsonResponse({ data: { read: docsResult() } })),
    );
    const service = new ReadServiceImpl(
      ENDPOINT,
      createMockTokenProvider(),
      fetchFn as unknown as typeof fetch,
    );
    await service.read({
      target: "https://expressjs.com/llms/api-5x.txt",
      selector: "expressjson",
      waitTimeoutMs: 0,
    });
    expect(readRequest(fetchFn).variables).toEqual({
      target: "https://expressjs.com/llms/api-5x.txt",
      selector: "expressjson",
      waitTimeoutMs: 0,
    });
  });

  it.each([
    "github:owner/repo@abc/docs/README.md",
    "github:owner/repo@release/1.x",
  ])(
    "accepts backend docs results for slash-bearing repository IDs: %s",
    async (target) => {
      const fetchFn = mock(() =>
        Promise.resolve(jsonResponse({ data: { read: docsResult() } })),
      );
      const service = new ReadServiceImpl(
        ENDPOINT,
        createMockTokenProvider(),
        fetchFn as unknown as typeof fetch,
      );
      const response = await service.read({
        target,
        selector: "intro",
        waitTimeoutMs: 0,
      });
      expect(response.source).toBe("docs");
      expect(readRequest(fetchFn).variables).toEqual({
        target,
        selector: "intro",
        waitTimeoutMs: 0,
      });
    },
  );
  it("sends one compact code read with the exact effective variables and fields", async () => {
    const fetchFn = mock(() =>
      Promise.resolve(jsonResponse({ data: { read: codeResult() } })),
    );
    const service = new ReadServiceImpl(
      ENDPOINT,
      createMockTokenProvider(),
      fetchFn as unknown as typeof fetch,
    );

    const result = await service.read({
      target: "github:Owner/Repo@feature/a@b",
      path: " src/index.ts ",
      startLine: 4,
      endLine: 12,
      waitTimeoutMs: 30_000,
    });

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const request = readRequest(fetchFn);
    expect(request.variables).toEqual({
      target: "github:Owner/Repo@feature/a@b",
      path: "src/index.ts",
      startLine: 4,
      endLine: 12,
      waitTimeoutMs: 30_000,
    });
    expect(request.query).toContain("query Read(");
    expect(request.query).toContain("read(");
    expect(request.query).toContain("__typename");
    expect(request.query).toContain("... on CodeContextResult");
    expect(request.query).toContain("... on GetDocPageResult");
    expect(parseFragmentSelection(request.query, "CodeContextResult")).toEqual(
      CODE_READ_SELECTION,
    );
    expect(parseFragmentSelection(request.query, "GetDocPageResult")).toEqual(
      DOCS_READ_SELECTION,
    );
    expect(request.query).not.toContain("linkName");
    expect(result).toEqual({
      source: "code",
      result: {
        filePath: "src/index.ts",
        language: "TypeScript",
        totalLines: 1,
        startLine: 1,
        endLine: 1,
        content: "export const value = 1;\n",
        isBinary: false,
        targetResolution: undefined,
        availableVersions: undefined,
      },
    });
  });

  it("preserves an opaque docs target and omits an empty path", async () => {
    const target =
      "https://expressjs.com/en/guide/routing.html?q=a%2Fb#routing";
    const fetchFn = mock(() =>
      Promise.resolve(jsonResponse({ data: { read: docsResult() } })),
    );
    const service = new ReadServiceImpl(
      ENDPOINT,
      createMockTokenProvider(),
      fetchFn as unknown as typeof fetch,
    );

    const result = await service.read({
      target,
      path: " \n ",
      startLine: 10,
      endLine: 20,
      waitTimeoutMs: 42,
    });

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(readRequest(fetchFn).variables).toEqual({
      target,
      startLine: 10,
      endLine: 20,
      waitTimeoutMs: 42,
    });
    expect(result.source).toBe("docs");
    if (result.source !== "docs") throw new Error("expected docs result");
    expect(result.result.contentRange).toEqual({
      startLine: 10,
      endLine: 20,
      totalLines: 100,
      anchor: "routing",
    });
    expect(result.result.page).toMatchObject({
      id: "page-id",
      docsReadTarget: "https://expressjs.com/en/guide/routing.html#routing",
      title: "Routing",
    });
    expect(result.result.page?.linkName).toBeUndefined();
  });

  it("uses the backend result type for docs-shaped code and code-shaped docs", async () => {
    const codeService = new ReadServiceImpl(
      ENDPOINT,
      createMockTokenProvider(),
      mock(() =>
        Promise.resolve(jsonResponse({ data: { read: codeResult() } })),
      ) as unknown as typeof fetch,
    );
    const docsService = new ReadServiceImpl(
      ENDPOINT,
      createMockTokenProvider(),
      mock(() =>
        Promise.resolve(jsonResponse({ data: { read: docsResult() } })),
      ) as unknown as typeof fetch,
    );

    expect(
      (
        await codeService.read({
          target: "github:owner/repo@release/v1#makeApp",
        })
      ).source,
    ).toBe("code");
    expect(
      (await docsService.read({ target: "npm:express@5.2.1#heading" })).source,
    ).toBe("docs");
  });

  it.each([
    {
      name: "missing code branch",
      params: { target: "npm:express", path: "index.js" },
      body: { data: { read: null } },
      expected: MalformedCodeNavigationResponseError,
    },
    {
      name: "unknown docs branch",
      params: { target: "page-id" },
      body: { data: { read: { __typename: "FutureReadResult" } } },
      expected: MalformedCodeNavigationResponseError,
    },
  ])(
    "rejects $name without a legacy retry",
    async ({ params, body, expected }) => {
      const fetchFn = mock(() => Promise.resolve(jsonResponse(body)));
      const service = new ReadServiceImpl(
        ENDPOINT,
        createMockTokenProvider(),
        fetchFn as unknown as typeof fetch,
      );

      await expect(service.read(params)).rejects.toBeInstanceOf(expected);
      expect(fetchFn).toHaveBeenCalledTimes(1);
    },
  );

  it("promotes code indexing data through the existing typed error", async () => {
    const service = new ReadServiceImpl(
      ENDPOINT,
      createMockTokenProvider(),
      mock(() =>
        Promise.resolve(
          jsonResponse({
            data: {
              read: codeResult({
                content: null,
                codeIndexState: "INDEXING",
                indexingRef: "idx-read",
              }),
            },
          }),
        ),
      ) as unknown as typeof fetch,
    );

    try {
      await service.read({ target: "npm:express", path: "index.js" });
      throw new Error("expected indexing error");
    } catch (error) {
      expect(error).toBeInstanceOf(CodeNavigationIndexingError);
      expect((error as CodeNavigationIndexingError).indexingRef).toBe(
        "idx-read",
      );
    }
  });

  it("maps GraphQL errors from backend codes despite target shape", async () => {
    const codeService = new ReadServiceImpl(
      ENDPOINT,
      createMockTokenProvider(),
      mock(() =>
        Promise.resolve(
          jsonResponse({
            errors: [
              {
                message: "File not found: missing.ts",
                extensions: {
                  code: "FILE_NOT_FOUND",
                  file_path: "missing.ts",
                },
              },
            ],
          }),
        ),
      ) as unknown as typeof fetch,
    );
    const docsService = new ReadServiceImpl(
      ENDPOINT,
      createMockTokenProvider(),
      mock(() =>
        Promise.resolve(
          jsonResponse({
            errors: [
              {
                message: "Documentation section is ambiguous",
                extensions: {
                  code: "DOCUMENTATION_SECTION_UNRESOLVED",
                  reason: "ambiguous",
                },
              },
            ],
          }),
        ),
      ) as unknown as typeof fetch,
    );

    await expect(
      codeService.read({ target: "github:owner/repo@release/v1#missing" }),
    ).rejects.toBeInstanceOf(CodeNavigationFileNotFoundError);
    try {
      await docsService.read({ target: "npm:express@5.2.1#duplicate" });
      throw new Error("expected docs error");
    } catch (error) {
      expect(error).toBeInstanceOf(
        PackageIntelligenceDocumentationSectionUnresolvedError,
      );
      expect(
        (error as PackageIntelligenceDocumentationSectionUnresolvedError)
          .reason,
      ).toBe("ambiguous");
    }
  });

  it("keeps indexing and access errors source-neutral for docs-shaped targets", async () => {
    const responses = [
      {
        errors: [
          { message: "Indexing", extensions: { code: "PACKAGE_INDEXING" } },
        ],
      },
      { errors: [{ message: "Forbidden", extensions: { code: "FORBIDDEN" } }] },
    ];
    const fetchFn = mock(() =>
      Promise.resolve(jsonResponse(responses.shift())),
    );
    const service = new ReadServiceImpl(
      ENDPOINT,
      createMockTokenProvider(),
      fetchFn as unknown as typeof fetch,
    );
    const target = "github:owner/repo@release/v1#makeApp";
    await expect(service.read({ target })).rejects.toBeInstanceOf(
      CodeNavigationIndexingError,
    );
    try {
      await service.read({ target });
      throw new Error("expected access error");
    } catch (error) {
      expect(error).toBeInstanceOf(CodeNavigationAccessError);
      expect((error as Error).message).toBe("Read access denied.");
    }
  });

  it("keeps recovery metadata for shared version and target errors", async () => {
    const responses = [
      {
        errors: [
          {
            message: "Version not found",
            extensions: {
              code: "VERSION_NOT_FOUND",
              package: "npm/express",
              requested_version: "missing",
              latest_indexed: "5.2.1",
              available_versions: [{ version: "5.2.1", ref: "v5.2.1" }],
            },
          },
        ],
      },
      {
        errors: [
          {
            message: "Target not found",
            extensions: {
              code: "NOT_FOUND",
              repo_url: "https://github.com/owner/repo",
              git_ref: "release/v1",
            },
          },
        ],
      },
    ];
    const fetchFn = mock(() =>
      Promise.resolve(jsonResponse(responses.shift())),
    );
    const service = new ReadServiceImpl(
      ENDPOINT,
      createMockTokenProvider(),
      fetchFn as unknown as typeof fetch,
    );
    try {
      await service.read({ target: "github:owner/repo@release/v1#symbol" });
      throw new Error("expected version error");
    } catch (error) {
      expect(error).toBeInstanceOf(CodeNavigationVersionNotFoundError);
      expect((error as CodeNavigationVersionNotFoundError).latestIndexed).toBe(
        "5.2.1",
      );
    }
    try {
      await service.read({ target: "github:owner/repo@release/v1#symbol" });
      throw new Error("expected target error");
    } catch (error) {
      expect(error).toBeInstanceOf(CodeNavigationTargetNotFoundError);
      expect((error as CodeNavigationTargetNotFoundError).requestedRef).toBe(
        "release/v1",
      );
    }
  });

  it.each([
    {
      name: "code HTTP failure",
      params: { target: "npm:express", path: "index.js" },
      fetchFn: mock(() => Promise.resolve(jsonResponse({}, 503))),
      expected: CodeNavigationBackendError,
    },
    {
      name: "docs HTTP failure",
      params: { target: "page-id" },
      fetchFn: mock(() => Promise.resolve(jsonResponse({}, 503))),
      expected: CodeNavigationBackendError,
    },
    {
      name: "code transport failure",
      params: { target: "npm:express", path: "index.js" },
      fetchFn: mock(() => Promise.reject(new Error("offline"))),
      expected: CodeNavigationNetworkError,
    },
    {
      name: "docs transport failure",
      params: { target: "page-id" },
      fetchFn: mock(() => Promise.reject(new Error("offline"))),
      expected: CodeNavigationNetworkError,
    },
  ])(
    "maps $name through neutral read errors",
    async ({ params, fetchFn, expected }) => {
      const service = new ReadServiceImpl(
        ENDPOINT,
        createMockTokenProvider(),
        fetchFn as unknown as typeof fetch,
      );

      await expect(service.read(params)).rejects.toBeInstanceOf(expected);
      expect(fetchFn).toHaveBeenCalledTimes(1);
    },
  );

  it("uses neutral messages for source-free transport, HTTP and protocol errors", async () => {
    const responses = [
      mock(() => Promise.reject(new Error("offline"))),
      mock(() => Promise.resolve(jsonResponse({}, 403))),
      mock(() => Promise.resolve(jsonResponse({ data: { read: null } }))),
    ];
    const expected = [
      [CodeNavigationNetworkError, "Could not reach the read service"],
      [CodeNavigationAccessError, "Read access denied."],
      [
        MalformedCodeNavigationResponseError,
        "Malformed response from read service.",
      ],
    ] as const;
    for (const [index, fetchFn] of responses.entries()) {
      const service = new ReadServiceImpl(
        ENDPOINT,
        createMockTokenProvider(),
        fetchFn as unknown as typeof fetch,
      );
      try {
        await service.read({ target: "page-id" });
        throw new Error("expected read error");
      } catch (error) {
        expect(error).toBeInstanceOf(expected[index]![0]);
        expect((error as Error).message).toContain(expected[index]![1]);
      }
    }
  });

  it.each([
    { target: "npm:express#makeApp", result: codeResult({ content: 42 }) },
    {
      target: "https://expressjs.com/guide#routing",
      result: docsResult({ contentRange: null }),
    },
  ])(
    "uses a neutral protocol error for malformed typed result $target",
    async ({ target, result }) => {
      const fetchFn = mock(() =>
        Promise.resolve(jsonResponse({ data: { read: result } })),
      );
      const service = new ReadServiceImpl(
        ENDPOINT,
        createMockTokenProvider(),
        fetchFn as unknown as typeof fetch,
      );
      try {
        await service.read({ target });
        throw new Error("expected malformed read response");
      } catch (error) {
        expect(error).toBeInstanceOf(MalformedCodeNavigationResponseError);
        expect((error as Error).message).toBe(
          "Malformed response from read service.",
        );
      }
    },
  );

  it("refreshes once for backend authentication errors", async () => {
    const forceRefresh = mock(() => Promise.resolve("renewed-token"));
    const fetchFn = mock(() =>
      Promise.resolve(
        jsonResponse({
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
      ),
    );
    const service = new ReadServiceImpl(
      ENDPOINT,
      createMockTokenProvider({ forceRefresh }),
      fetchFn as unknown as typeof fetch,
    );

    await expect(
      service.read({ target: "npm:express", path: "index.js" }),
    ).rejects.toBeInstanceOf(AuthenticationError);
    expect(forceRefresh).toHaveBeenCalledTimes(1);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
});
