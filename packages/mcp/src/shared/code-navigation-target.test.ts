import { describe, expect, it } from "bun:test";
import { parseCodeNavigationTargetSpec } from "./code-navigation-target.js";

describe("parseCodeNavigationTargetSpec", () => {
  it("treats github.com shorthand as a repository target", () => {
    expect(
      parseCodeNavigationTargetSpec("github.com/expressjs/express"),
    ).toEqual({
      repoUrl: "https://github.com/expressjs/express",
    });
  });

  it("preserves git refs on github.com shorthand targets", () => {
    expect(
      parseCodeNavigationTargetSpec("github.com/expressjs/express#main"),
    ).toEqual({
      repoUrl: "https://github.com/expressjs/express",
      gitRef: "main",
    });
  });

  it("treats github:owner/repo shorthand as a repository target", () => {
    expect(parseCodeNavigationTargetSpec("github:expressjs/express")).toEqual({
      repoUrl: "https://github.com/expressjs/express",
    });
  });

  it("preserves git refs on github:owner/repo shorthand targets", () => {
    expect(
      parseCodeNavigationTargetSpec("github:expressjs/express#main"),
    ).toEqual({
      repoUrl: "https://github.com/expressjs/express",
      gitRef: "main",
    });
  });

  it("rejects empty targets", () => {
    expect(() => parseCodeNavigationTargetSpec("   ")).toThrow(
      "Target spec cannot be empty.",
    );
  });

  it("rejects package targets without an explicit registry", () => {
    expect(() => parseCodeNavigationTargetSpec("express")).toThrow(
      "Expected package target <registry>:<name>[@<version>]",
    );
    expect(() => parseCodeNavigationTargetSpec("express")).toThrow(
      "repository target github:owner/repo[#ref]",
    );
  });

  it("rejects unknown repository-looking targets with target syntax guidance", () => {
    expect(() => parseCodeNavigationTargetSpec("gitlab.com/org/repo")).toThrow(
      "Expected package target <registry>:<name>[@<version>]",
    );
    expect(() => parseCodeNavigationTargetSpec("gitlab.com/org/repo")).toThrow(
      "repository target github:owner/repo[#ref]",
    );
  });
});
