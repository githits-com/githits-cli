import { describe, expect, it } from "bun:test";
import type { CodeNavigationTarget } from "../services/index.js";
import { buildListFilesParams } from "./list-files-request.js";

const packageTarget: CodeNavigationTarget = {
  registry: "NPM",
  packageName: "express",
};

describe("buildListFilesParams — defaults + passthrough", () => {
  it("substitutes the default limit (200) when omitted", () => {
    const { params, effectiveLimit, limitExplicit } = buildListFilesParams({
      target: packageTarget,
    });
    expect(params.limit).toBe(200);
    expect(effectiveLimit).toBe(200);
    expect(limitExplicit).toBe(false);
  });

  it("passes an explicit limit through and marks it explicit", () => {
    const { params, effectiveLimit, limitExplicit } = buildListFilesParams({
      target: packageTarget,
      limit: 50,
    });
    expect(params.limit).toBe(50);
    expect(effectiveLimit).toBe(50);
    expect(limitExplicit).toBe(true);
  });

  it("passes waitTimeoutMs through when valid", () => {
    const { params } = buildListFilesParams({
      target: packageTarget,
      waitTimeoutMs: 5000,
    });
    expect(params.waitTimeoutMs).toBe(5000);
  });

  it("substitutes the shared DEFAULT_WAIT_TIMEOUT_MS (20000) when omitted", () => {
    const { params } = buildListFilesParams({ target: packageTarget });
    expect(params.waitTimeoutMs).toBe(20000);
  });

  it("passes a trimmed pathPrefix through and marks it explicit", () => {
    const { params, pathPrefixExplicit } = buildListFilesParams({
      target: packageTarget,
      pathPrefix: "  src/  ",
    });
    expect(params.pathPrefix).toBe("src/");
    expect(pathPrefixExplicit).toBe(true);
  });

  it("treats whitespace-only pathPrefix as absent", () => {
    const { params, pathPrefixExplicit } = buildListFilesParams({
      target: packageTarget,
      pathPrefix: "   ",
    });
    expect(params.pathPrefix).toBeUndefined();
    expect(pathPrefixExplicit).toBe(false);
  });
});

describe("buildListFilesParams — limit bounds", () => {
  it.each([0, 1001, 3.5, -1])("rejects out-of-range limit %s", (limit) => {
    expect(() =>
      buildListFilesParams({ target: packageTarget, limit }),
    ).toThrow(/between 1 and 1000/);
  });

  it("accepts limits at the boundaries (1 and 1000)", () => {
    expect(
      buildListFilesParams({ target: packageTarget, limit: 1 }).params.limit,
    ).toBe(1);
    expect(
      buildListFilesParams({ target: packageTarget, limit: 1000 }).params.limit,
    ).toBe(1000);
  });
});

describe("buildListFilesParams — waitTimeoutMs bounds", () => {
  it.each([
    -1, 60001, 3.5,
  ])("rejects out-of-range waitTimeoutMs %s", (waitTimeoutMs) => {
    expect(() =>
      buildListFilesParams({ target: packageTarget, waitTimeoutMs }),
    ).toThrow(/between 0 and 60000/);
  });

  it("accepts 0 (fail-fast mode) at the lower boundary", () => {
    expect(
      buildListFilesParams({ target: packageTarget, waitTimeoutMs: 0 }).params
        .waitTimeoutMs,
    ).toBe(0);
  });

  it("accepts 60000 at the upper boundary", () => {
    expect(
      buildListFilesParams({ target: packageTarget, waitTimeoutMs: 60000 })
        .params.waitTimeoutMs,
    ).toBe(60000);
  });
});
