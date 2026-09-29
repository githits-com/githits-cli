import { describe, expect, it } from "bun:test";
import type {
  UnifiedSearchHitPresentation,
  UnifiedSearchStatusCompletedPresentation,
  UnifiedSearchStatusIncompletePresentation,
  UnifiedSearchStatusResultPresentation,
} from "./unified-search-response.js";
import { renderUnifiedSearchStatusText } from "./unified-search-status-text.js";

function hit(): UnifiedSearchHitPresentation {
  return {
    type: "documentation_page",
    target: "npm:express@5.2.1",
    title: "Routing",
    locator: { pageId: "express/routing" },
    readTarget: { target: "express/routing" },
  };
}

function result(
  overrides: Partial<UnifiedSearchStatusResultPresentation> = {},
): UnifiedSearchStatusResultPresentation {
  return {
    query: { raw: "router" },
    partialResults: false,
    hasMore: false,
    results: [],
    ...overrides,
  };
}

function active(
  overrides: Partial<UnifiedSearchStatusIncompletePresentation> = {},
): UnifiedSearchStatusIncompletePresentation {
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
    const payload: UnifiedSearchStatusIncompletePresentation = active({
      result: result({ results: [hit()] }),
    });
    const text = renderUnifiedSearchStatusText(payload);

    expect(firstLine(text)).toBe(
      "1 interim result | 1 docs page | indexing | 0/1 ready",
    );
    expect(text).toContain(
      "express/routing [docs page] npm:express - source URL unavailable - Routing",
    );
    expect(text).toContain(
      'Next: search_status search_ref="search-ref-status" wait_timeout_ms=30000',
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
      "1 partial result | 1 docs page | indexing | 0/1 ready",
    );
  });

  it("distinguishes status snapshots with partialResults true", () => {
    const payload = active({
      result: result({ partialResults: true, results: [hit()] }),
    });
    const text = renderUnifiedSearchStatusText(payload);
    expect(firstLine(text)).toContain("1 partial result");
    expect(text).not.toContain("1 interim result");
  });

  it.each([false, true])(
    "renders backend selectors in stored results (completed=%s)",
    (completed) => {
      const actionHit: UnifiedSearchHitPresentation = {
        ...hit(),
        readTarget: { target: "opaque-page", selector: "Routing heading" },
      };
      const payload = completed
        ? {
            completed: true as const,
            searchRef: "stored",
            result: result({
              results: [actionHit],
              hasMore: true,
              nextOffset: 5,
            }),
          }
        : active({
            result: result({
              results: [actionHit],
              hasMore: true,
              nextOffset: 5,
            }),
          });
      const mcp = renderUnifiedSearchStatusText(payload);
      const cli = renderUnifiedSearchStatusText(payload, {
        actionSyntax: "cli",
      });
      expect(mcp).toContain(
        'read target="opaque-page" selector="Routing heading"',
      );
      expect(cli).toContain(
        "githits read 'opaque-page' --selector 'Routing heading'",
      );
      expect(mcp.match(/read target=/g)).toHaveLength(1);
      expect(cli.match(/githits read /g)).toHaveLength(1);
      expect(mcp).toContain("next_offset=5");
      expect(cli).toContain("next_offset=5");
      if (!completed) {
        expect(mcp).toContain("Next: search_status");
        expect(cli).toContain("Next: githits search-status");
      }
    },
  );

  it("keeps full CLI selections and caps MCP file actions in retained status", () => {
    const actionHit: UnifiedSearchHitPresentation = {
      ...hit(),
      type: "repository_code",
      readTarget: {
        target: "served-revision",
        path: "actual.ts",
        startLine: 1,
        endLine: 900,
      },
    };
    const payload = active({ result: result({ results: [actionHit] }) });
    expect(renderUnifiedSearchStatusText(payload)).toContain(
      'read target="served-revision" path="actual.ts" start_line=1 end_line=300',
    );
    expect(
      renderUnifiedSearchStatusText(payload, { actionSyntax: "cli" }),
    ).toContain("githits read 'served-revision' 'actual.ts' --lines 1-900");
  });

  it("keeps pathless docs preview ranges separate from its full action", () => {
    const actionHit: UnifiedSearchHitPresentation = {
      ...hit(),
      type: "repository_doc",
      locator: {
        ...hit().locator,
        filePath: "guide.md",
        startLine: 42,
        endLine: 48,
      },
      readTarget: {
        target: "opaque-page",
        selector: "chapter",
        startLine: 1,
        endLine: 900,
      },
    };
    const text = renderUnifiedSearchStatusText(
      active({ result: result({ results: [actionHit] }) }),
    );
    expect(text).toContain("npm:express@5.2.1 guide.md:42-48 [repo doc]");
    expect(text).toContain(
      'read target="opaque-page" selector="chapter" start_line=1 end_line=900',
    );
  });

  it("retains package attribution and producer preview despite a different canonical action", () => {
    const actionHit: UnifiedSearchHitPresentation = {
      type: "repository_code",
      target: "npm:package@1.2.3",
      locator: {
        registry: "npm",
        packageName: "package",
        filePath: "src/view.ts",
        repositoryFilePath: "packages/package/src/view.ts",
        startLine: 90,
        endLine: 95,
      },
      repositoryEvidence: {
        semanticContext: null,
        matchedSource: {
          startLine: 90,
          endLine: 95,
          matchLine: 90,
          rangeKind: "syntax_context",
          matchSpansTruncated: false,
          lines: [
            {
              lineNumber: 90,
              text: "export const view = 1",
              highlights: [[0, 6]],
              prefixTruncated: false,
              suffixTruncated: false,
            },
          ],
          linesOmittedBefore: false,
          linesOmittedAfter: false,
        },
      },
      readTarget: {
        target: "github:owner/monorepo@served-sha",
        path: "packages/package/src/view.ts",
        startLine: 1,
        endLine: 500,
      },
    };
    const text = renderUnifiedSearchStatusText(
      active({ result: result({ results: [actionHit] }) }),
      { actionSyntax: "cli" },
    );
    expect(text).toContain(
      "[1] npm:package@1.2.3 src/view.ts:90-95 [repo code]",
    );
    expect(text).toContain("> 90 | export const view = 1");
    expect(text).toContain(
      "githits read 'github:owner/monorepo@served-sha' 'packages/package/src/view.ts' --lines 1-500",
    );
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
      "No result snapshot yet | preparing | 0/1 ready",
    );
    expect(text).not.toContain("Indexing:");
    expect(text).not.toContain("No hits");
    expect(text).toContain("- npm:express");
    expect(text).toContain(
      'Next: search_status search_ref="search-ref-status" wait_timeout_ms=30000',
    );
  });

  it("renders a completed empty stored result with one applicable action", () => {
    const payload: UnifiedSearchStatusCompletedPresentation = {
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
    expect(firstLine(text)).toBe("No results");
    expect(text).toContain("- npm:express@5.2.1\n  searched: code");
    expect(text).toContain(
      'Next: shorten or broaden query; use source="symbol"; use code_grep.',
    );
    expect(text).not.toContain("Search search-ref-empty | completed");
  });

  it("terminal target recovery renders typed guidance for stored results", () => {
    const payload: UnifiedSearchStatusCompletedPresentation = {
      completed: true,
      searchRef: "search-ref-terminal",
      result: result({
        sourceStatus: [
          {
            source: "CODE",
            targetLabel: "npm:express@4.18.2",
            codeIndexState: "NOT_FOUND",
          },
          {
            source: "CODE",
            targetLabel: "github:owner/repo@main",
            indexingStatus: "UNRESOLVABLE",
            targetResolution: {
              freshness: "indexing",
              freshnessReason: "no_current_fallback",
              requested: { repoUrl: "https://github.com/owner/repo" },
              availableVersions: [],
              availableRefs: [],
            },
          },
          {
            source: "DOCS",
            targetLabel: "site:docs.example.com",
            codeIndexState: "UNRESOLVABLE",
          },
          {
            source: "CODE",
            targetLabel: "opaque:target",
            indexingStatus: "NOT_FOUND",
          },
        ],
      }),
    };
    const text = renderUnifiedSearchStatusText(payload);

    expect(text).toContain(
      "Fix: verify registry coordinate/version; use its public repository for",
    );
    expect(text).toContain("repo-wide search.");
    expect(text).toContain("Fix: verify public repository/ref.");
    expect(text).toContain("Fix: verify site host/path.");
    expect(text).toContain("Fix: verify or replace target.");
    expect(text).not.toContain("rerun search later");
    expect(text).not.toContain("searchRef=");
  });

  it("continues completed mutable evidence through one status action", () => {
    const payload: UnifiedSearchStatusCompletedPresentation = {
      completed: true,
      searchRef: "search-ref-evidence",
      result: result({
        results: [hit()],
        evidenceNotice: "opaque backend notice",
      }),
    };
    const text = renderUnifiedSearchStatusText(payload);
    expect(firstLine(text)).toContain("1 result");
    expect(text).not.toContain("Search search-ref-evidence | completed");
    expect(text).toContain(
      'Next: search_status search_ref="search-ref-evidence" wait_timeout_ms=30000',
    );
    expect(text).not.toContain("opaque backend notice");
    expect(text).not.toContain("Evidence may change.");
    expect(text).not.toContain("Do not repeat");
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
      expect(firstLine(text)).toBe(
        `No result snapshot | ${status.toLowerCase()} | 0/1 ready`,
      );
      expect(text).toContain("Next: rerun search later.");
      expect(text).not.toContain("Do not poll");
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
      "No result snapshot | status unknown | 0/1 ready",
    );
    expect(text).toContain("Next: rerun search later.");
    expect(text).not.toContain("Do not poll");
    expect(text).not.toContain("Next: search_status");
  });
});
