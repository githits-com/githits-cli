import { describe, expect, it } from "bun:test";
import { buildReadPackageDocParams } from "./read-package-doc-request.js";

describe("buildReadPackageDocParams", () => {
  it("preserves opaque page IDs byte-for-byte", () => {
    const pageId = "  opaque:%2Fpath?x=%23#fragment%2F  ";

    expect(buildReadPackageDocParams({ pageId }).params).toEqual({ pageId });
  });

  it.each([
    [{}, { pageId: "page" }],
    [{ startLine: 10 }, { pageId: "page", startLine: 10 }],
    [{ endLine: 40 }, { pageId: "page", endLine: 40 }],
    [
      { startLine: 10, endLine: 40 },
      { pageId: "page", startLine: 10, endLine: 40 },
    ],
  ])("retains only supplied bounds %#", (bounds, expected) => {
    expect(
      buildReadPackageDocParams({ pageId: "page", ...bounds }).params,
    ).toEqual(expected);
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid line %s",
    (line) => {
      expect(() =>
        buildReadPackageDocParams({ pageId: "page", startLine: line }),
      ).toThrow("positive integer");
    },
  );

  it("rejects reversed ranges", () => {
    expect(() =>
      buildReadPackageDocParams({
        pageId: "page",
        startLine: 40,
        endLine: 10,
      }),
    ).toThrow("range is reversed");
  });
});
