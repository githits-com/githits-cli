import { describe, expect, it } from "bun:test";
import type {
  UnifiedSearchOutcome,
  UnifiedSearchParams,
} from "@githits/core-internal";
import { defaultUnifiedSearchOutcome } from "../services/test-helpers.js";
import {
  buildSourceStatusWarnings,
  buildUnifiedSearchErrorPayload,
  buildUnifiedSearchStatusPayload,
  buildUnifiedSearchSuccessPayload,
} from "./unified-search-response.js";

describe("buildUnifiedSearchSuccessPayload", () => {
  const params: UnifiedSearchParams = {
    targets: [{ registry: "NPM", packageName: "express" }],
    query: "router middleware",
    limit: 10,
    offset: 0,
    waitTimeoutMs: 20_000,
  };

  it("normalises completed results into the shared envelope", () => {
    const payload = buildUnifiedSearchSuccessPayload(
      params,
      "router middleware",
      "router middleware",
      defaultUnifiedSearchOutcome,
    );

    expect(payload.completed).toBe(true);
    expect(payload.results.length).toBe(1);
    expect(payload.results[0]).toMatchObject({
      type: "repository_code",
      target: "npm:express@4.18.2",
      title: "router middleware",
      summary: "function router(req, res, next) { ... }",
      highlights: {
        title: [[7, 17]],
        summary: [[9, 15]],
      },
      locator: expect.objectContaining({
        filePath: "lib/router/index.js",
        language: "javascript",
      }),
    });
    expect(payload.results[0]?.followUp).toBe(
      'code_read target="npm:express@4.18.2" path="lib/router/index.js" start_line=42 end_line=57',
    );
    expect(payload.results[0]).not.toHaveProperty("score");
  });

  it("allows repository doc hits without gitRef", () => {
    if (defaultUnifiedSearchOutcome.state !== "completed") {
      throw new Error("expected completed outcome fixture");
    }
    const hit = defaultUnifiedSearchOutcome.result.results[0]!;
    const payload = buildUnifiedSearchSuccessPayload(
      params,
      "router middleware",
      "router middleware",
      {
        ...defaultUnifiedSearchOutcome,
        result: {
          ...defaultUnifiedSearchOutcome.result,
          results: [
            {
              ...hit,
              resultType: "REPOSITORY_DOC",
              targetLabel: "expressjs/express",
              locator: {
                ...hit.locator,
                pageId: "github:expressjs/express/README.md",
                repoUrl: "https://github.com/expressjs/express",
                gitRef: undefined,
                filePath: "README.md",
              },
            },
          ],
        },
      },
    );

    expect(payload.results[0]?.type).toBe("repository_doc");
    expect(payload.results[0]?.target).toBe("github:expressjs/express");
    expect(payload.results[0]?.followUp).toContain(
      'docs_read page_id="github:expressjs/express/README.md"',
    );
  });

  it("canonicalizes repository hit target labels containing @ in refs", () => {
    if (defaultUnifiedSearchOutcome.state !== "completed") {
      throw new Error("expected completed outcome fixture");
    }
    const hit = defaultUnifiedSearchOutcome.result.results[0]!;
    const payload = buildUnifiedSearchSuccessPayload(
      params,
      "router middleware",
      "router middleware",
      {
        ...defaultUnifiedSearchOutcome,
        result: {
          ...defaultUnifiedSearchOutcome.result,
          results: [
            {
              ...hit,
              targetLabel: "n8n-io/n8n@n8n@2.26.5",
            },
          ],
        },
      },
    );

    expect(payload.results[0]?.target).toBe("github:n8n-io/n8n#n8n@2.26.5");
  });

  it("omits default-valued query echo fields", () => {
    const payload = buildUnifiedSearchSuccessPayload(
      params,
      "router middleware",
      "router middleware",
      defaultUnifiedSearchOutcome,
    );

    // Default limit/offset/waitTimeoutMs/allowPartialResults all omitted.
    // No `compiled` because it equals raw. No `warnings` because empty.
    expect(payload.query).toEqual({
      raw: "router middleware",
    });
  });

  it("normalises incomplete outcomes without partial results", () => {
    const payload = buildUnifiedSearchSuccessPayload(
      params,
      "router middleware",
      "router middleware",
      {
        state: "incomplete",
        completed: false,
        searchRef: "search-ref-123",
        progress: {
          searchRef: "search-ref-123",
          status: "INDEXING",
          targetsTotal: 1,
          targetsReady: 0,
          elapsedMs: 200,
          query: "router middleware",
          queryWarnings: [],
          sources: ["CODE"],
        },
      },
    );

    expect(payload).toEqual({
      query: { raw: "router middleware" },
      completed: false,
      hasMore: false,
      results: [],
      searchRef: "search-ref-123",
      progress: {
        status: "INDEXING",
        targetsReady: 0,
        targetsTotal: 1,
        elapsedMs: 200,
        query: "router middleware",
        next: 'search_status search_ref="search-ref-123"',
      },
    });
  });

  it("normalises incomplete outcomes with opt-in partial results", () => {
    if (defaultUnifiedSearchOutcome.state !== "completed") {
      throw new Error("expected completed outcome fixture");
    }

    const payload = buildUnifiedSearchSuccessPayload(
      { ...params, allowPartialResults: true },
      "router middleware",
      "router middleware",
      {
        state: "incomplete",
        completed: false,
        searchRef: "search-ref-123",
        result: {
          ...defaultUnifiedSearchOutcome.result,
          partialResults: true,
        },
        progress: {
          searchRef: "search-ref-123",
          status: "INDEXING",
          targetsTotal: 2,
          targetsReady: 1,
          elapsedMs: 200,
          query: "router middleware",
          queryWarnings: [],
          sources: ["CODE"],
        },
      },
    );

    expect(payload.completed).toBe(false);
    expect(payload.query.allowPartialResults).toBe(true);
    expect(payload.results.length).toBe(1);
    expect(payload.results[0]?.target).toBe("npm:express@4.18.2");
  });

  it("projects stale hit freshness into compact fields and warnings", () => {
    if (defaultUnifiedSearchOutcome.state !== "completed") {
      throw new Error("expected completed outcome fixture");
    }
    const outcome: UnifiedSearchOutcome = {
      ...defaultUnifiedSearchOutcome,
      result: {
        ...defaultUnifiedSearchOutcome.result,
        results: [
          {
            ...defaultUnifiedSearchOutcome.result.results[0]!,
            requestedTargetLabel: "npm:express latest",
            freshTargetLabel: "npm:express@5.2.1",
            servedTargetLabel: "npm:express@5.1.0",
            freshness: "STALE",
          },
        ],
      },
    };

    const payload = buildUnifiedSearchSuccessPayload(
      params,
      "router middleware",
      "router middleware",
      outcome,
    );

    expect(payload.results[0]).toMatchObject({
      requestedTarget: "npm:express latest",
      freshTarget: "npm:express@5.2.1",
      servedTarget: "npm:express@5.1.0",
      freshness: "STALE",
    });
    expect(payload.warnings).toContain(
      "requested npm:express latest; served stale npm:express@5.1.0 while npm:express@5.2.1 indexes.",
    );
  });

  it("canonicalizes stale repository hit freshness labels", () => {
    if (defaultUnifiedSearchOutcome.state !== "completed") {
      throw new Error("expected completed outcome fixture");
    }
    const outcome: UnifiedSearchOutcome = {
      ...defaultUnifiedSearchOutcome,
      result: {
        ...defaultUnifiedSearchOutcome.result,
        results: [
          {
            ...defaultUnifiedSearchOutcome.result.results[0]!,
            targetLabel: "n8n-io/n8n@n8n@2.26.5",
            requestedTargetLabel: "n8n-io/n8n@n8n@2.26.5",
            freshTargetLabel: "n8n-io/n8n@n8n@2.26.9",
            servedTargetLabel: "n8n-io/n8n@n8n@2.26.5",
            freshness: "STALE",
          },
        ],
      },
    };

    const payload = buildUnifiedSearchSuccessPayload(
      params,
      "router middleware",
      "router middleware",
      outcome,
    );

    expect(payload.results[0]).toMatchObject({
      target: "github:n8n-io/n8n#n8n@2.26.5",
      requestedTarget: "github:n8n-io/n8n#n8n@2.26.5",
      freshTarget: "github:n8n-io/n8n#n8n@2.26.9",
      servedTarget: "github:n8n-io/n8n#n8n@2.26.5",
      freshness: "STALE",
    });
    expect(payload.warnings).toContain(
      "requested github:n8n-io/n8n#n8n@2.26.5; served stale github:n8n-io/n8n#n8n@2.26.5 while github:n8n-io/n8n#n8n@2.26.9 indexes.",
    );
  });

  it("suppresses version-prefix-only package stale hit warnings", () => {
    if (defaultUnifiedSearchOutcome.state !== "completed") {
      throw new Error("expected completed outcome fixture");
    }
    const outcome: UnifiedSearchOutcome = {
      ...defaultUnifiedSearchOutcome,
      result: {
        ...defaultUnifiedSearchOutcome.result,
        results: [
          {
            ...defaultUnifiedSearchOutcome.result.results[0]!,
            requestedTargetLabel: "npm:express@5.2.1",
            freshTargetLabel: "npm:express@5.2.1",
            servedTargetLabel: "npm:express@v5.2.1",
            freshness: "STALE",
          },
        ],
      },
    };

    const payload = buildUnifiedSearchSuccessPayload(
      params,
      "router middleware",
      "router middleware",
      outcome,
    );

    expect(payload.results[0]).not.toHaveProperty("freshness");
    expect(payload.warnings).toBeUndefined();
  });

  it("keeps follow-up commands pinned to served locator identity", () => {
    if (defaultUnifiedSearchOutcome.state !== "completed") {
      throw new Error("expected completed outcome fixture");
    }
    const outcome: UnifiedSearchOutcome = {
      ...defaultUnifiedSearchOutcome,
      result: {
        ...defaultUnifiedSearchOutcome.result,
        results: [
          {
            ...defaultUnifiedSearchOutcome.result.results[0]!,
            targetLabel: "npm:express latest",
            requestedTargetLabel: "npm:express latest",
            freshTargetLabel: "npm:express@5.2.1",
            servedTargetLabel: "npm:express@4.18.2",
            freshness: "STALE",
            locator: {
              ...defaultUnifiedSearchOutcome.result.results[0]!.locator,
              version: "4.18.2",
            },
          },
        ],
      },
    };

    const payload = buildUnifiedSearchSuccessPayload(
      params,
      "router middleware",
      "router middleware",
      outcome,
    );

    expect(payload.results[0]?.followUp).toContain(
      'target="npm:express@4.18.2"',
    );
    expect(payload.results[0]?.followUp).not.toContain("5.2.1");
  });

  it("projects source targetResolution into actionable warnings", () => {
    if (defaultUnifiedSearchOutcome.state !== "completed") {
      throw new Error("expected completed outcome fixture");
    }
    const outcome: UnifiedSearchOutcome = {
      ...defaultUnifiedSearchOutcome,
      result: {
        ...defaultUnifiedSearchOutcome.result,
        sourceStatus: [
          {
            ...defaultUnifiedSearchOutcome.result.sourceStatus[0]!,
            targetResolution: {
              requested: {
                repoUrl: "https://github.com/expressjs/express",
                gitRef: "HEAD",
              },
              resolvedRequested: {
                repoUrl: "https://github.com/expressjs/express",
                gitRef: "main",
                commitSha: "def456789abc",
              },
              served: {
                repoUrl: "https://github.com/expressjs/express",
                gitRef: "main",
                commitSha: "abc123789def",
              },
              freshness: "fallback_recent",
              freshnessReason: "head_refresh_deferred",
              indexingRef: "idx_123",
              availableVersions: [],
              availableRefs: [{ ref: "main" }, { ref: "v4.18.2" }],
            },
          },
        ],
      },
    };

    const payload = buildUnifiedSearchSuccessPayload(
      params,
      "router middleware",
      "router middleware",
      outcome,
    );

    expect(payload.sourceStatus?.[0]?.targetResolution?.freshness).toBe(
      "fallback_recent",
    );
    expect(payload.warnings?.join("\n")).toContain("using recent index");
    expect(payload.warnings?.join("\n")).toContain("queryable now");
  });

  it("canonicalizes source-status repository labels", () => {
    if (defaultUnifiedSearchOutcome.state !== "completed") {
      throw new Error("expected completed outcome fixture");
    }
    const payload = buildUnifiedSearchSuccessPayload(
      params,
      "router middleware",
      "router middleware",
      {
        ...defaultUnifiedSearchOutcome,
        result: {
          ...defaultUnifiedSearchOutcome.result,
          sourceStatus: [
            {
              ...defaultUnifiedSearchOutcome.result.sourceStatus[0]!,
              targetLabel: "n8n-io/n8n@n8n@2.26.5",
              requestedTargetLabel: "n8n-io/n8n@n8n@2.26.5",
              freshTargetLabel: "n8n-io/n8n@n8n@2.26.9",
              servedTargetLabel: "n8n-io/n8n@n8n@2.26.5",
              codeIndexState: "STALE",
            },
          ],
        },
      },
    );

    expect(payload.sourceStatus?.[0]).toMatchObject({
      targetLabel: "github:n8n-io/n8n#n8n@2.26.5",
      requestedTarget: "github:n8n-io/n8n#n8n@2.26.5",
      freshTarget: "github:n8n-io/n8n#n8n@2.26.9",
      servedTarget: "github:n8n-io/n8n#n8n@2.26.5",
    });
  });

  it("dedupes identical freshness warnings across hits sharing a state", () => {
    if (defaultUnifiedSearchOutcome.state !== "completed") {
      throw new Error("expected completed outcome fixture");
    }
    const baseHit = defaultUnifiedSearchOutcome.result.results[0]!;
    // Five hits all stale on the same target — agents should see one
    // warning, not five copies of the same string.
    const staleHit = {
      ...baseHit,
      requestedTargetLabel: "npm:zod latest",
      freshTargetLabel: "npm:zod@4.4.4",
      servedTargetLabel: "npm:zod@4.4.3",
      freshness: "STALE" as const,
    };
    const outcome: UnifiedSearchOutcome = {
      ...defaultUnifiedSearchOutcome,
      result: {
        ...defaultUnifiedSearchOutcome.result,
        results: [staleHit, staleHit, staleHit, staleHit, staleHit],
      },
    };

    const payload = buildUnifiedSearchSuccessPayload(
      params,
      "schema",
      "schema",
      outcome,
    );

    const matches = (payload.warnings ?? []).filter((entry) =>
      entry.includes("served stale npm:zod@4.4.3"),
    );
    expect(matches).toHaveLength(1);
  });

  it("omits non-actionable current freshness metadata from hits", () => {
    if (defaultUnifiedSearchOutcome.state !== "completed") {
      throw new Error("expected completed outcome fixture");
    }
    const outcome: UnifiedSearchOutcome = {
      ...defaultUnifiedSearchOutcome,
      result: {
        ...defaultUnifiedSearchOutcome.result,
        results: [
          {
            ...defaultUnifiedSearchOutcome.result.results[0]!,
            requestedTargetLabel: "expressjs/express",
            freshTargetLabel: "expressjs/express@master",
            servedTargetLabel: "expressjs/express@master",
            freshness: "CURRENT",
          },
        ],
      },
    };

    const payload = buildUnifiedSearchSuccessPayload(
      params,
      "router middleware",
      "router middleware",
      outcome,
    );

    expect(payload.results[0]).not.toHaveProperty("requestedTarget");
    expect(payload.results[0]).not.toHaveProperty("freshTarget");
    expect(payload.results[0]).not.toHaveProperty("servedTarget");
    expect(payload.results[0]).not.toHaveProperty("freshness");
    expect(payload.warnings).toBeUndefined();
  });

  it("projects progress freshness warnings without result hits", () => {
    const payload = buildUnifiedSearchSuccessPayload(
      params,
      "router middleware",
      "router middleware",
      {
        state: "incomplete",
        completed: false,
        searchRef: "search-ref-123",
        progress: {
          searchRef: "search-ref-123",
          status: "INDEXING",
          targetsTotal: 1,
          targetsReady: 0,
          elapsedMs: 200,
          query: "router middleware",
          queryWarnings: [],
          sources: ["CODE"],
          targets: [
            {
              requested: "https://github.com/foo/bar default branch",
              resolvedRequested: "main@def456",
              served: "main@abc123",
              freshness: "STALE",
            },
          ],
        },
      },
    );

    expect(payload.warnings).toContain(
      "requested https://github.com/foo/bar default branch; served stale main@abc123 while main@def456 indexes.",
    );
  });

  it("canonicalizes repository progress target labels", () => {
    const payload = buildUnifiedSearchSuccessPayload(
      params,
      "router middleware",
      "router middleware",
      {
        state: "incomplete",
        completed: false,
        searchRef: "search-ref-123",
        progress: {
          searchRef: "search-ref-123",
          status: "INDEXING",
          targetsTotal: 1,
          targetsReady: 0,
          elapsedMs: 200,
          query: "router middleware",
          queryWarnings: [],
          sources: ["CODE"],
          targets: [
            {
              requested: "n8n-io/n8n@n8n@2.26.5",
              resolvedRequested: "n8n-io/n8n@n8n@2.26.9",
              served: "n8n-io/n8n@n8n@2.26.5",
              freshness: "STALE",
            },
          ],
        },
      },
    );

    if (payload.completed) {
      throw new Error("expected incomplete payload");
    }
    expect(payload.progress?.targets?.[0]).toMatchObject({
      requested: "github:n8n-io/n8n#n8n@2.26.5",
      resolvedRequested: "github:n8n-io/n8n#n8n@2.26.9",
      served: "github:n8n-io/n8n#n8n@2.26.5",
    });
    expect(payload.warnings).toContain(
      "requested github:n8n-io/n8n#n8n@2.26.5; served stale github:n8n-io/n8n#n8n@2.26.5 while github:n8n-io/n8n#n8n@2.26.9 indexes.",
    );
  });

  it("projects progress targetResolution retry candidates without result hits", () => {
    const payload = buildUnifiedSearchSuccessPayload(
      params,
      "router middleware",
      "router middleware",
      {
        state: "incomplete",
        completed: false,
        searchRef: "search-ref-123",
        progress: {
          searchRef: "search-ref-123",
          status: "INDEXING",
          targetsTotal: 1,
          targetsReady: 0,
          elapsedMs: 200,
          query: "router middleware",
          queryWarnings: [],
          sources: ["CODE"],
          targets: [
            {
              requested: "https://github.com/foo/bar default branch",
              freshness: "INDEXING",
              indexingRef: "idx_123",
              targetResolution: {
                requested: {
                  repoUrl: "https://github.com/foo/bar",
                },
                resolvedRequested: {
                  repoUrl: "https://github.com/foo/bar",
                  gitRef: "main",
                },
                freshness: "indexing",
                freshnessReason: "requested_ref_indexing",
                indexingRef: "idx_123",
                availableVersions: [],
                availableRefs: [{ ref: "main" }, { ref: "v1.2.3" }],
              },
            },
          ],
        },
      },
    );

    expect(payload.completed).toBe(false);
    if (payload.completed) {
      throw new Error("expected incomplete payload");
    }
    expect(payload.progress?.targets?.[0]?.targetResolution?.freshness).toBe(
      "indexing",
    );
    expect(
      payload.progress?.targets?.[0]?.targetResolution?.availableRefs,
    ).toEqual([{ ref: "main" }, { ref: "v1.2.3" }]);
    expect(payload.warnings?.join("\n")).toContain("queryable now");
  });
});

describe("buildSourceStatusWarnings — sourceStatus → warnings promotion", () => {
  it("returns empty when source status is undefined or empty", () => {
    expect(buildSourceStatusWarnings(undefined)).toEqual([]);
    expect(buildSourceStatusWarnings([])).toEqual([]);
  });

  it("promotes incompatibleQueryFeatures into a structured message", () => {
    const warnings = buildSourceStatusWarnings([
      {
        source: "docs",
        targetLabel: "npm:zod@4.3.6",
        incompatibleQueryFeatures: ["kind"],
        note: "Incompatible with query features: kind",
      },
    ]);
    expect(warnings).toEqual([
      "Source 'docs' for npm:zod@4.3.6: incompatible query features [kind]",
    ]);
  });

  it("combines multiple reasons in a single warning", () => {
    const warnings = buildSourceStatusWarnings([
      {
        source: "docs",
        targetLabel: "npm:express@5.2.1",
        incompatibleQueryFeatures: ["lang"],
        ignoredFilters: ["fileIntent"],
      },
    ]);
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain("incompatible query features [lang]");
    expect(warnings[0]).toContain("ignored filters [fileIntent]");
  });

  it("falls back to the free-form note when no structured fields fired", () => {
    const warnings = buildSourceStatusWarnings([
      {
        source: "code",
        targetLabel: "npm:express@5.2.1",
        note: "Index rebuilt 5 minutes ago.",
      },
    ]);
    expect(warnings).toEqual([
      "Source 'code' for npm:express@5.2.1: Index rebuilt 5 minutes ago.",
    ]);
  });

  it("prefers compact lifecycle note over raw target-resolution details for terminal states", () => {
    const warnings = buildSourceStatusWarnings([
      {
        source: "code",
        targetLabel: "githits-com/no-such-repo",
        targetResolution: {
          requested: { repoUrl: "https://github.com/githits-com/no-such-repo" },
          resolvedRequested: {
            repoUrl: "https://github.com/githits-com/no-such-repo",
            gitRef: "HEAD",
          },
          freshness: "indexing",
          freshnessReason: "no_current_fallback",
          availableVersions: [],
          availableRefs: [],
        },
        indexingStatus: "UNRESOLVABLE",
        codeIndexState: "UNRESOLVABLE",
        note: "Repository ref cannot be resolved",
      },
    ]);

    expect(warnings).toEqual([
      "Source 'code' for github:githits-com/no-such-repo: Repository ref cannot be resolved (UNRESOLVABLE)",
    ]);
  });

  it("uses canonical repo target formatting for source-status warnings", () => {
    const warnings = buildSourceStatusWarnings([
      {
        source: "code",
        targetLabel: "n8n-io/n8n@n8n@2.26.5",
        targetResolution: {
          requested: {
            repoUrl: "https://github.com/n8n-io/n8n",
            gitRef: "n8n@2.26.5",
          },
          freshness: "unavailable",
          availableVersions: [],
          availableRefs: [],
        },
        indexingStatus: "UNRESOLVABLE",
        codeIndexState: "UNRESOLVABLE",
        note: "Repository ref cannot be resolved",
      },
    ]);

    expect(warnings).toEqual([
      "Source 'code' for github:n8n-io/n8n#n8n@2.26.5: Repository ref cannot be resolved (UNRESOLVABLE)",
    ]);
  });

  it("canonicalizes backend repo labels when structured target resolution is absent", () => {
    const warnings = buildSourceStatusWarnings([
      {
        source: "code",
        targetLabel: "n8n-io/n8n@n8n@2.26.5",
        indexingStatus: "UNRESOLVABLE",
        codeIndexState: "UNRESOLVABLE",
        note: "Repository ref cannot be resolved",
      },
    ]);

    expect(warnings).toEqual([
      "Source 'code' for github:n8n-io/n8n#n8n@2.26.5: Repository ref cannot be resolved (UNRESOLVABLE)",
    ]);
  });

  it("produces one warning per source-status entry, preserving order", () => {
    const warnings = buildSourceStatusWarnings([
      {
        source: "docs",
        targetLabel: "npm:zod@4.3.6",
        incompatibleQueryFeatures: ["kind"],
      },
      {
        source: "code",
        targetLabel: "npm:zod@4.3.6",
        ignoredFilters: ["pathPrefix"],
      },
    ]);
    expect(warnings.length).toBe(2);
    expect(warnings[0]).toContain("docs");
    expect(warnings[1]).toContain("code");
  });

  it("does not warn for stale source status without label divergence", () => {
    expect(
      buildSourceStatusWarnings([
        {
          source: "code",
          targetLabel: "npm:express@5.1.0",
          codeIndexState: "STALE",
        },
      ]),
    ).toEqual([]);
  });

  it("does not warn when requested is floating but fresh and served match", () => {
    expect(
      buildSourceStatusWarnings([
        {
          source: "code",
          targetLabel: "githits-com/githits-cli",
          requestedTarget: "githits-com/githits-cli",
          freshTarget: "githits-com/githits-cli@HEAD",
          servedTarget: "githits-com/githits-cli@HEAD",
          codeIndexState: "STALE",
        },
      ]),
    ).toEqual([]);
  });

  it("does not warn when only a package version v-prefix differs", () => {
    expect(
      buildSourceStatusWarnings([
        {
          source: "code",
          targetLabel: "npm:express@5.2.1",
          requestedTarget: "npm:express@5.2.1",
          freshTarget: "npm:express@5.2.1",
          servedTarget: "npm:express@v5.2.1",
          codeIndexState: "STALE",
        },
      ]),
    ).toEqual([]);
  });

  it("warns for stale source status when labels diverge", () => {
    expect(
      buildSourceStatusWarnings([
        {
          source: "code",
          targetLabel: "npm:express@5.1.0",
          requestedTarget: "npm:express latest",
          freshTarget: "npm:express@5.2.1",
          servedTarget: "npm:express@5.1.0",
          codeIndexState: "STALE",
        },
      ]),
    ).toEqual([
      "requested npm:express latest; served stale npm:express@5.1.0 while npm:express@5.2.1 indexes.",
    ]);
  });
});

describe("buildUnifiedSearchSuccessPayload — sourceStatus warnings on completed payloads", () => {
  function buildOutcomeWithStatus(
    overrides: Record<string, unknown>,
  ): UnifiedSearchOutcome {
    if (defaultUnifiedSearchOutcome.state !== "completed") {
      throw new Error("expected completed fixture");
    }
    const sourceStatus = [
      {
        ...defaultUnifiedSearchOutcome.result.sourceStatus[0],
        ...overrides,
      },
    ];
    return {
      ...defaultUnifiedSearchOutcome,
      result: {
        ...defaultUnifiedSearchOutcome.result,
        sourceStatus,
      },
    } as UnifiedSearchOutcome;
  }

  const params: UnifiedSearchParams = {
    targets: [{ registry: "NPM", packageName: "zod" }],
    query: "parse kind:function",
    sources: ["DOCS"],
    limit: 10,
    offset: 0,
    waitTimeoutMs: 20_000,
  };

  it("emits warnings[] when a source reports incompatibleQueryFeatures (B5 repro)", () => {
    const outcome = buildOutcomeWithStatus({
      source: "DOCS",
      targetLabel: "npm:zod@4.3.6",
      incompatibleQueryFeatures: ["kind"],
      note: "Incompatible with query features: kind",
    });
    const payload = buildUnifiedSearchSuccessPayload(
      params,
      "parse kind:function",
      "parse kind:function",
      outcome,
    );
    expect(payload.completed).toBe(true);
    expect(payload.warnings).toEqual([
      "Source 'docs' for npm:zod@4.3.6: incompatible query features [kind]",
    ]);
    // Structured detail is still available alongside.
    expect(payload.sourceStatus?.[0]?.incompatibleQueryFeatures).toEqual([
      "kind",
    ]);
  });

  it("omits warnings[] when sourceStatus is healthy", () => {
    const payload = buildUnifiedSearchSuccessPayload(
      params,
      "router middleware",
      "router middleware",
      defaultUnifiedSearchOutcome,
    );
    expect(payload.warnings).toBeUndefined();
  });

  it("omits warnings[] for current targetResolution on floating repo targets", () => {
    const outcome = buildOutcomeWithStatus({
      source: "CODE",
      targetLabel: "githits-com/githits-cli",
      targetResolution: {
        requested: {
          kind: "repo_default_branch",
          repoUrl: "https://github.com/githits-com/githits-cli",
        },
        resolvedRequested: {
          repoUrl: "https://github.com/githits-com/githits-cli",
          gitRef: "HEAD",
          commitSha: "fd3d47cec611714272f68692b6fc91db575b41bf",
        },
        served: {
          repoUrl: "https://github.com/githits-com/githits-cli",
          gitRef: "HEAD",
          commitSha: "fd3d47cec611714272f68692b6fc91db575b41bf",
        },
        freshness: "current",
        freshnessReason: "head_refresh_deferred_within_ttl",
        availableVersions: [],
        availableRefs: [],
      },
    });

    const payload = buildUnifiedSearchSuccessPayload(
      params,
      "tracking",
      "tracking",
      outcome,
    );

    expect(payload.warnings).toBeUndefined();
    expect(payload.sourceStatus).toBeUndefined();
  });

  it("includes parser warnings ahead of sourceStatus warnings at top level", () => {
    if (defaultUnifiedSearchOutcome.state !== "completed") {
      throw new Error("expected completed fixture");
    }
    const outcome = {
      ...defaultUnifiedSearchOutcome,
      result: {
        ...defaultUnifiedSearchOutcome.result,
        queryWarnings: ["unrecognised qualifier 'xyz:'"],
        sourceStatus: [
          {
            ...defaultUnifiedSearchOutcome.result.sourceStatus[0],
            incompatibleQueryFeatures: ["kind"],
          },
        ],
      },
    } as UnifiedSearchOutcome;
    const payload = buildUnifiedSearchSuccessPayload(
      params,
      "parse kind:function",
      "parse kind:function",
      outcome,
    );
    expect(payload.warnings).toEqual([
      "unrecognised qualifier 'xyz:'",
      expect.stringContaining("incompatible query features [kind]"),
    ]);
    // Parser warnings remain on the query echo for callers that
    // specifically inspect the parser-warning surface.
    expect(payload.query.warnings).toEqual(["unrecognised qualifier 'xyz:'"]);
  });
});

describe("buildUnifiedSearchStatusPayload — combined warnings", () => {
  it("appends sourceStatus warnings after parser warnings", () => {
    if (defaultUnifiedSearchOutcome.state !== "completed") {
      throw new Error("expected completed fixture");
    }
    const outcome = {
      ...defaultUnifiedSearchOutcome,
      result: {
        ...defaultUnifiedSearchOutcome.result,
        queryWarnings: ["unrecognised qualifier 'xyz:'"],
        sourceStatus: [
          {
            ...defaultUnifiedSearchOutcome.result.sourceStatus[0],
            incompatibleQueryFeatures: ["kind"],
          },
        ],
      },
    } as UnifiedSearchOutcome;

    const payload = buildUnifiedSearchStatusPayload(outcome);
    if (!payload.completed) throw new Error("expected completed payload");
    expect(payload.result.warnings).toEqual([
      "unrecognised qualifier 'xyz:'",
      expect.stringContaining("incompatible query features [kind]"),
    ]);
  });
});

describe("buildUnifiedSearchErrorPayload", () => {
  it("maps errors to the shared error envelope", () => {
    const payload = buildUnifiedSearchErrorPayload(new Error("boom"));

    expect(payload).toEqual({
      error: "boom",
      code: "UNKNOWN",
      retryable: false,
    });
  });
});

describe("buildUnifiedSearchStatusPayload", () => {
  it("builds a status payload for incomplete follow-up checks", () => {
    const payload = buildUnifiedSearchStatusPayload({
      state: "incomplete",
      completed: false,
      searchRef: "search-ref-123",
      progress: {
        searchRef: "search-ref-123",
        status: "INDEXING",
        targetsTotal: 1,
        targetsReady: 0,
        elapsedMs: 200,
        query: "router middleware",
        queryWarnings: [],
        sources: ["CODE"],
      },
    });

    expect(payload).toEqual({
      completed: false,
      searchRef: "search-ref-123",
      progress: {
        status: "INDEXING",
        targetsReady: 0,
        targetsTotal: 1,
        elapsedMs: 200,
        query: "router middleware",
        next: 'search_status search_ref="search-ref-123"',
      },
    });
  });

  it("builds a completed status payload without fabricating the original request", () => {
    if (defaultUnifiedSearchOutcome.state !== "completed") {
      throw new Error("expected completed outcome fixture");
    }

    const payload = buildUnifiedSearchStatusPayload(
      defaultUnifiedSearchOutcome,
    );

    expect(payload.completed).toBe(true);
    if (!payload.completed) {
      throw new Error("expected completed payload");
    }

    expect(payload.result).toEqual({
      query: {
        raw: "router middleware",
        sources: ["code"],
      },
      sources: ["code"],
      hasMore: false,
      results: [
        expect.objectContaining({
          type: "repository_code",
          target: "npm:express@4.18.2",
        }),
      ],
    });
  });
});
