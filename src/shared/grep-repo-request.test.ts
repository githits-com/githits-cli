import { describe, expect, it } from "bun:test";
import type { CodeNavigationTarget } from "../services/index.js";
import {
  buildGrepRepoParams,
  GREP_REPO_PATTERN_NOTE,
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
    expect(params.waitTimeoutMs).toBe(20000);
    expect(params.symbolFields).toBeUndefined();
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

  it("passes symbol fields through when requested", () => {
    const { params, explicit } = buildGrepRepoParams({
      target,
      pattern: "middleware",
      symbolFields: ["name", "qualified_path", "kind"],
    });

    expect(params.symbolFields).toEqual(["name", "qualified_path", "kind"]);
    expect(explicit.symbolFields).toBe(true);
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
});

describe("GREP_REPO_PATTERN_NOTE", () => {
  it("mentions literal, regex, RE2, and byte limit", () => {
    expect(GREP_REPO_PATTERN_NOTE).toMatch(/literal/i);
    expect(GREP_REPO_PATTERN_NOTE).toMatch(/regex/i);
    expect(GREP_REPO_PATTERN_NOTE).toMatch(/RE2/i);
    expect(GREP_REPO_PATTERN_NOTE).toMatch(/200/i);
  });
});
