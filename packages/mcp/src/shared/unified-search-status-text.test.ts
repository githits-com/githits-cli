import { describe, expect, it } from "bun:test";
import type {
  UnifiedSearchHitPayload,
  UnifiedSearchStatusCompletedPayload,
  UnifiedSearchStatusIncompletePayload,
  UnifiedSearchStatusResultPayload,
} from "./unified-search-response.js";
import { renderUnifiedSearchStatusText } from "./unified-search-status-text.js";

function hit(): UnifiedSearchHitPayload {
  return {
    type: "documentation_page",
    target: "npm:express@5.2.1",
    title: "Routing",
    locator: { pageId: "express/routing" },
  };
}

function result(
  overrides: Partial<UnifiedSearchStatusResultPayload> = {},
): UnifiedSearchStatusResultPayload {
  return {
    query: { raw: "router" },
    partialResults: false,
    hasMore: false,
    results: [],
    ...overrides,
  };
}

function active(
  overrides: Partial<UnifiedSearchStatusIncompletePayload> = {},
): UnifiedSearchStatusIncompletePayload {
  return {
    completed: false,
    searchRef: "search-ref-status",
    progress: {
      status: "INDEXING",
      targetsReady: 0,
      targetsTotal: 1,
      elapsedMs: 100,
    },
    ...overrides,
  };
}

function firstLine(text: string): string {
  return text.split("\n")[0] ?? "";
}

describe("renderUnifiedSearchStatusText", () => {
  it("uses the same outcome and exact Next action as initial search", () => {
    const payload: UnifiedSearchStatusIncompletePayload = active({
      result: result({ results: [hit()] }),
    });
    const text = renderUnifiedSearchStatusText(payload);

    expect(firstLine(text)).toBe(
      "Indexing continues - 1 interim result returned",
    );
    expect(text).toContain("[1] express/routing npm:express  docs");
    expect(text).toContain("Do not repeat search.\nNext:");
    expect(text).toContain(
      'Next: search_status search_ref="search-ref-status" wait_timeout_ms=20000',
    );
    expect(text).not.toContain("search_status |");
    expect(text).not.toContain("searchRef=");
  });

  it("keeps status and initial rendering aligned for equivalent partial evidence", () => {
    const statusText = renderUnifiedSearchStatusText(
      active({
        result: result({ partialResults: true, results: [hit()] }),
      }),
    );
    expect(firstLine(statusText)).toBe(
      "Indexing continues - 1 partial result returned",
    );
  });

  it("distinguishes status snapshots with partialResults true", () => {
    const payload = active({
      result: result({ partialResults: true, results: [hit()] }),
    });
    const text = renderUnifiedSearchStatusText(payload);
    expect(firstLine(text)).toContain("1 partial result returned");
    expect(text).not.toContain("1 interim result");
  });

  it("renders progress-only status without inventing sources or a no-hits claim", () => {
    const text = renderUnifiedSearchStatusText(
      active({
        progress: {
          status: "PENDING",
          targetsReady: 0,
          targetsTotal: 1,
          elapsedMs: 100,
          targets: [{ requested: "npm:express", freshness: "PENDING" }],
        },
      }),
    );
    expect(firstLine(text)).toBe(
      "Preparing npm:express - no result snapshot returned yet",
    );
    expect(text).not.toContain("Waiting:");
    expect(text).not.toContain("No hits");
    expect(text).toContain("Ready: 0/1 targets");
    expect(text).toContain("Do not repeat search.\nNext:");
  });

  it("renders a completed empty stored result with one applicable action", () => {
    const payload: UnifiedSearchStatusCompletedPayload = {
      completed: true,
      searchRef: "search-ref-empty",
      result: result({
        sourceStatus: [
          {
            source: "code",
            targetLabel: "npm:express@5.2.1",
            resultCount: 0,
          },
        ],
      }),
    };
    const text = renderUnifiedSearchStatusText(payload);
    expect(firstLine(text)).toContain("No results returned");
    expect(text).toContain("Searched: code");
    expect(text).toContain("Do not repeat this search unchanged.");
    expect(text).toContain("shorten or broaden query");
    expect(text).not.toContain("search-ref-empty");
  });

  it("continues completed mutable evidence through one status action", () => {
    const payload: UnifiedSearchStatusCompletedPayload = {
      completed: true,
      searchRef: "search-ref-evidence",
      result: result({
        results: [hit()],
        evidenceNotice: "opaque backend notice",
      }),
    };
    const text = renderUnifiedSearchStatusText(payload);
    expect(firstLine(text)).toContain("1 result");
    expect(text).toContain("Evidence may change.");
    expect(text).toContain("Do not repeat immediately.\nNext:");
    expect(text).toContain(
      'Next: search_status search_ref="search-ref-evidence" wait_timeout_ms=20000',
    );
    expect(text).not.toContain("opaque backend notice");
  });

  it.each(["DEFERRED", "TIMEOUT", "FAILED"] as const)(
    "does not poll a terminal stored status: %s",
    (status) => {
      const text = renderUnifiedSearchStatusText(
        active({
          progress: {
            status,
            targetsReady: 0,
            targetsTotal: 1,
            elapsedMs: 60_000,
          },
        }),
      );
      expect(firstLine(text)).toStartWith(status);
      expect(text).toContain("Do not poll this session again.");
      expect(text).not.toContain("Next: search_status");
    },
  );

  it("preserves unknown status without polling", () => {
    const text = renderUnifiedSearchStatusText(
      active({
        progress: {
          status: "FUTURE_SESSION_STATE",
          targetsReady: 0,
          targetsTotal: 1,
          elapsedMs: 60_000,
        },
      }),
    );
    expect(firstLine(text)).toBe(
      "FUTURE_SESSION_STATE - no result snapshot returned",
    );
    expect(text).toContain("Do not poll this session again.");
    expect(text).not.toContain("Next: search_status");
  });
});
