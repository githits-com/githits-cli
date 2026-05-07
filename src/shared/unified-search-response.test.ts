import { describe, expect, it } from "bun:test";
import type {
  UnifiedSearchOutcome,
  UnifiedSearchParams,
} from "../services/code-navigation-service.js";
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
