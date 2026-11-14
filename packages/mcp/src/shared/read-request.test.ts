import { describe, expect, it } from "bun:test";
import { resolveReadLocator } from "./read-request.js";

describe("transparent read targets", () => {
  it.each([
    "cargo:serde",
    " CARGO:serde@1.0.228 ",
    "crates:serde@1.0.228",
    "npm:@types/node",
    "maven:org.example:lib",
    "github:owner/repo@main",
    "site:example.test/api",
    "https://example.test/path",
    "opaque-target",
  ])("preserves target bytes for %s", (target) => {
    expect(resolveReadLocator(target, "src/lib.rs")).toEqual({
      target,
      path: "src/lib.rs",
    });
  });

  it("preserves leading and trailing whitespace in literal paths", () => {
    expect(resolveReadLocator("npm:express", "  src/index.js  ")).toEqual({
      target: "npm:express",
      path: "  src/index.js  ",
    });
  });
});
