import { describe, expect, it } from "bun:test";
import type {
  GrepHit,
  GrepResult,
  GrepTargetStatus,
  TargetResolution,
} from "@githits/core-internal";
import { projectGrepResult } from "./grep-response.js";
import { formatGrepText } from "./grep-text.js";

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
  repoUrl: "https://github.com/o/r",
  canonicalSite: null,
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
  matchStartByte: 0,
  matchEndByte: 6,
  read: {
    target: "github:o/r@abc",
    path: "packages/x/lib/a.ts",
    startLine: 2,
    endLine: 2,
  },
};
function result(overrides: Partial<GrepResult> = {}): GrepResult {
  return {
    indexingEstimates: [],
    pathWarnings: [],
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
  it("accepts a pre-metadata injected provider while preserving absent metadata", () => {
    const provider = result();
    delete provider.indexingEstimates;
    expect(projectGrepResult(provider)).toEqual({
      ...provider,
      pathWarnings: [],
    });
    expect(projectGrepResult(provider)).not.toHaveProperty("indexingEstimates");
  });
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
    expect(projectGrepResult(page)).toEqual({ ...page, pathWarnings: [] });
    const output = formatGrepText(page);
    expect(output).toContain("  - site:docs.test (not reached on this page)");
    expect(output).not.toContain("not visited in this page");
    expect(output).not.toContain("inputs 0, 1");
    expect(output).not.toContain("UNSPECIFIED / RESUMABLE_LIMIT");
    expect(output).toContain("--cursor 'opaque'");
    expect(output).not.toContain("Unavailable input");
    expect(output).toContain("2: router");
  });
  it("preserves source and context backslashes while escaping terminal controls", () => {
    const source = String.raw`const re = /\d+/; s.split("\n")`;
    const context = String.raw`const path = "C:\src\file.ts"`;
    const output = formatGrepText(
      result({
        indexingEstimates: [],
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
    expect(
      output.match(/^\[1\] github:o\/r@abc packages\/x\/lib\/a.ts$/gm),
    ).toHaveLength(1);
  });
  it("allowlists fields, preserves selected nulls, details and independent arrays", () => {
    const data = result({
      indexingEstimates: [],
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
    expect(projected).toEqual({ ...data, pathWarnings: [] });
    expect(projected.targets[0]?.publicMessage).toBeNull();
    expect(projected.hits[0]?.sourceMatchStartByte).toBe(10);
    projected.hits.pop();
    expect(data.hits).toHaveLength(1);
    const compact = projectGrepResult(result());
    expect(compact.hits[0]).not.toHaveProperty("lineContent");
    expect(compact).not.toHaveProperty("hasMore");
  });
  it("preserves JSON producer ordering and groups text by exact read identity", () => {
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
        indexingEstimates: [],
        hits: [hit, site, hit],
        totalMatches: 3,
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
    expect(
      output.match(/^\[1\] github:o\/r@abc packages\/x\/lib\/a.ts$/gm),
    ).toHaveLength(1);
    expect(
      output.indexOf("[1] github:o/r@abc packages/x/lib/a.ts"),
    ).toBeLessThan(output.lastIndexOf("[2]"));
    expect(output).toContain(
      "Files: githits read --lines $start-$end -- $target $path",
    );
    expect(output).toContain("Pages: githits read --lines $start-$end -- $url");
    expect(output).toContain("[2] https://docs.test/p");
    expect(output).not.toContain("inputs 1, 0");
    expect(output).not.toContain("current content");
    expect(output).not.toContain("Read recipes");
  });
  it("merges overlapping context while keeping match markers and slice omissions", () => {
    const output = formatGrepText(
      result({
        indexingEstimates: [],
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
    expect(output).toContain("3- after");
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
      expect(output).toContain(
        "No matches returned; some requested content could not be searched.",
      );
      expect(output).not.toContain("(no results)");
    }
    const output = formatGrepText(
      result({ hits: [], totalMatches: 0, targets: [scopes[4]!] }),
    );
    expect(output).toContain("(aggregate)");
    expect(output).toContain("2 additional file issue");
    expect(output.replace(/\s+/g, " ")).toContain("safety normalization");
    expect(formatGrepText(result({ hits: [], totalMatches: 0 }))).toContain(
      "No matches found.",
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
    expect(output).not.toContain("crawl:1");
    expect(
      projectGrepResult(result({ unavailableTargets: [omission] }))
        .unavailableTargets[0]?.progressRef,
    ).toBe("crawl:1");
    expect(output).toContain("Search hosted documentation instead");
    expect(output).toContain("--cursor 'opaque'");
    expect(output).toContain("Repeat the original grep");
    expect(
      formatGrepText(
        result({
          targets: [{ ...target, traversal: "RESUMABLE_LIMIT" }],
          traversal: "RESUMABLE_LIMIT",
          nextCursor: "opaque",
        }),
      ),
    ).toContain("More results:");
    expect(
      formatGrepText(
        result({ traversal: "CURSOR_EXPIRED", unavailableTargets: [omission] }),
      ),
    ).toContain("To restart the full search");
  });
  it("quotes terminal controls and locator backslashes for exact reads, preserves Unicode and wraps prose only", () => {
    const content = `${"界".repeat(100)}\x1b[31m`;
    const output = formatGrepText(
      result({
        indexingEstimates: [],
        hits: [
          {
            ...hit,
            filePath: "a\\b\x1b",
            read: { ...hit.read, path: "a\\b\x1b" },
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
    expect(output).toContain("$'a\\\\b\\x1b'");
    expect(output).toContain(`${"界".repeat(100)}\\u001b[31m`);
    expect(output).not.toContain("\x1b");
    expect(output.replace(/\s+/g, " ")).toContain("Long words should");
    expect(
      formatGrepText(
        result({
          indexingEstimates: [],
          hits: [{ ...hit, read: { ...hit.read, target: "github:o/r@abc\n" } }],
        }),
      ),
    ).toContain("\\x0a");
    expect(formatGrepText(result(), { syntax: "mcp" })).toContain(
      "path=$path start_line=$start end_line=$end",
    );
    const leadingDash = formatGrepText(
      result({ hits: [{ ...hit, read: { ...hit.read, path: "-README.md" } }] }),
    );
    expect(leadingDash).toContain("[1] github:o/r@abc -README.md");
    expect(leadingDash).toContain("read --lines $start-$end -- $target $path");
  });
});

describe("grep page and omission outcomes", () => {
  it.each(["CURRENT", "UNSPECIFIED"] as const)(
    "treats %s resumable targets as normal pagination",
    (readiness) => {
      for (const hits of [[], [hit]]) {
        const output = formatGrepText(
          result({
            hits,
            totalMatches: hits.length,
            targets: [{ ...target, readiness, traversal: "RESUMABLE_LIMIT" }],
            traversal: "RESUMABLE_LIMIT",
            nextCursor: "exact cursor",
          }),
        );
        expect(output.split("\n")[0]).toBe(
          hits.length
            ? "Found 1 match on 1 line in 1 file."
            : "No matches on this page.",
        );
        expect(output).toContain("More results:");
        expect(output).toContain("--cursor 'exact cursor'");
        expect(output).not.toMatch(
          /coverage is incomplete|could not be searched|Traversal is incomplete|Follow-up:/,
        );
      }
    },
  );
  it.each([null, "cursor"])(
    "explains retryable preparation-only omissions without an exhaustive empty claim",
    (nextCursor) => {
      const output = formatGrepText(
        result({
          hits: [],
          totalMatches: 0,
          nextCursor,
          traversal: "NON_RESUMABLE_PARTIAL",
          unavailableTargets: [
            {
              inputIndex: 0,
              target: "npm:pending",
              reason: "repository_indexing",
              retryable: true,
              progressRef: null,
              suggestedSiteTargets: null,
            },
          ],
        }),
      );
      expect(output.split("\n")[0]).toBe(
        nextCursor
          ? "No matches on this page; some requested content is still being prepared."
          : "No matches available yet; some requested content is still being prepared.",
      );
      expect(output).toContain("Preparing:");
      expect(output).toContain("Follow-up:");
      expect(output).not.toContain("Traversal is incomplete");
    },
  );
  it("retains attributed gaps even beside a resumable cursor", () => {
    const output = formatGrepText(
      result({
        hits: [],
        totalMatches: 0,
        targets: [
          { ...target, binaryFilesSkipped: 1, traversal: "RESUMABLE_LIMIT" },
        ],
        traversal: "RESUMABLE_LIMIT",
        nextCursor: "cursor",
      }),
    );
    expect(output.split("\n")[0]).toBe(
      "No matches on this page; some requested content could not be searched.",
    );
    expect(output).toContain("Repository npm:x:");
    expect(output).toContain("Skipped 1 binary file.");
    expect(output).toContain("--cursor 'cursor'");
    expect(output).not.toContain("(no results)");
  });
  it("scopes an empty cursor page independently of non-retryable omissions", () => {
    const output = formatGrepText(
      result({
        hits: [],
        totalMatches: 0,
        traversal: "RESUMABLE_LIMIT",
        nextCursor: "cursor",
        unavailableTargets: [
          {
            inputIndex: 0,
            target: "npm:unsupported",
            reason: "unsupported",
            retryable: false,
            progressRef: null,
            suggestedSiteTargets: null,
          },
        ],
      }),
    );
    expect(output.split("\n")[0]).toBe(
      "No matches on this page; some requested content could not be searched.",
    );
    expect(output).toContain("Not searched:\n  - npm:unsupported: unsupported");
    expect(output).toContain("--cursor 'cursor'");
    expect(output).not.toContain("To retry omitted targets");
  });
  it("explains unspecified readiness when it is not an unvisited continuation", () => {
    const output = formatGrepText(
      result({ targets: [{ ...target, readiness: "UNSPECIFIED" }] }),
    );
    expect(output).toContain(
      "Repository npm:x: source readiness unknown; do not retry unchanged.",
    );
  });
});

describe("overall grep traversal limitations", () => {
  it.each(["NON_RESUMABLE_PARTIAL", "FAILED"] as const)(
    "discloses %s even when a sibling cursor remains",
    (traversal) => {
      for (const hits of [[], [hit]]) {
        const output = formatGrepText(
          result({
            hits,
            totalMatches: hits.length,
            traversal,
            nextCursor: "sibling cursor",
          }),
        );
        expect(output.split("\n")[0]).toBe(
          hits.length
            ? "Found 1 match on 1 line in 1 file."
            : "No matches on this page; some requested content could not be searched.",
        );
        expect(output.replace(/\s+/g, " ")).toContain(
          "service did not explain why or whether retrying would help.",
        );
        expect(
          output.includes("Some requested content could not be searched;"),
        ).toBe(hits.length > 0);
        expect(output).toContain("--cursor 'sibling cursor'");
        expect(output).not.toContain("has no continuation cursor");
        expect(output).not.toContain("(no results)");
      }
    },
  );
});

function correspondenceResolution(
  state: string | null,
  served = true,
): TargetResolution {
  const identity = {
    registry: "MAVEN",
    packageName: "example:library",
    version: "1.2.3",
    repoUrl: "https://github.com/example/library",
    gitRef: "v1.2.3",
    commitSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  };
  return {
    requested: {
      registry: "MAVEN",
      packageName: "example:library",
      version: "1.2.3",
      releaseCorrespondence: null,
    },
    resolvedRequested: {
      ...identity,
      releaseCorrespondence: served ? "manifest_matched" : state,
    },
    ...(served
      ? { served: { ...identity, releaseCorrespondence: state } }
      : {}),
    freshness: served ? "current" : "indexing",
    availableVersions: [],
    availableRefs: [],
    suggestedRefs: [],
  };
}

it("preserves ordered per-input assessments for a shared physical scan", () => {
  const page = result({
    targetResolutions: [
      {
        inputIndex: 0,
        target: "maven:example:library@1.2.3",
        targetResolution: correspondenceResolution("manifest_matched"),
      },
      {
        inputIndex: 1,
        target: "maven:example:library",
        targetResolution: correspondenceResolution("unverified"),
      },
    ],
  });
  const before = structuredClone(page);
  const projected = projectGrepResult(page);
  expect(projected.targetResolutions).toEqual(page.targetResolutions);
  expect(projected.targetResolutions).not.toBe(page.targetResolutions);
  expect(page).toEqual(before);
  const text = formatGrepText(page).replace(/\s+/g, " ");
  expect(text.split("match to")).toHaveLength(2);
  expect(text).toContain(
    "Source: github:example/library@v1.2.3 (commit aaaaaaa,",
  );
  expect(text).not.toMatch(/binary|version tag|listed revision for/);
});

it.each(["CURRENT", "UNSPECIFIED", "INCOMPLETE"] as const)(
  "discloses %s provenance without confusing selection and page execution",
  (readiness) => {
    const page = result({
      hits: readiness === "INCOMPLETE" ? [hit] : [],
      totalMatches: readiness === "INCOMPLETE" ? 1 : 0,
      targets: [
        {
          ...target,
          readiness,
          filesScanned: readiness === "UNSPECIFIED" ? 0 : 1,
          traversal:
            readiness === "UNSPECIFIED" ? "RESUMABLE_LIMIT" : "COMPLETE",
        },
      ],
      traversal: readiness === "UNSPECIFIED" ? "RESUMABLE_LIMIT" : "COMPLETE",
      nextCursor: readiness === "UNSPECIFIED" ? "next" : null,
      targetResolutions: [
        {
          inputIndex: 0,
          target: "maven:example:library",
          targetResolution: correspondenceResolution("tag_inferred"),
        },
      ],
    });
    const text = formatGrepText(page).replace(/\s+/g, " ");
    expect(text).toContain("version tag");
    expect(text).toContain(
      `${readiness === "UNSPECIFIED" ? "Selected source" : "Source"}: github:example/library@v1.2.3`,
    );
    if (readiness === "UNSPECIFIED") {
      expect(text).not.toContain("Source: github:");
      expect(text).toContain("not reached on this page");
    }
  },
);

it("keeps pending-only and failed inputs resolved-only without changing omission recovery", () => {
  const page = result({
    hits: [],
    targets: [],
    totalMatches: 0,
    traversal: "NON_RESUMABLE_PARTIAL",
    targetResolutions: [
      {
        inputIndex: 0,
        target: "maven:example:library",
        targetResolution: correspondenceResolution("unverified", false),
      },
    ],
    unavailableTargets: [
      {
        inputIndex: 0,
        target: "maven:example:library",
        reason: "repository_indexing",
        retryable: true,
        progressRef: "pending",
        suggestedSiteTargets: null,
      },
    ],
  });
  const before = structuredClone(page.unavailableTargets);
  const projected = projectGrepResult(page);
  const text = formatGrepText(page).replace(/\s+/g, " ");
  expect(text).toContain("Selected source: github:example/library@v1.2.3");
  expect(text).not.toContain("Source: github:");
  expect(text).toContain("still being prepared");
  expect(projected.unavailableTargets).toEqual(before);
  page.targetResolutions![0]!.targetResolution.freshness = "unavailable";
  page.unavailableTargets[0]!.reason = "package_scope_unavailable";
  page.unavailableTargets[0]!.retryable = false;
  expect(formatGrepText(page).replace(/\s+/g, " ")).toContain(
    "Selected source: ",
  );
});

it("does not use a hosted outcome as evidence that the repository was searched", () => {
  const page = result({
    hits: [],
    totalMatches: 0,
    traversal: "RESUMABLE_LIMIT",
    nextCursor: "next",
    targets: [
      {
        ...target,
        kind: "SITE",
        target: "site:docs.test",
        requestedInputIndices: [0],
        corpus: null,
      },
      {
        ...target,
        targetIndex: 8,
        requestedInputIndices: [0],
        readiness: "UNSPECIFIED",
        filesScanned: 0,
        traversal: "RESUMABLE_LIMIT",
      },
    ],
    targetResolutions: [
      {
        inputIndex: 0,
        target: "maven:example:library",
        targetResolution: correspondenceResolution("unverified"),
      },
    ],
  });
  const text = formatGrepText(page).replace(/\s+/g, " ");
  expect(text).toContain("Selected source: ");
  expect(text).not.toContain("Source: github:");
});
