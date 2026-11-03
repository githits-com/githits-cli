import { describe, expect, it } from "bun:test";
import {
  buildGrepContextClampingNotice,
  normalizeGrepContextValue,
  resolveGrepContext,
} from "./grep-context.js";

describe("grep context normalization", () => {
  it("validates requested context before any cap is applied", () => {
    expect(normalizeGrepContextValue(undefined, "--context")).toBeUndefined();
    expect(
      normalizeGrepContextValue(Number.MAX_SAFE_INTEGER, "--context"),
    ).toBe(Number.MAX_SAFE_INTEGER);
    for (const value of [
      -1,
      0.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.MAX_SAFE_INTEGER + 1,
    ])
      expect(() => normalizeGrepContextValue(value, "--context")).toThrow(
        /--context.*nonnegative safe integer/,
      );
  });

  it("keeps unchanged sides free of clamping metadata", () => {
    expect(resolveGrepContext()).toEqual({
      contextLinesBefore: 0,
      contextLinesAfter: 0,
    });
    expect(resolveGrepContext(0, 10)).toEqual({
      contextLinesBefore: 0,
      contextLinesAfter: 10,
    });
    expect(buildGrepContextClampingNotice(undefined)).toBeUndefined();
  });

  it("reports the requested and effective asymmetric sides with a surface-native read action", () => {
    const context = resolveGrepContext(20, 3);
    expect(context).toEqual({
      contextLinesBefore: 10,
      contextLinesAfter: 3,
      contextClamping: {
        requestedBefore: 20,
        requestedAfter: 3,
        effectiveBefore: 10,
        effectiveAfter: 3,
      },
    });
    expect(buildGrepContextClampingNotice(context.contextClamping, "cli")).toBe(
      "Context capped (before/after): 20/3 -> 10/3. More: githits read.",
    );
    expect(
      buildGrepContextClampingNotice(context.contextClamping, "mcp"),
    ).toContain("More: read.");
  });
});
