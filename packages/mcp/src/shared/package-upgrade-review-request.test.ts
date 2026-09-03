import { describe, expect, it } from "bun:test";
import { InvalidPackageSpecError } from "./package-spec.js";
import {
  buildPackageUpgradeReviewRequest,
  PACKAGE_UPGRADE_REVIEW_MAX_PACKAGES,
  type UpgradeReviewPackageInput,
} from "./package-upgrade-review-request.js";

function batchPackage(index: number): UpgradeReviewPackageInput {
  return {
    registry: "npm",
    packageName: `package-${index}`,
    currentVersion: "1.0.0",
    targetVersion: "1.0.1",
  };
}

describe("buildPackageUpgradeReviewRequest", () => {
  it("treats an empty packages array as absent for single-package mode", () => {
    const { packages } = buildPackageUpgradeReviewRequest({
      registry: "npm",
      packageName: "express",
      currentVersion: "4.18.0",
      targetVersion: "5.0.0",
      packages: [],
    });

    expect(packages).toHaveLength(1);
    expect(packages[0]).toMatchObject({
      registry: "NPM",
      packageName: "express",
      currentVersion: "4.18.0",
      targetVersion: "5.0.0",
    });
  });

  it("treats blank packages rows as absent for single-package mode", () => {
    const { packages } = buildPackageUpgradeReviewRequest({
      registry: "npm",
      packageName: "express",
      currentVersion: "4.18.0",
      targetVersion: "5.0.0",
      packages: [
        {
          registry: " ",
          packageName: "",
          currentVersion: "\t",
          targetVersion: "",
        },
      ],
    });

    expect(packages).toHaveLength(1);
    expect(packages[0]).toMatchObject({
      registry: "NPM",
      packageName: "express",
      currentVersion: "4.18.0",
      targetVersion: "5.0.0",
    });
  });

  it("treats blank single-package fields as absent for batch mode", () => {
    const { packages } = buildPackageUpgradeReviewRequest({
      registry: "",
      packageName: " ",
      currentVersion: "",
      targetVersion: "\t",
      packages: [
        {
          registry: "npm",
          packageName: "express",
          currentVersion: "4.18.0",
          targetVersion: "5.0.0",
        },
      ],
    });

    expect(packages).toHaveLength(1);
    expect(packages[0]).toMatchObject({
      registry: "NPM",
      packageName: "express",
      currentVersion: "4.18.0",
      targetVersion: "5.0.0",
    });
  });

  it("drops blank packages rows from batch mode", () => {
    const { packages } = buildPackageUpgradeReviewRequest({
      packages: [
        {
          registry: " ",
          packageName: "",
          currentVersion: "\t",
          targetVersion: "",
        },
        {
          registry: "npm",
          packageName: "express",
          currentVersion: "4.18.0",
          targetVersion: "5.0.0",
        },
      ],
    });

    expect(packages).toHaveLength(1);
    expect(packages[0]).toMatchObject({
      registry: "NPM",
      packageName: "express",
      currentVersion: "4.18.0",
      targetVersion: "5.0.0",
    });
  });

  it("accepts the maximum batch size after dropping blank rows", () => {
    const { packages } = buildPackageUpgradeReviewRequest({
      packages: [
        {
          registry: " ",
          packageName: "",
          currentVersion: "\t",
          targetVersion: "",
        },
        ...Array.from(
          { length: PACKAGE_UPGRADE_REVIEW_MAX_PACKAGES },
          (_, index) => batchPackage(index),
        ),
      ],
    });

    expect(packages).toHaveLength(PACKAGE_UPGRADE_REVIEW_MAX_PACKAGES);
  });

  it("rejects batches above the maximum", () => {
    expect(() =>
      buildPackageUpgradeReviewRequest({
        packages: Array.from(
          { length: PACKAGE_UPGRADE_REVIEW_MAX_PACKAGES + 1 },
          (_, index) => batchPackage(index),
        ),
      }),
    ).toThrow(InvalidPackageSpecError);
    expect(() =>
      buildPackageUpgradeReviewRequest({
        packages: Array.from(
          { length: PACKAGE_UPGRADE_REVIEW_MAX_PACKAGES + 1 },
          (_, index) => batchPackage(index),
        ),
      }),
    ).toThrow("packages[] must contain at most 30 upgrades.");
  });

  it("still rejects calls without a package target", () => {
    expect(() =>
      buildPackageUpgradeReviewRequest({
        registry: "",
        packageName: " ",
        currentVersion: "",
        targetVersion: "\t",
        packages: [],
      }),
    ).toThrow(InvalidPackageSpecError);
  });

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
