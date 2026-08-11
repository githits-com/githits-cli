import { describe, expect, it } from "bun:test";
import type {
  LeanGrepRepoEnvelope,
  LeanGrepRepoMatch,
} from "./grep-repo-response.js";
import { renderGrepRepoText } from "./grep-repo-text.js";

function envelope(
  overrides: Partial<LeanGrepRepoEnvelope> = {},
): LeanGrepRepoEnvelope {
  return {
    pattern: "applyEdit",
    matches: [],
    hasMore: false,
    filesScanned: 120,
    filesInScope: 120,
    totalMatches: 0,
    uniqueFilesMatched: 0,
    ...overrides,
  };
}

function match(overrides: Partial<LeanGrepRepoMatch> = {}): LeanGrepRepoMatch {
  return {
    filePath: "src/diff/foo.ts",
    line: 142,
    matchStartByte: 16,
    matchEndByte: 25,
    lineContent: "export function applyEdit(input: string): string {",
    ...overrides,
  };
}

describe("renderGrepRepoText", () => {
  it("renders scoped zero-match context and pattern pivots", () => {
    const text = renderGrepRepoText(envelope());
    expect(text).toContain("code_grep | 0 matches in 0 files");
    expect(text).toContain('pattern="applyEdit"');
    expect(text).toContain("No matches.");
    expect(text).toContain("files scanned: 120 (full scope)");
    expect(text).toContain("Do not repeat this grep unchanged.");
    expect(text).toContain("shorten or change the pattern");
    expect(text).not.toContain("casing");
    expect(text).not.toContain("case_sensitive");
    expect(text).toContain("use search for conceptual intent");
  });

  it("advises disabling case sensitivity only when it was enabled", () => {
    const text = renderGrepRepoText(envelope({ caseSensitive: true }));

    expect(text).toContain("set case_sensitive: false");
  });

  it("advises loosening selectors when no files are in scope", () => {
    const text = renderGrepRepoText(
      envelope({
        filesScanned: 0,
        filesInScope: 0,
        indexedVersion: "v5.2.1",
      }),
    );

    expect(text).toContain("files scanned: 0 (full scope)");
    expect(text).toContain("served=v5.2.1");
    expect(text).toContain(
      "loosen path, path_prefix, globs, extensions, or exclusion filters",
    );
    expect(text).not.toContain("use search for conceptual intent");
  });

  it("explains when the content index pruned files before verification", () => {
    const text = renderGrepRepoText(
      envelope({ filesScanned: 1, filesInScope: 206 }),
    );

    expect(text).toContain(
      "files: 206 in scope | 1 content-scanned after index pruning",
    );
    expect(text).not.toContain("files: 1 scanned | 206 in scope");
  });

  it("renders single-file matches grouped under the file with line gutter", () => {
    const text = renderGrepRepoText(
      envelope({
        totalMatches: 2,
        uniqueFilesMatched: 1,
        matches: [
          match({ line: 142 }),
          match({
            line: 287,
            lineContent: "  const result = applyEdit(input, hunk);",
          }),
        ],
      }),
    );
    expect(text).toContain("src/diff/foo.ts (2)");
    expect(text).toContain(
      "  142: export function applyEdit(input: string): string {",
    );
    expect(text).toContain("  287:   const result = applyEdit(input, hunk);");
    expect(text).not.toContain("Do not repeat this grep unchanged.");
  });

  it("renders matches across multiple files with blank-line separators", () => {
    const text = renderGrepRepoText(
      envelope({
        totalMatches: 2,
        uniqueFilesMatched: 2,
        matches: [
          match({ filePath: "src/a.ts", line: 10, lineContent: "a-line" }),
          match({ filePath: "src/b.ts", line: 20, lineContent: "b-line" }),
        ],
      }),
    );
    expect(text).toContain("src/a.ts (1)");
    expect(text).toContain("src/b.ts (1)");
    const aIdx = text.indexOf("src/a.ts");
    const bIdx = text.indexOf("src/b.ts");
    expect(aIdx).toBeLessThan(bIdx);
    // Two file blocks separated by a blank line.
    const between = text.slice(aIdx, bIdx);
    expect(between).toContain("\n\n");
  });

  it("renders context lines with grep -A/-B separators", () => {
    const text = renderGrepRepoText(
      envelope({
        totalMatches: 1,
        uniqueFilesMatched: 1,
        matches: [
          match({
            line: 142,
            contextBefore: [
              "// Apply a unified diff patch",
              "// Returns the new content",
            ],
            contextAfter: ['  const lines = file.split("\\n");'],
          }),
        ],
      }),
    );
    expect(text).toContain("  140- // Apply a unified diff patch");
    expect(text).toContain("  141- // Returns the new content");
    expect(text).toContain(
      "  142: export function applyEdit(input: string): string {",
    );
    expect(text).toContain('  143-   const lines = file.split("\\n");');
  });

  it("inserts a separator between non-adjacent blocks in the same file", () => {
    const text = renderGrepRepoText(
      envelope({
        totalMatches: 2,
        uniqueFilesMatched: 1,
        matches: [
          match({
            line: 50,
            contextBefore: ["before-50"],
            contextAfter: ["after-50"],
          }),
          match({
            line: 200,
            contextBefore: ["before-200"],
            contextAfter: ["after-200"],
          }),
        ],
      }),
    );
    expect(text).toContain("  --");
  });

  it("renders truncation notice when truncatedReason is set", () => {
    const text = renderGrepRepoText(
      envelope({
        totalMatches: 50,
        uniqueFilesMatched: 7,
        truncatedReason: "limit",
        hasMore: true,
        matches: [match()],
      }),
    );
    expect(text).toContain("Truncated: limit.");
    expect(text).toContain("max_matches");
  });

  it("renders next-cursor note when hasMore", () => {
    const text = renderGrepRepoText(
      envelope({
        totalMatches: 50,
        uniqueFilesMatched: 7,
        hasMore: true,
        nextCursor: "ABC123",
        matches: [match()],
      }),
    );
    expect(text).toContain("More matches available. Pass cursor=ABC123");
  });

  it("pages an empty incomplete result instead of changing the grep", () => {
    const text = renderGrepRepoText(
      envelope({
        hasMore: true,
        nextCursor: "ABC123",
      }),
    );

    expect(text).toContain("More matches available. Pass cursor=ABC123");
    expect(text).not.toContain("Do not repeat this grep unchanged.");
    expect(text).not.toContain("shorten or change the pattern");
  });

  it("surfaces truncation on an empty incomplete result", () => {
    const text = renderGrepRepoText(
      envelope({
        truncatedReason: "limit",
      }),
    );

    expect(text).toContain("Truncated: limit.");
    expect(text).not.toContain("Do not repeat this grep unchanged.");
  });

  it("humanizes deadline truncation", () => {
    const text = renderGrepRepoText(
      envelope({
        truncatedReason: "DEADLINE",
      }),
    );

    expect(text).toContain("Truncated: time limit reached.");
    expect(text).not.toContain("Truncated: DEADLINE.");
  });

  it("renders pattern-type and case-sensitive flags in header when set", () => {
    const text = renderGrepRepoText(
      envelope({
        patternType: "regex",
        caseSensitive: true,
        totalMatches: 1,
        uniqueFilesMatched: 1,
        matches: [match()],
      }),
    );
    expect(text).toContain("regex,case-sensitive");
  });

  it("keeps filter inputs out of the header", () => {
    const text = renderGrepRepoText(
      envelope({
        totalMatches: 1,
        uniqueFilesMatched: 1,
        matches: [match()],
        filter: {
          pathPrefix: "src/integrations",
          extensions: ["ts", "tsx"],
          maxMatches: 30,
        },
      }),
    );
    const header = text.split("\n")[0] ?? "";
    expect(header).toBe('code_grep | 1 match in 1 file | pattern="applyEdit"');
  });

  it("keeps symbol metadata out of text output", () => {
    const text = renderGrepRepoText(
      envelope({
        totalMatches: 1,
        uniqueFilesMatched: 1,
        matches: [
          match({
            symbol: {
              name: "applyEdit",
              qualifiedPath: "diff.applyEdit",
              kind: "function",
              startLine: 140,
              endLine: 160,
            },
          }),
        ],
      }),
    );
    expect(text).toContain(
      "  142: export function applyEdit(input: string): string {",
    );
    expect(text).not.toContain("Symbols:");
    expect(text).not.toContain("diff.applyEdit");
  });

  it("uses ASCII separators only", () => {
    const text = renderGrepRepoText(
      envelope({
        totalMatches: 1,
        uniqueFilesMatched: 1,
        truncatedReason: "limit",
        hasMore: true,
        nextCursor: "X",
        matches: [match()],
      }),
    );
    expect(text).not.toMatch(/[·…—–]/);
  });

  it("notes binary/oversized skips when present", () => {
    const text = renderGrepRepoText(
      envelope({
        totalMatches: 1,
        uniqueFilesMatched: 1,
        binaryFilesSkipped: 4,
        filesTooLargeSkipped: 2,
        matches: [match()],
      }),
    );
    expect(text).toContain("4 binary file(s) skipped");
    expect(text).toContain("2 oversized file(s) skipped");
  });
});
