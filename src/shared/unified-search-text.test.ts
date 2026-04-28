import { describe, expect, it } from "bun:test";
import type {
  UnifiedSearchCompletedPayload,
  UnifiedSearchErrorPayload,
  UnifiedSearchHitPayload,
  UnifiedSearchIncompletePayload,
} from "./unified-search-response.js";
import {
  renderUnifiedSearchError,
  renderUnifiedSearchSuccess,
} from "./unified-search-text.js";

function codeHit(
  overrides: Partial<UnifiedSearchHitPayload> = {},
): UnifiedSearchHitPayload {
  return {
    type: "repository_code",
    target: "cline/cline@v3.4.2",
    title: "applyEdit",
    summary:
      "Search/replace block parser with fuzzy fallback when exact match fails.",
    score: 0.87,
    locator: {
      registry: "npm",
      packageName: "cline",
      version: "v3.4.2",
      filePath: "src/integrations/diff/strategies/multi-search-replace.ts",
      startLine: 142,
      endLine: 156,
      kind: "function",
    },
    ...overrides,
  };
}

function docsHit(): UnifiedSearchHitPayload {
  return {
    type: "documentation_page",
    target: "aider-AI/aider@v0.55.0",
    title: "Edit Formats",
    summary: "Compares whole-file, diff-fenced, udiff, and editblock formats.",
    score: 0.83,
    locator: {
      pageId: "aider/edit-formats",
      sourceUrl: "https://aider.chat/docs/more/edit-formats.html",
      sourceKind: "hosted",
    },
  };
}

function symbolHit(): UnifiedSearchHitPayload {
  return {
    type: "repository_symbol",
    target: "continuedev/continue@v0.9.42",
    title: "diffLines",
    summary: "Myers diff core; line-level with O(ND) complexity.",
    score: 0.91,
    locator: {
      filePath: "core/diff/myers.ts",
      startLine: 48,
      endLine: 112,
      qualifiedPath: "core.diff.myers.diffLines",
      kind: "function",
      category: "callable",
      language: "typescript",
    },
  };
}

function completed(
  results: UnifiedSearchHitPayload[],
  overrides: Partial<UnifiedSearchCompletedPayload> = {},
): UnifiedSearchCompletedPayload {
  return {
    query: { raw: "diff myers" },
    completed: true,
    hasMore: false,
    results,
    ...overrides,
  };
}

describe("renderUnifiedSearchSuccess", () => {
  it("renders an empty completed envelope with a clear message", () => {
    const text = renderUnifiedSearchSuccess(completed([]));
    expect(text).toContain("0 hits");
    expect(text).toContain('query="diff myers"');
    expect(text).toContain("No hits.");
  });

  it("renders a single code hit with locator, title, and summary", () => {
    const text = renderUnifiedSearchSuccess(completed([codeHit()]));
    expect(text).toContain("[1] cline/cline@v3.4.2  code  0.87");
    expect(text).toContain(
      "    src/integrations/diff/strategies/multi-search-replace.ts:142-156  function",
    );
    expect(text).toContain("    applyEdit");
    expect(text).toContain(
      "    Search/replace block parser with fuzzy fallback when exact match fails.",
    );
  });

  it("uses pageId for documentation hits", () => {
    const text = renderUnifiedSearchSuccess(completed([docsHit()]));
    expect(text).toContain("[1] aider-AI/aider@v0.55.0  docs  0.83");
    expect(text).toContain("    pageId: aider/edit-formats");
    expect(text).toContain("    Edit Formats");
  });

  it("renders qualifiedPath alongside file location for symbol hits", () => {
    const text = renderUnifiedSearchSuccess(completed([symbolHit()]));
    expect(text).toContain("[1] continuedev/continue@v0.9.42  symbol  0.91");
    expect(text).toContain(
      "    core/diff/myers.ts:48-112  core.diff.myers.diffLines | function",
    );
    expect(text).toContain("    diffLines");
  });

  it("uses ASCII separators throughout (no multi-byte chars)", () => {
    const text = renderUnifiedSearchSuccess(
      completed([codeHit(), symbolHit()]),
    );
    // No common Unicode-Latin1 separator characters in the output.
    expect(text).not.toMatch(/[·…—–]/);
  });

  it("emits a truncation hint with offset when hasMore", () => {
    const text = renderUnifiedSearchSuccess(
      completed([codeHit()], { hasMore: true, nextOffset: 10 }),
    );
    expect(text).toContain("More hits available. Pass offset=10");
  });

  it("falls back to a plain widen hint when nextOffset is missing", () => {
    const text = renderUnifiedSearchSuccess(
      completed([codeHit()], { hasMore: true }),
    );
    expect(text).toContain("More hits available. Pass limit=N to widen.");
  });

  it("renders incomplete payloads with searchRef and progress hint", () => {
    const incomplete: UnifiedSearchIncompletePayload = {
      query: { raw: "myers" },
      completed: false,
      hasMore: false,
      results: [codeHit()],
      searchRef: "ref_abc-123",
      progress: {
        status: "INDEXING",
        targetsReady: 1,
        targetsTotal: 2,
        elapsedMs: 8200,
      },
    };
    const text = renderUnifiedSearchSuccess(incomplete);
    expect(text).toContain("1 partial");
    expect(text).toContain("searchRef=ref_abc-123");
    expect(text).toContain(
      "Indexing in progress. Call search_status with searchRef=ref_abc-123",
    );
  });

  it("wraps long summaries at the configured width", () => {
    const longSummary =
      "This summary is intentionally long enough to force the wrap logic to break it across multiple lines so the renderer's wrap behaviour is verified.";
    const text = renderUnifiedSearchSuccess(
      completed([codeHit({ summary: longSummary })]),
    );
    const summaryLines = text
      .split("\n")
      .filter(
        (line) => line.startsWith("    ") && line.includes("intentionally"),
      );
    expect(summaryLines.length).toBeGreaterThanOrEqual(1);
    for (const line of text.split("\n")) {
      // 4-space indent + content; allow some slack for the wrap target.
      expect(line.length).toBeLessThanOrEqual(82);
    }
  });

  it("renders source-status notes when the backend reports them", () => {
    const text = renderUnifiedSearchSuccess(
      completed([codeHit()], {
        sourceStatus: [
          {
            source: "code",
            targetLabel: "npm/cline@v3.4.2",
            ignoredFilters: ["fileIntent"],
            note: "fileIntent unsupported on code source",
          },
        ],
      }),
    );
    expect(text).toContain("source notes:");
    expect(text).toContain("- code (npm/cline@v3.4.2)");
    expect(text).toContain("ignored=fileIntent");
  });

  it("separates multiple hits with a blank line", () => {
    const text = renderUnifiedSearchSuccess(
      completed([codeHit(), docsHit(), symbolHit()]),
    );
    const hitHeaders = text.split("\n").filter((line) => /^\[\d\]/.test(line));
    expect(hitHeaders).toHaveLength(3);
    expect(text).toContain("[1] cline/cline@v3.4.2");
    expect(text).toContain("[2] aider-AI/aider@v0.55.0");
    expect(text).toContain("[3] continuedev/continue@v0.9.42");
  });
});

describe("renderUnifiedSearchError", () => {
  it("renders a basic error", () => {
    const error: UnifiedSearchErrorPayload = {
      error: "Target is still indexing.",
      code: "INDEXING",
      retryable: true,
      details: { indexingRef: "ref_xyz" },
    };
    const text = renderUnifiedSearchError(error);
    expect(text).toContain("search | ERROR | code=INDEXING | retryable");
    expect(text).toContain("Target is still indexing.");
    expect(text).toContain("details:");
    expect(text).toContain("  indexingRef: ref_xyz");
  });

  it("omits retryable marker when not set", () => {
    const error: UnifiedSearchErrorPayload = {
      error: "Bad request.",
      code: "INVALID_ARGUMENT",
    };
    const text = renderUnifiedSearchError(error);
    expect(text).toBe("search | ERROR | code=INVALID_ARGUMENT\nBad request.");
  });

  it("serialises object detail values via JSON", () => {
    const error: UnifiedSearchErrorPayload = {
      error: "Indexing.",
      code: "INDEXING",
      details: {
        availableVersions: [
          { version: "4.21.0", ref: "v4.21.0" },
          { version: "4.20.0", ref: "v4.20.0" },
        ],
      },
    };
    const text = renderUnifiedSearchError(error);
    expect(text).toContain('"version":"4.21.0"');
  });
});
