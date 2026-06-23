import { describe, expect, it } from "bun:test";
import {
  formatRepositoryTarget,
  formatRepositoryTargetLabel,
} from "./repository-target.js";

describe("formatRepositoryTarget", () => {
  it("formats GitHub repo targets with compact canonical # refs", () => {
    expect(
      formatRepositoryTarget("https://github.com/n8n-io/n8n", "n8n@2.26.5"),
    ).toBe("github:n8n-io/n8n#n8n@2.26.5");
  });

  it("falls back to URL form for non-compactable repo URLs", () => {
    expect(
      formatRepositoryTarget("https://example.com/owner/repo", "main"),
    ).toBe("https://example.com/owner/repo#main");
  });
});

describe("formatRepositoryTargetLabel", () => {
  it("canonicalizes backend owner/repo@ref labels without truncating @ inside refs", () => {
    expect(formatRepositoryTargetLabel("n8n-io/n8n@n8n@2.26.5")).toBe(
      "github:n8n-io/n8n#n8n@2.26.5",
    );
  });

  it("does not rewrite package-style labels", () => {
    expect(formatRepositoryTargetLabel("npm:express@5.2.1")).toBeUndefined();
  });
});
