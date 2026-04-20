import { describe, expect, it } from "bun:test";
import { formatCompactNumber } from "./format-number.js";

describe("formatCompactNumber", () => {
  it("handles the locked boundary table from the plan", () => {
    const cases: Array<[number, string]> = [
      [0, "0"],
      [1, "1"],
      [999, "999"],
      [1_000, "1.0k"],
      [1_499, "1.4k"],
      [1_500, "1.5k"],
      [1_599, "1.5k"], // floor, not round
      [9_949, "9.9k"],
      [9_950, "9.9k"], // floor, not round
      [9_999, "9.9k"], // never rounds *up* across boundary
      [10_000, "10k"], // no decimal above 10
      [10_999, "10k"],
      [99_999, "99k"],
      [100_000, "100k"],
      [999_999, "999k"],
      [1_000_000, "1.0M"],
      [1_500_000, "1.5M"],
      [9_999_999, "9.9M"],
      [10_000_000, "10M"],
      [1_000_000_000, "1.0B"],
      [1_500_000_000, "1.5B"],
    ];

    for (const [input, expected] of cases) {
      expect(formatCompactNumber(input)).toBe(expected);
    }
  });

  it("emits `-` prefix for negatives with magnitude-floor semantics", () => {
    expect(formatCompactNumber(-1)).toBe("-1");
    expect(formatCompactNumber(-999)).toBe("-999");
    expect(formatCompactNumber(-1_500)).toBe("-1.5k");
    expect(formatCompactNumber(-1_599)).toBe("-1.5k");
    expect(formatCompactNumber(-10_000)).toBe("-10k");
    expect(formatCompactNumber(-1_000_000)).toBe("-1.0M");
  });

  it("throws RangeError for NaN and ±Infinity", () => {
    expect(() => formatCompactNumber(Number.NaN)).toThrow(RangeError);
    expect(() => formatCompactNumber(Number.POSITIVE_INFINITY)).toThrow(
      RangeError,
    );
    expect(() => formatCompactNumber(Number.NEGATIVE_INFINITY)).toThrow(
      RangeError,
    );
  });
});
