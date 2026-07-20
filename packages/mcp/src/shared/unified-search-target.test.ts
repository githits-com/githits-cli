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

  it("preserves repository refs containing @ with # syntax", () => {
    expect(
      parseUnifiedSearchTargetSpec("https://github.com/n8n-io/n8n#n8n@2.26.5"),
    ).toEqual({
      repoUrl: "https://github.com/n8n-io/n8n",
      gitRef: "n8n@2.26.5",
    });
  });

  it("splits @ repository refs without truncating @ inside the ref", () => {
    expect(
      parseUnifiedSearchTargetSpec("https://github.com/n8n-io/n8n@n8n@2.26.5"),
    ).toEqual({
      repoUrl: "https://github.com/n8n-io/n8n",
      gitRef: "n8n@2.26.5",
    });
  });

  it("rejects malformed GitHub URLs instead of guessing", () => {
    expect(() =>
      parseUnifiedSearchTargetSpec("https://github.com/n8n-io/n8n/tree/main"),
    ).toThrow(
      "Repository URL targets must point to github.com/owner/repo; pass refs with #gitRef or @gitRef.",
    );
  });

  it("treats github:owner/repo shorthand as a repository target", () => {
    expect(parseUnifiedSearchTargetSpec("github:expressjs/express")).toEqual({
      repoUrl: "https://github.com/expressjs/express",
    });
  });

  it("accepts standalone indexed documentation site targets", () => {
    expect(parseUnifiedSearchTargetSpec("site:ExpressJS.com")).toEqual({
      site: "site:expressjs.com",
    });
  });

  it("normalises URL-shaped site targets to canonical site labels", () => {
    expect(
      parseUnifiedSearchTargetSpec("site:https://expressjs.com/en/guide/"),
    ).toEqual({
      site: "site:expressjs.com/en/guide",
    });
  });

  it("rejects empty targets", () => {
    expect(() => parseUnifiedSearchTargetSpec("   ")).toThrow(
      "Target spec cannot be empty.",
    );
  });

  it("rejects empty site targets", () => {
    expect(() => parseUnifiedSearchTargetSpec("site:   ")).toThrow(
      "Site target cannot be empty.",
    );
  });

  it("rejects package targets without an explicit registry", () => {
    expect(() => parseUnifiedSearchTargetSpec("express")).toThrow(
      "Expected package target <registry>:<name>[@<version>]",
    );
    expect(() => parseUnifiedSearchTargetSpec("express")).toThrow(
      "repository target github:owner/repo[#ref|@ref]",
    );
  });

  it("rejects unknown repository-looking targets with target syntax guidance", () => {
    expect(() => parseUnifiedSearchTargetSpec("gitlab.com/org/repo")).toThrow(
      "Expected package target <registry>:<name>[@<version>]",
    );
    expect(() => parseUnifiedSearchTargetSpec("gitlab.com/org/repo")).toThrow(
      "repository target github:owner/repo[#ref|@ref]",
    );
  });
});
