import { describe, expect, it } from "bun:test";
import type {
  GrepHit,
  GrepResult,
  GrepTargetStatus,
} from "@githits/core-internal";
import { projectGrepResult } from "./grep-response.js";
import { formatGrepText, formatReadAction } from "./grep-text.js";

const slice = {
  content: "router",
  startByte: 0,
  endByte: 6,
  originalLineBytes: 6,
};
const target: GrepTargetStatus = {
  targetIndex: 7,
  requestedInputIndices: [1, 0],
  kind: "REPOSITORY",
  target: "npm:x",
  traversal: "COMPLETE",
  readiness: "CURRENT",
  errorCode: null,
  retryable: false,
  publicMessage: null,
  requestedRef: "v1",
  commitSha: "abc",
  corpus: "ALL",
  filesScanned: 1,
  filesInScope: 1,
  binaryFilesSkipped: 0,
  filesTooLargeSkipped: 0,
  fileIssues: [],
  fileIssuesOmitted: 0,
};
const hit: GrepHit = {
  __typename: "GrepRepositoryHit",
  targetIndex: 7,
  filePath: "lib/a.ts",
  line: 2,
  lineSlice: slice,
  contextBeforeSlices: [],
  contextAfterSlices: [],
  contentSafety: { filtered: false },
  read: {
    target: "github:o/r@abc",
    path: "packages/x/lib/a.ts",
    startLine: 2,
    endLine: 2,
  },
};
function result(overrides: Partial<GrepResult> = {}): GrepResult {
  return {
    hits: [hit],
    targets: [target],
    unavailableTargets: [],
    traversal: "COMPLETE",
    nextCursor: null,
    totalMatches: 1,
    ...overrides,
  };
}

describe("unified grep result and text", () => {
  it("retains an unvisited selected site and explains its continuation", () => {
    const page = result({
      targets: [
        target,
        {
          ...target,
          targetIndex: 8,
          requestedInputIndices: [0, 1],
          kind: "SITE",
          target: "site:docs.test",
          corpus: null,
          readiness: "UNSPECIFIED",
          traversal: "RESUMABLE_LIMIT",
        },
      ],
      traversal: "RESUMABLE_LIMIT",
      nextCursor: "opaque",
    });
    expect(projectGrepResult(page)).toEqual(page);
    const output = formatGrepText(page);
    expect(output).toContain("inputs 0, 1 | UNSPECIFIED / RESUMABLE_LIMIT");
    expect(output).toContain("Coverage: not visited in this page");
    expect(output).toContain("--cursor 'opaque'");
    expect(output).not.toContain("Unavailable input");
    expect(output).toContain("2: router");
  });
  it("preserves source and context backslashes while escaping terminal controls", () => {
    const source = String.raw`const re = /\d+/; s.split("\n")`;
    const context = String.raw`const path = "C:\src\file.ts"`;
    const output = formatGrepText(
      result({
        hits: [
          {
            ...hit,
            lineSlice: {
              content: `${source}\x1b`,
              startByte: 0,
              endByte: source.length + 1,
              originalLineBytes: source.length + 1,
            },
            contextBeforeSlices: [
              {
                content: context,
                startByte: 0,
                endByte: context.length,
                originalLineBytes: context.length,
              },
            ],
          },
        ],
      }),
    );
    expect(output).toContain(`2: ${source}\\u001b`);
    expect(output).toContain(`1- ${context}`);
    expect(output).not.toContain("\x1b");
  });
  it("preserves different match windows on the same long physical line", () => {
    const first = {
      ...hit,
      lineSlice: {
        content: "first router",
        startByte: 0,
        endByte: 12,
        originalLineBytes: 1000,
      },
    };
    const second = {
      ...hit,
      lineSlice: {
        content: "second router",
        startByte: 500,
        endByte: 513,
        originalLineBytes: 1000,
      },
    };
    const output = formatGrepText(
      result({ hits: [first, second], totalMatches: 2 }),
    );
    expect(output).toContain("first router [...]");
    expect(output).toContain("[...] second router [...]");
    expect(output.match(/\[7\] lib\/a.ts/g)).toHaveLength(2);
  });
  it("allowlists fields, preserves selected nulls, details and independent arrays", () => {
    const data = result({
      hits: [
        {
          ...hit,
          lineContent: "router",
          matchStartByte: 0,
          matchEndByte: 6,
          sourceMatchStartByte: 10,
          sourceMatchEndByte: 16,
          contentSafety: {
            filtered: true,
            modifications: ["INVISIBLE_CONTROLS_STRIPPED"],
          },
        },
      ],
    });
    const projected = projectGrepResult({
      ...data,
      unknown: "drop",
    } as GrepResult);
    expect(projected).toEqual(data);
    expect(projected.targets[0]?.publicMessage).toBeNull();
    expect(projected.hits[0]?.sourceMatchStartByte).toBe(10);
    projected.hits.pop();
    expect(data.hits).toHaveLength(1);
    const compact = projectGrepResult(result());
    expect(compact.hits[0]).not.toHaveProperty("lineContent");
    expect(compact).not.toHaveProperty("hasMore");
  });
  it("preserves producer ordering and uses server reads rather than display paths", () => {
    const site: GrepHit = {
      ...hit,
      __typename: "GrepSiteHit",
      targetIndex: 4,
      pageUrl: "https://docs.test/p",
      read: {
        target: "https://docs.test/p",
        path: null,
        startLine: 2,
        endLine: 2,
      },
    };
    const output = formatGrepText(
      result({
        hits: [hit, site, hit],
        targets: [
          target,
          {
            ...target,
            targetIndex: 4,
            kind: "SITE",
            commitSha: null,
            corpus: null,
          },
        ],
      }),
    );
    expect(output.match(/\[7\] lib\/a.ts/g)).toHaveLength(2);
    expect(output.indexOf("[7] lib/a.ts")).toBeLessThan(
      output.indexOf("[4] https://docs.test/p"),
    );
    expect(output).toContain(
      "githits read 'github:o/r@abc' 'packages/x/lib/a.ts' --lines 2-2",
    );
    expect(output).toContain("githits read 'https://docs.test/p' --lines 2-2");
    expect(output).toContain("inputs 1, 0");
    expect(output).toContain("latest active content");
  });
  it("merges overlapping context while keeping match markers and slice omissions", () => {
    const output = formatGrepText(
      result({
        hits: [
          {
            ...hit,
            lineSlice: {
              ...slice,
              startByte: 10,
              endByte: 16,
              originalLineBytes: 30,
            },
            contextBeforeSlices: [{ ...slice, content: "before" }],
            contextAfterSlices: [{ ...slice, content: "after" }],
          },
          { ...hit, line: 3, read: { ...hit.read, startLine: 3, endLine: 3 } },
        ],
      }),
    );
    expect(output).toContain("1- before");
    expect(output).toContain("2: [...] router [...]");
    expect(output).toContain("3: router");
    expect(output).not.toContain("3- after");
  });
  it("keeps all coverage warnings visible on zero-hit complete or partial pages", () => {
    const scopes = [
      { ...target, readiness: "STALE" as const },
      {
        ...target,
        traversal: "FAILED" as const,
        errorCode: "READ_FAILED",
        publicMessage: "reader unavailable",
      },
      { ...target, binaryFilesSkipped: 1 },
      { ...target, filesTooLargeSkipped: 1 },
      {
        ...target,
        fileIssues: [
          {
            filePath: "a",
            code: "LINE_TOO_LARGE",
            line: 0,
            contentSafety: { filtered: true },
          },
        ],
        fileIssuesOmitted: 2,
      },
    ];
    for (const scope of scopes) {
      const output = formatGrepText(
        result({ hits: [], totalMatches: 0, targets: [scope] }),
      );
      expect(output).toContain("Zero returned matches");
      expect(output).not.toContain("No matches.");
    }
    const output = formatGrepText(
      result({ hits: [], totalMatches: 0, targets: [scopes[4]!] }),
    );
    expect(output).toContain("(aggregate)");
    expect(output).toContain("2 additional file issue");
    expect(output).toContain("safety normalization");
    expect(formatGrepText(result({ hits: [], totalMatches: 0 }))).toContain(
      "No matches.",
    );
  });
  it("shows cursor and terminal omissions together and requires explicit expiry restart", () => {
    const omission = {
      inputIndex: 2,
      target: "npm:y",
      reason: "docs_not_ready",
      retryable: true,
      progressRef: "crawl:1",
      suggestedSiteTargets: ["site:docs.test"],
    };
    const output = formatGrepText(
      result({
        traversal: "NON_RESUMABLE_PARTIAL",
        nextCursor: "opaque",
        unavailableTargets: [omission],
      }),
    );
    expect(output).toContain("docs_not_ready");
    expect(output).toContain("crawl:1");
    expect(output).toContain("Suggested site");
    expect(output).toContain("--cursor 'opaque'");
    expect(output).toContain("same ordered targets and controls");
    expect(
      formatGrepText(
        result({
          targets: [{ ...target, traversal: "RESUMABLE_LIMIT" }],
          traversal: "RESUMABLE_LIMIT",
          nextCursor: "opaque",
        }),
      ),
    ).toContain("Coverage: RESUMABLE_LIMIT");
    expect(
      formatGrepText(
        result({ traversal: "CURSOR_EXPIRED", unavailableTargets: [omission] }),
      ),
    ).toContain("Restart explicitly");
  });
  it("escapes terminal controls and locator backslashes, preserves Unicode and wraps prose only", () => {
    const content = `${"界".repeat(100)}\x1b[31m`;
    const output = formatGrepText(
      result({
        hits: [
          {
            ...hit,
            filePath: "a\\b\x1b",
            lineSlice: {
              content,
              startByte: 0,
              endByte: 310,
              originalLineBytes: 310,
            },
          },
        ],
        targets: [
          {
            ...target,
            publicMessage: "Long words should wrap into multiple prose lines",
            readiness: "STALE",
          },
        ],
      }),
      { width: 25 },
    );
    expect(output).toContain("a\\\\b\\u001b");
    expect(output).toContain(`${"界".repeat(100)}\\u001b[31m`);
    expect(output).not.toContain("\x1b");
    expect(output.replace(/\s+/g, " ")).toContain("Long words should");
    expect(
      formatReadAction({ ...hit.read, target: "github:o/r@abc\n" }, "cli"),
    ).toContain("\\x0a");
    expect(formatReadAction(hit.read, "mcp")).toContain(
      'path="packages/x/lib/a.ts"',
    );
    expect(formatReadAction({ ...hit.read, path: "-README.md" }, "cli")).toBe(
      "githits read --lines 2-2 -- 'github:o/r@abc' '-README.md'",
    );
  });
});
