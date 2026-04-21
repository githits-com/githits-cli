import { describe, expect, it } from "bun:test";
import type { GrepFileResult } from "../services/index.js";
import {
  buildGrepFileSuccessPayload,
  formatGrepFileTerminal,
} from "./grep-file-response.js";

const baseResult: GrepFileResult = {
  matches: [
    {
      lineNumber: 10,
      lineContent: "const app = express();",
      contextBefore: ["", "// set up express", ""],
      contextAfter: ["", "app.get('/', …);"],
    },
  ],
  totalMatches: 1,
  hasMore: false,
  filePath: "src/index.js",
  language: "javascript",
  totalLines: 50,
  indexedVersion: "v5.2.1",
  resolution: {
    resolvedRef: "v5.2.1",
    commitSha: "abc123def",
  },
  hint: undefined,
};

const baseOptions = {
  registry: "npm",
  name: "express",
  pattern: "express()",
  path: "src/index.js",
  contextLinesExplicit: false,
  maxMatchesExplicit: false,
  contextLines: 2,
  maxMatches: 50,
};

describe("buildGrepFileSuccessPayload", () => {
  it("projects the envelope shape", () => {
    const envelope = buildGrepFileSuccessPayload(baseResult, baseOptions);
    expect(envelope.registry).toBe("npm");
    expect(envelope.name).toBe("express");
    expect(envelope.pattern).toBe("express()");
    expect(envelope.path).toBe("src/index.js");
    expect(envelope.totalMatches).toBe(1);
    expect(envelope.hasMore).toBe(false);
    expect(envelope.matches.length).toBe(1);
    expect(envelope.matches[0]?.lineNumber).toBe(10);
    expect(envelope.indexedVersion).toBe("v5.2.1");
    expect(envelope.filter).toBeUndefined();
  });

  it("echoes filter.contextLines and filter.maxMatches when explicit", () => {
    const envelope = buildGrepFileSuccessPayload(baseResult, {
      ...baseOptions,
      contextLines: 5,
      maxMatches: 100,
      contextLinesExplicit: true,
      maxMatchesExplicit: true,
    });
    expect(envelope.filter).toEqual({ contextLines: 5, maxMatches: 100 });
  });

  it("does not echo filter when defaults are used", () => {
    const envelope = buildGrepFileSuccessPayload(baseResult, baseOptions);
    expect(envelope.filter).toBeUndefined();
  });

  it("strips empty context arrays", () => {
    const envelope = buildGrepFileSuccessPayload(
      {
        ...baseResult,
        matches: [
          {
            lineNumber: 10,
            lineContent: "const app = express();",
            contextBefore: [],
            contextAfter: [],
          },
        ],
      },
      baseOptions,
    );
    expect(envelope.matches[0]?.contextBefore).toBeUndefined();
    expect(envelope.matches[0]?.contextAfter).toBeUndefined();
  });

  it("surfaces hint on empty results", () => {
    const envelope = buildGrepFileSuccessPayload(
      {
        ...baseResult,
        matches: [],
        totalMatches: 0,
        hint: "Pattern not found in file.",
      },
      baseOptions,
    );
    expect(envelope.matches).toEqual([]);
    expect(envelope.hint).toBe("Pattern not found in file.");
  });

  it("surfaces repo-URL addressing", () => {
    const envelope = buildGrepFileSuccessPayload(baseResult, {
      ...baseOptions,
      registry: undefined,
      name: undefined,
      repoUrl: "https://github.com/expressjs/express",
      gitRef: "main",
    });
    expect(envelope.repoUrl).toBe("https://github.com/expressjs/express");
    expect(envelope.gitRef).toBe("main");
  });
});

describe("formatGrepFileTerminal", () => {
  it("plain mode: emits matching lines only — no header, no gutter", () => {
    const envelope = buildGrepFileSuccessPayload(
      {
        ...baseResult,
        matches: [
          {
            lineNumber: 10,
            lineContent: "const app = express();",
            contextBefore: [],
            contextAfter: [],
          },
        ],
      },
      baseOptions,
    );
    const { stdout: output } = formatGrepFileTerminal(envelope, {
      useColors: false,
    });
    expect(output).toContain("const app = express();");
    expect(output).not.toContain("express · npm");
    expect(output).not.toMatch(/^>/m);
    // No line number prefix in plain mode.
    expect(output).not.toMatch(/^\s*10\s+const/m);
  });

  it("plain mode: zero matches → completely silent (matches grep's exit-1-with-no-output convention)", () => {
    const envelope = buildGrepFileSuccessPayload(
      { ...baseResult, matches: [], totalMatches: 0 },
      baseOptions,
    );
    const { stdout: output } = formatGrepFileTerminal(envelope, {
      useColors: false,
    });
    expect(output).toBe("");
  });

  it("plain mode with context: merges overlapping blocks into a single block", () => {
    // Two matches at lines 10 and 12 with contextBefore/After=2 each.
    // The contexts for match-1 [8..12] and match-2 [10..14] overlap.
    const envelope = buildGrepFileSuccessPayload(
      {
        ...baseResult,
        totalMatches: 2,
        matches: [
          {
            lineNumber: 10,
            lineContent: "match one",
            contextBefore: ["line 8", "line 9"],
            contextAfter: ["line 11", "match two"],
          },
          {
            lineNumber: 12,
            lineContent: "match two",
            contextBefore: ["line 10 (dup)", "line 11 (dup)"],
            contextAfter: ["line 13", "line 14"],
          },
        ],
      },
      baseOptions,
    );
    const { stdout: output } = formatGrepFileTerminal(envelope, {
      useColors: false,
    });
    // Every context line must appear exactly once.
    expect(output.match(/line 8/g)?.length).toBe(1);
    expect(output.match(/line 9/g)?.length).toBe(1);
    expect(output.match(/line 11/g)?.length).toBe(1);
    expect(output.match(/line 13/g)?.length).toBe(1);
    expect(output.match(/line 14/g)?.length).toBe(1);
    // Match-1 content (line 10) and match-2 content (line 12) both
    // appear once — the context duplicate at line 10 in match-2's
    // contextBefore must not overwrite the match line content.
    expect(output.match(/match one/g)?.length).toBe(1);
    expect(output.match(/match two/g)?.length).toBe(1);
    // No `--` separator because both matches merged into a single
    // block.
    expect(output).not.toContain("--");
  });

  it("plain mode with context: inserts `--` separator between distinct blocks", () => {
    const envelope = buildGrepFileSuccessPayload(
      {
        ...baseResult,
        totalMatches: 2,
        matches: [
          {
            lineNumber: 5,
            lineContent: "match near top",
            contextBefore: ["line 4"],
            contextAfter: ["line 6"],
          },
          {
            lineNumber: 50,
            lineContent: "match far below",
            contextBefore: ["line 49"],
            contextAfter: ["line 51"],
          },
        ],
      },
      baseOptions,
    );
    const { stdout: output } = formatGrepFileTerminal(envelope, {
      useColors: false,
    });
    expect(output).toContain("--");
    expect(output).toContain("line 4");
    expect(output).toContain("line 51");
  });

  it("verbose mode: renders header + gutter + `>` marker on match lines", () => {
    const envelope = buildGrepFileSuccessPayload(baseResult, baseOptions);
    const { stdout: output } = formatGrepFileTerminal(envelope, {
      useColors: false,
      verbose: true,
    });
    expect(output).toContain("express · npm · 1 match in src/index.js");
    expect(output).toContain("> 10  const app = express();");
    expect(output).toContain("// set up express");
    expect(output).toContain("app.get('/', …);");
  });

  it("verbose mode: renders plural 'matches' for counts ≠ 1", () => {
    const envelope = buildGrepFileSuccessPayload(
      {
        ...baseResult,
        totalMatches: 3,
        matches: Array.from({ length: 3 }, (_, i) => ({
          lineNumber: 10 + i,
          lineContent: `line ${10 + i}`,
        })),
      },
      baseOptions,
    );
    const { stdout: output } = formatGrepFileTerminal(envelope, {
      useColors: false,
      verbose: true,
    });
    expect(output).toContain("3 matches");
  });

  it("verbose mode: uses N+ header when hasMore is true", () => {
    const envelope = buildGrepFileSuccessPayload(
      {
        ...baseResult,
        totalMatches: 50,
        hasMore: true,
        matches: Array.from({ length: 50 }, (_, i) => ({
          lineNumber: i + 1,
          lineContent: `line ${i + 1}`,
        })),
      },
      baseOptions,
    );
    const { stdout: output } = formatGrepFileTerminal(envelope, {
      useColors: false,
      verbose: true,
    });
    expect(output).toContain("50+ matches");
    expect(output).toContain("More matches available");
  });

  it("verbose mode: empty-result + regex-char hint when pattern looks like regex", () => {
    const envelope = buildGrepFileSuccessPayload(
      { ...baseResult, matches: [], totalMatches: 0 },
      { ...baseOptions, pattern: "\\bfoo\\b" },
    );
    const { stdout: output } = formatGrepFileTerminal(envelope, {
      useColors: false,
      verbose: true,
    });
    expect(output).toContain("No matches for '\\bfoo\\b'");
    expect(output).toContain("literal substring matching");
  });

  it("verbose mode: does not add the regex hint when pattern doesn't look like regex", () => {
    const envelope = buildGrepFileSuccessPayload(
      { ...baseResult, matches: [], totalMatches: 0 },
      { ...baseOptions, pattern: "foo.bar" },
    );
    const { stdout: output } = formatGrepFileTerminal(envelope, {
      useColors: false,
      verbose: true,
    });
    expect(output).toContain("No matches for 'foo.bar'");
    expect(output).not.toContain("literal substring matching");
  });

  it("verbose mode: uses server-supplied hint when present", () => {
    const envelope = buildGrepFileSuccessPayload(
      {
        ...baseResult,
        matches: [],
        totalMatches: 0,
        hint: "Check the file path — we indexed this repo but the path didn't match.",
      },
      baseOptions,
    );
    const { stdout: output } = formatGrepFileTerminal(envelope, {
      useColors: false,
      verbose: true,
    });
    expect(output).toContain("Check the file path");
  });

  it("plain mode: handles unsorted matches from the backend — final output is line-number sorted", () => {
    // Defensive: the backend should return matches sorted by line
    // number, but the merger has no dependency on arrival order.
    const envelope = buildGrepFileSuccessPayload(
      {
        ...baseResult,
        totalMatches: 2,
        matches: [
          {
            lineNumber: 80,
            lineContent: "match two",
            contextBefore: [],
            contextAfter: [],
          },
          {
            lineNumber: 10,
            lineContent: "match one",
            contextBefore: [],
            contextAfter: [],
          },
        ],
      },
      baseOptions,
    );
    const { stdout } = formatGrepFileTerminal(envelope, { useColors: false });
    const oneIndex = stdout.indexOf("match one");
    const twoIndex = stdout.indexOf("match two");
    expect(oneIndex).toBeGreaterThan(-1);
    expect(twoIndex).toBeGreaterThan(-1);
    expect(oneIndex).toBeLessThan(twoIndex);
  });

  it("plain mode with context: match line wins over another match's context entry at the same line", () => {
    // Match A at line 10; match B at line 12 with contextBefore that
    // reaches back to line 10. The match-line entry at 10 must stay
    // flagged as a match, not get overwritten by B's context copy.
    const envelope = buildGrepFileSuccessPayload(
      {
        ...baseResult,
        totalMatches: 2,
        matches: [
          {
            lineNumber: 10,
            lineContent: "TRUE_MATCH_CONTENT",
            contextBefore: [],
            contextAfter: ["ctx 11"],
          },
          {
            lineNumber: 12,
            lineContent: "match two",
            contextBefore: ["stale context version", "ctx 11 dup"],
            contextAfter: [],
          },
        ],
      },
      baseOptions,
    );
    const { stdout } = formatGrepFileTerminal(envelope, {
      useColors: false,
      verbose: true,
    });
    // The match line's actual content must appear with the `>` marker.
    expect(stdout).toMatch(/>\s+10\s+TRUE_MATCH_CONTENT/);
    // The stale context version must not leak in.
    expect(stdout).not.toContain("stale context version");
  });

  it("plain mode: handles matches with null contextBefore / contextAfter (builder strips empties to undefined)", () => {
    const envelope = buildGrepFileSuccessPayload(
      {
        ...baseResult,
        matches: [
          {
            lineNumber: 42,
            lineContent: "lonely match",
            contextBefore: [],
            contextAfter: [],
          },
        ],
      },
      baseOptions,
    );
    // Confirm the envelope stripped empty arrays.
    expect(envelope.matches[0]?.contextBefore).toBeUndefined();
    expect(envelope.matches[0]?.contextAfter).toBeUndefined();
    const { stdout } = formatGrepFileTerminal(envelope, { useColors: false });
    expect(stdout).toContain("lonely match");
  });

  it("verbose mode with context: merges overlapping blocks and deduplicates lines", () => {
    const envelope = buildGrepFileSuccessPayload(
      {
        ...baseResult,
        totalMatches: 2,
        matches: [
          {
            lineNumber: 10,
            lineContent: "match one",
            contextBefore: ["ctx 9"],
            contextAfter: ["ctx 11"],
          },
          {
            lineNumber: 12,
            lineContent: "match two",
            contextBefore: ["ctx 11 (dup)"],
            contextAfter: ["ctx 13"],
          },
        ],
      },
      baseOptions,
    );
    const { stdout: output } = formatGrepFileTerminal(envelope, {
      useColors: false,
      verbose: true,
    });
    // `ctx 11` appears once (match-1's contextAfter wins; match-2's
    // contextBefore version is dropped as a dup).
    expect(output.match(/ctx 11/g)?.length).toBe(1);
    expect(output.match(/ctx 11 \(dup\)/g)?.length).toBeFalsy();
    // Both matches are marked with `>`.
    expect(output.match(/^> /gm)?.length).toBe(2);
  });
});
