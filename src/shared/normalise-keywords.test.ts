import { describe, expect, it } from "bun:test";
import {
  InvalidKeywordsError,
  normaliseKeywords,
} from "./normalise-keywords.js";

describe("normaliseKeywords", () => {
  it("returns an empty array when both inputs are undefined", () => {
    expect(normaliseKeywords(undefined, undefined)).toEqual([]);
  });

  it("splits a comma-separated list and trims entries", () => {
    expect(normaliseKeywords("router, handler , middleware")).toEqual([
      "router",
      "handler",
      "middleware",
    ]);
  });

  it("accepts a repeated-flag array unchanged (after trim/dedup)", () => {
    expect(normaliseKeywords(undefined, ["router", "handler"])).toEqual([
      "router",
      "handler",
    ]);
  });

  it("merges comma + repeated inputs and de-duplicates preserving first-seen order", () => {
    expect(
      normaliseKeywords("router,handler", ["middleware", "router", "errors"]),
    ).toEqual(["router", "handler", "middleware", "errors"]);
  });

  it("drops empty entries", () => {
    expect(normaliseKeywords(",router,,handler,,,")).toEqual([
      "router",
      "handler",
    ]);
  });

  it("accepts empty string as no input", () => {
    expect(normaliseKeywords("")).toEqual([]);
  });

  it("throws InvalidKeywordsError when the merged list exceeds 20 entries", () => {
    const many = Array.from({ length: 21 }, (_, i) => `kw${i}`).join(",");
    expect(() => normaliseKeywords(many)).toThrow(InvalidKeywordsError);
  });

  it("counts AFTER dedup when enforcing the cap", () => {
    // 20 unique keywords + one duplicate should stay at 20 and pass.
    const twenty = Array.from({ length: 20 }, (_, i) => `kw${i}`).join(",");
    expect(() => normaliseKeywords(`${twenty},kw0`)).not.toThrow();
  });

  it("classifier contract: error name is stable", () => {
    try {
      normaliseKeywords(
        Array.from({ length: 30 }, (_, i) => `kw${i}`).join(","),
      );
      expect.unreachable();
    } catch (err) {
      expect((err as Error).name).toBe("InvalidKeywordsError");
    }
  });
});
