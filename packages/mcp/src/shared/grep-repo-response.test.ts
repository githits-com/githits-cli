import { describe, expect, it } from "bun:test";
import type { GrepRepoResult } from "@githits/core-internal";
import {
  buildGrepRepoSuccessPayload,
  formatGrepRepoTerminal,
} from "./grep-repo-response.js";
import { renderGrepRepoText } from "./grep-repo-text.js";

const baseResult: GrepRepoResult = {
  matches: [
    {
      filePath: "src/index.js",
      line: 10,
      matchStartByte: 6,
      matchEndByte: 13,
      lineContent: "const app = express();",
      contextBefore: ["", "// set up express", ""],
      contextAfter: ["", "app.get('/', …);"],
      fileContentHash: "abc123",
      fileIntent: "production",
      symbolRowId: "42",
      symbol: {
        symbolRef: "npm:express:4.18.2:42",
        name: "createRouter",
        qualifiedPath: "express.createRouter",
        kind: "function",
      },
    },
  ],
  nextCursor: undefined,
  hasMore: false,
  truncatedReason: "NONE",
  routeTaken: "CONTENT_INDEX",
  filesScanned: 1,
  filesInScope: 1,
  binaryFilesSkipped: 0,
  filesTooLargeSkipped: 0,
  totalMatches: 1,
  uniqueFilesMatched: 1,
  indexedVersion: "v5.2.1",
  resolution: {
    resolvedRef: "v5.2.1",
    commitSha: "abc123def",
  },
};

const baseOptions = {
  registry: "npm",
  name: "express",
  pattern: "express()",
  patternType: "literal" as const,
  caseSensitive: false,
  path: undefined,
  pathPrefix: "src/",
  globs: ["src/**/*.js"],
  extensions: ["js"],
  contextLines: 2,
  contextLinesBefore: 2,
  contextLinesAfter: 2,
  maxMatches: 50,
  maxMatchesPerFile: 3,
  cursor: undefined,
  symbolFields: ["name", "qualified_path", "kind"],
  excludeDocFiles: true,
  excludeTestFiles: true,
  explicit: {
    path: false,
    pathPrefix: true,
    globs: true,
    extensions: true,
    patternType: false,
    caseSensitive: false,
    excludeDocFiles: true,
    excludeTestFiles: true,
    contextLines: true,
    contextLinesBefore: false,
    contextLinesAfter: false,
    maxMatches: true,
    maxMatchesPerFile: true,
    cursor: false,
    symbolFields: true,
  },
};

describe("buildGrepRepoSuccessPayload", () => {
  it("projects the new envelope shape", () => {
    const envelope = buildGrepRepoSuccessPayload(baseResult, baseOptions);
    expect(envelope.pattern).toBe("express()");
    // patternType omitted when default ("literal")
    expect(envelope.patternType).toBeUndefined();
    expect(envelope.totalMatches).toBe(1);
    expect(envelope.matches[0]?.filePath).toBe("src/index.js");
    expect(envelope.matches[0]?.symbol).toMatchObject({
      name: "createRouter",
      qualifiedPath: "express.createRouter",
    });
    expect(envelope.filter).toEqual({
      pathPrefix: "src/",
      globs: ["src/**/*.js"],
      extensions: ["js"],
      excludeDocFiles: true,
      excludeTestFiles: true,
      contextLines: 2,
      maxMatches: 50,
      maxMatchesPerFile: 3,
      symbolFields: ["name", "qualified_path", "kind"],
    });
  });
});

describe("formatGrepRepoTerminal", () => {
  it("plain mode emits file:line:text", () => {
    const envelope = buildGrepRepoSuccessPayload(baseResult, baseOptions);
    const { stdout } = formatGrepRepoTerminal(envelope, {
      useColors: false,
    });
    expect(stdout).toContain("src/index.js:10:const app = express();");
  });

  it("applies grep match highlighting when colors are enabled", () => {
    const envelope = buildGrepRepoSuccessPayload(baseResult, baseOptions);
    const { stdout } = formatGrepRepoTerminal(envelope, {
      useColors: true,
    });
    expect(stdout).toContain(
      `src/index.js:10:const ${"\u001b[1m\u001b[33m"}app = e${"\u001b[0m"}xpress();`,
    );
  });

  it("maps UTF-8 byte offsets to string indexes for highlighting", () => {
    const envelope = buildGrepRepoSuccessPayload(
      {
        ...baseResult,
        matches: [
          {
            ...baseResult.matches[0]!,
            lineContent: "const café = express();",
            matchStartByte: 14,
            matchEndByte: 21,
          },
        ],
      },
      baseOptions,
    );
    const { stdout } = formatGrepRepoTerminal(envelope, {
      useColors: true,
    });
    expect(stdout).toContain(
      `const café = ${"\u001b[1m\u001b[33m"}express${"\u001b[0m"}();`,
    );
  });

  it("heading mode emits a file heading with compact line rows", () => {
    const envelope = buildGrepRepoSuccessPayload(baseResult, baseOptions);
    const { stdout } = formatGrepRepoTerminal(envelope, {
      useColors: false,
      headingStyle: true,
    });
    expect(stdout).toContain("src/index.js\n10:const app = express();");
    expect(stdout).not.toContain("src/index.js:10:const app = express();");
  });

  it("verbose mode emits a grouped header", () => {
    const envelope = buildGrepRepoSuccessPayload(baseResult, baseOptions);
    const { stdout } = formatGrepRepoTerminal(envelope, {
      useColors: false,
      verbose: true,
    });
    expect(stdout).toContain("1 match in 1 file");
    expect(stdout).toContain("src/index.js\n");
    expect(stdout).toContain("> 10  const app = express();");
  });

  it("verbose mode explains zero-match results and pattern pivots", () => {
    const envelope = buildGrepRepoSuccessPayload(
      {
        ...baseResult,
        matches: [],
        totalMatches: 0,
        uniqueFilesMatched: 0,
      },
      baseOptions,
    );
    const { stdout, stderr } = formatGrepRepoTerminal(envelope, {
      useColors: false,
      verbose: true,
    });

    expect(stdout).toContain("0 matches in 0 files");
    expect(stdout).toContain("No matches.");
    expect(stderr).toContain("files scanned: 1 (full scope)");
    expect(stderr).toContain("Do not repeat this grep unchanged.");
    expect(stderr).toContain("shorten or change the pattern");
    expect(stderr).toContain("use githits search for conceptual intent");
    expect(stderr).not.toContain("case-sensitive");
  });

  it("uses CLI syntax when a case-sensitive empty grep can be broadened", () => {
    const envelope = buildGrepRepoSuccessPayload(
      {
        ...baseResult,
        matches: [],
        totalMatches: 0,
        uniqueFilesMatched: 0,
      },
      {
        ...baseOptions,
        caseSensitive: true,
        explicit: { ...baseOptions.explicit, caseSensitive: true },
      },
    );
    const { stderr } = formatGrepRepoTerminal(envelope, {
      useColors: false,
    });

    expect(stderr).toContain("drop --case-sensitive");
    expect(stderr).not.toContain("case_sensitive");
  });

  it("plain mode preserves grep-style stdout silence and explains empty scope on stderr", () => {
    const envelope = buildGrepRepoSuccessPayload(
      {
        ...baseResult,
        matches: [],
        totalMatches: 0,
        uniqueFilesMatched: 0,
        filesScanned: 0,
        filesInScope: 0,
      },
      baseOptions,
    );
    const { stdout, stderr } = formatGrepRepoTerminal(envelope, {
      useColors: false,
    });

    expect(stdout).toBe("");
    expect(stderr).toContain("files scanned: 0 (no files in scope)");
    expect(stderr).toContain(
      "loosen the optional path-prefix argument, --path, --glob, --ext, or exclusion flags",
    );
  });

  it("preserves CLI cursor guidance for an empty incomplete page", () => {
    const envelope = buildGrepRepoSuccessPayload(
      {
        ...baseResult,
        matches: [],
        totalMatches: 0,
        uniqueFilesMatched: 0,
        hasMore: true,
        nextCursor: "next-page",
      },
      baseOptions,
    );
    const { stderr } = formatGrepRepoTerminal(envelope, {
      useColors: false,
    });

    expect(stderr).toContain("More matches available — rerun");
    expect(stderr).toContain("--cursor 'next-page'");
    expect(stderr).not.toContain("Do not repeat this grep unchanged.");
  });

  it("uses the real CLI limit flag for an empty truncated result", () => {
    const envelope = buildGrepRepoSuccessPayload(
      {
        ...baseResult,
        matches: [],
        totalMatches: 0,
        uniqueFilesMatched: 0,
        truncatedReason: "MAX_MATCHES",
      },
      baseOptions,
    );
    const { stderr } = formatGrepRepoTerminal(envelope, {
      useColors: false,
    });

    expect(stderr).toContain("Truncated: match limit reached.");
    expect(stderr).toContain("increase --limit");
    expect(stderr).not.toContain("--max-matches");
  });

  it.each([
    ["MAX_MATCHES", "max_matches", "match limit reached"],
    [
      "MAX_MATCHES_PER_FILE",
      "max_matches_per_file",
      "per-file match limit reached",
    ],
    ["DEADLINE", "deadline", "time limit reached"],
  ] as const)(
    "humanizes producer-normalized %s truncation",
    (backendReason, normalizedReason, humanReason) => {
      const envelope = buildGrepRepoSuccessPayload(
        {
          ...baseResult,
          matches: [],
          totalMatches: 0,
          uniqueFilesMatched: 0,
          truncatedReason: backendReason,
        },
        baseOptions,
      );

      expect(envelope.truncatedReason).toBe(normalizedReason);
      expect(renderGrepRepoText(envelope)).toContain(
        `Truncated: ${humanReason}.`,
      );
      expect(
        formatGrepRepoTerminal(envelope, { useColors: false }).stderr,
      ).toContain(`Truncated: ${humanReason}.`);
    },
  );

  it("humanizes a producer-built truncation trailer with matches", () => {
    const envelope = buildGrepRepoSuccessPayload(
      { ...baseResult, truncatedReason: "MAX_MATCHES" },
      baseOptions,
    );

    expect(renderGrepRepoText(envelope)).toContain(
      "Truncated: match limit reached.",
    );
  });

  it("verbose mode renders minimal symbol hints", () => {
    const envelope = buildGrepRepoSuccessPayload(
      {
        ...baseResult,
        matches: [
          {
            ...baseResult.matches[0]!,
            symbol: {
              ...baseResult.matches[0]!.symbol,
              category: "callable",
              isPublic: true,
              startLine: 1,
              endLine: 20,
              parentPath: "express",
            },
          },
        ],
      },
      baseOptions,
    );

    const { stdout } = formatGrepRepoTerminal(envelope, {
      useColors: false,
      verbose: true,
    });
    expect(stdout).toContain(
      "in: express.createRouter (function) public L1-20",
    );
    expect(stdout).not.toContain("category=callable");
    expect(stdout).not.toContain("parent=express");
  });

  it("renders context in chronological order", () => {
    const envelope = buildGrepRepoSuccessPayload(
      {
        ...baseResult,
        matches: [
          {
            ...baseResult.matches[0]!,
            contextBefore: ["before"],
            contextAfter: ["after"],
          },
        ],
      },
      baseOptions,
    );

    const plain = formatGrepRepoTerminal(envelope, {
      useColors: false,
      withContext: true,
    }).stdout;
    expect(plain.indexOf("src/index.js\n")).toBeLessThan(
      plain.indexOf("9-before"),
    );
    expect(plain.indexOf("9-before")).toBeLessThan(
      plain.indexOf("10:const app = express();"),
    );
    expect(plain.indexOf("10:const app = express();")).toBeLessThan(
      plain.indexOf("11-after"),
    );

    const verbose = formatGrepRepoTerminal(envelope, {
      useColors: false,
      verbose: true,
    }).stdout;
    expect(verbose.indexOf("   9  before")).toBeLessThan(
      verbose.indexOf("> 10  const app = express();"),
    );
    expect(verbose.indexOf("> 10  const app = express();")).toBeLessThan(
      verbose.indexOf("  11  after"),
    );
  });

  it("dedupes multiple matches on the same line in terminal output", () => {
    const envelope = buildGrepRepoSuccessPayload(
      {
        ...baseResult,
        totalMatches: 2,
        matches: [
          baseResult.matches[0]!,
          {
            ...baseResult.matches[0]!,
            matchStartByte: 20,
            matchEndByte: 27,
          },
        ],
      },
      baseOptions,
    );

    const plain = formatGrepRepoTerminal(envelope, {
      useColors: false,
    }).stdout;
    expect(
      plain.match(/src\/index\.js:10:const app = express\(\);/g)?.length,
    ).toBe(1);

    const verbose = formatGrepRepoTerminal(envelope, {
      useColors: false,
      verbose: true,
    }).stdout;
    expect(verbose.match(/^src\/index\.js$/gm)?.length).toBe(1);
    expect(verbose.match(/^>\s+10\s+const app = express\(\);$/gm)?.length).toBe(
      1,
    );
  });

  it("merges overlapping context blocks with grep-style line prefixes", () => {
    const envelope = buildGrepRepoSuccessPayload(
      {
        ...baseResult,
        totalMatches: 2,
        uniqueFilesMatched: 1,
        matches: [
          {
            ...baseResult.matches[0]!,
            filePath: "lib/app.js",
            line: 10,
            lineContent: "match one",
            contextBefore: ["line 8", "line 9"],
            contextAfter: ["line 11", "match two"],
          },
          {
            ...baseResult.matches[0]!,
            filePath: "lib/app.js",
            line: 12,
            lineContent: "match two",
            contextBefore: ["line 10 stale", "line 11 stale"],
            contextAfter: ["line 13", "line 14"],
          },
        ],
      },
      baseOptions,
    );

    const plain = formatGrepRepoTerminal(envelope, {
      useColors: false,
      withContext: true,
    }).stdout;

    expect(plain).toContain("lib/app.js\n8-line 8");
    expect(plain).toContain("9-line 9");
    expect(plain).toContain("10:match one");
    expect(plain).toContain("11-line 11");
    expect(plain).toContain("12:match two");
    expect(plain).toContain("13-line 13");
    expect(plain).toContain("14-line 14");
    expect(plain).not.toContain("line 10 stale");
    expect(plain).not.toContain("line 11 stale");
    expect(plain).not.toContain("--\n--");
  });

  it("prints nextCursor continuation instructions with the real cursor value", () => {
    const envelope = buildGrepRepoSuccessPayload(
      {
        ...baseResult,
        hasMore: true,
        nextCursor: "cursor_abc123",
        truncatedReason: "MAX_MATCHES",
      },
      baseOptions,
    );

    const rendered = formatGrepRepoTerminal(envelope, {
      useColors: false,
    });

    expect(rendered.stderr).toBe(
      "More matches available — rerun with --cursor 'cursor_abc123'\n",
    );
  });

  it("adds a narrow-scope hint for noisy broad results", () => {
    const envelope = buildGrepRepoSuccessPayload(
      {
        ...baseResult,
        totalMatches: 6,
        uniqueFilesMatched: 6,
        matches: [
          { ...baseResult.matches[0]!, filePath: "History.md", line: 1 },
          { ...baseResult.matches[0]!, filePath: "Readme.md", line: 2 },
          { ...baseResult.matches[0]!, filePath: "benchmarks/run", line: 3 },
          { ...baseResult.matches[0]!, filePath: "examples/a.js", line: 4 },
          { ...baseResult.matches[0]!, filePath: "test/a.js", line: 5 },
          { ...baseResult.matches[0]!, filePath: "lib/app.js", line: 6 },
        ],
      },
      {
        ...baseOptions,
        pathPrefix: undefined,
        globs: undefined,
        extensions: undefined,
        excludeDocFiles: undefined,
        excludeTestFiles: undefined,
        explicit: {
          ...baseOptions.explicit,
          pathPrefix: false,
          globs: false,
          extensions: false,
          excludeDocFiles: false,
          excludeTestFiles: false,
        },
      },
    );

    const rendered = formatGrepRepoTerminal(envelope, {
      useColors: false,
    });

    expect(rendered.stderr).toContain("Broad results");
    expect(rendered.stderr).toContain("--exclude-docs");
  });
});
