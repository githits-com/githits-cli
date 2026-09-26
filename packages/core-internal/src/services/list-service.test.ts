import { describe, expect, it, mock } from "bun:test";
import { ClientUpdateRequiredError } from "./client-update-required-error.js";
import {
  ListAccessError,
  ListBackendError,
  ListGraphQLError,
  ListNetworkError,
  ListServiceImpl,
  MalformedListResponseError,
} from "./list-service.js";
import type { ServiceDiagnostics } from "./runtime-diagnostics.js";
import { createMockTokenProvider } from "./test-helpers.js";

const ENDPOINT = "https://pkgseer.dev";

interface SelectionTree {
  [field: string]:
    | SelectionTree
    | { __directive: string; __selection?: SelectionTree }
    | null;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function successBody(
  list: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    data: {
      list: {
        inventoryKind: "SOURCE",
        requestedTarget: "npm:express@5.2.1",
        canonicalTarget: "npm:express@5.2.1",
        entries: [],
        hasMore: false,
        nextCursor: null,
        indexedVersion: "5.2.1",
        resolution: null,
        targetResolution: null,
        codeIndexState: "CURRENT",
        indexingStatus: "COMPLETED",
        indexingRef: null,
        availableVersions: [],
        indexingEstimate: null,
        inventoryState: null,
        crawlStatus: null,
        coverageState: null,
        coverageReason: null,
        preparation: null,
        ...list,
      },
    },
  };
}

function parseListSelection(query: string): SelectionTree {
  const operationIndex = query.indexOf("\n  list(");
  if (operationIndex < 0) throw new Error("Missing Query.list field");
  const argsStart = query.indexOf("(", operationIndex);
  let depth = 0;
  let argsEnd = -1;
  for (let index = argsStart; index < query.length; index += 1) {
    if (query[index] === "(") depth += 1;
    if (query[index] === ")") depth -= 1;
    if (depth === 0) {
      argsEnd = index;
      break;
    }
  }
  if (argsEnd < 0) throw new Error("Unclosed Query.list arguments");
  const selectionStart = query.indexOf("{", argsEnd);
  if (selectionStart < 0) throw new Error("Missing Query.list selection");

  depth = 0;
  let selectionEnd = -1;
  for (let index = selectionStart; index < query.length; index += 1) {
    if (query[index] === "{") depth += 1;
    if (query[index] === "}") depth -= 1;
    if (depth === 0) {
      selectionEnd = index + 1;
      break;
    }
  }
  if (selectionEnd < 0) throw new Error("Unclosed Query.list selection");

  const tokens =
    query
      .slice(selectionStart, selectionEnd)
      .match(
        /@[A-Za-z_][A-Za-z0-9_]*|\$[A-Za-z_][A-Za-z0-9_]*|[A-Za-z_][A-Za-z0-9_]*|[{}():!]/g,
      ) ?? [];
  if (tokens.length === 0) throw new Error("Empty Query.list selection");
  let cursor = 0;

  function parseSet(): SelectionTree {
    if (tokens[cursor] !== "{") throw new Error("Expected selection set");
    cursor += 1;
    const selection: SelectionTree = {};
    while (tokens[cursor] !== "}") {
      const field = tokens[cursor];
      if (!field || field.startsWith("@")) {
        throw new Error("Expected a selected field");
      }
      cursor += 1;

      let directive: string | undefined;
      if (tokens[cursor]?.startsWith("@")) {
        const directiveName = tokens[cursor];
        cursor += 1;
        if (tokens[cursor] !== "(") throw new Error("Expected directive args");
        cursor += 1;
        const directiveArgs: string[] = [];
        let argsDepth = 1;
        while (argsDepth > 0) {
          const token = tokens[cursor];
          if (!token) throw new Error("Unclosed directive arguments");
          cursor += 1;
          if (token === "(") argsDepth += 1;
          if (token === ")") {
            argsDepth -= 1;
            if (argsDepth === 0) break;
          }
          directiveArgs.push(token);
        }
        directive = `${directiveName}(${directiveArgs.join("")})`;
      }

      const childSelection = tokens[cursor] === "{" ? parseSet() : undefined;
      selection[field] = directive
        ? {
            __directive: directive,
            ...(childSelection ? { __selection: childSelection } : {}),
          }
        : (childSelection ?? null);
    }
    cursor += 1;
    return selection;
  }

  return parseSet();
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

function asFetchFn<T extends (...args: never[]) => unknown>(
  fn: T,
): typeof fetch {
  return fn as unknown as typeof fetch;
}

function diagnosticRuntime(area: string): ServiceDiagnostics {
  return {
    withOperation: <T>(_name: string, operation: () => Promise<T>) =>
      operation(),
    isEnabled: (candidate: string) => candidate === area,
    debug: () => undefined,
  };
}

describe("ListServiceImpl", () => {
  it("wire projection preserves exact variables, actions, and compact fields", async () => {
    const fetchFn = mock((_url: string, _init?: RequestInit) =>
      Promise.resolve(
        jsonResponse(
          successBody({
            requestedTarget: " npm:express@5.2.1 ",
            entries: [
              {
                kind: "FILE",
                path: "src/index.ts",
                title: null,
                language: null,
                fileType: null,
                intent: null,
                byteSize: null,
                lineCount: null,
                contentHash: null,
                read: {
                  target: "github:expressjs/express@abc123",
                  path: "src/a%2Fb.ts",
                  paths: null,
                },
                browse: null,
              },
              {
                kind: "DIRECTORY",
                path: "src",
                title: null,
                read: null,
                browse: {
                  target: "npm:express@5.2.1",
                  path: null,
                  paths: ["src/\\*"],
                },
              },
            ],
          }),
        ),
      ),
    );
    const service = new ListServiceImpl(
      ENDPOINT,
      createMockTokenProvider(),
      asFetchFn(fetchFn),
    );

    const result = await service.list({
      target: " npm:express@5.2.1 ",
      paths: [],
      recursive: false,
      fileTypes: [],
      languages: ["TypeScript"],
      intents: [],
      limit: 0,
      after: "",
      waitTimeoutMs: 0,
      includeDetailedFields: false,
    });

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const request = readRequest(fetchFn);
    expect(request.variables).toEqual({
      target: " npm:express@5.2.1 ",
      paths: [],
      recursive: false,
      fileTypes: [],
      languages: ["TypeScript"],
      intents: [],
      limit: 0,
      after: "",
      waitTimeoutMs: 0,
      includeDetailedFields: false,
    });
    expect(request.query).toContain("query List(");
    expect(request.query).toContain("list(");
    expect(request.query).not.toContain("listRepoFiles");
    expect(request.query).not.toMatch(
      /^\s+(content|body|snippet|sections)\s*$/m,
    );
    expect(parseListSelection(request.query)).toEqual(expectedListSelection());
    expect(result.entries[0]).toEqual({
      kind: "FILE",
      path: "src/index.ts",
      read: {
        target: "github:expressjs/express@abc123",
        path: "src/a%2Fb.ts",
      },
    });
    expect(result.entries[1]?.browse).toEqual({
      target: "npm:express@5.2.1",
      paths: ["src/\\*"],
    });
  });

  it("wire projection parses detailed resolution and site lifecycle fields", async () => {
    let capturedBody = "";
    const fetchFn = mock((_url: string, init?: RequestInit) => {
      capturedBody = String(init?.body);
      return Promise.resolve(
        jsonResponse(
          successBody({
            inventoryKind: "SITE",
            requestedTarget: "site:docs.example.test",
            canonicalTarget: null,
            entries: [
              {
                kind: "PAGE",
                path: "docs.example.test/api%2Fv1",
                title: "API",
                language: null,
                fileType: null,
                intent: null,
                byteSize: null,
                lineCount: null,
                contentHash: null,
                read: {
                  target: "https://docs.example.test/api%2Fv1?lang=en#part",
                  path: null,
                  paths: null,
                },
                browse: {
                  target: "site:docs.example.test",
                  path: null,
                  paths: ["docs.example.test/api%2Fv1"],
                },
              },
            ],
            hasMore: true,
            nextCursor: " opaque/cursor= ",
            indexedVersion: null,
            resolution: {
              requestedVersion: null,
              requestedRef: null,
              resolvedRef: null,
              commitSha: null,
            },
            targetResolution: null,
            codeIndexState: null,
            indexingStatus: null,
            indexingRef: null,
            availableVersions: null,
            indexingEstimate: null,
            inventoryState: "AVAILABLE",
            crawlStatus: "RUNNING",
            coverageState: "PARTIAL",
            coverageReason: "refresh_pending",
            preparation: {
              selected: 2,
              enqueued: 1,
              activeJobs: [{ mode: "incremental_recrawl", state: "RUNNING" }],
              awaited: [{ mode: null, outcome: "TIMEOUT" }],
            },
          }),
        ),
      );
    });
    const service = new ListServiceImpl(
      ENDPOINT,
      createMockTokenProvider(),
      asFetchFn(fetchFn),
    );

    const result = await service.list({
      target: "site:docs.example.test",
      includeDetailedFields: true,
    });
    const request = JSON.parse(capturedBody) as {
      query: string;
      variables: Record<string, unknown>;
    };

    expect(request.variables).toEqual({
      target: "site:docs.example.test",
      includeDetailedFields: true,
    });
    expect(parseListSelection(request.query)).toEqual(expectedListSelection());
    expect(result).toMatchObject({
      inventoryKind: "SITE",
      requestedTarget: "site:docs.example.test",
      hasMore: true,
      nextCursor: " opaque/cursor= ",
      inventoryState: "AVAILABLE",
      crawlStatus: "RUNNING",
      coverageState: "PARTIAL",
      coverageReason: "refresh_pending",
      preparation: {
        selected: 2,
        enqueued: 1,
        activeJobs: [{ mode: "incremental_recrawl", state: "RUNNING" }],
        awaited: [{ outcome: "TIMEOUT" }],
      },
      entries: [
        {
          kind: "PAGE",
          path: "docs.example.test/api%2Fv1",
          title: "API",
          read: {
            target: "https://docs.example.test/api%2Fv1?lang=en#part",
          },
          browse: {
            target: "site:docs.example.test",
            paths: ["docs.example.test/api%2Fv1"],
          },
        },
      ],
    });
    expect(result.canonicalTarget).toBeUndefined();
    expect(result.preparation?.awaited[0]?.mode).toBeUndefined();
  });

  it("wire projection rejects hasMore without a nonempty cursor", async () => {
    const fetchFn = mock(() =>
      Promise.resolve(
        jsonResponse(successBody({ hasMore: true, nextCursor: "" })),
      ),
    );
    const service = new ListServiceImpl(
      ENDPOINT,
      createMockTokenProvider(),
      asFetchFn(fetchFn),
    );

    await expect(
      service.list({
        target: "github:expressjs/express",
        includeDetailedFields: false,
      }),
    ).rejects.toBeInstanceOf(MalformedListResponseError);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("wire projection returns detailed source resolution and indexing metadata", async () => {
    const fetchFn = mock(() =>
      Promise.resolve(
        jsonResponse(
          successBody({
            resolution: {
              requestedVersion: "^5.2",
              requestedRef: null,
              resolvedRef: "v5.2.1",
              commitSha: "abc123",
            },
            targetResolution: {
              requested: {
                kind: "package_exact_version",
                registry: "npm",
                packageName: "express",
                version: "5.2.1",
                repoUrl: null,
                gitRef: null,
                commitSha: null,
              },
              resolvedRequested: null,
              served: {
                kind: "package_exact_version",
                registry: "npm",
                packageName: "express",
                version: "5.2.1",
                repoUrl: "https://github.com/expressjs/express",
                gitRef: "v5.2.1",
                commitSha: "abc123",
              },
              freshness: "current",
              freshnessReason: "exact_current",
              indexingRef: null,
              availableVersions: [{ version: "5.2.1", ref: "v5.2.1" }],
              availableRefs: [{ version: null, ref: "v5.2.1" }],
              suggestedRefs: [{ version: null, ref: "v5.2.2" }],
            },
            availableVersions: [{ version: "5.2.1", ref: "v5.2.1" }],
            indexingEstimate: {
              lowerSeconds: 3,
              upperSeconds: 8,
              elapsedSeconds: 1,
              sampleCount: 5,
              source: "same_repository_refs",
            },
          }),
        ),
      ),
    );
    const service = new ListServiceImpl(
      ENDPOINT,
      createMockTokenProvider(),
      asFetchFn(fetchFn),
    );

    const result = await service.list({
      target: "npm:express@5.2.1",
      includeDetailedFields: true,
    });
    expect(result.resolution).toEqual({
      requestedVersion: "^5.2",
      resolvedRef: "v5.2.1",
      commitSha: "abc123",
    });
    expect(result.targetResolution).toEqual({
      requested: {
        kind: "package_exact_version",
        registry: "npm",
        packageName: "express",
        version: "5.2.1",
      },
      served: {
        kind: "package_exact_version",
        registry: "npm",
        packageName: "express",
        version: "5.2.1",
        repoUrl: "https://github.com/expressjs/express",
        gitRef: "v5.2.1",
        commitSha: "abc123",
      },
      freshness: "current",
      freshnessReason: "exact_current",
      availableVersions: [{ version: "5.2.1", ref: "v5.2.1" }],
      availableRefs: [{ ref: "v5.2.1" }],
      suggestedRefs: [{ ref: "v5.2.2" }],
    });
    expect(result.indexingEstimate).toEqual({
      lowerSeconds: 3,
      upperSeconds: 8,
      elapsedSeconds: 1,
      sampleCount: 5,
      source: "same_repository_refs",
    });
  });

  it("GraphQL errors preserve scope recovery fields and generic metadata", async () => {
    const responses = [
      {
        message: "Package scope could not be certified",
        extensions: {
          code: "SOURCE_INVENTORY_SCOPE_UNAVAILABLE",
          retryable: false,
          repo_url: "https://github.com/expressjs/express",
          commit_sha: "abc123",
          indexing_ref: "idx-1",
          hint: "Use repository scope only if acceptable.",
        },
      },
      {
        message: "Package scope could not be certified",
        extensions: {
          code: "SOURCE_INVENTORY_SCOPE_UNAVAILABLE",
          retryable: true,
        },
      },
      {
        message: "Package scope could not be certified",
        extensions: {
          code: "SOURCE_INVENTORY_SCOPE_UNAVAILABLE",
          retryable: false,
          repo_url: "https://github.com/expressjs/express",
        },
      },
      {
        message: "Still indexing",
        extensions: {
          code: "PACKAGE_INDEXING",
          retryable: true,
          indexing_ref: "idx-2",
        },
      },
      {
        message: "Unclassified failure",
        extensions: { code: "INTERNAL_ERROR", retryable: true },
      },
    ];

    for (const error of responses) {
      const fetchFn = mock(() =>
        Promise.resolve(jsonResponse({ errors: [error] })),
      );
      const service = new ListServiceImpl(
        ENDPOINT,
        createMockTokenProvider(),
        asFetchFn(fetchFn),
      );
      let thrown: unknown;
      try {
        await service.list({
          target: "npm:express",
          includeDetailedFields: false,
        });
      } catch (errorValue) {
        thrown = errorValue;
      }
      expect(thrown).toBeInstanceOf(ListGraphQLError);
      expect(fetchFn).toHaveBeenCalledTimes(1);
      const request = readRequest(fetchFn);
      expect(request.query).not.toContain("listRepoFiles");
      expect(request.variables.target).toBe("npm:express");
      if (error.extensions?.code === "SOURCE_INVENTORY_SCOPE_UNAVAILABLE") {
        const graphQLError = thrown as ListGraphQLError;
        expect(graphQLError.message).toBe(error.message);
        expect(graphQLError.code).toBe("SOURCE_INVENTORY_SCOPE_UNAVAILABLE");
        expect(graphQLError.retryable).toBe(error.extensions.retryable);
        if (typeof error.extensions.repo_url === "string") {
          expect(graphQLError.repoUrl).toBe(error.extensions.repo_url);
          expect(graphQLError.commitSha).toBe(
            typeof error.extensions.commit_sha === "string"
              ? error.extensions.commit_sha
              : undefined,
          );
        } else {
          expect(graphQLError.repoUrl).toBeUndefined();
          expect(graphQLError.commitSha).toBeUndefined();
        }
        expect(graphQLError.indexingRef).toBe(
          error.extensions.indexing_ref ?? undefined,
        );
        expect(graphQLError.hint).toBe(error.extensions.hint ?? undefined);
      } else {
        const graphQLError = thrown as ListGraphQLError;
        expect(graphQLError.code).toBe(error.extensions.code);
        expect(graphQLError.retryable).toBe(error.extensions.retryable);
        expect(graphQLError.indexingRef).toBe(
          error.extensions.indexing_ref ?? undefined,
        );
      }
    }
  });

  it("service failures refresh authentication and classify transport, HTTP, schema, and malformed responses", async () => {
    const getToken = mock(() => Promise.resolve("initial-token"));
    const forceRefresh = mock(() => Promise.resolve("refreshed-token"));
    const authHeaders: string[] = [];
    const authFetch = mock((_url: string, init?: RequestInit) => {
      authHeaders.push(new Headers(init?.headers).get("Authorization") ?? "");
      if (authFetch.mock.calls.length === 1) {
        return Promise.resolve(
          jsonResponse({
            errors: [
              {
                message: "Unauthorized",
                extensions: { code: "UNAUTHORIZED" },
              },
            ],
          }),
        );
      }
      return Promise.resolve(jsonResponse(successBody()));
    });
    const authService = new ListServiceImpl(
      ENDPOINT,
      createMockTokenProvider({ getToken, forceRefresh }),
      asFetchFn(authFetch),
    );
    await authService.list({
      target: "npm:express",
      includeDetailedFields: false,
    });
    expect(getToken).toHaveBeenCalledTimes(1);
    expect(forceRefresh).toHaveBeenCalledTimes(1);
    expect(authFetch).toHaveBeenCalledTimes(2);
    expect(authHeaders).toEqual([
      "Bearer initial-token",
      "Bearer refreshed-token",
    ]);

    const httpAuthRefresh = mock(() => Promise.resolve("http-refreshed-token"));
    const httpAuthFetch = mock(() =>
      Promise.resolve(
        httpAuthFetch.mock.calls.length === 1
          ? jsonResponse({}, 401)
          : jsonResponse(successBody()),
      ),
    );
    const httpAuthService = new ListServiceImpl(
      ENDPOINT,
      createMockTokenProvider({ forceRefresh: httpAuthRefresh }),
      asFetchFn(httpAuthFetch),
    );
    await httpAuthService.list({
      target: "npm:express",
      includeDetailedFields: false,
    });
    expect(httpAuthRefresh).toHaveBeenCalledTimes(1);
    expect(httpAuthFetch).toHaveBeenCalledTimes(2);

    const transportService = new ListServiceImpl(
      ENDPOINT,
      createMockTokenProvider(),
      asFetchFn(mock(() => Promise.reject(new Error("socket down")))),
    );
    await expect(
      transportService.list({
        target: "npm:express",
        includeDetailedFields: false,
      }),
    ).rejects.toBeInstanceOf(ListNetworkError);

    const deniedService = new ListServiceImpl(
      ENDPOINT,
      createMockTokenProvider(),
      asFetchFn(mock(() => Promise.resolve(jsonResponse({}, 403)))),
    );
    await expect(
      deniedService.list({
        target: "npm:express",
        includeDetailedFields: false,
      }),
    ).rejects.toBeInstanceOf(ListAccessError);

    const backendService = new ListServiceImpl(
      ENDPOINT,
      createMockTokenProvider(),
      asFetchFn(mock(() => Promise.resolve(jsonResponse({}, 502)))),
    );
    await expect(
      backendService.list({
        target: "npm:express",
        includeDetailedFields: false,
      }),
    ).rejects.toMatchObject({
      constructor: ListBackendError,
      status: 502,
    });

    const schemaMessage = 'Cannot query field "list" on type "Query".';
    const schemaResponse = {
      errors: [
        {
          message: schemaMessage,
          extensions: { code: "GRAPHQL_VALIDATION_FAILED" },
        },
      ],
    };
    const safeSchemaService = new ListServiceImpl(
      ENDPOINT,
      createMockTokenProvider(),
      asFetchFn(mock(() => Promise.resolve(jsonResponse(schemaResponse)))),
    );
    let safeSchemaError: unknown;
    try {
      await safeSchemaService.list({
        target: "npm:express",
        includeDetailedFields: false,
      });
    } catch (error) {
      safeSchemaError = error;
    }
    expect(safeSchemaError).toBeInstanceOf(ListBackendError);
    expect((safeSchemaError as Error).message).not.toContain(schemaMessage);
    expect((safeSchemaError as Error).message).toContain(
      "Backend protocol mismatch",
    );

    const wireSchemaService = new ListServiceImpl(
      ENDPOINT,
      createMockTokenProvider(),
      asFetchFn(mock(() => Promise.resolve(jsonResponse(schemaResponse)))),
      { diagnostics: diagnosticRuntime("code-nav-wire") },
    );
    await expect(
      wireSchemaService.list({
        target: "npm:express",
        includeDetailedFields: false,
      }),
    ).rejects.toMatchObject({ message: schemaMessage });

    const updateService = new ListServiceImpl(
      ENDPOINT,
      createMockTokenProvider(),
      asFetchFn(
        mock(() =>
          Promise.resolve(
            jsonResponse({
              errors: [
                {
                  message: "Update required",
                  extensions: { code: "CLIENT_UPDATE_REQUIRED" },
                },
              ],
            }),
          ),
        ),
      ),
      { clientVersion: "1.2.3" },
    );
    await expect(
      updateService.list({
        target: "npm:express",
        includeDetailedFields: false,
      }),
    ).rejects.toBeInstanceOf(ClientUpdateRequiredError);

    const malformedService = new ListServiceImpl(
      ENDPOINT,
      createMockTokenProvider(),
      asFetchFn(mock(() => Promise.resolve(jsonResponse({ data: null })))),
    );
    await expect(
      malformedService.list({
        target: "npm:express",
        includeDetailedFields: false,
      }),
    ).rejects.toBeInstanceOf(MalformedListResponseError);
  });

  it("service failures reject empty nextCursor when hasMore is true", async () => {
    const fetchFn = mock(() =>
      Promise.resolve(
        jsonResponse(successBody({ hasMore: true, nextCursor: null })),
      ),
    );
    const service = new ListServiceImpl(
      ENDPOINT,
      createMockTokenProvider(),
      asFetchFn(fetchFn),
    );
    await expect(
      service.list({ target: "npm:express", includeDetailedFields: false }),
    ).rejects.toBeInstanceOf(MalformedListResponseError);
  });
});

function expectedListSelection(): SelectionTree {
  const includeDetailed = "@include(if:$includeDetailedFields)";
  const detailed = (selection?: SelectionTree) => ({
    __directive: includeDetailed,
    ...(selection ? { __selection: selection } : {}),
  });
  const identity = {
    kind: null,
    registry: null,
    packageName: null,
    version: null,
    repoUrl: null,
    gitRef: null,
    commitSha: null,
  };
  return {
    inventoryKind: null,
    requestedTarget: null,
    canonicalTarget: null,
    entries: {
      kind: null,
      path: null,
      title: null,
      language: detailed(),
      fileType: detailed(),
      intent: detailed(),
      byteSize: detailed(),
      lineCount: detailed(),
      contentHash: detailed(),
      read: { target: null, path: null },
      browse: { target: null, paths: null },
    },
    hasMore: null,
    nextCursor: null,
    indexedVersion: null,
    resolution: detailed({
      requestedVersion: null,
      requestedRef: null,
      resolvedRef: null,
      commitSha: null,
    }),
    targetResolution: detailed({
      requested: identity,
      resolvedRequested: identity,
      served: identity,
      freshness: null,
      freshnessReason: null,
      indexingRef: null,
      availableVersions: { version: null, ref: null },
      availableRefs: { version: null, ref: null },
      suggestedRefs: { version: null, ref: null },
    }),
    codeIndexState: null,
    indexingStatus: null,
    indexingRef: null,
    availableVersions: detailed({ version: null, ref: null }),
    indexingEstimate: detailed({
      lowerSeconds: null,
      upperSeconds: null,
      elapsedSeconds: null,
      sampleCount: null,
      source: null,
    }),
    inventoryState: null,
    crawlStatus: null,
    coverageState: null,
    coverageReason: null,
    preparation: {
      selected: null,
      enqueued: null,
      activeJobs: { mode: null, state: null },
      awaited: { mode: null, outcome: null },
    },
  };
}
