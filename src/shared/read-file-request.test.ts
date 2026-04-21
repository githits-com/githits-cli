import { describe, expect, it } from "bun:test";
import type { CodeNavigationTarget } from "../services/index.js";
import { buildReadFileParams } from "./read-file-request.js";

const target: CodeNavigationTarget = {
  registry: "NPM",
  packageName: "express",
};

describe("buildReadFileParams — defaults and validation", () => {
  it("accepts a minimal request and defaults wait to 20000", () => {
    const { params, startLineExplicit, endLineExplicit } = buildReadFileParams({
      target,
      filePath: "src/index.js",
    });
    expect(params.filePath).toBe("src/index.js");
    expect(params.startLine).toBeUndefined();
    expect(params.endLine).toBeUndefined();
    expect(params.waitTimeoutMs).toBe(20000);
    expect(startLineExplicit).toBe(false);
    expect(endLineExplicit).toBe(false);
  });

  it("trims whitespace around filePath", () => {
    const { params } = buildReadFileParams({
      target,
      filePath: "  src/index.js  ",
    });
    expect(params.filePath).toBe("src/index.js");
  });

  it("rejects an empty filePath", () => {
    expect(() => buildReadFileParams({ target, filePath: "   " })).toThrow(
      /required/,
    );
  });

  it("passes line range through", () => {
    const { params, startLineExplicit, endLineExplicit } = buildReadFileParams({
      target,
      filePath: "src/index.js",
      startLine: 10,
      endLine: 40,
    });
    expect(params.startLine).toBe(10);
    expect(params.endLine).toBe(40);
    expect(startLineExplicit).toBe(true);
    expect(endLineExplicit).toBe(true);
  });

  it("accepts open-ended start (end omitted)", () => {
    const { params } = buildReadFileParams({
      target,
      filePath: "src/index.js",
      startLine: 10,
    });
    expect(params.startLine).toBe(10);
    expect(params.endLine).toBeUndefined();
  });

  it("accepts open-ended end (start omitted)", () => {
    const { params } = buildReadFileParams({
      target,
      filePath: "src/index.js",
      endLine: 40,
    });
    expect(params.startLine).toBeUndefined();
    expect(params.endLine).toBe(40);
  });
});

describe("buildReadFileParams — rejection cases", () => {
  it.each([
    0, -1, 3.5,
  ])("rejects non-positive/fractional startLine %s", (raw) => {
    expect(() =>
      buildReadFileParams({ target, filePath: "src/index.js", startLine: raw }),
    ).toThrow(/start_line.*positive integer/);
  });

  it("rejects a reversed range", () => {
    expect(() =>
      buildReadFileParams({
        target,
        filePath: "src/index.js",
        startLine: 40,
        endLine: 10,
      }),
    ).toThrow(/reversed/);
  });

  it.each([-1, 60001, 3.5])("rejects out-of-range waitTimeoutMs %s", (wait) => {
    expect(() =>
      buildReadFileParams({
        target,
        filePath: "src/index.js",
        waitTimeoutMs: wait,
      }),
    ).toThrow(/between 0 and 60000/);
  });
});
