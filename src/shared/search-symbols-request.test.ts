import { describe, expect, it } from "bun:test";
import { FILE_INTENT_ALL } from "./code-navigation-defaults.js";
import { buildSearchSymbolsParams } from "./search-symbols-request.js";

describe("buildSearchSymbolsParams", () => {
  const baseTarget = { registry: "NPM", packageName: "express" } as const;

  it("leaves fileIntent unset when the caller omits it", () => {
    const { params, defaulted } = buildSearchSymbolsParams({
      target: baseTarget,
      query: "middleware",
    });

    expect(params.fileIntent).toBeUndefined();
    expect(defaulted).not.toContain("fileIntent");
  });

  it("defaults waitTimeoutMs to 20000 and records it as defaulted", () => {
    const { params, defaulted } = buildSearchSymbolsParams({
      target: baseTarget,
      query: "middleware",
    });

    expect(params.waitTimeoutMs).toBe(20_000);
    expect(defaulted).toContain("waitTimeoutMs");
  });

  it("preserves explicit fileIntent values and does not mark as defaulted", () => {
    const { params, defaulted } = buildSearchSymbolsParams({
      target: baseTarget,
      query: "middleware",
      fileIntent: "TEST",
    });

    expect(params.fileIntent).toBe("TEST");
    expect(defaulted).not.toContain("fileIntent");
  });

  it("preserves explicit waitTimeoutMs and does not mark as defaulted", () => {
    const { params, defaulted } = buildSearchSymbolsParams({
      target: baseTarget,
      query: "middleware",
      waitTimeoutMs: 5000,
    });

    expect(params.waitTimeoutMs).toBe(5000);
    expect(defaulted).not.toContain("waitTimeoutMs");
  });

  it("maps FILE_INTENT_ALL sentinel to undefined (omit filter at service layer)", () => {
    const { params, defaulted } = buildSearchSymbolsParams({
      target: baseTarget,
      query: "middleware",
      fileIntent: FILE_INTENT_ALL,
    });

    expect(params.fileIntent).toBeUndefined();
    // Explicit caller choice — not a silent default.
    expect(defaulted).not.toContain("fileIntent");
  });

  it("passes all other fields through unchanged", () => {
    const { params } = buildSearchSymbolsParams({
      target: baseTarget,
      query: "middleware",
      keywords: ["a", "b"],
      matchMode: "AND",
      kind: "FUNCTION",
      filePath: "lib/",
      limit: 25,
      waitTimeoutMs: 3000,
    });

    expect(params).toEqual({
      target: baseTarget,
      query: "middleware",
      keywords: ["a", "b"],
      matchMode: "AND",
      kind: "FUNCTION",
      filePath: "lib/",
      limit: 25,
      fileIntent: undefined,
      waitTimeoutMs: 3000,
    });
  });
});
