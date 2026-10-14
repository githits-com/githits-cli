import { describe, expect, it } from "bun:test";
import { InvalidPackageSpecError } from "./package-spec.js";
import {
  buildPackageUpgradeReviewRequest,
  PACKAGE_UPGRADE_REVIEW_MAX_PACKAGES,
  type PackageUpgradeReviewRequestInput,
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
  const changelogViewCases: Array<{
    name: string;
    input: PackageUpgradeReviewRequestInput;
    expectedView: "text" | "json" | "triage";
    expectedPackageCount?: number;
  }> = [
    {
      name: "single default/text",
      input: {
        registry: "npm",
        packageName: "express",
        currentVersion: "4.18.0",
        targetVersion: "5.0.0",
      },
      expectedView: "text",
    },
    {
      name: "batch compact",
      input: { packages: [batchPackage(0), batchPackage(1)] },
      expectedView: "triage",
    },
    {
      name: "batch verbose",
      input: {
        packages: [batchPackage(0), batchPackage(1)],
        verbose: true,
      },
      expectedView: "text",
    },
    {
      name: "JSON batch verbose",
      input: {
        packages: [batchPackage(0), batchPackage(1)],
        format: "json",
        verbose: true,
      },
      expectedView: "json",
    },
    {
      name: "normalized blank-batch entries do not affect count",
      input: {
        packages: [
          {
            registry: " ",
            packageName: "",
            currentVersion: "\t",
            targetVersion: "",
          },
          batchPackage(0),
        ],
      },
      expectedView: "text",
      expectedPackageCount: 1,
    },
  ];

  it.each(changelogViewCases)(
    "derives the changelog view: $name",
    ({ input, expectedView, expectedPackageCount }) => {
      const request = buildPackageUpgradeReviewRequest(input);

      expect(request.options.changelogView).toBe(expectedView);
      if (expectedPackageCount !== undefined) {
        expect(request.packages).toHaveLength(expectedPackageCount);
      }
    },
  );

  it.each([
    [
      "omitted",
      undefined,
      "focused",
      undefined,
      ["MUST_ACT", "SHOULD_KNOW", "UNCLASSIFIED"],
    ],
    [
      "blank",
      "  ",
      "focused",
      undefined,
      ["MUST_ACT", "SHOULD_KNOW", "UNCLASSIFIED"],
    ],
    [
      "mixed-case actionable",
      "  AcTiOnAbLe  ",
      "actionable",
      "actionable",
      ["MUST_ACT"],
    ],
    [
      "important",
      "important",
      "important",
      "important",
      ["MUST_ACT", "SHOULD_KNOW"],
    ],
    ["all", "all", "all", "all", undefined],
  ] as const)(
    "changelog filter selection: %s",
    (_case, changes, changesSelection, explicitChanges, statementTiers) => {
      const { options } = buildPackageUpgradeReviewRequest({
        registry: "npm",
        packageName: "express",
        currentVersion: "4.18.0",
        targetVersion: "5.0.0",
        changes,
      });

      expect(options.changesSelection).toBe(changesSelection);
      expect(options.explicitChanges).toBe(explicitChanges);
      expect(options.statementTiers).toEqual(
        statementTiers === undefined ? undefined : [...statementTiers],
      );
    },
  );

  it("changelog filter selection: invalid", () => {
    expect(() =>
      buildPackageUpgradeReviewRequest({
        registry: "npm",
        packageName: "express",
        currentVersion: "4.18.0",
        targetVersion: "5.0.0",
        changes: "unknown",
      }),
    ).toThrow(InvalidPackageSpecError);
  });

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

  it("sends canonical Go upgrade endpoints to the backend", () => {
    const { packages } = buildPackageUpgradeReviewRequest({
      registry: "go",
      packageName: "golang.org/x/text",
      currentVersion: "0.27.0",
      targetVersion: "v0.28.0",
    });

    expect(packages[0]).toMatchObject({
      registry: "GO",
      currentVersion: "v0.27.0",
      targetVersion: "v0.28.0",
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
    ).toThrow("Invalid current_version 'v4.18.0'");

    expect(() =>
      buildPackageUpgradeReviewRequest({
        registry: "npm",
        packageName: "express",
        currentVersion: "4.18.0",
        targetVersion: "v5.2.1",
      }),
    ).toThrow("Invalid target_version 'v5.2.1'");
  });
});
