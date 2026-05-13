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
    const { params, explicit } = buildListFilesParams({
      target: packageTarget,
      pathPrefix: "  src/  ",
    });
    expect(params.pathPrefix).toBe("src/");
    expect(explicit.pathPrefix).toBe(true);
  });

  it("treats whitespace-only pathPrefix as absent", () => {
    const { params, explicit } = buildListFilesParams({
      target: packageTarget,
      pathPrefix: "   ",
    });
    expect(params.pathPrefix).toBeUndefined();
    expect(explicit.pathPrefix).toBe(false);
  });

  it("builds exact and glob path selectors", () => {
    const { params, explicit, filterEcho } = buildListFilesParams({
      target: packageTarget,
      path: " src/index.ts ",
      globs: ["src/**/*.ts", "test/**/*.ts"],
    });
    expect(params.pathSelectors).toEqual([
      { kind: "EXACT", value: "src/index.ts" },
      { kind: "GLOB", value: "src/**/*.ts" },
      { kind: "GLOB", value: "test/**/*.ts" },
    ]);
    expect(explicit.path).toBe(true);
    expect(explicit.globs).toBe(true);
    expect(filterEcho.path).toBe("src/index.ts");
    expect(filterEcho.globs).toEqual(["src/**/*.ts", "test/**/*.ts"]);
  });

  it("normalises file filters and file intents", () => {
    const { params, filterEcho, explicit } = buildListFilesParams({
      target: packageTarget,
      extensions: ["ts", "tsx"],
      fileTypes: ["source", "doc"],
      languages: ["TypeScript", "TSX"],
      fileIntents: ["production", "test"],
      excludeFileIntents: ["generated", "fixture"],
      excludeDocFiles: true,
      excludeTestFiles: false,
      includeHidden: true,
    });
    expect(params.extensions).toEqual(["ts", "tsx"]);
    expect(params.fileTypes).toEqual(["source", "doc"]);
    expect(params.languages).toEqual(["TypeScript", "TSX"]);
    expect(params.fileIntents).toEqual(["PRODUCTION", "TEST"]);
    expect(params.excludeFileIntents).toEqual(["GENERATED", "FIXTURE"]);
    expect(params.excludeDocFiles).toBe(true);
    expect(params.excludeTestFiles).toBe(false);
    expect(params.includeHidden).toBe(true);
    expect(filterEcho.fileIntents).toEqual(["production", "test"]);
    expect(filterEcho.excludeFileIntents).toEqual(["generated", "fixture"]);
    expect(explicit.excludeTestFiles).toBe(true);
  });

  it("normalises a singular file intent and echoes it canonically", () => {
    const { params, filterEcho, explicit } = buildListFilesParams({
      target: packageTarget,
      fileIntent: " Production ",
    });
    expect(params.fileIntent).toBe("PRODUCTION");
    expect(filterEcho.fileIntent).toBe("production");
    expect(explicit.fileIntent).toBe(true);
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

describe("buildListFilesParams — filter validation", () => {
  it("treats an empty exact path as absent", () => {
    const { params, explicit, filterEcho } = buildListFilesParams({
      target: packageTarget,
      path: "   ",
    });

    expect(params.pathSelectors).toBeUndefined();
    expect(explicit.path).toBe(false);
    expect(filterEcho.path).toBeUndefined();
  });

  it("rejects empty list entries", () => {
    expect(() =>
      buildListFilesParams({ target: packageTarget, globs: ["src/**", " "] }),
    ).toThrow(/`globs` entries cannot be empty/);
  });

  it("rejects leading dots in extensions", () => {
    expect(() =>
      buildListFilesParams({ target: packageTarget, extensions: [".ts"] }),
    ).toThrow(/must not include a leading dot/);
  });

  it("rejects unknown file intents", () => {
    expect(() =>
      buildListFilesParams({
        target: packageTarget,
        fileIntents: ["production", "weird"],
      }),
    ).toThrow(/file_intents/);
  });

  it("rejects file_intent together with file_intents", () => {
    expect(() =>
      buildListFilesParams({
        target: packageTarget,
        fileIntent: "production",
        fileIntents: ["test"],
      }),
    ).toThrow(/cannot be combined/);
  });
});
