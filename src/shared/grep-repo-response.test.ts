import { describe, expect, it } from "bun:test";
import type { GrepRepoResult } from "../services/index.js";
import {
  buildGrepRepoSuccessPayload,
  formatGrepRepoTerminal,
} from "./grep-repo-response.js";

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
      "More grep results available — rerun with --cursor 'cursor_abc123'\n",
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
