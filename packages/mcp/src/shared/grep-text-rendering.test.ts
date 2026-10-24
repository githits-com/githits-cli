import { describe, expect, it } from "bun:test";
import type {
  GrepHit,
  GrepLineSlice,
  GrepRepositoryHit,
  GrepResult,
  GrepTargetStatus,
} from "@githits/core-internal";
import { colors } from "./colors.js";
import { formatGrepText } from "./grep-text.js";

function slice(
  content: string,
  startByte = 0,
  originalLineBytes = new TextEncoder().encode(content).length,
): GrepLineSlice {
  return {
    content,
    startByte,
    endByte: startByte + new TextEncoder().encode(content).length,
    originalLineBytes,
  };
}
function hit(overrides: Partial<GrepRepositoryHit> = {}): GrepRepositoryHit {
  return {
    __typename: "GrepRepositoryHit",
    targetIndex: 0,
    filePath: "a.ts",
    line: 3,
    lineSlice: slice("router"),
    contextBeforeSlices: [],
    contextAfterSlices: [],
    matchStartByte: 0,
    matchEndByte: 6,
    contentSafety: { filtered: false },
    read: { target: "github:o/r@sha", path: "a.ts", startLine: 3, endLine: 3 },
    ...overrides,
  };
}
function scope(overrides: Partial<GrepTargetStatus> = {}): GrepTargetStatus {
  return {
    targetIndex: 0,
    requestedInputIndices: [0],
    kind: "REPOSITORY",
    target: "npm:x",
    traversal: "COMPLETE",
    readiness: "CURRENT",
    errorCode: null,
    retryable: false,
    publicMessage: null,
    requestedRef: "sha",
    commitSha: "sha",
    corpus: "ALL",
    filesScanned: 1,
    filesInScope: 1,
    binaryFilesSkipped: 0,
    filesTooLargeSkipped: 0,
    fileIssues: [],
    fileIssuesOmitted: 0,
    repoUrl: "https://github.com/o/r",
    canonicalSite: null,
    ...overrides,
  };
}
function page(
  hits: GrepHit[],
  overrides: Partial<GrepResult> = {},
): GrepResult {
  return {
    indexingEstimates: [],
    pathWarnings: [],
    hits,
    targets: [scope()],
    totalMatches: hits.length,
    unavailableTargets: [],
    traversal: "COMPLETE",
    nextCursor: null,
    ...overrides,
  };
}
function stripAnsi(value: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: Strip formatter-authored ANSI for parity assertions.
  return value.replace(/\x1b\[[0-9;]*m/g, "");
}

describe("grep evidence rendering", () => {
  it("preserves U+FEFF at the beginning of each decoded color segment", () => {
    for (const [content, start, end] of [
      ["\uFEFFrouter", 3, 9],
      ["router\uFEFF next", 0, 6],
      ["x\uFEFFrouter", 1, 10],
    ] as const) {
      const data = page([
        hit({
          lineSlice: slice(content),
          matchStartByte: start,
          matchEndByte: end,
        }),
      ]);
      const plain = formatGrepText(data);
      expect(plain).toContain(`3: ${content}`);
      expect(stripAnsi(formatGrepText(data, { useColors: true }))).toBe(plain);
    }
  });
  it("highlights all native byte spans after Unicode and escaped controls without changing source rows", () => {
    const content = "\t界\x1brouter router";
    const first = hit({
      lineSlice: slice(content),
      matchStartByte: 5,
      matchEndByte: 11,
    });
    const second = { ...first, matchStartByte: 12, matchEndByte: 18 };
    const data = page([first, second]);
    const before = structuredClone(data);
    const plain = formatGrepText(data);
    const colored = formatGrepText(data, { useColors: true });
    expect(plain).toContain("3: \t界\\u001brouter router");
    expect(plain).not.toContain("\\u0009");
    expect(colored).toContain(
      `\\u001b${colors.bold}${colors.yellow}router${colors.reset} ${colors.bold}${colors.yellow}router${colors.reset}`,
    );
    expect(stripAnsi(colored)).toBe(plain);
    expect(data).toEqual(before);
    expect(plain).toContain("Found 2 matches on 1 line in 1 file.");
    expect(plain).not.toContain("(2 matches)");
  });
  it("preserves tab-indented native CRLF-derived source and context rows", () => {
    const data = page([
      hit({
        lineSlice: slice("\trouter"),
        matchStartByte: 1,
        matchEndByte: 7,
        contextBeforeSlices: [slice("\tbefore")],
      }),
    ]);
    const text = formatGrepText(data);
    expect(text).toContain("2- \tbefore\n3: \trouter");
    expect(text).not.toContain("\\u000d");
    expect(text).not.toContain("\\u0009");
  });
  it("does not add gap separators without context, but separates disjoint context blocks", () => {
    const first = hit();
    const later = hit({
      line: 10,
      read: { ...first.read, startLine: 10, endLine: 10 },
    });
    const plain = formatGrepText(page([first, later]));
    expect(plain).not.toMatch(/^--$/m);
    expect(plain).toContain(" 3: router\n10: router");
    const contextual = formatGrepText(
      page([
        { ...first, contextBeforeSlices: [slice("before")] },
        { ...later, contextBeforeSlices: [slice("later")] },
      ]),
    );
    expect(contextual).toContain("3: router\n--\n 9- later\n10: router");
  });
  it("promotes identical context slices to matches and preserves incompatible context windows", () => {
    const data = page([
      hit({ contextAfterSlices: [slice("router")] }),
      hit({
        line: 4,
        contextBeforeSlices: [slice("router"), slice("different", 10, 100)],
        read: {
          target: "github:o/r@sha",
          path: "a.ts",
          startLine: 4,
          endLine: 4,
        },
      }),
    ]);
    const text = formatGrepText(data);
    expect(text.match(/^4: router$/gm)).toHaveLength(1);
    expect(text).not.toContain("4- router");
    expect(text).toContain("3- [...] different [...]");
    expect(text).toContain("3: router");
  });
  it("keeps different revisions of one display path separate and retains exact canonical read targets", () => {
    const first = hit();
    const second = hit({ read: { ...first.read, target: "github:o/r@other" } });
    const text = formatGrepText(page([first, second]));
    expect(text).toContain("[1] github:o/r@sha a.ts");
    expect(text).toContain("[2] github:o/r@other a.ts");
  });
  it("retains different hosted display/read URLs and quotes unsafe shell and leading-dash operands", () => {
    const source = hit({
      filePath: "display.ts",
      read: {
        target: "-target'with space",
        path: "-root path.ts",
        startLine: 3,
        endLine: 3,
      },
    });
    const { filePath: _path, ...base } = hit();
    const site: GrepHit = {
      ...base,
      __typename: "GrepSiteHit",
      targetIndex: 1,
      pageUrl: "https://docs.test/display",
      read: {
        target: "https://docs.test/p?a=1&b=2",
        path: null,
        startLine: 3,
        endLine: 3,
      },
    };
    const data = page([source, site], {
      targets: [
        scope(),
        scope({
          targetIndex: 1,
          kind: "SITE",
          target: "site:docs.test",
          corpus: null,
        }),
      ],
    });
    const cli = formatGrepText(data);
    expect(cli).toContain("[1] '-target'\"'\"'with space' '-root path.ts'");
    expect(cli).not.toContain("display.ts");
    expect(cli).toContain("read --lines $start-$end -- $target $path");
    expect(cli).toContain(
      "[2] 'https://docs.test/p?a=1&b=2' [page: https://docs.test/display]",
    );
    expect(cli).toContain("https://docs.test/display");
    const mcp = formatGrepText(data, { syntax: "mcp" });
    expect(mcp).toContain('[1] "-target\'with space" "-root path.ts"');
    expect(mcp).toContain("read target=$url start_line=$start end_line=$end");
    expect(mcp).toContain('[2] "https://docs.test/p?a=1&b=2"');
  });
  it("counts zero-width matches without fabricated highlight text or empty ANSI spans", () => {
    const data = page([hit({ matchStartByte: 3, matchEndByte: 3 })]);
    const text = formatGrepText(data, { useColors: true });
    expect(text).toContain("Found 1 match on 1 line in 1 file.");
    expect(text).toContain("3: router");
    expect(text).not.toContain(colors.yellow);
  });
  it("quotes shell comment paths and literal backslashes while leaving ordinary locators readable", () => {
    for (const path of ["#notes.md", String.raw`a\b.ts`]) {
      const data = page([hit({ read: { ...hit().read, path } })]);
      const cli = formatGrepText(data);
      expect(cli).toContain(`[1] github:o/r@sha '${path}'`);
      expect(formatGrepText(data, { syntax: "mcp" })).toContain(
        `[1] github:o/r@sha ${JSON.stringify(path)}`,
      );
    }
    expect(formatGrepText(page([hit()]))).toContain("[1] github:o/r@sha a.ts");
  });
  it("leads complete empty pages with the outcome and lists searched sources", () => {
    expect(formatGrepText(page([]))).toBe(
      "No matches found.\n\nSources:\n  - github:o/r@sha (no results)",
    );
    const text = formatGrepText(
      page([], {
        targets: [
          scope({
            readiness: "STALE",
            commitSha: "served",
            requestedRef: "wanted",
            filesScanned: 3,
            filesInScope: 10,
            binaryFilesSkipped: 2,
            filesTooLargeSkipped: 1,
          }),
        ],
      }),
    );
    expect(
      text.startsWith(
        "No matches returned; some requested content could not be searched.",
      ),
    ).toBe(true);
    expect(text).toContain("stale snapshot");
    expect(text).toContain(
      "github:o/r@served (older snapshot, no matches returned)",
    );
    expect(text).toContain("Requested ref: wanted.");
    expect(text).toContain("Searched 3 of 10 files");
    expect(text).toContain("  Skipped 2 binary files");
    expect(text).toContain("  Skipped 1 oversized file");
    expect(text.match(/Repository npm:x:/g)).toHaveLength(1);
    expect(text).not.toMatch(/\(inputs? \d/);
    expect(text).not.toContain("retryable false");
  });

  it.each([
    [1, "Searched 0 of 1 file."],
    [2, "Searched 0 of 2 files."],
  ] as const)(
    "uses the scope file count's plural for %i files",
    (filesInScope, expected) => {
      const text = formatGrepText(
        page([], {
          targets: [
            scope({
              readiness: "NOT_AVAILABLE",
              traversal: "FAILED",
              filesScanned: 0,
              filesInScope,
            }),
          ],
        }),
      );
      expect(text).toContain(expected);
    },
  );

  it("places exact dim continuation instructions after evidence for CLI and MCP", () => {
    const cursor = "opaque cursor";
    const data = page([hit()], {
      traversal: "RESUMABLE_LIMIT",
      nextCursor: cursor,
      targets: [scope({ traversal: "RESUMABLE_LIMIT" })],
    });
    const intro = "Repeat the original grep, adding:";
    const cases = [
      {
        syntax: "cli" as const,
        cursorLine: "  --cursor 'opaque cursor'",
        header: "Files: githits read --lines $start-$end -- $target $path",
      },
      {
        syntax: "mcp" as const,
        cursorLine: `  cursor=${JSON.stringify(cursor)}`,
        header:
          "Files: read target=$target path=$path start_line=$start end_line=$end",
      },
    ] as const;

    for (const { syntax, cursorLine, header } of cases) {
      const plain = formatGrepText(data, { syntax, useColors: false });
      const colored = formatGrepText(data, { syntax, useColors: true });
      expect(plain.endsWith(`\n  ${intro}\n${cursorLine}`)).toBe(true);
      const coloredLines = colored.split("\n");
      expect(coloredLines).toContain(`  ${colors.dim}${header}${colors.reset}`);
      expect(coloredLines.slice(-2)).toEqual([
        `  ${intro}`,
        `  ${colors.dim}${cursorLine.trimStart()}${colors.reset}`,
      ]);
      expect(stripAnsi(colored)).toBe(plain);
    }

    const narrowIntro = ["  Repeat the original", "  grep, adding:"];
    const narrowPlain = formatGrepText(data, {
      syntax: "cli",
      useColors: false,
      width: 24,
    });
    const narrowColored = formatGrepText(data, {
      syntax: "cli",
      useColors: true,
      width: 24,
    });
    expect(narrowPlain.split("\n").slice(-(narrowIntro.length + 1))).toEqual([
      ...narrowIntro,
      cases[0].cursorLine,
    ]);
    expect(narrowColored.split("\n").slice(-(narrowIntro.length + 1))).toEqual([
      ...narrowIntro,
      `  ${colors.dim}${cases[0].cursorLine.trimStart()}${colors.reset}`,
    ]);
    expect(stripAnsi(narrowColored)).toBe(narrowPlain);

    for (const syntax of ["cli", "mcp"] as const) {
      const noCursor = formatGrepText(page([hit()]), { syntax });
      expect(noCursor).not.toContain("More matches:");
      expect(noCursor).not.toContain("--cursor");
      expect(noCursor).not.toContain("cursor=");
    }
    expect(formatGrepText(page([]))).toBe(
      "No matches found.\n\nSources:\n  - github:o/r@sha (no results)",
    );
  });
});

const preparing = {
  inputIndex: 1,
  target: "npm:pending",
  reason: "repository_indexing",
  retryable: true,
  progressRef: null,
  suggestedSiteTargets: null,
};
const terminal = {
  ...preparing,
  inputIndex: 2,
  target: "npm:unsupported",
  reason: "no_grep_scopes",
  retryable: false,
};

describe("grep coverage copy", () => {
  const incomplete =
    "No matches returned; some requested content could not be searched.";
  const cases: { name: string; result: GrepResult; headline: string }[] = [
    {
      name: "complete empty search",
      result: page([]),
      headline: "No matches found.",
    },
    {
      name: "empty searchable corpus",
      result: page([], {
        targets: [scope({ filesScanned: 0, filesInScope: 0 })],
      }),
      headline: "No matches found.",
    },
    {
      name: "all scopes preparing",
      result: page([], {
        targets: [],
        traversal: "NON_RESUMABLE_PARTIAL",
        unavailableTargets: [preparing],
      }),
      headline:
        "No matches available yet; requested content is still being prepared.",
    },
    {
      name: "ready empty scope and pending omission",
      result: page([], {
        traversal: "NON_RESUMABLE_PARTIAL",
        unavailableTargets: [preparing],
      }),
      headline:
        "No matches available yet; some requested content is still being prepared.",
    },
    {
      name: "terminal omissions only",
      result: page([], {
        targets: [],
        traversal: "NON_RESUMABLE_PARTIAL",
        unavailableTargets: [terminal],
      }),
      headline: "None of the requested content could be searched.",
    },
    {
      name: "ready scope and terminal omission",
      result: page([], { unavailableTargets: [terminal] }),
      headline: incomplete,
    },
    {
      name: "mixed omissions",
      result: page([], {
        traversal: "NON_RESUMABLE_PARTIAL",
        unavailableTargets: [preparing, terminal],
      }),
      headline: incomplete,
    },
    ...(["NOT_AVAILABLE", "CURRENT"] as const).map((readiness) => ({
      name: `zero-scanned failed native scope with ${readiness} readiness`,
      result: page([], {
        traversal: "FAILED",
        targets: [scope({ readiness, traversal: "FAILED", filesScanned: 0 })],
      }),
      headline: "None of the requested content could be searched.",
    })),
    {
      name: "unavailable native scope without a traversal failure",
      result: page([], {
        targets: [scope({ readiness: "NOT_AVAILABLE", filesScanned: 0 })],
      }),
      headline: "None of the requested content could be searched.",
    },
    {
      name: "native failure after scanning",
      result: page([], {
        traversal: "FAILED",
        targets: [scope({ traversal: "FAILED" })],
      }),
      headline: incomplete,
    },
    {
      name: "healthy empty continuation",
      result: page([], {
        traversal: "RESUMABLE_LIMIT",
        nextCursor: "cursor",
        targets: [
          scope({
            readiness: "UNSPECIFIED",
            traversal: "RESUMABLE_LIMIT",
            filesScanned: 0,
          }),
        ],
      }),
      headline: "No matches on this page.",
    },
    ...(
      [
        { binaryFilesSkipped: 1 },
        { filesTooLargeSkipped: 1 },
        { readiness: "STALE" },
        {
          fileIssues: [
            {
              filePath: "a.ts",
              line: 3,
              code: "LINE_TOO_LARGE",
              contentSafety: { filtered: true },
            },
          ],
        },
        { fileIssuesOmitted: 2 },
      ] satisfies Partial<GrepTargetStatus>[]
    ).map((gap) => ({
      name: `coverage gap: ${Object.keys(gap).join(", ")}`,
      result: page([], { targets: [scope(gap)] }),
      headline: incomplete,
    })),
  ];
  for (const { name, result, headline } of cases) {
    it(name, () => {
      const before = structuredClone(result);
      for (const syntax of ["cli", "mcp"] as const) {
        const text = formatGrepText(result, { syntax });
        expect(text.split("\n")[0]).toBe(headline);
        expect(
          stripAnsi(formatGrepText(result, { syntax, useColors: true })),
        ).toBe(text);
        expect(text).not.toContain("Traversal is incomplete");
        if (
          headline === "None of the requested content could be searched." &&
          result.targets.length
        )
          expect(text).toContain("(not searched)");
      }
      expect(result).toEqual(before);
    });
  }

  it("keeps hits, attributed failures and exact reads without repeated caveats", () => {
    const data = page([hit()], {
      traversal: "NON_RESUMABLE_PARTIAL",
      targets: [
        scope(),
        scope({
          targetIndex: 1,
          target: "npm:failed",
          traversal: "FAILED",
          readiness: "NOT_AVAILABLE",
          filesScanned: 0,
          errorCode: "READ_FAILED",
          publicMessage: "Reader unavailable.",
          retryable: true,
        }),
      ],
    });
    for (const syntax of ["cli", "mcp"] as const) {
      const text = formatGrepText(data, { syntax, width: 160 });
      expect(text.startsWith("Found 1 match on 1 line in 1 file.")).toBe(true);
      expect(text).toContain("[1] github:o/r@sha a.ts\n3: router");
      expect(text).toContain(
        "Repository npm:failed: unavailable; search failed; you can retry.\n  Reason: Reader unavailable. [READ_FAILED]",
      );
      expect(text).not.toContain(".;");
      expect(text).not.toContain("Traversal is incomplete");
      expect(text).not.toContain("Some requested content");
      expect(text).toContain(
        "Repeat the original grep inputs for these sources:",
      );
      expect(text).toContain(
        syntax === "cli"
          ? "Omit --cursor to start a new search."
          : "Omit cursor to start a new search.",
      );
      expect(text).not.toMatch(/--wait|wait_timeout_ms/);
    }
  });

  it("keeps continuation and selective preparation recovery distinct with mixed omissions", () => {
    const data = page([], {
      traversal: "RESUMABLE_LIMIT",
      nextCursor: "exact cursor",
      unavailableTargets: [
        preparing,
        terminal,
        {
          ...terminal,
          inputIndex: 3,
          target: "npm:retryable",
          reason: "resolution_failed",
          retryable: true,
        },
      ],
    });
    for (const syntax of ["cli", "mcp"] as const) {
      const text = formatGrepText(data, { syntax, width: 160 });
      expect(text.split("\n")[0]).toBe(
        "No matches on this page; some requested content could not be searched.",
      );
      expect(text).toContain(
        "npm:unsupported: no searchable source or documentation is available",
      );
      expect(text).toContain("npm:retryable: resolution_failed");
      expect(text).toContain(
        "Repeat the original grep inputs for these sources:",
      );
      expect(text).toContain(
        syntax === "cli"
          ? "set --wait 30000 to wait up to 30s for preparation."
          : "set wait_timeout_ms=30000 to wait up to 30s for preparation.",
      );
      expect(text).toContain(
        syntax === "cli" ? "--cursor 'exact cursor'" : 'cursor="exact cursor"',
      );
      expect(text).not.toContain("rerun the original query");
    }
  });

  it("does not suggest preparation or retry for terminal preparation omissions", () => {
    const data = page([], {
      targets: [],
      unavailableTargets: [{ ...preparing, retryable: false }],
    });
    for (const syntax of ["cli", "mcp"] as const) {
      const text = formatGrepText(data, { syntax });
      expect(
        text.startsWith("None of the requested content could be searched."),
      ).toBe(true);
      expect(text).toContain("Not searched:");
      expect(text).not.toContain("Preparing:");
      expect(text).not.toMatch(/Follow-up:|--wait|wait_timeout_ms|Retry/);
    }
  });

  it("retries a non-preparation omission without inventing a preparation wait", () => {
    const data = page([], {
      unavailableTargets: [
        { ...terminal, reason: "resolution_failed", retryable: true },
      ],
    });
    const text = formatGrepText(data, { width: 160 });
    expect(text.startsWith(incomplete)).toBe(true);
    expect(text).toContain("npm:unsupported: resolution_failed");
    expect(text).toContain(
      "Repeat the original grep inputs for these sources:",
    );
    expect(text).not.toMatch(/--wait|wait_timeout_ms|Preparing:/);
  });
});

describe("grep recovery precedence", () => {
  it("keeps cursor expiry restart as the sole recovery action with retained retryable targets", () => {
    for (const unavailableTargets of [[], [preparing], [preparing, terminal]]) {
      const data = page([hit()], {
        traversal: "CURSOR_EXPIRED",
        unavailableTargets,
        targets: [
          scope({
            readiness: "NOT_AVAILABLE",
            traversal: "FAILED",
            retryable: true,
          }),
        ],
      });
      for (const syntax of ["cli", "mcp"] as const) {
        const text = formatGrepText(data, { syntax, width: 160 });
        expect(text).toContain(
          "Cursor expired; the search could not continue.",
        );
        expect(text).toContain("[1] github:o/r@sha a.ts\n3: router");
        if (unavailableTargets.length) expect(text).toContain("Preparing:");
        expect(text).toContain(
          `To restart the full search, repeat the original grep and omit ${syntax === "cli" ? "--cursor" : "cursor"}.`,
        );
        expect(text).not.toMatch(
          /Repeat the same pattern|Repeat the original grep inputs|--wait|wait_timeout_ms/,
        );
        expect(text).not.toContain("More results:");
      }
    }
  });

  it("retains otherwise unexplained traversal limits beside skips, file issues or stale snapshots", () => {
    const gaps: Partial<GrepTargetStatus>[] = [
      { binaryFilesSkipped: 1 },
      { filesTooLargeSkipped: 1 },
      { readiness: "STALE" },
      {
        fileIssues: [
          {
            filePath: "a.ts",
            code: "LINE_TOO_LARGE",
            line: 3,
            contentSafety: { filtered: false },
          },
        ],
      },
      { fileIssuesOmitted: 1 },
    ];
    for (const gap of gaps) {
      for (const nextCursor of [null, "sibling cursor"]) {
        for (const traversal of ["FAILED", "NON_RESUMABLE_PARTIAL"] as const) {
          const data = page([hit()], {
            traversal,
            nextCursor,
            targets: [scope(gap)],
          });
          for (const syntax of ["cli", "mcp"] as const) {
            const text = formatGrepText(data, { syntax, width: 160 });
            expect(text.startsWith("Found 1 match on 1 line in 1 file.")).toBe(
              true,
            );
            expect(text).toContain(
              nextCursor
                ? "Some requested content could not be searched; the service did not explain why or whether retrying would help."
                : "The search did not finish, and no continuation cursor was returned.",
            );
            if (nextCursor)
              expect(text).toContain(
                syntax === "cli"
                  ? "--cursor 'sibling cursor'"
                  : 'cursor="sibling cursor"',
              );
          }
        }
      }
    }
  });
});

describe("grep omission attribution", () => {
  it("avoids a repeated caveat for explained omissions beside unrelated scope gaps", () => {
    for (const omission of [preparing, terminal]) {
      for (const gap of [
        { binaryFilesSkipped: 1 },
        { readiness: "STALE" },
      ] satisfies Partial<GrepTargetStatus>[]) {
        for (const traversal of ["NON_RESUMABLE_PARTIAL", "FAILED"] as const) {
          const data = page([hit()], {
            traversal,
            targets: [scope(gap)],
            unavailableTargets: [omission],
          });
          for (const syntax of ["cli", "mcp"] as const) {
            const text = formatGrepText(data, { syntax, width: 160 });
            expect(text).toContain(
              omission.retryable ? "Preparing:" : "Not searched:",
            );
            expect(
              text.includes(
                "The search did not finish, and no continuation cursor was returned.",
              ),
            ).toBe(traversal === "FAILED");
            expect(text).toContain("[1] github:o/r@sha a.ts\n3: router");
          }
        }
      }
    }
  });
});

describe("explicit grep recovery", () => {
  it.each([true, false])(
    "states the supplied native failure cause and retry advice for retryable=%s",
    (retryable) => {
      const data = page([], {
        targets: [
          scope({
            readiness: "READER_OPEN_FAILED",
            traversal: "FAILED",
            retryable,
            errorCode: "OPEN_FAILED",
            publicMessage: "Reader could not be opened.",
            filesScanned: 0,
          }),
        ],
      });
      for (const syntax of ["cli", "mcp"] as const) {
        const text = formatGrepText(data, { syntax, width: 160 });
        expect(text).toContain(
          retryable ? "you can retry" : "do not retry unchanged",
        );
        expect(text).toContain(
          "Reason: Reader could not be opened. [OPEN_FAILED]",
        );
        expect(text).not.toMatch(/temporary|permanent/);
        if (!retryable) expect(text).not.toContain("Follow-up:");
      }
    },
  );

  it("does not invent a cause when a failed scope supplies no further details", () => {
    const data = page([], {
      targets: [
        scope({
          readiness: "NOT_AVAILABLE",
          traversal: "FAILED",
          publicMessage: null,
          errorCode: null,
          retryable: true,
          filesScanned: 0,
        }),
      ],
    });
    for (const syntax of ["cli", "mcp"] as const) {
      const text = formatGrepText(data, { syntax });
      expect(text).toContain("No further failure details were provided.");
      expect(text).toContain("you can retry");
      expect(text).not.toMatch(/Reason:|Error:|temporary|permanent/);
    }
  });

  it.each(["FAILED", "NON_RESUMABLE_PARTIAL"] as const)(
    "discloses unknown cause and retryability for an unattributed empty %s search",
    (traversal) => {
      const data = page([], { traversal });
      for (const syntax of ["cli", "mcp"] as const) {
        const text = formatGrepText(data, { syntax, width: 160 });
        expect(text).toContain(
          "The search did not finish, and no continuation cursor was returned.",
        );
        expect(text).toContain(
          "The service did not explain why the full search stopped or whether retrying would help.",
        );
        expect(text).not.toContain("Follow-up:");
      }
    },
  );

  it("names eligible original operands instead of resolved sources or terminal targets", () => {
    const data = page([], {
      targets: [
        scope({
          target: "https://github.com/o/r@resolved",
          requestedInputIndices: [1],
          traversal: "FAILED",
          retryable: true,
        }),
      ],
      unavailableTargets: [
        { ...terminal, inputIndex: 0 },
        { ...preparing, inputIndex: 2, target: "npm:backend-alias" },
      ],
    });
    for (const syntax of ["cli", "mcp"] as const) {
      const text = formatGrepText(data, {
        syntax,
        width: 160,
        requestedTargets: ["npm:terminal", "npm:original", "npm:preparing"],
      });
      const recovery = text.split("Follow-up:\n")[1]!;
      expect(recovery).toContain(
        "Repeat the same pattern and options for:\n    npm:original\n    npm:preparing",
      );
      expect(recovery).not.toMatch(/terminal|backend-alias|resolved|retryable/);
      expect(recovery).toContain(
        syntax === "cli"
          ? "Omit --cursor; set --wait 30000 to wait up to 30s for preparation."
          : "Omit cursor; set wait_timeout_ms=30000 to wait up to 30s for preparation.",
      );
    }
  });

  it("identifies which original input to retry when operand names repeat", () => {
    const data = page([], {
      unavailableTargets: [{ ...preparing, inputIndex: 1 }],
    });
    const recovery = formatGrepText(data, {
      requestedTargets: ["npm:same", "npm:same"],
    }).split("Follow-up:\n")[1]!;
    expect(recovery).toContain("    npm:same (target 2)");
    expect(recovery).not.toContain("target 1");
  });

  it("keeps quoted retry operands exact and free from terminal controls at narrow widths", () => {
    const requested = "npm:a\\b'\n$HOME";
    const data = page([], {
      unavailableTargets: [
        { ...preparing, inputIndex: 0, target: "backend-alias" },
      ],
    });
    for (const syntax of ["cli", "mcp"] as const) {
      const text = formatGrepText(data, {
        syntax,
        width: 24,
        requestedTargets: [requested],
      });
      const expected =
        syntax === "cli"
          ? "$'npm:a\\\\b\\'\\x0a$HOME'"
          : JSON.stringify(requested);
      expect(text.split("\n")).toContain(`    ${expected}`);
      expect(text).not.toContain("b'\n$HOME");
      expect(
        stripAnsi(
          formatGrepText(data, {
            syntax,
            width: 24,
            requestedTargets: [requested],
            useColors: true,
          }),
        ),
      ).toBe(text);
    }
  });

  it.each([
    { retryable: false, suggestedSiteTargets: null, remedy: true },
    {
      retryable: false,
      suggestedSiteTargets: ["site:docs.example"],
      remedy: false,
    },
    { retryable: true, suggestedSiteTargets: null, remedy: false },
  ])(
    "offers a different target only for a terminal omission without an alternative: %j",
    ({ retryable, suggestedSiteTargets, remedy }) => {
      const data = page([], {
        targets: [],
        unavailableTargets: [
          {
            ...terminal,
            retryable,
            suggestedSiteTargets: suggestedSiteTargets?.slice() ?? null,
          },
        ],
      });
      for (const syntax of ["cli", "mcp"] as const) {
        const text = formatGrepText(data, { syntax, width: 160 });
        expect(text).toContain(
          retryable ? "you can retry" : "do not retry unchanged",
        );
        expect(
          text.includes(
            "choose a different package, repository or site target",
          ),
        ).toBe(remedy);
        if (suggestedSiteTargets)
          expect(text).toContain(
            "Search hosted documentation instead: site:docs.example",
          );
        if (!retryable) expect(text).not.toContain("Follow-up:");
      }
    },
  );

  it("keeps a supplied error code when no public reason was supplied", () => {
    const data = page([], {
      targets: [
        scope({
          traversal: "FAILED",
          errorCode: "READ_FAILED",
          publicMessage: null,
        }),
      ],
    });
    for (const syntax of ["cli", "mcp"] as const) {
      const text = formatGrepText(data, { syntax });
      expect(text).toContain("  Error: READ_FAILED.");
      expect(text).not.toContain("Reason:");
    }
  });

  it("keeps unknown backend reasons and offers only supplied documentation alternatives", () => {
    const data = page([], {
      targets: [],
      unavailableTargets: [
        {
          ...terminal,
          reason: "unknown_reason",
          suggestedSiteTargets: ["site:docs.example"],
        },
      ],
    });
    const text = formatGrepText(data, {
      width: 160,
      requestedTargets: ["npm:original"],
    });
    expect(text).toContain(
      "Not searched:\n  - npm:unsupported: unknown_reason; do not retry unchanged\n    Search hosted documentation instead: site:docs.example",
    );
    expect(text).not.toMatch(
      /Follow-up:|--wait|wait_timeout_ms|Repeat the same pattern/,
    );
  });
});
