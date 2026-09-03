import { describe, expect, it } from "bun:test";
import type { CodeNavigationTarget } from "@githits/core-internal";
import {
  buildGrepRepoParams,
  GREP_REPO_PATTERN_NOTE,
  GREP_REPO_SYMBOL_FIELDS,
} from "./grep-repo-request.js";

const target: CodeNavigationTarget = {
  registry: "NPM",
  packageName: "express",
};

describe("buildGrepRepoParams", () => {
  it("defaults to whole-target literal grep", () => {
    const { params } = buildGrepRepoParams({
      target,
      pattern: "middleware",
    });
    expect(params.patternType).toBeUndefined();
    expect(params.allowUnscoped).toBe(true);
    expect(params.contextLinesBefore).toBe(0);
    expect(params.contextLinesAfter).toBe(0);
    expect(params.maxMatches).toBe(50);
    expect(params.maxMatchesPerFile).toBe(50);
    expect(params.waitTimeoutMs).toBe(20000);
    expect(params.symbolFields).toBeUndefined();
  });

  it("defaults the per-file limit to the requested total limit", () => {
    const { params } = buildGrepRepoParams({
      target,
      pattern: "middleware",
      maxMatches: 60,
    });

    expect(params.maxMatches).toBe(60);
    expect(params.maxMatchesPerFile).toBe(60);
  });

  it("compiles path, pathPrefix, and globs into pathSelectors", () => {
    const { params } = buildGrepRepoParams({
      target,
      pattern: "middleware",
      path: "src/index.js",
      pathPrefix: "src/",
      globs: ["src/**/*.js"],
    });
    expect(params.allowUnscoped).toBeUndefined();
    expect(params.pathSelectors).toEqual([
      { kind: "EXACT", value: "src/index.js" },
      { kind: "PREFIX", value: "src/" },
      { kind: "GLOB", value: "src/**/*.js" },
    ]);
  });

  it("supports symmetric and asymmetric context", () => {
    const symmetric = buildGrepRepoParams({
      target,
      pattern: "middleware",
      contextLines: 3,
    });
    expect(symmetric.params.contextLinesBefore).toBe(3);
    expect(symmetric.params.contextLinesAfter).toBe(3);

    const asymmetric = buildGrepRepoParams({
      target,
      pattern: "middleware",
      contextLines: 3,
      contextLinesBefore: 1,
      contextLinesAfter: 5,
    });
    expect(asymmetric.params.contextLinesBefore).toBe(1);
    expect(asymmetric.params.contextLinesAfter).toBe(5);
  });

  it("accepts context boundaries and rejects values outside them", () => {
    const boundary = buildGrepRepoParams({
      target,
      pattern: "middleware",
      contextLinesBefore: 0,
      contextLinesAfter: 10,
    });
    expect(boundary.params.contextLinesBefore).toBe(0);
    expect(boundary.params.contextLinesAfter).toBe(10);

    for (const contextLines of [-1, 11, 1.5]) {
      expect(() =>
        buildGrepRepoParams({
          target,
          pattern: "middleware",
          contextLines,
        }),
      ).toThrow(/context_lines.*integer between 0 and 10/);
    }
  });

  it("passes symbol fields through when requested", () => {
    const { params, explicit } = buildGrepRepoParams({
      target,
      pattern: "middleware",
      symbolFields: ["name", "qualified_path", "kind"],
    });

    expect(params.symbolFields).toEqual(["name", "qualified_path", "kind"]);
    expect(explicit.symbolFields).toBe(true);
  });

  it("matches the grepRepo symbol hydration contract", () => {
    expect(GREP_REPO_SYMBOL_FIELDS).toEqual([
      "symbol_ref",
      "name",
      "qualified_path",
      "kind",
      "category",
      "arity",
      "is_public",
      "file_path",
      "start_line",
      "end_line",
      "content_hash",
      "parent_path",
    ]);
  });

  it.each(["code", "caller_count", "parent_symbol_ref"])(
    "rejects underivable grep symbol field %s",
    (symbolField) => {
      expect(() =>
        buildGrepRepoParams({
          target,
          pattern: "middleware",
          symbolFields: [symbolField],
        }),
      ).toThrow(/symbol_fields.*must be one of/);
    },
  );

  it("rejects unknown symbol fields", () => {
    expect(() =>
      buildGrepRepoParams({
        target,
        pattern: "middleware",
        symbolFields: ["name", "qualifiedPath"],
      }),
    ).toThrow(/symbol_fields.*qualifiedPath/);
  });

  it("rejects leading dots in extensions", () => {
    expect(() =>
      buildGrepRepoParams({
        target,
        pattern: "middleware",
        extensions: [".js"],
      }),
    ).toThrow(/leading dot/);
  });

  it("rejects whitespace-only patterns without trimming real content", () => {
    expect(() =>
      buildGrepRepoParams({
        target,
        pattern: "   ",
      }),
    ).toThrow(/pattern/);

    const { params } = buildGrepRepoParams({
      target,
      pattern: " middleware ",
    });
    expect(params.pattern).toBe(" middleware ");
  });

  it("rejects omitted patterns with a code_files recovery hint", () => {
    expect(() =>
      buildGrepRepoParams({
        target,
        pathPrefix: "lib/",
      }),
    ).toThrow(/pattern.*code_files/);
  });
});

describe("GREP_REPO_PATTERN_NOTE", () => {
  it("mentions literal, regex, RE2, byte limit, and whole-target regex planning", () => {
    expect(GREP_REPO_PATTERN_NOTE).toMatch(/literal/i);
    expect(GREP_REPO_PATTERN_NOTE).toMatch(/regex/i);
    expect(GREP_REPO_PATTERN_NOTE).toMatch(/RE2/i);
    expect(GREP_REPO_PATTERN_NOTE).toMatch(/200/i);
    expect(GREP_REPO_PATTERN_NOTE).toMatch(/literal substring/i);
  });
});
