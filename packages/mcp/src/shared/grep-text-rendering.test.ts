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
    expect(plain).toContain("2 matches in 1 line across 1 file");
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
    expect(text).toContain("1 match in 1 line across 1 file");
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
  it("leads complete empty pages with only the outcome and makes partial scope coverage readable", () => {
    expect(formatGrepText(page([]))).toBe("No matches.");
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
      text.startsWith("Zero returned matches; coverage is incomplete."),
    ).toBe(true);
    expect(text).toContain("stale snapshot");
    expect(text).toContain("Served served; requested wanted");
    expect(text).toContain("Searched 3 of 10 files");
    expect(text).toContain("  Skipped 2 binary file(s)");
    expect(text).toContain("  Skipped 1 oversized file(s)");
    expect(text.match(/Repository npm:x \(inputs 0\)/g)).toHaveLength(1);
    expect(text).not.toContain("retryable false");
  });

  it("places exact dim continuation instructions after evidence for CLI and MCP", () => {
    const cursor = "opaque cursor";
    const data = page([hit()], {
      traversal: "RESUMABLE_LIMIT",
      nextCursor: cursor,
      targets: [scope({ traversal: "RESUMABLE_LIMIT" })],
    });
    const intro =
      "More matches: reuse the same ordered targets and controls with:";
    const cases = [
      {
        syntax: "cli" as const,
        cursorLine: "  --cursor 'opaque cursor'",
        header: "# Read files: read --lines $start-$end -- $target $path",
      },
      {
        syntax: "mcp" as const,
        cursorLine: `  cursor=${JSON.stringify(cursor)}`,
        header:
          "# Read files: read target=$target path=$path start_line=$start end_line=$end",
      },
    ] as const;

    for (const { syntax, cursorLine, header } of cases) {
      const plain = formatGrepText(data, { syntax, useColors: false });
      const colored = formatGrepText(data, { syntax, useColors: true });
      expect(plain.endsWith(`\n${intro}\n${cursorLine}`)).toBe(true);
      const coloredLines = colored.split("\n");
      expect(coloredLines).toContain(`${colors.dim}${header}${colors.reset}`);
      expect(coloredLines.slice(-2)).toEqual([
        `${colors.dim}${intro}${colors.reset}`,
        `${colors.dim}${cursorLine}${colors.reset}`,
      ]);
      expect(stripAnsi(colored)).toBe(plain);
    }

    const narrowIntro = [
      "More matches: reuse the",
      "same ordered targets and",
      "controls with:",
    ];
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
    expect(narrowPlain.split("\n").slice(-4)).toEqual([
      ...narrowIntro,
      cases[0].cursorLine,
    ]);
    expect(narrowColored.split("\n").slice(-4)).toEqual([
      ...narrowIntro.map((line) => `${colors.dim}${line}${colors.reset}`),
      `${colors.dim}${cases[0].cursorLine}${colors.reset}`,
    ]);
    expect(stripAnsi(narrowColored)).toBe(narrowPlain);

    for (const syntax of ["cli", "mcp"] as const) {
      const noCursor = formatGrepText(page([hit()]), { syntax });
      expect(noCursor).not.toContain("More matches:");
      expect(noCursor).not.toContain("--cursor");
      expect(noCursor).not.toContain("cursor=");
    }
    expect(formatGrepText(page([]))).toBe("No matches.");
  });
});
