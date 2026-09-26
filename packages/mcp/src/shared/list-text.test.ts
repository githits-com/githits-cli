import { describe, expect, it } from "bun:test";
import type { ListParams, ListResult } from "@githits/core-internal";
import { formatListText } from "./list-text.js";

function sourceResult(overrides: Partial<ListResult> = {}): ListResult {
  return {
    inventoryKind: "SOURCE",
    requestedTarget: "github:example/repo@main",
    canonicalTarget: "github:example/repo@main",
    entries: [],
    hasMore: false,
    nextCursor: null,
    indexedVersion: "main",
    codeIndexState: "CURRENT",
    indexingStatus: "COMPLETED",
    indexingRef: null,
    inventoryState: null,
    crawlStatus: null,
    coverageState: null,
    coverageReason: null,
    preparation: null,
    ...overrides,
  };
}

function siteResult(overrides: Partial<ListResult> = {}): ListResult {
  return {
    inventoryKind: "SITE",
    requestedTarget: "site:docs.example.test/api",
    canonicalTarget: "site:docs.example.test/api",
    entries: [],
    hasMore: false,
    nextCursor: null,
    indexedVersion: null,
    codeIndexState: null,
    indexingStatus: null,
    indexingRef: null,
    inventoryState: "AVAILABLE",
    crawlStatus: "COMPLETE",
    coverageState: "COMPLETE",
    coverageReason: null,
    preparation: null,
    ...overrides,
  };
}

function params(overrides: Partial<ListParams> = {}): ListParams {
  return {
    target: "github:example/repo@main",
    includeDetailedFields: false,
    ...overrides,
  };
}

function options(
  overrides: Partial<Parameters<typeof formatListText>[2]> = {},
): Parameters<typeof formatListText>[2] {
  return {
    surface: "mcp",
    verbose: false,
    useColors: false,
    ...overrides,
  };
}

function file(
  path: string,
  target: string,
  readPath: string,
): ListResult["entries"][number] {
  return {
    kind: "FILE",
    path,
    title: null,
    read: { target, path: readPath },
    browse: null,
  };
}

function jsonStringAfter(text: string, marker: string): string {
  const token = jsonTokenAfter(text, marker);
  return JSON.parse(token) as string;
}

function jsonStringArrayAfter(text: string, marker: string): string[] {
  const token = jsonTokenAfter(text, marker);
  return JSON.parse(token) as string[];
}

function jsonTokenAfter(text: string, marker: string): string {
  const markerIndex = text.indexOf(marker);
  if (markerIndex < 0) throw new Error(`Missing field ${marker}.`);
  const start = markerIndex + marker.length;
  const first = text[start];
  if (first === '"') {
    let escaped = false;
    for (let index = start + 1; index < text.length; index += 1) {
      const character = text[index];
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        return text.slice(start, index + 1);
      }
    }
  } else if (first === "[") {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < text.length; index += 1) {
      const character = text[index];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (character === "\\") {
          escaped = true;
        } else if (character === '"') {
          inString = false;
        }
      } else if (character === '"') {
        inString = true;
      } else if (character === "[") {
        depth += 1;
      } else if (character === "]") {
        depth -= 1;
        if (depth === 0) return text.slice(start, index + 1);
      }
    }
  }
  throw new Error(`Invalid JSON field ${marker}.`);
}

function parseShellWords(command: string): string[] {
  const words: string[] = [];
  let index = 0;
  while (index < command.length) {
    while (index < command.length && /\s/u.test(command[index] ?? "")) {
      index += 1;
    }
    if (index >= command.length) break;

    let word = "";
    while (index < command.length && !/\s/u.test(command[index] ?? "")) {
      if (command.startsWith("$'", index)) {
        const parsed = parseAnsiCQuoted(command, index + 2);
        word += parsed.value;
        index = parsed.nextIndex;
      } else if (command[index] === "'") {
        const end = command.indexOf("'", index + 1);
        if (end < 0) throw new Error("Unclosed single-quoted shell value.");
        word += command.slice(index + 1, end);
        index = end + 1;
      } else if (command[index] === '"') {
        const end = command.indexOf('"', index + 1);
        if (end < 0) throw new Error("Unclosed double-quoted shell value.");
        word += command.slice(index + 1, end);
        index = end + 1;
      } else {
        word += command[index];
        index += 1;
      }
    }
    words.push(word);
  }
  return words;
}

function parseAnsiCQuoted(
  command: string,
  start: number,
): { value: string; nextIndex: number } {
  let value = "";
  let index = start;
  while (index < command.length) {
    const character = command[index];
    if (character === "'") return { value, nextIndex: index + 1 };
    if (character !== "\\") {
      value += character;
      index += 1;
      continue;
    }

    const escapeChar = command[index + 1];
    if (escapeChar === "\\" || escapeChar === "'") {
      value += escapeChar;
      index += 2;
    } else if (escapeChar === "u") {
      const hexadecimal = command.slice(index + 2, index + 6);
      if (!/^[0-9a-f]{4}$/iu.test(hexadecimal)) {
        throw new Error("Invalid Unicode escape in ANSI-C shell value.");
      }
      value += String.fromCharCode(Number.parseInt(hexadecimal, 16));
      index += 6;
    } else {
      throw new Error(`Unsupported ANSI-C escape \\${escapeChar}.`);
    }
  }
  throw new Error("Unclosed ANSI-C shell value.");
}

function assertNoRawControls(text: string): void {
  const hasRawControl = [...text.replaceAll("\n", "")].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f);
  });
  expect(hasRawControl).toBe(false);
}

describe("formatListText", () => {
  it("compares repository root and package subtree actions without totals", () => {
    const pinnedTarget = `github:example/repo@${"a".repeat(120)}`;
    const repositoryRoot = sourceResult({
      requestedTarget: "github:example/repo",
      canonicalTarget: "github:example/repo@main",
      entries: [
        file("src/display-a.ts", pinnedTarget, "src/a%2Fb.ts"),
        file("src/display-b.ts", pinnedTarget, "src/b.ts"),
        {
          kind: "DIRECTORY",
          path: "docs",
          title: null,
          read: null,
          browse: {
            target: "github:example/repo@main",
            paths: ["docs/O'Reilly.md"],
          },
        },
      ],
    });
    const packageSubtree = sourceResult({
      requestedTarget: "npm:@example/pkg@2.0.0",
      canonicalTarget: null,
      entries: [
        {
          kind: "DIRECTORY",
          path: "docs",
          title: null,
          read: null,
          browse: null,
        },
      ],
    });

    const rootText = formatListText(
      repositoryRoot,
      params({ target: "github:example/repo" }),
      options({ width: 140 }),
    );
    expect(rootText).toContain('requested="github:example/repo"');
    expect(rootText).toContain('canonical="github:example/repo@main"');
    expect(rootText).toContain(
      `Read target: read target=${JSON.stringify(pinnedTarget)}`,
    );
    expect(rootText).toContain('read path="src/a%2Fb.ts"');
    expect(rootText).toContain('read path="src/b.ts"');
    expect(rootText).toContain(
      'browse: list target="github:example/repo@main" paths=["docs/O\'Reilly.md"]',
    );
    expect(rootText).not.toContain("total");
    const cliRootText = formatListText(
      repositoryRoot,
      params({ target: "github:example/repo" }),
      options({ surface: "cli" }),
    );
    expect(cliRootText).toContain(
      `browse: githits list 'github:example/repo@main' 'docs/O'"'"'Reilly.md'`,
    );

    const packageText = formatListText(
      packageSubtree,
      params({ target: "npm:@example/pkg@2.0.0" }),
      options(),
    );
    expect(packageText).toContain("canonical=null");
    expect(packageText).toContain("DIRECTORY");
    expect(packageText).not.toContain("browse:");

    const repeated = sourceResult({
      entries: repositoryRoot.entries
        .slice(0, 2)
        .map((entry, index) =>
          file(
            entry.path,
            `${pinnedTarget}-${index}`,
            entry.read?.path ?? entry.path,
          ),
        ),
    });
    const repeatedText = formatListText(repeated, params(), options());
    expect(rootText.length).toBeLessThan(repeatedText.length);
    expect(rootText.match(new RegExp(pinnedTarget, "g"))).toHaveLength(1);
  });

  it("renders recursive glob actions and exact continuation replay for both surfaces", () => {
    const cursor = "next/'cursor' $opaque;*";
    const recursive = sourceResult({
      entries: [
        {
          ...file("docs/雪%2Fguide.md", "npm:pkg@5.2.1", "docs/雪%2Fguide.md"),
          language: "TypeScript",
          fileType: "documentation",
          intent: "TEST",
          byteSize: 42,
          lineCount: null,
          contentHash: null,
        },
      ],
      hasMore: true,
      nextCursor: cursor,
      resolution: {
        requestedVersion: null,
        requestedRef: "v1",
        resolvedRef: "v1",
        commitSha: null,
      },
      targetResolution: {
        requested: null,
        resolvedRequested: null,
        served: null,
        freshness: "current",
        freshnessReason: null,
        indexingRef: null,
        availableVersions: null,
        availableRefs: [],
        suggestedRefs: [{ version: null, ref: "v2" }],
      },
      availableVersions: [{ version: null, ref: "v1" }],
      indexingEstimate: {
        lowerSeconds: null,
        upperSeconds: null,
        elapsedSeconds: null,
        sampleCount: null,
        source: "same_repository_refs",
      },
    });
    const request = params({
      target: "github:example/repo@v1",
      paths: ["**/*.md", "docs/O'Reilly.md"],
      recursive: true,
      fileTypes: ["documentation", "source"],
      languages: ["TypeScript"],
      intents: ["TEST"],
      limit: 25,
      after: "old cursor",
      waitTimeoutMs: 0,
      includeDetailedFields: true,
    });

    const cliText = formatListText(
      recursive,
      request,
      options({ surface: "cli", verbose: true }),
    );
    expect(cliText).toContain(
      "githits read 'npm:pkg@5.2.1' 'docs/雪%2Fguide.md'",
    );
    expect(cliText).toContain('language="TypeScript"');
    expect(cliText).toContain("lineCount=null");
    expect(cliText).toContain("resolution={requestedVersion=null");
    expect(cliText).toContain("targetResolution={requested=null");
    expect(cliText).toContain('availableVersions=[{version=null, ref="v1"}]');
    expect(cliText).toContain("indexingEstimate={lowerSeconds=null");
    expect(cliText).toContain(
      `Continue: githits list 'github:example/repo@v1' '**/*.md' 'docs/O'"'"'Reilly.md' --recursive --file-type 'documentation' --file-type 'source' --language 'TypeScript' --intent 'TEST' --limit 25 --after 'next/'"'"'cursor'"'"' $opaque;*' --wait 0 --verbose`,
    );
    expect(cliText).not.toContain("old cursor");

    const mcpText = formatListText(recursive, request, options());
    expect(mcpText).toContain(
      `Continue: list target="github:example/repo@v1" paths=["**/*.md", "docs/O'Reilly.md"] recursive=true file_types=["documentation", "source"] languages=["TypeScript"] intents=["TEST"] limit=25 after=${JSON.stringify(cursor)} wait_timeout_ms=0`,
    );
    expect(mcpText).not.toContain("old cursor");
    expect(mcpText).toContain('FILE "docs/雪%2Fguide.md"');
  });

  it("keeps a landing page title and both exact read and browse actions on one row", () => {
    const site = siteResult({
      entries: [
        {
          kind: "PAGE",
          path: "docs.example.test/api/",
          title: "API 雪",
          read: {
            target: "https://docs.example.test/api/?lang=en%2Fja#intro",
            path: null,
          },
          browse: {
            target: "site:docs.example.test",
            paths: ["docs.example.test/api/"],
          },
        },
      ],
      inventoryState: "EMPTY",
      crawlStatus: "RUNNING",
      coverageState: "PARTIAL",
      coverageReason: "refresh_pending",
      preparation: {
        selected: 3,
        enqueued: 1,
        activeJobs: [{ mode: "incremental_recrawl", state: "FAILED" }],
        awaited: [{ mode: null, outcome: "TIMEOUT" }],
      },
    });
    const text = formatListText(
      site,
      params({ target: "site:docs.example.test/api" }),
      options(),
    );

    const pageRow = text.split("\n").find((line) => line.startsWith("PAGE "));
    expect(pageRow).toContain('title="API 雪"');
    expect(pageRow).toContain(
      'read: read target="https://docs.example.test/api/?lang=en%2Fja#intro"',
    );
    expect(pageRow).toContain(
      'browse: list target="site:docs.example.test" paths=["docs.example.test/api/"]',
    );
    expect(text).toContain(
      'Site lifecycle: inventory="EMPTY" crawl="RUNNING" coverage="PARTIAL" reason="refresh_pending" preparation=selected=3 enqueued=1 activeJobs=["incremental_recrawl"/"FAILED"] awaited=[null/"TIMEOUT"]',
    );
  });

  it("keeps site EMPTY, RUNNING or FAILED, and PARTIAL or CAPPED states distinct", () => {
    for (const [crawlStatus, coverageState] of [
      ["RUNNING", "PARTIAL"],
      ["FAILED", "CAPPED"],
    ] as const) {
      const text = formatListText(
        siteResult({
          entries: [],
          inventoryState: "EMPTY",
          crawlStatus,
          coverageState,
          preparation: {
            selected: 0,
            enqueued: 0,
            activeJobs: [],
            awaited: [],
          },
        }),
        params({ target: "site:docs.example.test/api" }),
        options(),
      );
      expect(text).toContain("No pages are currently listed.");
      expect(text).toContain('inventory="EMPTY"');
      expect(text).toContain(`crawl="${crawlStatus}"`);
      expect(text).toContain(`coverage="${coverageState}"`);
      expect(text).not.toContain("not found");
    }
  });

  it("distinguishes an empty source inventory that is still indexing", () => {
    const text = formatListText(
      sourceResult({
        entries: [],
        codeIndexState: "CURRENT",
        indexingStatus: "INDEXING",
        indexingRef: "index-雪",
      }),
      params(),
      options({ verbose: true }),
    );
    expect(text).toContain(
      "Source index is INDEXING; no entries are available yet.",
    );
    expect(text).toContain('indexingStatus="INDEXING"');
    expect(text).toContain('indexingRef="index-雪"');
    expect(text).not.toContain("No entries matched.");
  });

  it("sanitizes control sequences without losing Unicode or encoded paths", () => {
    const value = "docs/雪%2Fguide\n\u001b[31m";
    const text = formatListText(
      sourceResult({ entries: [file(value, "npm:pkg", value)] }),
      params(),
      options({ width: 1 }),
    );
    expect(text).toContain("雪%2Fguide");
    expect(text).toContain("\\u{a}");
    expect(text).toContain("\\u{1b}[31m");
    expect(text).not.toContain("\u001b");
  });

  it("round-trips JSON and CLI actions with controls and encoded Unicode", () => {
    const value =
      "tab\tline\ncontrol\u0001\u001f\u007f\u0085\u009f quote\" apostrophe' slash\\ percent%2F snow-雪 pair-😀";
    const result = sourceResult({
      entries: [
        {
          ...file("display path", value, value),
          browse: { target: value, paths: [value] },
        },
      ],
      hasMore: true,
      nextCursor: value,
    });
    const request = params({
      target: value,
      paths: [value],
      fileTypes: [value],
      languages: [value],
      intents: ["TEST"],
      limit: 7,
      after: "old-cursor",
      waitTimeoutMs: 0,
    });

    const mcpText = formatListText(result, request, options());
    const mcpRow = mcpText.split("\n").find((line) => line.startsWith("FILE "));
    const mcpContinuation = mcpText
      .split("\n")
      .find((line) => line.startsWith("Continue: "));
    if (!mcpRow || !mcpContinuation)
      throw new Error("Missing MCP output rows.");
    expect(jsonStringAfter(mcpRow, "read target=")).toBe(value);
    expect(jsonStringAfter(mcpRow, "path=")).toBe(value);
    expect(jsonStringAfter(mcpRow, "browse: list target=")).toBe(value);
    expect(jsonStringArrayAfter(mcpRow, "paths=")).toEqual([value]);
    expect(jsonStringAfter(mcpContinuation, "target=")).toBe(value);
    expect(jsonStringArrayAfter(mcpContinuation, "paths=")).toEqual([value]);
    expect(jsonStringAfter(mcpContinuation, "after=")).toBe(value);
    assertNoRawControls(mcpText);

    const cliText = formatListText(
      result,
      request,
      options({ surface: "cli" }),
    );
    const cliRow = cliText.split("\n").find((line) => line.startsWith("FILE "));
    const cliContinuation = cliText
      .split("\n")
      .find((line) => line.startsWith("Continue: "));
    if (!cliRow || !cliContinuation)
      throw new Error("Missing CLI output rows.");
    const browseSeparator = cliRow.indexOf(" | browse: ");
    const readStart = cliRow.indexOf("read: ");
    expect(
      parseShellWords(
        cliRow.slice(readStart + "read: ".length, browseSeparator),
      ),
    ).toEqual(["githits", "read", value, value]);
    expect(
      parseShellWords(cliRow.slice(browseSeparator + " | browse: ".length)),
    ).toEqual(["githits", "list", value, value]);
    expect(parseShellWords(cliContinuation.slice("Continue: ".length))).toEqual(
      [
        "githits",
        "list",
        value,
        value,
        "--file-type",
        value,
        "--language",
        value,
        "--intent",
        "TEST",
        "--limit",
        "7",
        "--after",
        value,
        "--wait",
        "0",
      ],
    );
    assertNoRawControls(cliText);
  });

  it("uses lossless non-executable fields for CLI actions containing NUL", () => {
    const nulValue = "before\u0000after\u0085";
    const result = sourceResult({
      entries: [
        {
          ...file(
            "display path",
            `read-target-${nulValue}`,
            `read-path-${nulValue}`,
          ),
          browse: {
            target: `browse-target-${nulValue}`,
            paths: [`browse-path-${nulValue}`],
          },
        },
        file("second display path", `read-target-${nulValue}`, "safe-path"),
      ],
      hasMore: true,
      nextCursor: `cursor-${nulValue}`,
    });
    const request = params({ target: "github:example/repo", paths: ["docs"] });

    const cliText = formatListText(
      result,
      request,
      options({ surface: "cli" }),
    );
    const cliRow = cliText.split("\n").find((line) => line.startsWith("FILE "));
    const cliContinuation = cliText
      .split("\n")
      .find((line) => line.startsWith("Continue: "));
    if (!cliRow || !cliContinuation)
      throw new Error("Missing CLI output rows.");
    const readStart = cliRow.indexOf("read: ");
    const browseSeparator = cliRow.indexOf(" | browse: ");
    const readFields = cliRow.slice(
      readStart + "read: ".length,
      browseSeparator,
    );
    const browseFields = cliRow.slice(browseSeparator + " | browse: ".length);
    expect(readFields).toContain("not shell-executable: contains NUL");
    expect(readFields).not.toContain("githits read");
    expect(jsonStringAfter(readFields, "read target=")).toBe(
      `read-target-${nulValue}`,
    );
    expect(jsonStringAfter(readFields, "path=")).toBe(`read-path-${nulValue}`);
    expect(browseFields).toContain("not shell-executable: contains NUL");
    expect(browseFields).not.toContain("githits list");
    expect(jsonStringAfter(browseFields, "target=")).toBe(
      `browse-target-${nulValue}`,
    );
    expect(jsonStringArrayAfter(browseFields, "paths=")).toEqual([
      `browse-path-${nulValue}`,
    ]);
    expect(cliContinuation).toContain("not shell-executable: contains NUL");
    expect(cliContinuation).not.toContain("githits list");
    expect(jsonStringAfter(cliContinuation, "target=")).toBe(
      "github:example/repo",
    );
    expect(jsonStringArrayAfter(cliContinuation, "paths=")).toEqual(["docs"]);
    expect(jsonStringAfter(cliContinuation, "after=")).toBe(
      `cursor-${nulValue}`,
    );
    assertNoRawControls(cliText);

    const mcpText = formatListText(result, request, options());
    const mcpRow = mcpText.split("\n").find((line) => line.startsWith("FILE "));
    const mcpContinuation = mcpText
      .split("\n")
      .find((line) => line.startsWith("Continue: "));
    if (!mcpRow || !mcpContinuation)
      throw new Error("Missing MCP output rows.");
    expect(jsonStringAfter(mcpRow, "read target=")).toBe(
      `read-target-${nulValue}`,
    );
    expect(jsonStringAfter(mcpRow, "path=")).toBe(`read-path-${nulValue}`);
    expect(jsonStringAfter(mcpRow, "browse: list target=")).toBe(
      `browse-target-${nulValue}`,
    );
    expect(jsonStringArrayAfter(mcpRow, "paths=")).toEqual([
      `browse-path-${nulValue}`,
    ]);
    expect(jsonStringAfter(mcpContinuation, "after=")).toBe(
      `cursor-${nulValue}`,
    );
    assertNoRawControls(mcpText);
  });

  it("places list options before -- when target or path begins with a dash", () => {
    const browseResult = sourceResult({
      entries: [
        {
          kind: "DIRECTORY",
          path: "display",
          title: null,
          read: null,
          browse: { target: "-site:docs.example.test", paths: ["-docs/"] },
        },
      ],
    });
    const browseText = formatListText(
      browseResult,
      params(),
      options({ surface: "cli" }),
    );
    expect(browseText).toContain(
      "browse: githits list -- '-site:docs.example.test' '-docs/'",
    );

    const continuationResult = sourceResult({
      hasMore: true,
      nextCursor: "next",
    });
    const continuationText = formatListText(
      continuationResult,
      params({
        target: "-github:example/repo",
        paths: ["-docs"],
        recursive: true,
        fileTypes: ["source"],
      }),
      options({ surface: "cli" }),
    );
    const continuation = continuationText
      .split("\n")
      .find((line) => line.startsWith("Continue: "));
    if (!continuation) throw new Error("Missing continuation.");
    expect(continuation).toBe(
      "Continue: githits list --recursive --file-type 'source' --after 'next' -- '-github:example/repo' '-docs'",
    );
    const words = parseShellWords(continuation.slice("Continue: ".length));
    const marker = words.indexOf("--");
    expect(marker).toBeGreaterThan(0);
    expect(words.slice(0, marker)).toContain("--recursive");
    expect(words.slice(0, marker)).toContain("--file-type");
    expect(words.slice(0, marker)).toContain("--after");
    expect(words.slice(marker + 1)).toEqual(["-github:example/repo", "-docs"]);
  });

  it("keeps individual and grouped read actions safe for dash-leading operands", () => {
    const individualText = formatListText(
      sourceResult({
        entries: [
          file("target dash", "-github:example/repo", "src/file.ts"),
          file("path dash", "github:example/repo", "-docs/file.md"),
        ],
      }),
      params(),
      options({ surface: "cli" }),
    );
    const individualRows = individualText
      .split("\n")
      .filter((line) => line.startsWith("FILE "));
    expect(
      individualRows.map((line) => {
        const actionStart = line.indexOf("read: ");
        return parseShellWords(line.slice(actionStart + "read: ".length));
      }),
    ).toEqual([
      ["githits", "read", "--", "-github:example/repo", "src/file.ts"],
      ["githits", "read", "--", "github:example/repo", "-docs/file.md"],
    ]);

    const sharedTarget = "github:example/shared";
    const groupedPathText = formatListText(
      sourceResult({
        requestedTarget: "shared source",
        canonicalTarget: "shared source",
        entries: [
          file("normal path", sharedTarget, "src/file.ts"),
          file("dash path", sharedTarget, "-docs/file.md"),
        ],
      }),
      params(),
      options({ surface: "cli" }),
    );
    const groupedPathHeader = groupedPathText
      .split("\n")
      .find((line) => line.startsWith("Read target: "));
    const groupedPathRows = groupedPathText
      .split("\n")
      .filter((line) => line.startsWith("FILE "));
    if (!groupedPathHeader) throw new Error("Missing grouped read target.");
    const groupedPathPrefix = parseShellWords(
      groupedPathHeader.slice("Read target: ".length),
    );
    expect(groupedPathPrefix).toEqual(["githits", "read", "--", sharedTarget]);
    const groupedPaths = groupedPathRows.map((line) => {
      const pathStart = line.indexOf("read path ");
      return parseShellWords(line.slice(pathStart + "read path ".length));
    });
    expect(groupedPaths).toEqual([["src/file.ts"], ["-docs/file.md"]]);
    expect(groupedPathRows.join("\n")).not.toContain("githits read");

    const dashTarget = "-github:example/shared";
    const groupedTargetText = formatListText(
      sourceResult({
        requestedTarget: "shared source",
        canonicalTarget: "shared source",
        entries: [
          file("first", dashTarget, "src/first.ts"),
          file("second", dashTarget, "src/second.ts"),
        ],
      }),
      params(),
      options({ surface: "cli" }),
    );
    const groupedTargetHeader = groupedTargetText
      .split("\n")
      .find((line) => line.startsWith("Read target: "));
    if (!groupedTargetHeader) throw new Error("Missing grouped read target.");
    expect(
      parseShellWords(groupedTargetHeader.slice("Read target: ".length)),
    ).toEqual(["githits", "read", "--", dashTarget]);
    expect(groupedTargetText.match(/-github:example\/shared/gu)).toHaveLength(
      1,
    );
  });
});
