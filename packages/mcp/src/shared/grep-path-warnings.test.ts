import { describe, expect, it } from "bun:test";
import { type GrepPathWarning, parseGrepResult } from "@githits/core-internal";
import mixed from "./fixtures/grep-text/mixed-100.json";
import { projectGrepResult } from "./grep-response.js";
import { formatGrepText } from "./grep-text.js";

const warning: GrepPathWarning = {
  requestedInputIndices: [2, 0],
  target: "npm:x",
  path: "packages/x/src",
  repositorySubpath: "packages/x",
  message: "Verbose backend explanation that must stay internal.",
  suggestions: [
    { target: `github:o/r@${"a".repeat(40)}`, path: "packages/x/src" },
    { target: "npm:x", path: "src" },
  ],
};
const summary =
  'Path is prefixed with package path "packages/x". Did you mean "src"?';

function page() {
  return {
    ...parseGrepResult(mixed),
    pathWarnings: structuredClone([
      warning,
      {
        ...warning,
        requestedInputIndices: [1],
        suggestions: [{ target: warning.target, path: "test" }],
      },
    ]),
  };
}

describe("compact grep path warnings", () => {
  it("projects warning strings without verbose backend metadata or aliasing provider data", () => {
    const input = page();
    const before = structuredClone(input);
    const projected = projectGrepResult(input);
    expect(projected).toEqual({
      ...before,
      pathWarnings: [
        summary,
        'Path is prefixed with package path "packages/x". Did you mean "test"?',
      ],
    });
    projected.pathWarnings.push("changed");
    projected.hits.pop();
    expect(input).toEqual(before);
    const json = JSON.stringify(projectGrepResult(input));
    expect(json).not.toContain(warning.message);
    expect(json).not.toContain('"suggestions"');
    expect(json).not.toContain(warning.suggestions[0]!.target);
  });

  it("keeps native failures, matches and cursors beside compact warning lines", () => {
    const input = page();
    Object.assign(input.targets[0]!, {
      traversal: "FAILED",
      errorCode: "GREP_PATH_NOT_INDEXED",
      publicMessage: "The requested exact path is not indexed.",
      retryable: false,
    });
    input.traversal = "NON_RESUMABLE_PARTIAL";
    const text = formatGrepText(input);
    expect(text).toContain("Found 100 matches");
    expect(text).toContain("GREP_PATH_NOT_INDEXED");
    expect(text).toContain("The requested exact path is not indexed.");
    expect(
      text.split("\n").filter((line) => line.startsWith("Warning:")),
    ).toEqual([
      `Warning: ${summary}`,
      'Warning: Path is prefixed with package path "packages/x". Did you mean "test"?',
    ]);
    expect(text).toContain("--cursor");
    expect(text).not.toContain(warning.message);
    expect(text).not.toContain("Path advisories:");
    expect(text).not.toContain("Unverified alternatives");
  });

  it("collapses duplicate warning text in both output formats", () => {
    const input = page();
    input.pathWarnings = [warning, structuredClone(warning)];
    expect(projectGrepResult(input).pathWarnings).toEqual([summary]);
    expect(
      formatGrepText(input)
        .split("\n")
        .filter((line) => line.startsWith("Warning:")),
    ).toEqual([`Warning: ${summary}`]);
  });

  it("does not invent a correction when the backend has no same-target suggestion", () => {
    const input = page();
    input.pathWarnings = [
      { ...warning, suggestions: [warning.suggestions[0]!] },
    ];
    const expected = 'Path is prefixed with package path "packages/x".';
    expect(projectGrepResult(input).pathWarnings).toEqual([expected]);
    expect(formatGrepText(input)).toContain(`Warning: ${expected}`);
  });

  for (const syntax of ["cli", "mcp"] as const) {
    it(`keeps the ${syntax} warning on one line even at narrow widths`, () => {
      const input = page();
      Object.assign(input, {
        hits: [],
        totalMatches: 0,
        traversal: "COMPLETE",
        nextCursor: null,
      });
      for (const target of input.targets)
        Object.assign(target, { traversal: "COMPLETE", readiness: "CURRENT" });
      const text = formatGrepText(input, { syntax, width: 35 });
      expect(text).toStartWith("No matches found.");
      expect(
        text.split("\n").filter((line) => line.startsWith("Warning:")),
      ).toEqual([
        `Warning: ${summary}`,
        'Warning: Path is prefixed with package path "packages/x". Did you mean "test"?',
      ]);
      expect(text).not.toContain("search failed");
      expect(text).not.toContain("still being prepared");
    });

    it(`quotes unusual ${syntax} paths and escapes terminal controls`, () => {
      const input = page();
      const path =
        "src/a 'quoted' \"file\";$HOME`echo nope`\\é\n\u001b[31m\u009b[31m.ts";
      input.pathWarnings = [
        {
          ...warning,
          repositorySubpath: "packages/\u009bx\u007f",
          suggestions: [{ target: warning.target, path }],
        },
      ];
      const text = formatGrepText(input, { syntax, width: 35 });
      const row = text.split("\n").find((line) => line.startsWith("Warning:"))!;
      expect(row).toContain('Did you mean "src/a');
      expect(row).toContain(
        '\\"file\\";$HOME`echo nope`\\\\é\\n\\u001b[31m\\u009b[31m.ts"?',
      );
      expect(row).not.toContain("\u001b");
      expect(row).not.toContain("\u009b");
      const projected = projectGrepResult(input);
      const warnings = JSON.parse(JSON.stringify(projected)).pathWarnings;
      expect(warnings).toEqual(projected.pathWarnings);
      expect(row.slice("Warning: ".length)).toBe(warnings[0]);
      expect(warnings[0]).not.toContain("\u009b");
      expect(warnings[0]).not.toContain("\u007f");
    });
  }
});
