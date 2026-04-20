import { describe, expect, it } from "bun:test";
import {
  CodeNavigationBackendError,
  CodeNavigationIndexingError,
  CodeNavigationVersionNotFoundError,
} from "../services/code-navigation-service.js";
import type {
  SearchSymbolsParams,
  SearchSymbolsResult,
} from "../services/index.js";
import {
  buildSearchSymbolsErrorPayload,
  buildSearchSymbolsSuccessPayload,
} from "./search-symbols-response.js";

const baseParams: SearchSymbolsParams = {
  target: { registry: "NPM", packageName: "express" },
  query: "middleware",
  fileIntent: "PRODUCTION",
  waitTimeoutMs: 20_000,
};

const empty: SearchSymbolsResult = {
  results: [],
  totalMatches: 0,
  hasMore: false,
};

describe("buildSearchSymbolsSuccessPayload — query echo", () => {
  it("echoes category as a lowercase string when the caller supplied one", () => {
    const payload = buildSearchSymbolsSuccessPayload(
      {
        ...baseParams,
        category: "CALLABLE",
      },
      [],
      empty,
    );
    expect(payload.query.category).toBe("callable");
  });

  it("omits category from the echo when the caller did not supply one", () => {
    const payload = buildSearchSymbolsSuccessPayload(baseParams, [], empty);
    expect(payload.query.category).toBeUndefined();
  });
});

describe("buildSearchSymbolsSuccessPayload — zero-result hint handling", () => {
  it("passes the backend zero-result hint through in the success envelope", () => {
    const payload = buildSearchSymbolsSuccessPayload(baseParams, [], {
      ...empty,
      version: "v5.2.1",
      hint: "120 chunks indexed across 45 files. Try broader search terms or use fetch_code_context to read specific files directly.",
    });
    expect(payload.hint).toContain("120 chunks indexed across 45 files");
  });

  it("passes the docs-only hint through on zero-result", () => {
    const payload = buildSearchSymbolsSuccessPayload(baseParams, [], {
      ...empty,
      hint: "This package has no searchable code chunks — it may be docs-only, binary-heavy, or use a language the extractor doesn't support.",
    });
    expect(payload.hint).toContain("docs-only, binary-heavy");
  });

  it("suppresses the legacy '0 searchable chunks' phrasing even when backend regresses", () => {
    const payload = buildSearchSymbolsSuccessPayload(baseParams, [], {
      ...empty,
      hint: "Repository indexed but contains 0 searchable chunks.",
    });
    expect(payload.hint).toBeUndefined();
  });

  it("omits hint entirely when backend sends none", () => {
    const payload = buildSearchSymbolsSuccessPayload(baseParams, [], empty);
    expect(payload.hint).toBeUndefined();
  });
});

describe("buildSearchSymbolsErrorPayload — retryable surfacing", () => {
  it("surfaces retryable: true for INDEXING", () => {
    const payload = buildSearchSymbolsErrorPayload(
      new CodeNavigationIndexingError("still indexing", "idx-1"),
    );
    expect(payload.code).toBe("INDEXING");
    expect(payload.retryable).toBe(true);
  });

  it("surfaces retryable: false for VERSION_NOT_FOUND and carries structured details", () => {
    const payload = buildSearchSymbolsErrorPayload(
      new CodeNavigationVersionNotFoundError(
        "No version of npm/express matches '4'.",
        "npm/express",
        "4",
        "5.2.1",
        [{ version: "5.2.1", ref: "v5.2.1" }],
      ),
    );
    expect(payload.code).toBe("VERSION_NOT_FOUND");
    expect(payload.retryable).toBe(false);
    expect(payload.details).toMatchObject({
      package: "npm/express",
      requestedVersion: "4",
      latestIndexed: "5.2.1",
    });
  });

  it("honours backend-supplied retryable override on CodeNavigationBackendError", () => {
    const payload = buildSearchSymbolsErrorPayload(
      new CodeNavigationBackendError("hiccup", 500, "INTERNAL_ERROR", true),
    );
    expect(payload.code).toBe("BACKEND_ERROR");
    expect(payload.retryable).toBe(true);
  });
});
