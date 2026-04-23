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
  },
};

describe("buildGrepRepoSuccessPayload", () => {
  it("projects the new envelope shape", () => {
    const envelope = buildGrepRepoSuccessPayload(baseResult, baseOptions);
    expect(envelope.pattern).toBe("express()");
    expect(envelope.patternType).toBe("literal");
    expect(envelope.totalMatches).toBe(1);
    expect(envelope.matches[0]?.filePath).toBe("src/index.js");
    expect(envelope.routeTaken).toBe("content_index");
    expect(envelope.filter).toEqual({
      pathPrefix: "src/",
      globs: ["src/**/*.js"],
      extensions: ["js"],
      excludeDocFiles: true,
      excludeTestFiles: true,
      contextLines: 2,
      maxMatches: 50,
      maxMatchesPerFile: 3,
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

  it("verbose mode emits a grouped header", () => {
    const envelope = buildGrepRepoSuccessPayload(baseResult, baseOptions);
    const { stdout } = formatGrepRepoTerminal(envelope, {
      useColors: false,
      verbose: true,
    });
    expect(stdout).toContain("1 match(es) in 1 file(s)");
    expect(stdout).toContain("src/index.js:10");
    expect(stdout).toContain("> const app = express();");
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
    expect(plain.indexOf("-before")).toBeLessThan(
      plain.indexOf("src/index.js:10:const app = express();"),
    );
    expect(
      plain.indexOf("src/index.js:10:const app = express();"),
    ).toBeLessThan(plain.indexOf("+after"));

    const verbose = formatGrepRepoTerminal(envelope, {
      useColors: false,
      verbose: true,
    }).stdout;
    expect(verbose.indexOf("  before")).toBeLessThan(
      verbose.indexOf("> const app = express();"),
    );
    expect(verbose.indexOf("> const app = express();")).toBeLessThan(
      verbose.indexOf("  after"),
    );
  });
});
