import { describe, expect, it } from "bun:test";
import type { UnifiedSearchStatusCompletedPayload } from "./unified-search-response.js";
import { renderUnifiedSearchStatusText } from "./unified-search-status-text.js";

describe("renderUnifiedSearchStatusText", () => {
  it("renders stored documentation contributors and the evidence notice once", () => {
    const notice =
      "Results reflect disclosed snapshots; pending work may change hits and ordering.";
    const payload: UnifiedSearchStatusCompletedPayload = {
      completed: true,
      searchRef: "search-ref-docs",
      result: {
        hasMore: false,
        results: [],
        evidenceNotice: notice,
        sourceStatus: [
          {
            source: "docs",
            targetLabel: "site:docs.example.com",
            contributors: [
              {
                kind: "DOCPACK",
                state: "SEARCHED",
                freshness: "CURRENT",
                resultCount: 0,
                siteKey: "5555555555555555",
                coverage: {
                  coverageState: "PARTIAL",
                  pagesCrawled: 120,
                  frontierRemaining: null,
                  artifactOverflowPageCount: 0,
                  note: "Indexing is still in progress.",
                },
              },
            ],
          },
        ],
      },
    };

    const text = renderUnifiedSearchStatusText(payload);

    expect(text).toContain(
      "site docs.example.com - searched; published snapshot is partial: 120 pages included",
    );
    expect(text).toContain("documentation sources:");
    expect(text).not.toContain("hits on this page");
    expect(text).not.toContain("documentation corpora");
    expect(text).not.toContain("Indexing is still in progress");
    expect(text).toContain("No hits in the searched evidence on this page.");
    expect(text).toContain("Do not repeat immediately.");
    expect(text.match(new RegExp(notice, "g"))).toHaveLength(1);
    expect(text).not.toContain("next: call search_status");
  });

  it("does not add an empty source-details separator", () => {
    const payload: UnifiedSearchStatusCompletedPayload = {
      completed: true,
      searchRef: "search-ref-healthy",
      result: {
        hasMore: false,
        results: [],
        sourceStatus: [
          {
            source: "docs",
            targetLabel: "site:docs.example.com",
            contributors: [],
          },
        ],
      },
    };

    const text = renderUnifiedSearchStatusText(payload);

    expect(text).toContain("\n\nNo hits for docs on site:docs.example.com.");
    expect(text).not.toContain("\n\n\n");
  });

  it("does not leave a trailing separator after healthy stored results", () => {
    const payload: UnifiedSearchStatusCompletedPayload = {
      completed: true,
      searchRef: "search-ref-healthy",
      result: {
        hasMore: false,
        results: [
          {
            type: "documentation_page",
            target: "npm:express@5.2.1",
            title: "Routing",
            locator: {
              pageId: "express/routing",
              sourceUrl: "https://expressjs.com/en/guide/routing.html",
            },
          },
        ],
        sourceStatus: [
          {
            source: "docs",
            targetLabel: "npm:express@5.2.1",
            contributors: [
              {
                kind: "REPOSITORY_DOCS",
                state: "SEARCHED",
                freshness: "CURRENT",
                resultCount: 1,
                repositoryUrl: "https://github.com/expressjs/express",
                commitSha: "0123456789abcdef0123456789abcdef01234567",
              },
            ],
          },
        ],
      },
    };

    const text = renderUnifiedSearchStatusText(payload);

    expect(text.indexOf("searched:")).toBeLessThan(text.indexOf("[1]"));
    expect(text.endsWith("\n")).toBe(false);
  });
});
