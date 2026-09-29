import { describe, expect, it } from "bun:test";
import {
  READ_TARGET_SELECTION,
  readTargetSchema,
  selectedReadTargetSchema,
} from "../index.js";

describe("ReadTarget", () => {
  it("exports the complete selection string", () => {
    expect(READ_TARGET_SELECTION).toBe(
      "target path selector startLine endLine",
    );
  });

  it("preserves opaque target, path, and selector bytes", () => {
    const target = 'https://example.test/包?next=%2F%E2%9C%93&quote="x y"';
    const path = 'src/目录/a file.ts?raw="yes"&value=%25';
    const selector = "heading “Quoted” / `symbol name`?x=%2F";

    expect(
      readTargetSchema.parse({
        target,
        path,
        selector,
        startLine: 3,
        endLine: 8,
      }),
    ).toEqual({ target, path, selector, startLine: 3, endLine: 8 });
  });

  it("omits nullable and absent optional fields", () => {
    const parsed = readTargetSchema.parse({
      target: "opaque-target",
      path: null,
      selector: null,
      startLine: null,
      endLine: null,
    });

    expect(parsed).toEqual({ target: "opaque-target" });
    expect(Object.keys(parsed)).toEqual(["target"]);
    expect(Object.hasOwn(parsed, "path")).toBe(false);
    expect(Object.hasOwn(parsed, "selector")).toBe(false);
    expect(Object.hasOwn(parsed, "startLine")).toBe(false);
    expect(Object.hasOwn(parsed, "endLine")).toBe(false);
  });

  it("accepts target-only and target/path projections", () => {
    expect(readTargetSchema.parse({ target: "opaque-target" })).toEqual({
      target: "opaque-target",
    });
    expect(
      readTargetSchema.parse({ target: "opaque-target", path: "src/a.ts" }),
    ).toEqual({ target: "opaque-target", path: "src/a.ts" });
  });

  it("requires a present nonempty string target", () => {
    for (const value of [{}, { target: "" }, { target: null }]) {
      expect(readTargetSchema.safeParse(value).success).toBe(false);
    }
  });

  it("rejects non-string optional text fields", () => {
    for (const value of [
      { target: 1 },
      { target: "t", path: 1 },
      { target: "t", selector: false },
      { target: "t", startLine: "1" },
      { target: "t", endLine: true },
    ]) {
      expect(readTargetSchema.safeParse(value).success).toBe(false);
    }
  });

  it("rejects nonpositive and fractional bounds", () => {
    for (const value of [
      { target: "t", startLine: 0 },
      { target: "t", endLine: -1 },
      { target: "t", startLine: 1.5 },
    ]) {
      expect(readTargetSchema.safeParse(value).success).toBe(false);
    }
  });

  it("rejects an end bound before its start bound", () => {
    expect(
      readTargetSchema.safeParse({
        target: "t",
        startLine: 8,
        endLine: 7,
      }).success,
    ).toBe(false);
  });

  it("requires every field selected by the full wire selection", () => {
    const complete = {
      target: "opaque-target",
      path: null,
      selector: null,
      startLine: null,
      endLine: null,
    };

    expect(selectedReadTargetSchema.parse(complete)).toEqual({
      target: "opaque-target",
    });

    for (const field of ["path", "selector", "startLine", "endLine"] as const) {
      const missingField: Record<string, unknown> = { ...complete };
      delete missingField[field];
      expect(selectedReadTargetSchema.safeParse(missingField).success).toBe(
        false,
      );
    }

    expect(readTargetSchema.parse({ target: "opaque-target" })).toEqual({
      target: "opaque-target",
    });
  });
});
