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

  it("preserves git refs containing @ when using # syntax", () => {
    expect(
      parseCodeNavigationTargetSpec("github.com/n8n-io/n8n#n8n@2.26.5"),
    ).toEqual({
      repoUrl: "https://github.com/n8n-io/n8n",
      gitRef: "n8n@2.26.5",
    });
  });

  it("splits @ refs only at the repository suffix delimiter", () => {
    expect(
      parseCodeNavigationTargetSpec("github.com/n8n-io/n8n@n8n@2.26.5"),
    ).toEqual({
      repoUrl: "https://github.com/n8n-io/n8n",
      gitRef: "n8n@2.26.5",
    });
  });

  it("rejects repository URLs with ambiguous path refs", () => {
    expect(() =>
      parseCodeNavigationTargetSpec(
        "https://github.com/expressjs/express/tree/main",
      ),
    ).toThrow(
      "Repository URL targets must point to github.com/owner/repo; pass refs with #gitRef or @gitRef.",
    );
  });

  it("rejects repository URLs with both ref suffix syntaxes", () => {
    expect(() =>
      parseCodeNavigationTargetSpec("github.com/expressjs/express@main#dev"),
    ).toThrow("must use only one ref suffix");
  });

  it.each([
    ["github.com/foo bar/baz", "valid GitHub owner name"],
    ["github.com/foo@bar/baz", "valid GitHub owner name"],
    ["github.com/foo/bar%2Fbaz", "valid GitHub repository name"],
    ["github.com/foo/bar baz", "valid GitHub repository name"],
  ])("rejects malformed GitHub component %s", (spec, message) => {
    expect(() => parseCodeNavigationTargetSpec(spec)).toThrow(message);
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
      "repository target github:owner/repo[#ref|@ref]",
    );
  });

  it("rejects unknown repository-looking targets with target syntax guidance", () => {
    expect(() => parseCodeNavigationTargetSpec("gitlab.com/org/repo")).toThrow(
      "Expected package target <registry>:<name>[@<version>]",
    );
    expect(() => parseCodeNavigationTargetSpec("gitlab.com/org/repo")).toThrow(
      "repository target github:owner/repo[#ref|@ref]",
    );
  });
});
