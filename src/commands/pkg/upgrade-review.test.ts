import { describe, expect, it } from "bun:test";
import { InvalidPackageSpecError } from "../../shared/index.js";
import { parseUpgradeReviewPackageOption } from "./upgrade-review.js";

describe("parseUpgradeReviewPackageOption", () => {
  it("accepts shell-safe double-dot package ranges", () => {
    expect(parseUpgradeReviewPackageOption("npm:zod@4.3.6..4.4.3")).toEqual({
      registry: "npm",
      packageName: "zod",
      currentVersion: "4.3.6",
      targetVersion: "4.4.3",
    });
  });

  it("keeps quoted arrow package ranges compatible", () => {
    expect(
      parseUpgradeReviewPackageOption("npm:@scope/pkg@1.2.3->1.3.0"),
    ).toEqual({
      registry: "npm",
      packageName: "@scope/pkg",
      currentVersion: "1.2.3",
      targetVersion: "1.3.0",
    });
  });

  it("explains likely shell redirection for truncated arrow ranges", () => {
    expect(() => parseUpgradeReviewPackageOption("npm:zod@4.3.6-")).toThrow(
      InvalidPackageSpecError,
    );
    expect(() => parseUpgradeReviewPackageOption("npm:zod@4.3.6-")).toThrow(
      "The shell likely treated '>' as output redirection",
    );
  });
});
