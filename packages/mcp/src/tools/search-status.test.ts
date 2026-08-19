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
  });

  it("describes partial-result follow-up behavior", () => {
    const tool = createSearchStatusTool(createMockCodeNavigationService());

    expect(tool.description).toContain("interim hits");
    expect(tool.description).toContain("partial hits");
    expect(tool.description).toContain("serveable subset");
    expect(tool.description).toContain("allow_partial_results");
    expect(tool.description).toContain("instead of repeating `search`");
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
    expect(payload).not.toHaveProperty("query");
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
    expect(text.content[0]?.text).toContain("documentation sources:");
    expect(text.content[0]?.text).toContain(
      "site expressjs.com/en/guide - not ready, so it was not searched",
    );
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
    expect(text).toContain("search_status | timeout | searchRef=ref-timeout");
    expect(text).not.toContain("search_status | indexing");
    expect(text).toContain("Do not call search_status again for this session.");
    expect(text).toContain("next: rerun search.");
    expect(text).not.toContain("next: call search_status");
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
    expect(text).toContain("Do not call search_status again for this session.");
    expect(text).toContain("next: rerun search.");
    expect(text).not.toContain("next: call search_status");
  });

  it.each([
    ["FAILED", "No hits - search failed."],
    ["TIMEOUT", "No hits - search timed out."],
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

  it("renders site recovery guidance for incomplete results without hits", async () => {
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
    expect(text).toContain("No hits yet");
    expect(text).toContain("source notes:");
    expect(text).toContain("Suggested site targets: site:docs.example.com");
    expect(text).toContain("Additional site targets were omitted.");
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
    expect(text).toContain("warnings:");
    const warning =
      "requested npm:express latest; served older snapshot npm:express@5.1.0 while npm:express@5.2.1 indexes.";
    expect(text).toContain(warning);
    expect(text.split(warning)).toHaveLength(2);
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
    expect(text).toContain("source notes:");
    expect(text).toContain(
      "Using recent indexed snapshot while branch resolution is deferred",
    );
    expect(text).toContain("queryable now: versions=4.18.2@v4.18.2");
  });

  it("renders structured site recovery guidance in completed text", async () => {
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
    expect(text).toContain("Suggested site targets: site:example.com/docs");
    expect(text).toContain("Additional site targets were omitted.");
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
    expect(text).toContain(
      "code (github:githits-com/no-such-repo) | Repository ref cannot be resolved (UNRESOLVABLE)",
    );
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
    expect(text).toContain("search_status | searching | searchRef=ref-text");
    expect(text).toContain("progress: SEARCHING, 0/1 targets ready");
    expect(text).toContain("Do not repeat search.");
    expect(text).toContain(
      'next: call search_status with search_ref="ref-text" and wait_timeout_ms=20000.',
    );
    expect(text).not.toContain("searchRef=ref-text to follow up");
    expect(() => JSON.parse(text)).toThrow();
  });

  it("renders immediately queryable alternatives while deferred", async () => {
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

    expect(text).toContain(
      "queryable now: versions=4.18.2@v4.18.2 | refs=main",
    );
    expect(text).toContain("Do not repeat search.");
    expect(text).not.toContain("allow_partial_results: true");
  });
});
