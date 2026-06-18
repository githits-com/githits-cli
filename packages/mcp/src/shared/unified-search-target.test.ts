import { describe, expect, it } from "bun:test";
import { parseUnifiedSearchTargetSpec } from "./unified-search-target.js";

describe("parseUnifiedSearchTargetSpec", () => {
  it("treats github.com shorthand as a repository target", () => {
    expect(
      parseUnifiedSearchTargetSpec("github.com/expressjs/express"),
    ).toEqual({
      repoUrl: "https://github.com/expressjs/express",
    });
  });

  it("treats github:owner/repo shorthand as a repository target", () => {
    expect(parseUnifiedSearchTargetSpec("github:expressjs/express")).toEqual({
      repoUrl: "https://github.com/expressjs/express",
    });
  });

  it("rejects empty targets", () => {
    expect(() => parseUnifiedSearchTargetSpec("   ")).toThrow(
      "Target spec cannot be empty.",
    );
  });

  it("rejects package targets without an explicit registry", () => {
    expect(() => parseUnifiedSearchTargetSpec("express")).toThrow(
      "Expected package target <registry>:<name>[@<version>]",
    );
    expect(() => parseUnifiedSearchTargetSpec("express")).toThrow(
      "repository target github:owner/repo[#ref]",
    );
  });

  it("rejects unknown repository-looking targets with target syntax guidance", () => {
    expect(() => parseUnifiedSearchTargetSpec("gitlab.com/org/repo")).toThrow(
      "Expected package target <registry>:<name>[@<version>]",
    );
    expect(() => parseUnifiedSearchTargetSpec("gitlab.com/org/repo")).toThrow(
      "repository target github:owner/repo[#ref]",
    );
  });
});
