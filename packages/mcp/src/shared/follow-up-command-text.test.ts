import { describe, expect, it } from "bun:test";
import type { UnifiedSearchSemanticPreferredRead } from "@githits/core-internal";
import { parseCodeNavigationTargetSpec } from "./code-navigation-target.js";
import { buildSearchHitFollowUpCommand } from "./follow-up-command-text.js";
import type { UnifiedSearchHitPayload } from "./unified-search-response.js";

const commitSha = "0123456789abcdef0123456789abcdef01234567";
const preferredRead: UnifiedSearchSemanticPreferredRead = {
  targetLabel: "npm:pkg@1.2.3",
  registry: "npm",
  packageName: "pkg",
  version: "1.2.3",
  repoUrl: "https://github.com/owner/monorepo",
  gitRef: commitSha,
  commitSha,
  requestedRef: "main",
  filePath: "src/client.ts",
  repositoryFilePath: "packages/pkg/src/client.ts",
  startLine: 120,
  endLine: 165,
};

function hit(
  read: UnifiedSearchSemanticPreferredRead,
): UnifiedSearchHitPayload {
  return {
    type: "repository_doc",
    target: "github:owner/monorepo#main",
    locator: { pageId: "opaque-page", filePath: "different-path.md" },
    repositoryEvidence: {
      semanticContext: {
        scopes: [],
        scopeChainTruncated: false,
        preferredRead: read,
      },
      focusedSource: {
        startLine: 142,
        endLine: 145,
        matchLine: 143,
        rangeKind: "match_window",
        matchSpansTruncated: false,
        lines: [],
        linesOmittedBefore: false,
        linesOmittedAfter: false,
      },
    },
  };
}

describe("semantic preferred reads", () => {
  it("uses package attribution and source context before a repository doc page ID", () => {
    expect(buildSearchHitFollowUpCommand(hit(preferredRead))).toBe(
      'code_read target="npm:pkg@1.2.3" path="src/client.ts" start_line=120 end_line=165',
    );
    expect(buildSearchHitFollowUpCommand(hit(preferredRead), "cli")).toBe(
      "githits code read 'npm:pkg@1.2.3' 'src/client.ts' --lines 120-165",
    );
  });

  it("pairs exact repository commits with repository-root paths", () => {
    const read = {
      ...preferredRead,
      registry: null,
      packageName: null,
      version: null,
    };
    const target = `github:owner/monorepo#${commitSha}`;
    expect(buildSearchHitFollowUpCommand(hit(read))).toBe(
      `code_read target="${target}" path="packages/pkg/src/client.ts" start_line=120 end_line=165`,
    );
    expect(buildSearchHitFollowUpCommand(hit(read), "cli")).toBe(
      `githits code read '${target}' 'packages/pkg/src/client.ts' --lines 120-165`,
    );
    expect(parseCodeNavigationTargetSpec(target)).toEqual({
      repoUrl: preferredRead.repoUrl,
      gitRef: commitSha,
    });
  });

  it.each(["github:owner/monorepo#main", "owner/monorepo@main"])(
    "honors repository label %s even when synthetic package metadata is populated",
    (targetLabel) => {
      const read = {
        ...preferredRead,
        targetLabel,
        version: commitSha,
      };
      const target = `github:owner/monorepo#${commitSha}`;
      expect(buildSearchHitFollowUpCommand(hit(read))).toBe(
        `code_read target="${target}" path="packages/pkg/src/client.ts" start_line=120 end_line=165`,
      );
      expect(buildSearchHitFollowUpCommand(hit(read), "cli")).toBe(
        `githits code read '${target}' 'packages/pkg/src/client.ts' --lines 120-165`,
      );
    },
  );

  it("bounds only the MCP action around the focused evidence and retains true bounds", () => {
    const read = { ...preferredRead, startLine: 1, endLine: 600 };
    const value = hit(read);
    expect(buildSearchHitFollowUpCommand(value)).toBe(
      'code_read target="npm:pkg@1.2.3" path="src/client.ts" start_line=1 end_line=300',
    );
    expect(buildSearchHitFollowUpCommand(value, "cli")).toEndWith(
      "--lines 1-600",
    );
    expect(read.endLine).toBe(600);
    expect(
      buildSearchHitFollowUpCommand(hit({ ...read, endLine: 300 })),
    ).toEndWith("start_line=1 end_line=300");
    expect(
      buildSearchHitFollowUpCommand(hit({ ...read, endLine: 301 })),
    ).toEndWith("start_line=1 end_line=300");
  });

  it("keeps preferred reads usable without focused source", () => {
    const value = hit(preferredRead);
    value.repositoryEvidence!.focusedSource = null;
    expect(buildSearchHitFollowUpCommand(value)).toEndWith(
      "start_line=120 end_line=165",
    );
    value.repositoryEvidence!.semanticContext = null;
    expect(buildSearchHitFollowUpCommand(value)).toBe(
      'docs_read page_id="opaque-page"',
    );
  });
});
