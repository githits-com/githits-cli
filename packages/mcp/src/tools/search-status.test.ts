import { describe, expect, it, mock } from "bun:test";
import type {
  UnifiedSearchIncomplete,
  UnifiedSearchProgress,
  UnifiedSearchSessionStatus,
} from "@githits/core-internal";
import { AuthenticationError } from "@githits/core-internal";
import {
  createMockCodeNavigationService,
  defaultUnifiedSearchOutcome,
  documentationContributorOutcome,
} from "../services/test-helpers.js";
import { createSearchStatusTool } from "./search-status.js";

describe("searchStatusTool", () => {
  function createIncompleteOutcome(
    status: UnifiedSearchSessionStatus,
    searchRef: string,
    progressOverrides: Partial<UnifiedSearchProgress> = {},
  ): UnifiedSearchIncomplete {
    return {
      state: "incomplete",
      completed: false,
      searchRef,
      progress: {
        searchRef,
        status,
        targetsTotal: 1,
        targetsReady: 0,
        elapsedMs: 100,
        query: "router",
        queryWarnings: [],
        sources: ["CODE"],
        ...progressOverrides,
      },
    };
  }

  it("returns incomplete progress payload while search is still running", async () => {
    const tool = createSearchStatusTool(
      createMockCodeNavigationService({
        searchStatus: mock(() =>
          Promise.resolve(
            createIncompleteOutcome("SEARCHING", "search-ref-123"),
          ),
        ),
      }),
    );

    const result = await tool.handler(
      { search_ref: "search-ref-123", format: "json" },
      {},
    );

    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0]?.text ?? "{}")).toEqual({
      completed: false,
      searchRef: "search-ref-123",
      progress: expect.objectContaining({ status: "SEARCHING" }),
    });
    expect(JSON.parse(result.content[0]?.text ?? "{}")).not.toHaveProperty(
      "partialResults",
    );
  });

  it("preserves provisional hits and the search reference for continuation", async () => {
    if (defaultUnifiedSearchOutcome.state !== "completed") {
      throw new Error("expected completed outcome fixture");
    }
    const incomplete = createIncompleteOutcome(
      "INDEXING",
      "search-ref-provisional",
      { targetsReady: 1 },
    );
    incomplete.result = {
      ...defaultUnifiedSearchOutcome.result,
      sourceStatus: [
        {
          ...defaultUnifiedSearchOutcome.result.sourceStatus[0]!,
          codeIndexState: "PROVISIONAL",
          targetResolution: {
            served: {
              repoUrl: "https://github.com/foo/bar",
              gitRef: "main",
              commitSha: "abc123789def",
            },
            freshness: "provisional",
            freshnessReason: "exact_provisional",
            indexingRef: "idx_123",
            availableVersions: [],
            availableRefs: [],
          },
        },
      ],
    };
    const tool = createSearchStatusTool(
      createMockCodeNavigationService({
        searchStatus: mock(() => Promise.resolve(incomplete)),
      }),
    );

    const json = await tool.handler(
      { search_ref: incomplete.searchRef, format: "json" },
      {},
    );
    const payload = JSON.parse(json.content[0]?.text ?? "{}");
    expect(payload).toMatchObject({
      completed: false,
      searchRef: "search-ref-provisional",
      result: {
        results: [{ type: "repository_code" }],
        partialResults: false,
        sourceStatus: [
          {
            codeIndexState: "PROVISIONAL",
            targetResolution: {
              freshness: "provisional",
              freshnessReason: "exact_provisional",
              indexingRef: "idx_123",
            },
          },
        ],
      },
    });

    const text = await tool.handler({ search_ref: incomplete.searchRef }, {});
    expect(text.content[0]?.text).toContain(
      "Indexing: provisional snapshot is searchable",
    );
    expect(text.content[0]?.text).toContain(
      'Next: search_status search_ref="search-ref-provisional" wait_timeout_ms=20000',
    );
    expect(text.content[0]?.text).not.toContain("indexingRef");
  });

  it("describes partial-result follow-up behavior", () => {
    const tool = createSearchStatusTool(createMockCodeNavigationService());

    expect(tool.description).toContain("retrieve interim or partial hits");
    expect(tool.description).toContain("partial hits");
    expect(tool.description).toContain("serveable subset");
    expect(tool.description).toContain("allow_partial_results");
    expect(tool.description).toContain("`PENDING`, `INDEXING`, or `SEARCHING`");
    expect(tool.description).toContain(
      "a completed result with an evidence notice",
    );
    expect(tool.description).toContain("`DEFERRED`, `TIMEOUT`, and `FAILED`");
    expect(tool.description).toContain("unrecognized statuses are not polled");
    expect(tool.description).toContain("rendered new-search action");
  });

  it("waits up to the shared default and forwards explicit wait windows", async () => {
    const searchStatus = mock((_searchRef: string, _waitTimeoutMs?: number) =>
      Promise.resolve(defaultUnifiedSearchOutcome),
    );
    const tool = createSearchStatusTool(
      createMockCodeNavigationService({ searchStatus }),
    );

    await tool.handler({ search_ref: "search-ref-default" }, {});
    expect(searchStatus.mock.calls[0]).toEqual(["search-ref-default", 20_000]);

    searchStatus.mockClear();
    await tool.handler(
      { search_ref: "search-ref-explicit", wait_timeout_ms: 45_000 },
      {},
    );
    expect(searchStatus.mock.calls[0]).toEqual(["search-ref-explicit", 45_000]);
  });

  it("bounds the wait timeout in the public schema", () => {
    const tool = createSearchStatusTool(createMockCodeNavigationService());
    const waitSchema = tool.schema.wait_timeout_ms;
    if (!waitSchema) throw new Error("expected wait_timeout_ms schema");

    expect(waitSchema.safeParse(0).success).toBe(true);
    expect(waitSchema.safeParse(60_000).success).toBe(true);
    expect(waitSchema.safeParse(-1).success).toBe(false);
    expect(waitSchema.safeParse(60_001).success).toBe(false);
  });

  it("adds local MCP auth remediation to auth errors", async () => {
    const tool = createSearchStatusTool(
      createMockCodeNavigationService({
        searchStatus: mock(() => Promise.reject(new AuthenticationError())),
      }),
    );

    const result = await tool.handler(
      { search_ref: "search-ref-123", format: "json" },
      {},
    );
    const payload = JSON.parse(result.content[0]?.text ?? "{}");

    expect(result.isError).toBe(true);
    expect(payload).toEqual({
      error: "Authentication required.",
      code: "AUTH_REQUIRED",
      retryable: false,
      details: {
        action:
          "Run `githits login`, or set GITHITS_API_TOKEN, then retry this tool call.",
        authSource: "local",
      },
    });
  });

  it("returns completed payload without fabricating initial query echo", async () => {
    const tool = createSearchStatusTool(createMockCodeNavigationService());

    const result = await tool.handler(
      { search_ref: "search-ref-123", format: "json" },
      {},
    );
    const payload = JSON.parse(result.content[0]?.text ?? "{}");

    expect(result.isError).toBeUndefined();
    expect(payload.completed).toBe(true);
    expect(payload.searchRef).toBe(defaultUnifiedSearchOutcome.searchRef);
    expect(payload.result.results).toHaveLength(1);
    expect(payload.result.partialResults).toBe(false);
    expect(payload).not.toHaveProperty("query");
  });

  it("preserves partialResults=true in a stored status result", async () => {
    if (defaultUnifiedSearchOutcome.state !== "completed") {
      throw new Error("expected completed outcome fixture");
    }
    const outcome = {
      ...defaultUnifiedSearchOutcome,
      result: { ...defaultUnifiedSearchOutcome.result, partialResults: true },
    };
    const tool = createSearchStatusTool(
      createMockCodeNavigationService({
        searchStatus: mock(() => Promise.resolve(outcome)),
      }),
    );

    const result = await tool.handler(
      { search_ref: "search-ref-123", format: "json" },
      {},
    );
    const payload = JSON.parse(result.content[0]?.text ?? "{}");
    expect(payload.result.partialResults).toBe(true);
  });

  it("preserves stored documentation contributor metadata in JSON and text", async () => {
    const tool = createSearchStatusTool(
      createMockCodeNavigationService({
        searchStatus: mock(() =>
          Promise.resolve(documentationContributorOutcome),
        ),
      }),
    );

    const json = await tool.handler(
      { search_ref: "search-ref-docs", format: "json" },
      {},
    );
    const payload = JSON.parse(json.content[0]?.text ?? "{}");
    expect(payload.result.sourceStatus[0].contributors).toEqual(
      documentationContributorOutcome.state === "completed"
        ? documentationContributorOutcome.result.sourceStatus[0]?.contributors
        : [],
    );
    expect(payload.result.evidenceNotice).toBe(
      documentationContributorOutcome.state === "completed"
        ? documentationContributorOutcome.result.evidenceNotice
        : undefined,
    );

    const text = await tool.handler({ search_ref: "search-ref-docs" }, {});
    expect(text.content[0]?.text).toContain(
      "Indexing: expressjs.com/en/guide docs",
    );
    expect(text.content[0]?.text).toContain("Searched: repository docs");
  });

  it("keeps completed empty JSON structured", async () => {
    if (defaultUnifiedSearchOutcome.state !== "completed") {
      throw new Error("expected completed outcome fixture");
    }
    const completedOutcome = defaultUnifiedSearchOutcome;
    const tool = createSearchStatusTool(
      createMockCodeNavigationService({
        searchStatus: mock(() =>
          Promise.resolve({
            ...completedOutcome,
            result: {
              ...completedOutcome.result,
              results: [],
              page: {
                ...completedOutcome.result.page,
                returned: 0,
              },
              sourceStatus: completedOutcome.result.sourceStatus.map(
                (entry) => ({ ...entry, resultCount: 0 }),
              ),
            },
          }),
        ),
      }),
    );

    const result = await tool.handler(
      { search_ref: "search-ref-123", format: "json" },
      {},
    );
    const payload = JSON.parse(result.content[0]?.text ?? "{}");

    expect(payload.result.results).toEqual([]);
    expect(payload.result.sourceStatus[0].resultCount).toBe(0);
    expect(result.content[0]?.text).not.toContain(
      "Do not repeat this search unchanged.",
    );
  });

  it("surfaces TIMEOUT status without pretending the search is still running", async () => {
    const tool = createSearchStatusTool(
      createMockCodeNavigationService({
        searchStatus: mock(() =>
          Promise.resolve(
            createIncompleteOutcome("TIMEOUT", "search-ref-timeout", {
              elapsedMs: 20_000,
            }),
          ),
        ),
      }),
    );

    const result = await tool.handler(
      { search_ref: "search-ref-timeout", format: "json" },
      {},
    );
    const payload = JSON.parse(result.content[0]?.text ?? "{}");

    expect(result.isError).toBeUndefined();
    expect(payload.completed).toBe(false);
    expect(payload.progress.status).toBe("TIMEOUT");
    expect(payload.progress.next).toBe("rerun search");
    expect(payload.progress.next).not.toContain("search_status");
  });

  it("renders TIMEOUT text without claiming active indexing", async () => {
    const tool = createSearchStatusTool(
      createMockCodeNavigationService({
        searchStatus: mock(() =>
          Promise.resolve(createIncompleteOutcome("TIMEOUT", "ref-timeout")),
        ),
      }),
    );

    const result = await tool.handler({ search_ref: "ref-timeout" }, {});
    const text = result.content[0]?.text ?? "";
    expect(text).toContain("TIMEOUT - no result snapshot returned");
    expect(text).not.toContain("search_status |");
    expect(text).toContain("Next: rerun search later.");
    expect(text).not.toContain("search_ref=");
  });

  it("stops polling a failed search session", async () => {
    const tool = createSearchStatusTool(
      createMockCodeNavigationService({
        searchStatus: mock(() =>
          Promise.resolve(createIncompleteOutcome("FAILED", "ref-failed")),
        ),
      }),
    );

    const result = await tool.handler({ search_ref: "ref-failed" }, {});
    const text = result.content[0]?.text ?? "";
    expect(text).toContain("FAILED - no result snapshot returned");
    expect(text).toContain("Next: rerun search later.");
    expect(text).not.toContain("search_ref=");
  });

  it("preserves evidence for a terminal deferred session without polling it", async () => {
    if (defaultUnifiedSearchOutcome.state !== "completed") {
      throw new Error("expected completed outcome fixture");
    }
    const incomplete = createIncompleteOutcome("DEFERRED", "ref-deferred", {
      targetsReady: 1,
      targetsTotal: 2,
      elapsedMs: 600_000,
    });
    incomplete.result = {
      ...defaultUnifiedSearchOutcome.result,
      evidenceNotice: "Stored evidence remains usable.",
    };
    const tool = createSearchStatusTool(
      createMockCodeNavigationService({
        searchStatus: mock(() => Promise.resolve(incomplete)),
      }),
    );

    const jsonResult = await tool.handler(
      { search_ref: "ref-deferred", format: "json" },
      {},
    );
    const payload = JSON.parse(jsonResult.content[0]?.text ?? "{}");
    expect(payload.completed).toBe(false);
    expect(payload.progress).toMatchObject({
      status: "DEFERRED",
      targetsReady: 1,
      targetsTotal: 2,
      next: "rerun search",
    });
    expect(payload.result.results).toHaveLength(1);
    expect(payload.result.evidenceNotice).toBe(
      "Stored evidence remains usable.",
    );

    const textResult = await tool.handler({ search_ref: "ref-deferred" }, {});
    const text = textResult.content[0]?.text ?? "";
    expect(text).toContain("DEFERRED - 1 result returned");
    expect(text).toContain("Next: rerun search later.");
    expect(text).not.toContain("search_ref=");
    expect(text).not.toContain("No hits");
    expect(text).not.toContain("Indexing in progress");
  });

  it("does not invent hits or indexing for a deferred session without results", async () => {
    const tool = createSearchStatusTool(
      createMockCodeNavigationService({
        searchStatus: mock(() =>
          Promise.resolve(
            createIncompleteOutcome("DEFERRED", "ref-deferred-empty"),
          ),
        ),
      }),
    );

    const result = await tool.handler({ search_ref: "ref-deferred-empty" }, {});
    const text = result.content[0]?.text ?? "";
    expect(text).toContain("DEFERRED - no result snapshot returned");
    expect(text).toContain("Next: rerun search later.");
    expect(text).not.toContain("No hits");
    expect(text).not.toContain("Indexing in progress");
    expect(text).not.toContain("search_ref=");
  });

  it("preserves an unrecognized status and evidence without polling it", async () => {
    if (defaultUnifiedSearchOutcome.state !== "completed") {
      throw new Error("expected completed outcome fixture");
    }
    const incomplete = createIncompleteOutcome(
      "FUTURE_SESSION_STATE",
      "ref-future",
    );
    incomplete.result = {
      ...defaultUnifiedSearchOutcome.result,
      evidenceNotice: "Stored evidence remains usable.",
    };
    const tool = createSearchStatusTool(
      createMockCodeNavigationService({
        searchStatus: mock(() => Promise.resolve(incomplete)),
      }),
    );

    const jsonResult = await tool.handler(
      { search_ref: "ref-future", format: "json" },
      {},
    );
    const payload = JSON.parse(jsonResult.content[0]?.text ?? "{}");
    expect(payload.completed).toBe(false);
    expect(payload.progress).toMatchObject({
      status: "FUTURE_SESSION_STATE",
      next: "rerun search",
    });
    expect(payload.result.results).toHaveLength(1);

    const textResult = await tool.handler({ search_ref: "ref-future" }, {});
    const text = textResult.content[0]?.text ?? "";
    expect(text).toContain("FUTURE_SESSION_STATE - 1 result returned");
    expect(text).toContain("Next: rerun search later.");
    expect(text).not.toContain("search_ref=");
    expect(text).not.toContain("No hits");
    expect(text).not.toContain("Indexing in progress");
    expect(text).not.toContain("status:");
  });

  it.each([
    ["FAILED", "FAILED - no results returned"],
    ["TIMEOUT", "TIMEOUT - no results returned"],
  ] as const)(
    "does not promise future hits for a terminal %s partial result",
    async (status, expectedMessage) => {
      const incomplete = createIncompleteOutcome(
        status,
        `ref-${status.toLowerCase()}`,
      );
      incomplete.result = {
        query: "router",
        queryWarnings: [],
        sources: ["CODE"],
        results: [],
        page: {
          offset: 0,
          limit: 10,
          returned: 0,
          hasMore: false,
        },
        partialResults: true,
        sourceStatus: [],
      };
      const tool = createSearchStatusTool(
        createMockCodeNavigationService({
          searchStatus: mock(() => Promise.resolve(incomplete)),
        }),
      );

      const result = await tool.handler(
        { search_ref: incomplete.searchRef },
        {},
      );
      const text = result.content[0]?.text ?? "";
      expect(text).toContain(expectedMessage);
      expect(text).not.toContain("No hits yet");
    },
  );

  it("renders site suggestions without selecting one during active recovery", async () => {
    if (defaultUnifiedSearchOutcome.state !== "completed") {
      throw new Error("expected completed outcome fixture");
    }
    const incomplete = createIncompleteOutcome("INDEXING", "ref-site-recovery");
    incomplete.result = {
      ...defaultUnifiedSearchOutcome.result,
      results: [],
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
          suggestedSiteTargets: ["site:docs.example.com"],
          suggestedSiteTargetsTruncated: true,
          contributors: [],
        },
      ],
    };
    const tool = createSearchStatusTool(
      createMockCodeNavigationService({
        searchStatus: mock(() => Promise.resolve(incomplete)),
      }),
    );

    const result = await tool.handler({ search_ref: incomplete.searchRef }, {});
    const text = result.content[0]?.text ?? "";
    expect(text).toContain("Indexing - no results yet");
    expect(text).toContain("- site:example.com");
    expect(text).toContain("Searched: site:example.com docs");
    expect(text).toContain("Suggested sites: site:docs.example.com");
    expect(text).toContain("More suggested sites omitted");
    expect(text).toContain(
      'Next: search_status search_ref="ref-site-recovery" wait_timeout_ms=20000',
    );
    expect(text).not.toContain("Next: retry one suggested site target");
  });

  it("surfaces progress freshness warnings", async () => {
    if (defaultUnifiedSearchOutcome.state !== "completed") {
      throw new Error("expected completed outcome fixture");
    }
    const incomplete = createIncompleteOutcome("INDEXING", "ref-stale", {
      targets: [
        {
          requested: "npm:express latest",
          resolvedRequested: "npm:express@5.2.1",
          served: "npm:express@5.1.0",
          freshness: "STALE",
        },
      ],
    });
    incomplete.result = {
      ...defaultUnifiedSearchOutcome.result,
      results: [],
      sourceStatus: [
        {
          source: "CODE",
          targetLabel: "npm:express@5.1.0",
          requestedTargetLabel: "npm:express latest",
          freshTargetLabel: "npm:express@5.2.1",
          servedTargetLabel: "npm:express@5.1.0",
          codeIndexState: "STALE",
          appliedFilters: [],
          ignoredFilters: [],
          incompatibleFilters: [],
          appliedQueryFeatures: [],
          ignoredQueryFeatures: [],
          incompatibleQueryFeatures: [],
          suggestedSiteTargets: [],
          suggestedSiteTargetsTruncated: false,
          contributors: [],
        },
      ],
    };
    const tool = createSearchStatusTool(
      createMockCodeNavigationService({
        searchStatus: mock(() => Promise.resolve(incomplete)),
      }),
    );

    const result = await tool.handler({ search_ref: "ref-stale" }, {});
    const text = result.content[0]?.text ?? "";
    expect(text).toContain("- npm:express latest -> 5.2.1");
    expect(text).toContain("Using: 5.1.0 while 5.2.1 indexes");
    expect(text.match(/5\.1\.0 while 5\.2\.1 indexes/g)).toHaveLength(1);
  });

  it("renders source targetResolution notes in completed text", async () => {
    if (defaultUnifiedSearchOutcome.state !== "completed") {
      throw new Error("expected completed outcome fixture");
    }
    const completedOutcome = defaultUnifiedSearchOutcome;
    const tool = createSearchStatusTool(
      createMockCodeNavigationService({
        searchStatus: mock(() =>
          Promise.resolve({
            ...completedOutcome,
            result: {
              ...completedOutcome.result,
              sourceStatus: [
                {
                  ...completedOutcome.result.sourceStatus[0]!,
                  targetResolution: {
                    requested: { registry: "NPM", packageName: "express" },
                    resolvedRequested: {
                      registry: "NPM",
                      packageName: "express",
                      version: "5.2.1",
                    },
                    served: {
                      registry: "NPM",
                      packageName: "express",
                      version: "4.18.2",
                    },
                    freshness: "fallback_recent",
                    freshnessReason: "ref_resolution_deferred",
                    availableVersions: [{ version: "4.18.2", ref: "v4.18.2" }],
                    availableRefs: [],
                  },
                },
              ],
            },
          }),
        ),
      }),
    );

    const result = await tool.handler({ search_ref: "search-ref-123" }, {});
    const text = result.content[0]?.text ?? "";
    expect(text).toContain("- npm:express@4.18.2");
    expect(text).toContain("Using: 4.18.2 (older snapshot)");
    expect(text).toContain("Ready now: versions");
    expect(text).toContain("4.18.2");
    expect(text).not.toContain("ref_resolution_deferred");
  });

  it("renders completed site suggestions as explicit recovery guidance", async () => {
    if (defaultUnifiedSearchOutcome.state !== "completed") {
      throw new Error("expected completed outcome fixture");
    }
    const completedOutcome = defaultUnifiedSearchOutcome;
    const tool = createSearchStatusTool(
      createMockCodeNavigationService({
        searchStatus: mock(() =>
          Promise.resolve({
            ...completedOutcome,
            result: {
              ...completedOutcome.result,
              results: [],
              sourceStatus: [
                {
                  source: "DOCS" as const,
                  targetLabel: "site:example.com",
                  appliedFilters: [],
                  ignoredFilters: [],
                  incompatibleFilters: [],
                  appliedQueryFeatures: [],
                  ignoredQueryFeatures: [],
                  incompatibleQueryFeatures: [],
                  suggestedSiteTargets: ["site:example.com/docs"],
                  suggestedSiteTargetsTruncated: true,
                  contributors: [],
                },
              ],
            },
          }),
        ),
      }),
    );

    const result = await tool.handler({ search_ref: "search-ref-123" }, {});
    const text = result.content[0]?.text ?? "";
    expect(text).toContain("No results returned");
    expect(text).toContain("- site:example.com");
    expect(text).toContain("Searched: site:example.com docs");
    expect(text).toContain("Suggested sites: site:example.com/docs");
    expect(text).toContain("More suggested sites omitted");
    expect(text).toContain("Next: retry one suggested site target explicitly.");
    expect(text).not.toContain("Next: shorten or broaden site query.");
  });

  it("renders terminal source status compactly in completed text", async () => {
    if (defaultUnifiedSearchOutcome.state !== "completed") {
      throw new Error("expected completed outcome fixture");
    }
    const completedOutcome = defaultUnifiedSearchOutcome;
    const tool = createSearchStatusTool(
      createMockCodeNavigationService({
        searchStatus: mock(() =>
          Promise.resolve({
            ...completedOutcome,
            result: {
              ...completedOutcome.result,
              results: [],
              sourceStatus: [
                {
                  ...completedOutcome.result.sourceStatus[0]!,
                  source: "CODE" as const,
                  targetLabel: "githits-com/no-such-repo",
                  indexingStatus: "UNRESOLVABLE",
                  codeIndexState: "UNRESOLVABLE",
                  note: "Repository ref cannot be resolved",
                  targetResolution: {
                    requested: {
                      repoUrl: "https://github.com/githits-com/no-such-repo",
                    },
                    resolvedRequested: {
                      repoUrl: "https://github.com/githits-com/no-such-repo",
                      gitRef: "HEAD",
                    },
                    freshness: "indexing",
                    freshnessReason: "no_current_fallback",
                    availableVersions: [],
                    availableRefs: [],
                  },
                },
              ],
            },
          }),
        ),
      }),
    );

    const result = await tool.handler(
      { search_ref: "search-ref-terminal" },
      {},
    );
    const text = result.content[0]?.text ?? "";
    expect(text).toContain("No results returned");
    expect(text).toContain("- github:githits-com/no-such-repo");
    expect(text).toContain("Unavailable: code");
    expect(text).not.toContain("Searched: code");
    expect(text).not.toContain("Repository ref cannot be resolved");
    expect(text).not.toContain("state=indexing");
  });

  it("defaults to compact text output", async () => {
    const tool = createSearchStatusTool(
      createMockCodeNavigationService({
        searchStatus: mock(() =>
          Promise.resolve(createIncompleteOutcome("SEARCHING", "ref-text")),
        ),
      }),
    );

    const result = await tool.handler({ search_ref: "ref-text" }, {});
    const text = result.content[0]?.text ?? "";

    expect(result.isError).toBeUndefined();
    expect(text).toContain("Searching - no result snapshot yet");
    expect(text).toContain("Search ref-text | 0/1 target ready");
    expect(text).toContain(
      'Next: search_status search_ref="ref-text" wait_timeout_ms=20000',
    );
    expect(text).not.toContain("search_status |");
    expect(text).not.toContain("searchRef=");
    expect(() => JSON.parse(text)).toThrow();
  });

  it("renders immediately queryable alternatives while incomplete", async () => {
    const tool = createSearchStatusTool(
      createMockCodeNavigationService({
        searchStatus: mock(() =>
          Promise.resolve(
            createIncompleteOutcome("INDEXING", "ref-alternatives", {
              targets: [
                {
                  requested: "npm:express latest",
                  availableVersions: [{ version: "4.18.2", ref: "v4.18.2" }],
                  availableRefs: [{ ref: "main" }],
                },
              ],
            }),
          ),
        ),
      }),
    );

    const result = await tool.handler({ search_ref: "ref-alternatives" }, {});
    const text = result.content[0]?.text ?? "";

    expect(text).toContain("- npm:express latest");
    expect(text).toContain("Ready now: versions 4.18.2, refs main");
    expect(text).toContain(
      'Next: search_status search_ref="ref-alternatives" wait_timeout_ms=20000',
    );
    expect(text).not.toContain("allow_partial_results: true");
  });
});
