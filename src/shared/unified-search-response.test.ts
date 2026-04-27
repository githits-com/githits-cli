import { describe, expect, it } from "bun:test";
import type { UnifiedSearchParams } from "../services/code-navigation-service.js";
import { defaultUnifiedSearchOutcome } from "../services/test-helpers.js";
import {
  buildUnifiedSearchErrorPayload,
  buildUnifiedSearchStatusPayload,
  buildUnifiedSearchSuccessPayload,
} from "./unified-search-response.js";

describe("buildUnifiedSearchSuccessPayload", () => {
  const params: UnifiedSearchParams = {
    targets: [{ registry: "NPM", packageName: "express" }],
    query: "router middleware",
    limit: 20,
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
    expect(payload.results[0]).toEqual({
      type: "repository_code",
      target: "npm:express@4.18.2",
      title: "router middleware",
      summary: "function router(req, res, next) { ... }",
      score: 0.92,
      highlights: {
        title: [[7, 17]],
        summary: [[9, 15]],
      },
      locator: expect.objectContaining({
        filePath: "lib/router/index.js",
        language: "javascript",
      }),
    });
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
