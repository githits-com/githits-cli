import { describe, expect, it } from "bun:test";
import { parseHttpErrorDetail } from "./http-error-detail.js";

describe("parseHttpErrorDetail", () => {
  it("returns an allowed JSON string field", () => {
    expect(
      parseHttpErrorDetail(JSON.stringify({ detail: "Resource not found" }), [
        "detail",
      ]),
    ).toBe("Resource not found");
  });

  it("does not surface plain text, HTML, or unknown fields", () => {
    expect(
      parseHttpErrorDetail("backend exploded", ["detail"]),
    ).toBeUndefined();
    expect(
      parseHttpErrorDetail("<!doctype html><h1>Failure</h1>", ["detail"]),
    ).toBeUndefined();
    expect(
      parseHttpErrorDetail(JSON.stringify({ message: "not allowed" }), [
        "detail",
      ]),
    ).toBeUndefined();
  });

  it("normalizes control characters and bounds displayed details", () => {
    const detail = `First line\nSecond\tline ${"x".repeat(600)}`;
    const result = parseHttpErrorDetail(JSON.stringify({ detail }), ["detail"]);

    expect(result).not.toContain("\n");
    expect(result).not.toContain("\t");
    expect(result).toStartWith("First line Second line");
    expect(result).toHaveLength(500);
    expect(result).toEndWith("...");
  });
});
