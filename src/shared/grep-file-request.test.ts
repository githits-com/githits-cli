import { describe, expect, it } from "bun:test";
import type { CodeNavigationTarget } from "../services/index.js";
import {
  buildGrepFileParams,
  GREP_PATTERN_SEMANTICS_NOTE,
  looksLikeRegexAttempt,
} from "./grep-file-request.js";

const target: CodeNavigationTarget = {
  registry: "NPM",
  packageName: "express",
};

describe("buildGrepFileParams — defaults + happy path", () => {
  it("applies defaults for context (0) and max_matches (50) and wait (20000)", () => {
    const { params } = buildGrepFileParams({
      target,
      path: "src/index.js",
      pattern: "middleware",
    });
    expect(params.contextLines).toBe(0);
    expect(params.maxMatches).toBe(50);
    expect(params.waitTimeoutMs).toBe(20000);
  });

  it("passes explicit values through and marks them explicit", () => {
    const { params, contextLinesExplicit, maxMatchesExplicit } =
      buildGrepFileParams({
        target,
        path: "src/index.js",
        pattern: "middleware",
        contextLines: 5,
        maxMatches: 100,
      });
    expect(params.contextLines).toBe(5);
    expect(params.maxMatches).toBe(100);
    expect(contextLinesExplicit).toBe(true);
    expect(maxMatchesExplicit).toBe(true);
  });

  it("trims the path", () => {
    const { params } = buildGrepFileParams({
      target,
      path: "  src/index.js  ",
      pattern: "middleware",
    });
    expect(params.path).toBe("src/index.js");
  });
});

describe("buildGrepFileParams — rejection cases", () => {
  it("rejects empty path", () => {
    expect(() =>
      buildGrepFileParams({
        target,
        path: "   ",
        pattern: "middleware",
      }),
    ).toThrow(/`path` is required/);
  });

  it("rejects empty pattern", () => {
    expect(() =>
      buildGrepFileParams({
        target,
        path: "src/index.js",
        pattern: "",
      }),
    ).toThrow(/`pattern` is required/);
  });

  it("rejects pattern over 200 characters", () => {
    expect(() =>
      buildGrepFileParams({
        target,
        path: "src/index.js",
        pattern: "a".repeat(201),
      }),
    ).toThrow(/≤ 200 characters/);
  });

  it.each([
    -1, 11, 3.5,
  ])("rejects out-of-range contextLines %s", (contextLines) => {
    expect(() =>
      buildGrepFileParams({
        target,
        path: "src/index.js",
        pattern: "middleware",
        contextLines,
      }),
    ).toThrow(/between 0 and 10/);
  });

  it.each([0, 201, 3.5])("rejects out-of-range maxMatches %s", (maxMatches) => {
    expect(() =>
      buildGrepFileParams({
        target,
        path: "src/index.js",
        pattern: "middleware",
        maxMatches,
      }),
    ).toThrow(/between 1 and 200/);
  });
});

describe("GREP_PATTERN_SEMANTICS_NOTE constant", () => {
  it("mentions case-insensitive, substring, not-regex, and 200-char cap", () => {
    expect(GREP_PATTERN_SEMANTICS_NOTE).toMatch(/case-insensitive/i);
    expect(GREP_PATTERN_SEMANTICS_NOTE).toMatch(/substring/i);
    expect(GREP_PATTERN_SEMANTICS_NOTE).toMatch(/NOT regex|not regex/i);
    expect(GREP_PATTERN_SEMANTICS_NOTE).toMatch(/200/);
  });
});

describe("looksLikeRegexAttempt — narrow heuristic", () => {
  it.each([
    "\\bfoo\\b",
    "\\Bnot-boundary",
    "\\w+",
    "\\W+",
    "\\d{3}",
    "\\D",
    "\\s",
    "\\S",
    "\\.foo",
    "\\/path",
    "\\(captured\\)",
    "\\[bracket\\]",
    "[abc]",
    "[a-z]",
    "(?:foo|bar)",
    "(?=bar)",
    "(?!bar)",
    "(?<=foo)bar",
    "(?<!foo)bar",
    "(?<name>foo)",
    "(?i)case",
    "\\\\path",
    "a{3}",
    "b{2,5}",
    "c{2,}",
  ])("flags '%s' as a regex attempt", (pattern) => {
    expect(looksLikeRegexAttempt(pattern)).toBe(true);
  });

  it.each([
    "foo.bar", // dot in filename — common, not a regex signal
    "*.js", // glob — not regex
    "hello world",
    "ENOTFOUND",
    "price?",
    "a+b",
    "^start", // raw ^ — too common in code to flag
    "end$", // raw $ — too common as variable / shell / regex end
    "foo|bar", // alternation — common as literal OR text
    "middleware()", // parens as function call, not regex group
    "{count: 5}", // braces in object literals
  ])("does not flag '%s' (avoids false positives)", (pattern) => {
    expect(looksLikeRegexAttempt(pattern)).toBe(false);
  });
});
