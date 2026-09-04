import { describe, expect, it } from "bun:test";
import { normalisePackageVersion } from "./package-version.js";

describe("normalisePackageVersion", () => {
  it.each([
    ["1.24.0", "v1.24.0"],
    ["v1.24.0", "v1.24.0"],
    ["0.0.0-20250807184922-2a7a1659af7b", "v0.0.0-20250807184922-2a7a1659af7b"],
    [
      "v0.0.0-20250807184922-2a7a1659af7b",
      "v0.0.0-20250807184922-2a7a1659af7b",
    ],
  ])("canonicalizes Go version %s to %s", (input, expected) => {
    expect(normalisePackageVersion(input, "GO")).toBe(expected);
  });

  it("preserves canonical non-Go versions", () => {
    expect(normalisePackageVersion("  5.2.1  ", "NPM")).toBe("5.2.1");
  });

  it("preserves v-prefixed Swift versions", () => {
    expect(normalisePackageVersion("v3.11.0", "SWIFT")).toBe("v3.11.0");
  });

  it("leaves non-exact Go inputs for backend validation", () => {
    expect(normalisePackageVersion("latest", "GO")).toBe("latest");
  });

  it("rejects v-prefixed versions for other registries", () => {
    expect(() =>
      normalisePackageVersion("v5.2.1", "NPM", { rejectLeadingV: true }),
    ).toThrow("canonical package version without a leading 'v'");
  });

  it("preserves non-Go v-prefixed versions when the boundary allows them", () => {
    expect(normalisePackageVersion("v5.2.1", "NPM")).toBe("v5.2.1");
  });

  it("treats blank optional versions as absent", () => {
    expect(normalisePackageVersion("   ", "GO")).toBeUndefined();
    expect(normalisePackageVersion(undefined, "GO")).toBeUndefined();
  });
});
