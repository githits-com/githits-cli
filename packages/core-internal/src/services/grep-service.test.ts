import { describe, expect, it, mock, spyOn } from "bun:test";
import { FetchTimeoutError } from "../shared/fetch-timeout.js";
import { TermsAcceptanceRequiredError } from "../shared/terms-acceptance.js";
import { ClientUpdateRequiredError } from "./client-update-required-error.js";
import { AuthenticationError } from "./githits-service.js";
import {
  GrepAccessError,
  GrepBackendError,
  GrepGraphQLError,
  GrepNetworkError,
  type GrepParams,
  type GrepResult,
  GrepServiceImpl,
  MalformedGrepResponseError,
  parseGrepResult,
} from "./grep-service.js";
import { createMockTokenProvider } from "./test-helpers.js";

const params: GrepParams = {
  targets: [{ target: "npm:x", corpus: "ALL", allowUnscoped: true }],
  pattern: "router",
  patternType: "REGEX",
  caseSensitive: true,
  contextLinesBefore: 0,
  contextLinesAfter: 0,
  includeDetailedFields: false,
};
function result(): GrepResult {
  return {
    hits: [],
    targets: [],
    unavailableTargets: [],
    traversal: "COMPLETE",
    nextCursor: null,
    totalMatches: 0,
  };
}
function response(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
function service(
  fetcher: (...args: Parameters<typeof fetch>) => Promise<Response>,
): GrepServiceImpl {
  return new GrepServiceImpl(
    "https://example.test",
    createMockTokenProvider(),
    fetcher as typeof fetch,
  );
}
const safety = { filtered: false };
const slice = {
  content: "router",
  startByte: 0,
  endByte: 6,
  originalLineBytes: 6,
};
function mixed(): GrepResult {
  return {
    ...result(),
    totalMatches: 2,
    hits: [
      {
        __typename: "GrepRepositoryHit",
        targetIndex: 0,
        filePath: "lib/a.ts",
        line: 2,
        lineSlice: slice,
        contextBeforeSlices: [],
        contextAfterSlices: [],
        read: {
          target: "github:o/r@sha",
          path: "packages/x/lib/a.ts",
          startLine: 2,
          endLine: 2,
        },
        contentSafety: safety,
        matchStartByte: 0,
        matchEndByte: 6,
      },
      {
        __typename: "GrepSiteHit",
        targetIndex: 1,
        pageUrl: "https://docs.test/page",
        line: 3,
        lineSlice: slice,
        contextBeforeSlices: [],
        contextAfterSlices: [],
        read: {
          target: "https://docs.test/page",
          path: null,
          startLine: 3,
          endLine: 3,
        },
        contentSafety: safety,
        matchStartByte: 0,
        matchEndByte: 6,
      },
    ],
    targets: [0, 1].map((targetIndex) => ({
      targetIndex,
      requestedInputIndices: [0],
      kind: targetIndex === 0 ? ("REPOSITORY" as const) : ("SITE" as const),
      target: "scope",
      traversal: "COMPLETE" as const,
      readiness: "CURRENT" as const,
      errorCode: null,
      retryable: false,
      publicMessage: null,
      requestedRef: null,
      commitSha: targetIndex === 0 ? "sha" : null,
      corpus: targetIndex === 0 ? ("ALL" as const) : null,
      filesScanned: null,
      filesInScope: null,
      binaryFilesSkipped: null,
      filesTooLargeSkipped: null,
      fileIssues: null,
      fileIssuesOmitted: null,
      repoUrl: targetIndex === 0 ? "https://github.com/o/r" : null,
      canonicalSite: targetIndex === 0 ? null : "https://docs.test",
    })),
  };
}

function detailedMixed(): GrepResult {
  const data = mixed();
  for (const hit of data.hits) {
    Object.assign(hit, {
      lineContent: "router",
      matchStartByte: 0,
      matchEndByte: 6,
      sourceMatchStartByte: 5,
      sourceMatchEndByte: 11,
      contentSafety: { filtered: false, modifications: [] },
    });
    if (hit.__typename === "GrepRepositoryHit")
      Object.assign(hit, {
        repoUrl: "https://github.com/o/r",
        commitSha: "sha",
        repositoryFilePath: "packages/x/lib/a.ts",
      });
  }
  for (const target of data.targets)
    Object.assign(target, {
      urlPrefixes: [],
    });
  return data;
}

describe("unified grep service", () => {
  for (const detailed of [false, true]) {
    it(`requires selected source identities in ${detailed ? "detailed" : "compact"} mode`, () => {
      const data = detailed ? detailedMixed() : mixed();
      const parsed = parseGrepResult(data, detailed);
      expect(parsed).toEqual(data);
      expect(parsed.targets[0]?.canonicalSite).toBeNull();
      expect(parsed.targets[1]?.repoUrl).toBeNull();
      expect(parsed.targets[1]?.canonicalSite).toBe("https://docs.test");
      for (const field of ["repoUrl", "canonicalSite"] as const) {
        const missing = structuredClone(data);
        Reflect.deleteProperty(missing.targets[0]!, field);
        expect(() => parseGrepResult(missing, detailed)).toThrow(
          MalformedGrepResponseError,
        );
        const malformed = structuredClone(data);
        Object.assign(malformed.targets[0]!, { [field]: 42 });
        expect(() => parseGrepResult(malformed, detailed)).toThrow(
          MalformedGrepResponseError,
        );
      }
    });
    it(`rejects read paths incompatible with the hit kind in ${detailed ? "detailed" : "compact"} mode`, () => {
      const data = detailed ? detailedMixed() : mixed();
      expect(parseGrepResult(data, detailed)).toEqual(data);
      for (const kind of ["GrepRepositoryHit", "GrepSiteHit"]) {
        const malformed = structuredClone(data);
        const hit = malformed.hits.find((hit) => hit.__typename === kind)!;
        Object.assign(hit.read, {
          path: kind === "GrepRepositoryHit" ? null : "unexpected.ts",
        });
        expect(() => parseGrepResult(malformed, detailed)).toThrow(
          MalformedGrepResponseError,
        );
      }
    });
    it(`preserves an unvisited scope on a ${detailed ? "detailed" : "compact"} one-match page and its visited continuation`, () => {
      const first = detailed ? detailedMixed() : mixed();
      first.hits = [first.hits[0]!];
      first.totalMatches = 1;
      first.traversal = "RESUMABLE_LIMIT";
      first.nextCursor = "page-two";
      Object.assign(first.targets[1]!, {
        readiness: "UNSPECIFIED",
        traversal: "RESUMABLE_LIMIT",
        requestedInputIndices: [0, 1],
      });
      const second = detailed ? detailedMixed() : mixed();
      second.hits = [second.hits[1]!];
      second.totalMatches = 1;
      second.targets[1]!.requestedInputIndices = [0, 1];
      expect(parseGrepResult(first, detailed)).toEqual(first);
      expect(parseGrepResult(second, detailed)).toEqual(second);
      expect(first.targets[1]!.errorCode).toBeNull();
      expect(first.unavailableTargets).toEqual([]);
    });
  }
  it("allows the advertised preparation wait before the transport deadline", async () => {
    const timeout = spyOn(AbortSignal, "timeout").mockImplementation(
      (milliseconds: number) => {
        expect(milliseconds).toBeGreaterThan(300_000);
        return new AbortController().signal;
      },
    );
    try {
      await service(async () => response({ data: { grep: result() } })).grep({
        ...params,
        waitTimeoutMs: 300_000,
      });
      expect(timeout).toHaveBeenCalledTimes(1);
    } finally {
      timeout.mockRestore();
    }
  });
  it("sends one grep page with exact controls and conditional detail selections", async () => {
    const fetcher = mock(
      async (_url: Parameters<typeof fetch>[0], init?: RequestInit) => {
        const body = JSON.parse(String(init?.body));
        expect(body.variables).toEqual({
          ...params,
          caseSensitive: false,
          waitTimeoutMs: 0,
          cursor: "opaque",
        });
        expect(body.query).toContain("grep(targets: $targets");
        expect(body.query).not.toContain("grepRepo(");
        for (const field of [
          "lineContent",
          "sourceMatchStartByte",
          "repoUrl",
          "lineBytes",
          "modifications",
          "urlPrefixes",
        ])
          expect(body.query).toContain(
            `${field} @include(if: $includeDetailedFields)`,
          );
        expect(
          body.query.match(
            /read: readTarget \{ target path startLine endLine \}/g,
          ),
        ).toHaveLength(2);
        expect(body.query).not.toContain(
          "read { target path startLine endLine }",
        );
        const scopeSelection = body.query
          .split("targets {")[1]
          .split("fileIssues {")[0];
        expect(scopeSelection).toContain("repoUrl canonicalSite");
        expect(scopeSelection).not.toContain("repoUrl @include");
        expect(scopeSelection).not.toContain("canonicalSite @include");
        expect(scopeSelection).toContain(
          "urlPrefixes @include(if: $includeDetailedFields)",
        );
        expect(body.query).toContain("fragment LineSlice on GrepRepoLineSlice");
        for (const fragment of ["RepositoryMatch", "SiteMatch"]) {
          const selection = body.query
            .split(`fragment ${fragment} on `)[1]
            .split("\n}")[0];
          expect(selection).toContain("matchStartByte matchEndByte");
          expect(selection).not.toContain("matchStartByte @include");
          expect(selection).not.toContain("matchEndByte @include");
          expect(selection).toContain(
            "sourceMatchStartByte @include(if: $includeDetailedFields)",
          );
        }
        return response({ data: { grep: mixed() } });
      },
    );
    const out = await service(fetcher).grep({
      ...params,
      caseSensitive: false,
      waitTimeoutMs: 0,
      cursor: "opaque",
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(out).toEqual(mixed());
    expect(out.hits[0]?.lineContent).toBeUndefined();
    expect(out.hits[1]?.read.path).toBeNull();
  });
  it("requires all selected detail fields and preserves nulls and both coordinate systems", async () => {
    const data = detailedMixed();
    const fetcher = mock(
      async (_url: Parameters<typeof fetch>[0], init?: RequestInit) => {
        expect(
          JSON.parse(String(init?.body)).variables.includeDetailedFields,
        ).toBe(true);
        return response({ data: { grep: data } });
      },
    );
    expect(
      await service(fetcher).grep({ ...params, includeDetailedFields: true }),
    ).toEqual(data);
    delete data.hits[0]?.lineContent;
    await expect(
      service(async () => response({ data: { grep: data } })).grep({
        ...params,
        includeDetailedFields: true,
      }),
    ).rejects.toBeInstanceOf(MalformedGrepResponseError);
  });
  it("rejects malformed unions, missing statuses, missing continuations and non-JSON responses", async () => {
    for (const data of [
      { ...mixed(), hits: [{ ...mixed().hits[0], __typename: "UnknownHit" }] },
      { ...mixed(), targets: [] },
      {
        ...mixed(),
        targets: mixed().targets.map((target) => ({
          ...target,
          readiness: "UNKNOWN_READINESS",
        })),
      },
      { ...result(), traversal: "RESUMABLE_LIMIT", nextCursor: null },
      { ...result(), totalMatches: "0" },
    ])
      await expect(
        service(async () => response({ data: { grep: data } })).grep(params),
      ).rejects.toBeInstanceOf(MalformedGrepResponseError);
    await expect(
      service(async () => new Response("invalid json")).grep(params),
    ).rejects.toBeInstanceOf(MalformedGrepResponseError);
  });
  for (const detailed of [false, true]) {
    for (const kind of ["GrepRepositoryHit", "GrepSiteHit"]) {
      it(`validates native UTF-8 display coordinates for ${kind} in ${detailed ? "detailed" : "compact"} mode`, () => {
        const data = detailed ? detailedMixed() : mixed();
        const matchingHit = data.hits.find((hit) => hit.__typename === kind)!;
        Object.assign(matchingHit, {
          lineSlice: {
            content: "界router",
            startByte: 0,
            endByte: 9,
            originalLineBytes: 9,
          },
          matchStartByte: 3,
          matchEndByte: 9,
          ...(detailed ? { lineContent: "界router" } : {}),
        });
        expect(parseGrepResult(data, detailed)).toEqual(data);
        for (const [start, end] of [
          [1, 9],
          [0, 1],
          [3, 10],
          [9, 3],
          [3, 4],
        ]) {
          const malformed = structuredClone(data);
          const hit = malformed.hits.find((hit) => hit.__typename === kind)!;
          // Last pair is valid: ASCII ends need not be grapheme boundaries.
          Object.assign(hit, { matchStartByte: start, matchEndByte: end });
          if (start === 3 && end === 4)
            expect(parseGrepResult(malformed, detailed)).toEqual(malformed);
          else
            expect(() => parseGrepResult(malformed, detailed)).toThrow(
              MalformedGrepResponseError,
            );
        }
        for (const field of ["matchStartByte", "matchEndByte"]) {
          const malformed = structuredClone(data);
          const hit = malformed.hits.find((hit) => hit.__typename === kind)!;
          Reflect.deleteProperty(hit, field);
          expect(() => parseGrepResult(malformed, detailed)).toThrow(
            MalformedGrepResponseError,
          );
        }
        const zeroWidth = structuredClone(data);
        Object.assign(zeroWidth.hits.find((hit) => hit.__typename === kind)!, {
          matchEndByte: 3,
        });
        expect(parseGrepResult(zeroWidth, detailed)).toEqual(zeroWidth);
        matchingHit.contentSafety.filtered = true;
        matchingHit.matchEndByte = 99;
        expect(() => parseGrepResult(data, detailed)).toThrow(
          MalformedGrepResponseError,
        );
      });
    }
  }
  it("returns cursor-expired and partial pages with sibling hits and omissions unchanged", async () => {
    const data = {
      ...mixed(),
      traversal: "CURSOR_EXPIRED" as const,
      unavailableTargets: [
        {
          inputIndex: 0,
          target: "npm:x",
          reason: "documentation_site_no_docs",
          retryable: false,
          progressRef: null,
          suggestedSiteTargets: null,
        },
      ],
    };
    expect(
      await service(async () => response({ data: { grep: data } })).grep(
        params,
      ),
    ).toEqual(data);
  });
  it("retains typed preparation extensions and performs no fallback or retry", async () => {
    const extensions = {
      code: "GREP_TARGET_PREPARATION_REQUIRED",
      retryable: true,
      target_issues: [
        {
          input_index: 0,
          reason: "repository_indexing",
          progress_ref: "index:1",
          retryable: true,
        },
      ],
    };
    const fetcher = mock(async () =>
      response({ errors: [{ message: "Targets not ready", extensions }] }),
    );
    try {
      await service(fetcher).grep(params);
      throw new Error("Expected failure");
    } catch (error) {
      expect(error).toBeInstanceOf(GrepGraphQLError);
      expect((error as GrepGraphQLError).extensions).toEqual(extensions);
    }
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("refreshes authentication once using the injected provider", async () => {
    const forceRefresh = mock(async () => "mock-refreshed");
    const fetcher = mock(async () =>
      response(
        fetcher.mock.calls.length === 1
          ? {
              errors: [
                {
                  message: "unauthorized",
                  extensions: { code: "UNAUTHORIZED" },
                },
              ],
            }
          : { data: { grep: result() } },
      ),
    );
    await new GrepServiceImpl(
      "https://example.test",
      createMockTokenProvider({ forceRefresh }),
      fetcher as unknown as typeof fetch,
    ).grep(params);
    expect(forceRefresh).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
    await expect(
      service(async () => response({}, 401)).grep(params),
    ).rejects.toBeInstanceOf(AuthenticationError);
  });
  it("classifies HTTP, transport, timeout, terms and client-update failures", async () => {
    await expect(
      service(async () => response({}, 403)).grep(params),
    ).rejects.toBeInstanceOf(GrepAccessError);
    await expect(
      service(async () => response({}, 502)).grep(params),
    ).rejects.toBeInstanceOf(GrepBackendError);
    await expect(
      service(async () => {
        throw new Error("socket down");
      }).grep(params),
    ).rejects.toBeInstanceOf(GrepNetworkError);
    await expect(
      service(async () => {
        throw new FetchTimeoutError(1000);
      }).grep(params),
    ).rejects.toMatchObject({ graphqlCode: "TIMEOUT", retryable: true });
    await expect(
      service(async () =>
        response({
          errors: [
            {
              message: "terms",
              extensions: { code: "TERMS_ACCEPTANCE_REQUIRED" },
            },
          ],
        }),
      ).grep(params),
    ).rejects.toBeInstanceOf(TermsAcceptanceRequiredError);
    await expect(
      service(async () =>
        response({
          errors: [
            {
              message: "update",
              extensions: { code: "CLIENT_UPDATE_REQUIRED" },
            },
          ],
        }),
      ).grep(params),
    ).rejects.toBeInstanceOf(ClientUpdateRequiredError);
    await expect(
      service(async () =>
        response({
          errors: [{ message: 'Cannot query field "grep" on type "Query".' }],
        }),
      ).grep(params),
    ).rejects.toMatchObject({ name: "GrepBackendError", retryable: false });
  });
  it("defers malformed endpoint validation until the network operation", async () => {
    const s = new GrepServiceImpl("invalid", createMockTokenProvider());
    await expect(s.grep(params)).rejects.toThrow();
  });
});
