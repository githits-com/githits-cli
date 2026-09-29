import { describe, expect, it } from "bun:test";
import type { ReadTarget } from "@githits/core-internal";
import { buildSearchHitFollowUpCommand } from "./follow-up-command-text.js";
import type { UnifiedSearchHitPresentation } from "./unified-search-response.js";

function hit(readTarget?: ReadTarget | null): UnifiedSearchHitPresentation {
  return {
    type: "repository_code",
    target: "npm:wrong@1",
    readTarget,
    locator: {
      registry: "npm",
      packageName: "wrong",
      version: "1",
      repoUrl: "https://github.com/wrong/repo",
      gitRef: "main",
      commitSha: "wrong-sha",
      filePath: "wrong.ts",
      repositoryFilePath: "packages/wrong.ts",
      startLine: 10,
      endLine: 11,
      evidenceRange: { startLine: 10, endLine: 11, matchSpansTruncated: false },
    },
  };
}

describe("backend-selected search actions", () => {
  it.each([
    "repository_code",
    "repository_symbol",
    "repository_doc",
    "documentation_page",
  ])(
    "uses the exact descriptor instead of conflicting %s locator facts",
    (type) => {
      const value = {
        ...hit({
          target: "github:owner/repo@served-sha",
          path: "root/right.ts",
          startLine: 20,
          endLine: 80,
        }),
        type,
      };
      expect(buildSearchHitFollowUpCommand(value)).toBe(
        'read target="github:owner/repo@served-sha" path="root/right.ts" start_line=20 end_line=80',
      );
      expect(buildSearchHitFollowUpCommand(value, "cli")).toBe(
        "githits read 'github:owner/repo@served-sha' 'root/right.ts' --lines 20-80",
      );
    },
  );

  it.each(["repository_symbol", "documentation_page"])(
    "keeps opaque selectors on %s",
    (type) => {
      const value = {
        ...hit({
          target: "https://host.test/page?x=%25",
          selector: "logical heading / symbol",
        }),
        type,
      };
      expect(buildSearchHitFollowUpCommand(value)).toBe(
        'read target="https://host.test/page?x=%25" selector="logical heading / symbol"',
      );
      expect(buildSearchHitFollowUpCommand(value, "cli")).toBe(
        "githits read 'https://host.test/page?x=%25' --selector 'logical heading / symbol'",
      );
      expect(buildSearchHitFollowUpCommand(value)).not.toContain("start_line");
    },
  );

  it.each([299, 300, 301])(
    "caps a path selection of %i lines only for MCP",
    (endLine) => {
      const action = {
        target: "npm:right@2",
        path: "right.ts",
        startLine: 1,
        endLine,
      };
      const value = hit(action);
      expect(buildSearchHitFollowUpCommand(value)).toEndWith(
        `start_line=1 end_line=${Math.min(endLine, 300)}`,
      );
      expect(buildSearchHitFollowUpCommand(value, "cli")).toEndWith(
        `--lines 1-${endLine}`,
      );
      expect(action.endLine).toBe(endLine);
    },
  );

  it("leaves pathless repository-doc bounds above 300 uncapped", () => {
    const value = {
      ...hit({ target: "opaque-page", startLine: 1, endLine: 900 }),
      type: "repository_doc",
    };
    expect(buildSearchHitFollowUpCommand(value)).toBe(
      'read target="opaque-page" start_line=1 end_line=900',
    );
  });

  it("centers ordinary cap bounds on locator evidence without enlarging selection", () => {
    const value = hit({
      target: "selected",
      path: "selected.ts",
      startLine: 50,
      endLine: 1000,
    });
    value.locator.evidenceRange = {
      startLine: 600,
      endLine: 610,
      matchSpansTruncated: false,
    };
    expect(buildSearchHitFollowUpCommand(value)).toEndWith(
      "start_line=456 end_line=755",
    );
    value.locator.evidenceRange = {
      startLine: 990,
      endLine: 1200,
      matchLine: 999,
      matchSpansTruncated: false,
    };
    expect(buildSearchHitFollowUpCommand(value)).toEndWith(
      "start_line=701 end_line=1000",
    );
  });

  it("uses semantic matched-source evidence rather than locator evidence", () => {
    const value = hit({
      target: "selected",
      path: "root/right.ts",
      startLine: 50,
      endLine: 1000,
    });
    value.repositoryEvidence = {
      semanticContext: {
        scopes: [],
        scopeChainTruncated: false,
        preferredRead: {
          targetLabel: "wrong",
          registry: null,
          packageName: null,
          version: null,
          repoUrl: "wrong",
          gitRef: "wrong",
          commitSha: "wrong",
          requestedRef: null,
          filePath: "wrong",
          repositoryFilePath: "wrong",
          startLine: 1,
          endLine: 2,
        },
      },
      matchedSource: {
        startLine: 600,
        endLine: 610,
        matchLine: null,
        rangeKind: "syntax_context",
        matchSpansTruncated: false,
        lines: [],
        linesOmittedBefore: false,
        linesOmittedAfter: false,
      },
    };
    expect(buildSearchHitFollowUpCommand(value)).toEndWith(
      "start_line=456 end_line=755",
    );
    value.repositoryEvidence.matchedSource = null;
    expect(buildSearchHitFollowUpCommand(value)).toEndWith(
      "start_line=50 end_line=349",
    );
  });

  it.each([undefined, null])(
    "does not reconstruct an omitted/null custom-provider action: %s",
    (action) => {
      expect(buildSearchHitFollowUpCommand(hit(action))).toBe(
        "follow-up unavailable: missing read target",
      );
    },
  );

  it.each(["repository_code", "repository_symbol"])(
    "reports missing exact revision for %s even with a mutable gitRef",
    (type) => {
      const value = hit(null);
      value.type = type;
      value.target = "github:wrong/repo@main";
      delete value.locator.commitSha;
      expect(buildSearchHitFollowUpCommand(value)).toBe(
        "follow-up unavailable: missing exact revision",
      );
    },
  );

  it("keeps the missing file-path reason without synthesizing an address", () => {
    const value = hit(null);
    delete value.locator.filePath;
    delete value.locator.repositoryFilePath;
    expect(buildSearchHitFollowUpCommand(value)).toBe(
      "follow-up unavailable: missing filePath",
    );
  });
});
