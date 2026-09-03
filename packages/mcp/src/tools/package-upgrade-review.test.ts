import { describe, expect, it, mock } from "bun:test";
import { z } from "zod";
import { createMockPackageIntelligenceService } from "../services/test-helpers.js";
import { PACKAGE_UPGRADE_REVIEW_MAX_PACKAGES } from "../shared/package-upgrade-review-request.js";
import { createPackageUpgradeReviewTool } from "./package-upgrade-review.js";

function parseText(result: { content: Array<{ text: string }> }): unknown {
  return JSON.parse(result.content[0]?.text ?? "");
}

describe("createPackageUpgradeReviewTool", () => {
  it("registers metadata and schema keys", () => {
    const tool = createPackageUpgradeReviewTool(
      createMockPackageIntelligenceService(),
    );

    expect(tool.name).toBe("pkg_upgrade_review");
    expect(tool.description).toContain("reports facts only");
    expect(tool.annotations?.readOnlyHint).toBe(true);
    expect(Object.keys(tool.schema).sort()).toEqual([
      "current_version",
      "format",
      "include_dependency_issues",
      "min_severity",
      "package_name",
      "packages",
      "registry",
      "skip_transitive_security",
      "target_version",
      "verbose",
    ]);

    const inputSchema = z.toJSONSchema(z.object(tool.schema));
    expect(inputSchema.properties?.packages).toMatchObject({
      description: expect.stringContaining("at most 30 upgrades"),
    });
    expect(inputSchema.properties?.packages).not.toHaveProperty("maxItems");
    expect(tool.description).toContain("at most 30 upgrades");
  });

  it("calls the aggregate service method with normalized single-package params", async () => {
    const packageUpgradeReview = mock((params) =>
      Promise.resolve({
        summary: {
          total: params.packages.length,
          withUnknowns: 0,
          withAddedAdvisories: 0,
          withBreakingSignals: 0,
          withDirectDependencyChanges: 0,
          withTransitiveVulnerabilityAdditions: 0,
        },
        reviews: [],
      }),
    );
    const service = createMockPackageIntelligenceService({
      packageUpgradeReview: packageUpgradeReview as never,
    });
    const tool = createPackageUpgradeReviewTool(service);

    await tool.handler(
      {
        registry: "npm",
        package_name: "express",
        current_version: "4.18.0",
        target_version: "5.0.0",
        min_severity: "high",
        include_dependency_issues: true,
        format: "json",
      },
      {},
    );

    expect(packageUpgradeReview).toHaveBeenCalledTimes(1);
    expect(packageUpgradeReview.mock.calls[0]?.[0]).toMatchObject({
      packages: [
        {
          registry: "NPM",
          name: "express",
          currentVersion: "4.18.0",
          targetVersion: "5.0.0",
        },
      ],
      minSeverity: 7,
      includeTransitiveSecurity: true,
      includeDependencyIssues: true,
      changelogLimit: 20,
    });
  });

  it("ignores empty optional mode fields emitted by tool-call harnesses", async () => {
    const tool = createPackageUpgradeReviewTool(
      createMockPackageIntelligenceService(),
    );

    const single = await tool.handler(
      {
        registry: "npm",
        package_name: "express",
        current_version: "4.18.0",
        target_version: "5.0.0",
        packages: [
          {
            registry: " ",
            package_name: "",
            current_version: "\t",
            target_version: "",
          },
        ],
        format: "json",
      },
      {},
    );

    const batch = await tool.handler(
      {
        registry: "",
        package_name: " ",
        current_version: "",
        target_version: "\t",
        packages: [
          {
            registry: " ",
            package_name: "",
            current_version: "\t",
            target_version: "",
          },
          {
            registry: "npm",
            package_name: "express",
            current_version: "4.18.0",
            target_version: "5.0.0",
          },
        ],
        format: "json",
      },
      {},
    );

    expect(single.isError).toBeUndefined();
    expect(batch.isError).toBeUndefined();
    expect(
      (parseText(single) as { summary?: { total?: number } }).summary?.total,
    ).toBe(1);
    expect(
      (parseText(batch) as { summary?: { total?: number } }).summary?.total,
    ).toBe(1);
  });

  it("returns text by default and JSON when requested", async () => {
    const tool = createPackageUpgradeReviewTool(
      createMockPackageIntelligenceService(),
    );

    const text = await tool.handler(
      {
        registry: "npm",
        package_name: "express",
        current_version: "4.18.0",
        target_version: "5.0.0",
      },
      {},
    );
    expect(text.isError).toBeUndefined();
    expect(text.content[0]?.text).toStartWith("Upgrade review - 1 package");
    expect(text.content[0]?.text).toContain("Security");
    expect(text.content[0]?.text).toContain("Changes");
    expect(text.content[0]?.text).not.toContain("pkg_upgrade_review");
    expect(text.content[0]?.text).not.toContain("\x1b[");
    expect(() => JSON.parse(text.content[0]?.text ?? "")).toThrow();

    const json = await tool.handler(
      {
        registry: "npm",
        package_name: "express",
        current_version: "4.18.0",
        target_version: "5.0.0",
        format: "json",
      },
      {},
    );
    expect(
      (parseText(json) as { summary?: { total?: number } }).summary?.total,
    ).toBe(1);
  });

  it("returns INVALID_ARGUMENT for incomplete args", async () => {
    const tool = createPackageUpgradeReviewTool(
      createMockPackageIntelligenceService(),
    );

    const result = await tool.handler(
      { registry: "npm", package_name: "express", current_version: "4.18.0" },
      {},
    );

    expect(result.isError).toBe(true);
    expect(parseText(result)).toMatchObject({ code: "INVALID_ARGUMENT" });
  });

  it("rejects over-cap batches before calling the service", async () => {
    const packageUpgradeReview = mock(() =>
      Promise.reject(new Error("service must not be called")),
    );
    const tool = createPackageUpgradeReviewTool(
      createMockPackageIntelligenceService({
        packageUpgradeReview: packageUpgradeReview as never,
      }),
    );

    const result = await tool.handler(
      {
        packages: Array.from(
          { length: PACKAGE_UPGRADE_REVIEW_MAX_PACKAGES + 1 },
          (_, index) => ({
            registry: "npm",
            package_name: `package-${index}`,
            current_version: "1.0.0",
            target_version: "1.0.1",
          }),
        ),
      },
      {},
    );

    expect(packageUpgradeReview).not.toHaveBeenCalled();
    expect(result.isError).toBe(true);
    expect(parseText(result)).toMatchObject({
      code: "INVALID_ARGUMENT",
      retryable: false,
      error: "packages[] must contain at most 30 upgrades.",
    });
  });
});
