import { describe, expect, it } from "bun:test";
import {
  buildCodeDiffParams,
  type CodeDiffRequestInput,
  type CodeDiffView,
} from "./code-diff-request.js";
import { InvalidPackageSpecError } from "./package-spec.js";

function invalid(input: CodeDiffRequestInput, message?: string): void {
  expect(() => buildCodeDiffParams(input)).toThrow(InvalidPackageSpecError);
  if (message !== undefined) {
    expect(() => buildCodeDiffParams(input)).toThrow(message);
  }
}

describe("buildCodeDiffParams", () => {
  it("builds an unversioned package target and preserves trimmed endpoints", () => {
    const result = buildCodeDiffParams({
      target: " npm:express ",
      range: "  v4.18.1 .. v4.18.2  ",
    });

    expect(result).toEqual({
      params: {
        target: { registry: "NPM", packageName: "express" },
        from: "v4.18.1",
        to: "v4.18.2",
        mode: "patches",
      },
      view: "patch",
    });
    expect(Object.hasOwn(result.params.target, "version")).toBe(false);
    expect(Object.hasOwn(result.params.target, "repoUrl")).toBe(false);
    expect(Object.hasOwn(result.params, "options")).toBe(false);
  });

  it("builds a compact repository target without the parser's ref key", () => {
    const result = buildCodeDiffParams({
      target: "github:expressjs/express",
      range: "main..release",
    });

    expect(result.params.target).toEqual({
      repoUrl: "https://github.com/expressjs/express",
    });
    expect(Object.hasOwn(result.params.target, "registry")).toBe(false);
    expect(Object.hasOwn(result.params.target, "packageName")).toBe(false);
    expect(Object.hasOwn(result.params.target, "gitRef")).toBe(false);
  });

  it("builds an explicit repository URL", () => {
    const { params } = buildCodeDiffParams({
      repoUrl: "https://github.com/expressjs/express",
      range: "v4.18.1..v4.18.2",
    });

    expect(params.target).toEqual({
      repoUrl: "https://github.com/expressjs/express",
    });
  });

  it.each([
    ["patch", "patches"],
    ["stat", "stats"],
    ["name-only", "inventory"],
    ["name-status", "inventory"],
  ] as const)("maps %s to service mode %s", (view, mode) => {
    const result = buildCodeDiffParams({
      target: "npm:express",
      range: "1..2",
      view,
    });

    expect(result.view).toBe(view);
    expect(result.params.mode).toBe(mode);
  });

  it("forwards only explicitly supplied options", () => {
    const result = buildCodeDiffParams({
      target: "npm:express",
      range: "1..2",
      pathGlob: "src/**/*.ts",
      maxFiles: 300,
      maxPatchBytes: 2_097_152,
    });

    expect(result.params.options).toEqual({
      pathGlob: "src/**/*.ts",
      maxFiles: 300,
      maxPatchBytes: 2_097_152,
    });
    expect(Object.hasOwn(result.params.options ?? {}, "pathPrefix")).toBe(
      false,
    );
  });

  it("omits options when every bound and glob is omitted", () => {
    const { params } = buildCodeDiffParams({
      target: "npm:express",
      range: "1..2",
      maxFiles: undefined,
      maxPatchBytes: undefined,
      pathGlob: undefined,
    });

    expect(Object.hasOwn(params, "options")).toBe(false);
  });

  it("accepts representative bounded repository-relative globs", () => {
    for (const pathGlob of [
      "src/**/*.ts",
      "**/*.ts",
      "src/?odule/file?.ts",
      "src/\\[generated\\]/literal\\*",
      "docs/guide\\!/*.md",
      "dir with spaces/*.ts",
    ]) {
      expect(
        buildCodeDiffParams({
          target: "npm:express",
          range: "1..2",
          pathGlob,
        }).params.options?.pathGlob,
      ).toBe(pathGlob);
    }
  });

  it("rejects absent, mixed, and incomplete addressing", () => {
    invalid({ range: "1..2" }, "exactly one");
    invalid(
      {
        target: "npm:express",
        repoUrl: "https://github.com/a/b",
        range: "1..2",
      },
      "either",
    );
    invalid({ target: "   ", range: "1..2" });
    invalid({ repoUrl: "   ", range: "1..2" });
    invalid({ repoUrl: "npm:express", range: "1..2" }, "repository target");
  });

  it("rejects versions and refs embedded in target addressing", () => {
    invalid(
      { target: "npm:express@4.18.1", range: "1..2" },
      "must not include a version",
    );
    invalid(
      { target: "github:expressjs/express#main", range: "1..2" },
      "must not include a ref",
    );
    invalid(
      {
        repoUrl: "https://github.com/expressjs/express#main",
        range: "1..2",
      },
      "must not include a ref",
    );
    invalid(
      {
        target: "https://github.com/expressjs/express@main",
        range: "1..2",
      },
      "must not include a ref",
    );
  });

  it("rejects invalid ranges and accepts identical endpoints", () => {
    for (const range of [
      "1",
      "..2",
      "1..",
      "..",
      "1...2",
      "1..2..3",
      "1....2",
      "1..2..",
      "1.. ..2",
    ]) {
      invalid({ target: "npm:express", range });
    }

    expect(
      buildCodeDiffParams({ target: "npm:express", range: "  same .. same " })
        .params,
    ).toMatchObject({ from: "same", to: "same" });
  });

  it("rejects invalid path glob forms", () => {
    for (const pathGlob of [
      "",
      "/src/*.ts",
      "src//*.ts",
      "src/./*.ts",
      "src/../*.ts",
      "src/",
      "src/*.ts/",
      "src/**.ts",
      "src/a***.ts",
      "src/[test].ts",
      "src/{test}.ts",
      "src/!test.ts",
      "src/foo\\",
      "src/foo\\/*.ts",
    ]) {
      invalid({ target: "npm:express", range: "1..2", pathGlob });
    }

    invalid(
      {
        target: "npm:express",
        range: "1..2",
        pathGlob: "a".repeat(1025),
      },
      "1024",
    );
    invalid(
      {
        target: "npm:express",
        range: "1..2",
        pathGlob: "é".repeat(513),
      },
      "1024",
    );
    invalid(
      {
        target: "npm:express",
        range: "1..2",
        pathGlob: "bad\ud800",
      },
      "valid UTF-8",
    );
  });

  it("validates numeric bounds and patch-byte view compatibility", () => {
    for (const maxFiles of [
      0,
      301,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
    ]) {
      invalid({ target: "npm:express", range: "1..2", maxFiles }, "maxFiles");
    }
    for (const maxPatchBytes of [1023, 2_097_153, 1.5, Number.NaN]) {
      invalid(
        { target: "npm:express", range: "1..2", maxPatchBytes },
        "maxPatchBytes",
      );
    }
    invalid(
      {
        target: "npm:express",
        range: "1..2",
        view: "stat",
        maxPatchBytes: 1024,
      },
      "only",
    );

    expect(
      buildCodeDiffParams({
        target: "npm:express",
        range: "1..2",
        maxFiles: 1,
        maxPatchBytes: 1024,
      }).params.options,
    ).toEqual({ maxFiles: 1, maxPatchBytes: 1024 });
  });

  it("rejects unknown runtime view values, including inherited keys", () => {
    for (const view of ["summary", "toString"]) {
      invalid(
        {
          target: "npm:express",
          range: "1..2",
          view: view as CodeDiffView,
        },
        "view",
      );
    }
  });
});
