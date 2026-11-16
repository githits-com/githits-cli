import { describe, expect, it } from "bun:test";
import {
  boundedErrorDetail,
  parseHttpErrorDetail,
} from "./http-error-detail.js";

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

it.each([undefined, null, 123, {}, "", " \n\t\u0000"])(
  "does not surface invalid or empty detail %j",
  (value) => {
    expect(boundedErrorDetail(value)).toBeUndefined();
    expect(
      parseHttpErrorDetail(
        JSON.stringify({ detail: value, error: "Fallback detail" }),
        ["detail", "error"],
      ),
    ).toBe("Fallback detail");
  },
);
it("normalizes and caps a selected value with the same parser rule", () => {
  const value = `Provider\nmessage\u0000${"x".repeat(600)}`;
  expect(boundedErrorDetail(value)).toBe(
    parseHttpErrorDetail(JSON.stringify({ detail: value }), ["detail"]),
  );
  expect(boundedErrorDetail(value)).toHaveLength(500);
});
