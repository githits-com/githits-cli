import { describe, expect, it } from "bun:test";
import { InvalidPackageSpecError } from "./package-spec.js";
import { buildPackageUpgradeReviewRequest } from "./package-upgrade-review-request.js";

describe("buildPackageUpgradeReviewRequest — Swift versions", () => {
  it("allows v-prefixed Swift versions", () => {
    const { packages } = buildPackageUpgradeReviewRequest({
      registry: "swift",
      packageName: "github.com/apple/swift-crypto",
      currentVersion: "v3.10.0",
      targetVersion: "v3.11.0",
    });

    expect(packages[0]).toMatchObject({
      registry: "SWIFT",
      registryLabel: "swift",
      packageName: "github.com/apple/swift-crypto",
      currentVersion: "v3.10.0",
      targetVersion: "v3.11.0",
    });
  });

  it("still rejects v-prefixed versions for non-Swift registries", () => {
    expect(() =>
      buildPackageUpgradeReviewRequest({
        registry: "npm",
        packageName: "express",
        currentVersion: "v4.18.0",
        targetVersion: "5.2.1",
      }),
    ).toThrow(InvalidPackageSpecError);
  });
});
