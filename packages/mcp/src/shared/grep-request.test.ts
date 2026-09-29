import { describe, expect, it } from "bun:test";
import { buildGrepParams, InvalidGrepRequestError } from "./grep-request.js";

const input = {
  targets: [{ target: "npm:express" }],
  pattern: "router",
  includeDetailedFields: false,
};

describe("unified grep request normalization", () => {
  it("enforces selector bounds per target rather than across targets", () => {
    const pathSelectors = Array.from({ length: 1000 }, () => ({
      kind: "exact" as const,
      value: "a",
    }));
    expect(
      buildGrepParams({
        ...input,
        targets: [
          { target: "npm:x", pathSelectors },
          { target: "npm:y", pathSelectors },
        ],
      }).targets,
    ).toHaveLength(2);
    expect(() =>
      buildGrepParams({
        ...input,
        targets: [
          {
            target: "npm:x",
            pathSelectors: [...pathSelectors, { kind: "exact", value: "b" }],
          },
        ],
      }),
    ).toThrow("1000");
  });
  it("sends explicit grep defaults without inventing page or wait controls", () => {
    expect(buildGrepParams(input)).toEqual({
      targets: [{ target: "npm:express", corpus: "ALL", allowUnscoped: true }],
      pattern: "router",
      patternType: "REGEX",
      caseSensitive: true,
      contextLinesBefore: 0,
      contextLinesAfter: 0,
      includeDetailedFields: false,
    });
  });
  it("preserves ordered scopes, raw locators and selector bytes without expansion", () => {
    const targets = [
      {
        target: "npm:example@1",
        corpus: "source",
        pathSelectors: [
          { kind: "glob" as const, value: "src/**/*.ts" },
          { kind: "exact" as const, value: "file with spaces.ts" },
        ],
      },
      { target: "site:example.test/api?x=%2F", pathSelectors: [] },
      { target: "github:owner/repo@refs/heads/main" },
      { target: "npm:example@1" },
    ];
    const params = buildGrepParams({
      ...input,
      targets,
      cursor: " opaque ",
      pattern: "  ",
    });
    expect(params.targets).toEqual([
      {
        target: targets[0]!.target,
        corpus: "SOURCE",
        allowUnscoped: true,
        pathSelectors: [
          { kind: "GLOB", value: "src/**/*.ts" },
          { kind: "EXACT", value: "file with spaces.ts" },
        ],
      },
      { target: targets[1]!.target },
      { target: targets[2]!.target, corpus: "ALL", allowUnscoped: true },
      { target: targets[3]!.target, corpus: "ALL", allowUnscoped: true },
    ]);
    expect(params.cursor).toBe(" opaque ");
    expect(params.pattern).toBe("  ");
  });
  it("inverts ignoreCase exactly once and preserves explicit literal and zero controls", () => {
    const p = buildGrepParams({
      ...input,
      pattern: "a(b)",
      patternType: "literal",
      ignoreCase: true,
      contextLinesBefore: 0,
      contextLinesAfter: 3,
      maxMatches: 1,
      waitTimeoutMs: 0,
      includeDetailedFields: true,
    });
    expect(p).toMatchObject({
      pattern: "a(b)",
      patternType: "LITERAL",
      caseSensitive: false,
      contextLinesBefore: 0,
      contextLinesAfter: 3,
      maxMatches: 1,
      waitTimeoutMs: 0,
      includeDetailedFields: true,
    });
    expect(buildGrepParams({ ...input, ignoreCase: false }).caseSensitive).toBe(
      true,
    );
  });
  it("omits empty optional arrays and cursors before rejecting site-only incompatibilities", () => {
    expect(
      buildGrepParams({
        ...input,
        targets: [{ target: "site:example.test", pathSelectors: [] }],
        cursor: "  ",
      }).targets,
    ).toEqual([{ target: "site:example.test" }]);
    expect(buildGrepParams({ ...input, cursor: "" }).cursor).toBeUndefined();
    for (const target of [
      { target: "site:example.test", corpus: "all" },
      {
        target: "site:example.test",
        pathSelectors: [{ kind: "prefix" as const, value: "api/" }],
      },
    ]) {
      expect(() => buildGrepParams({ ...input, targets: [target] })).toThrow(
        InvalidGrepRequestError,
      );
    }
  });
  it("validates pattern bytes and Unicode without trimming valid patterns", () => {
    expect(
      buildGrepParams({ ...input, pattern: "é".repeat(100) }).pattern,
    ).toBe("é".repeat(100));
    for (const pattern of ["", "é".repeat(101), "a\0b", "\ud800"])
      expect(() => buildGrepParams({ ...input, pattern })).toThrow(
        InvalidGrepRequestError,
      );
  });
  it("rejects invalid caller shapes and bounded controls instead of clamping", () => {
    for (const patch of [
      { targets: [] },
      { targets: Array.from({ length: 21 }, () => ({ target: "npm:x" })) },
      { targets: [{ target: " " }] },
      { contextLinesBefore: 11 },
      { contextLinesAfter: -1 },
      { contextLinesBefore: 0.5 },
      { maxMatches: 0 },
      { maxMatches: 1001 },
      { waitTimeoutMs: 300001 },
      { waitTimeoutMs: NaN },
      {
        targets: [
          {
            target: "npm:x",
            pathSelectors: [{ kind: "exact" as const, value: " " }],
          },
        ],
      },
    ])
      expect(() => buildGrepParams({ ...input, ...patch })).toThrow(
        InvalidGrepRequestError,
      );
  });
});
