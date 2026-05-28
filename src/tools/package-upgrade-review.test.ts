import { describe, expect, it, mock } from "bun:test";
import type {
  DependencyReport,
  VulnerabilityReport,
} from "../services/index.js";
import { createMockPackageIntelligenceService } from "../services/test-helpers.js";
import { createPackageUpgradeReviewTool } from "./package-upgrade-review.js";

function parseText(result: { content: Array<{ text: string }> }): unknown {
  return JSON.parse(result.content[0]?.text ?? "");
}

function cleanVuln(version: string): VulnerabilityReport {
  return {
    package: { name: "express", registry: "NPM", version, deprecated: false },
    security: {
      affectedVulnerabilityCount: 0,
      nonAffectingVulnerabilityCount: 0,
      allVulnerabilityCount: 0,
      currentVersionAffected: false,
      vulnerabilities: [],
    },
  };
}

function deps(version: string): DependencyReport {
  return {
    package: { name: "express", registry: "NPM", version, deprecated: false },
    dependencies: { direct: [] },
    dependencyGroups: { groups: [] },
  };
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
      "include_transitive_security",
      "min_severity",
      "package_name",
      "packages",
      "registry",
      "target_version",
      "verbose",
    ]);
  });

  it("calls service methods with normalized single-package params", async () => {
    const packageVulnerabilities = mock((params) =>
      Promise.resolve(cleanVuln(params.version ?? "5.0.0")),
    );
    const packageUpgradeDependencyProbe = mock((params) =>
      Promise.resolve(deps(params.version)),
    );
    const service = createMockPackageIntelligenceService({
      packageVulnerabilities: packageVulnerabilities as never,
      packageUpgradeDependencyProbe: packageUpgradeDependencyProbe as never,
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

    expect(packageVulnerabilities).toHaveBeenCalledTimes(2);
    expect(packageVulnerabilities.mock.calls[0]?.[0]).toMatchObject({
      registry: "NPM",
      packageName: "express",
      version: "4.18.0",
      minSeverity: 7,
      advisoryScope: "AFFECTED",
    });
    expect(packageUpgradeDependencyProbe).toHaveBeenCalledTimes(2);
    expect(packageUpgradeDependencyProbe.mock.calls[0]?.[0]).toMatchObject({
      registry: "NPM",
      packageName: "express",
      version: "4.18.0",
      minSeverity: 7,
      includeTransitiveSecurity: true,
      includeDependencyIssues: true,
      includeDependencyChanges: true,
    });
  });

  it("ignores empty optional mode fields emitted by tool-call harnesses", async () => {
    const packageVulnerabilities = mock((params) =>
      Promise.resolve(cleanVuln(params.version ?? "5.0.0")),
    );
    const packageUpgradeDependencyProbe = mock((params) =>
      Promise.resolve(deps(params.version)),
    );
    const service = createMockPackageIntelligenceService({
      packageVulnerabilities: packageVulnerabilities as never,
      packageUpgradeDependencyProbe: packageUpgradeDependencyProbe as never,
    });
    const tool = createPackageUpgradeReviewTool(service);

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
    const service = createMockPackageIntelligenceService({
      packageVulnerabilities: mock((params) =>
        Promise.resolve(cleanVuln(params.version ?? "5.0.0")),
      ) as never,
      packageUpgradeDependencyProbe: mock((params) =>
        Promise.resolve(deps(params.version)),
      ) as never,
    });
    const tool = createPackageUpgradeReviewTool(service);

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
    expect(text.content[0]?.text).toContain("pkg_upgrade_review");
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
});
