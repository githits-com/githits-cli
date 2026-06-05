import { describe, expect, it, mock } from "bun:test";
import type {
  ChangelogReport,
  DependencyReport,
  PackageIntelligenceService,
  TransitiveVulnerabilitySummary,
  VulnerabilityReport,
} from "@githits/core-internal";
import {
  createMockPackageIntelligenceService,
  defaultPackageSummary,
} from "../services/test-helpers.js";
import { buildPackageUpgradeReviewRequest } from "./package-upgrade-review-request.js";
import {
  buildPackageUpgradeReview,
  formatPackageUpgradeReviewTerminal,
} from "./package-upgrade-review-response.js";

function cleanVulnReport(
  version: string,
  deprecated = false,
): VulnerabilityReport {
  return {
    package: {
      name: "zod",
      registry: "NPM",
      version,
      deprecated,
    },
    security: {
      affectedVulnerabilityCount: 0,
      nonAffectingVulnerabilityCount: 0,
      allVulnerabilityCount: 0,
      currentVersionAffected: false,
      vulnerabilities: [],
    },
  };
}

function serviceWith(
  overrides: Partial<PackageIntelligenceService>,
): PackageIntelligenceService {
  return createMockPackageIntelligenceService({
    packageSummary: mock(() =>
      Promise.resolve({
        ...defaultPackageSummary,
        package: { ...defaultPackageSummary.package, name: "zod" },
      }),
    ),
    packageUpgradeDependencyProbe: mock(() =>
      Promise.resolve(cleanDependencyReport("4.4.3")),
    ),
    ...overrides,
  });
}

function cleanDependencyReport(
  version: string,
  transitive?: DependencyReport["dependencies"],
): DependencyReport {
  return {
    package: {
      name: "zod",
      registry: "NPM",
      version,
      deprecated: false,
    },
    dependencies: transitive,
    dependencyGroups: { groups: [] },
  };
}

function transitiveSummary(
  packages: TransitiveVulnerabilitySummary["packages"],
): TransitiveVulnerabilitySummary {
  const count = packages.length;
  const counts = {
    totalVulnerabilities: count,
    critical: 0,
    high: 0,
    medium: count,
    low: 0,
    unknown: 0,
  };
  return {
    affected: counts,
    nonAffecting: {
      totalVulnerabilities: 0,
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      unknown: 0,
    },
    combined: counts,
    totalPackagesAnalyzed: count,
    affectedPackageCount: count,
    packages,
  };
}

describe("package upgrade review response", () => {
  it("reports body-less package-version fallback changelog entries as missing evidence", async () => {
    const request = buildPackageUpgradeReviewRequest({
      registry: "npm",
      packageName: "zod",
      currentVersion: "4.3.6",
      targetVersion: "4.4.3",
    });
    const service = serviceWith({
      packageVulnerabilities: mock((params) =>
        Promise.resolve(cleanVulnReport(params.version ?? "4.4.3", false)),
      ) as never,
      packageChangelog: mock(() =>
        Promise.resolve({
          source: undefined,
          entries: [{ version: "4.4.3" }, { version: "4.3.6" }],
        } satisfies ChangelogReport),
      ),
    });

    const response = await buildPackageUpgradeReview(
      service,
      request.packages,
      request.options,
    );

    expect(response.reviews[0]?.unknowns).toContain(
      "changelog range only returned package-version fallback entries without release-note bodies",
    );
  });

  it("diffs advisories by alias cluster instead of raw id", async () => {
    const request = buildPackageUpgradeReviewRequest({
      registry: "npm",
      packageName: "zod",
      currentVersion: "4.3.6",
      targetVersion: "4.4.3",
    });
    const current: VulnerabilityReport = {
      ...cleanVulnReport("4.3.6", false),
      security: {
        affectedVulnerabilityCount: 1,
        nonAffectingVulnerabilityCount: 0,
        allVulnerabilityCount: 1,
        vulnerabilities: [
          {
            osvId: "GHSA-aaaa-bbbb-cccc",
            aliases: ["CVE-2026-0001"],
            severityScore: 5,
            affectedVersionRangesCount: 1,
            affectedVersionRangesTruncated: false,
            affectsInspectedVersion: true,
            matchedAffectedVersionRanges: ["<4.4.4"],
            duplicateIds: [],
          },
        ],
      },
    };
    const target: VulnerabilityReport = {
      ...cleanVulnReport("4.4.3", false),
      security: {
        affectedVulnerabilityCount: 1,
        nonAffectingVulnerabilityCount: 0,
        allVulnerabilityCount: 1,
        vulnerabilities: [
          {
            osvId: "CVE-2026-0001",
            aliases: ["GHSA-aaaa-bbbb-cccc"],
            severityScore: 5,
            affectedVersionRangesCount: 1,
            affectedVersionRangesTruncated: false,
            affectsInspectedVersion: true,
            matchedAffectedVersionRanges: ["<4.4.4"],
            duplicateIds: [],
          },
        ],
      },
    };
    const service = serviceWith({
      packageVulnerabilities: mock((params) =>
        Promise.resolve(params.version === "4.3.6" ? current : target),
      ) as never,
      packageChangelog: mock(() =>
        Promise.resolve({
          source: "releases",
          entries: [{ version: "4.4.3", body: "Patch fixes." }],
        } satisfies ChangelogReport),
      ),
      packageUpgradeDependencyProbe: mock((params) =>
        Promise.resolve(
          cleanDependencyReport(params.version, {
            transitive: { vulnerabilitySummary: transitiveSummary([]) },
          }),
        ),
      ) as never,
    });

    const response = await buildPackageUpgradeReview(
      service,
      request.packages,
      request.options,
    );

    expect(response.reviews[0]?.security.introduced).toHaveLength(0);
    expect(response.reviews[0]?.security.unchanged).toHaveLength(1);
  });

  it("reports non-major changelog breaking signals", async () => {
    const request = buildPackageUpgradeReviewRequest({
      registry: "npm",
      packageName: "zod",
      currentVersion: "4.3.6",
      targetVersion: "4.4.3",
    });
    const service = serviceWith({
      packageVulnerabilities: mock((params) =>
        Promise.resolve(cleanVulnReport(params.version ?? "4.4.3", false)),
      ) as never,
      packageChangelog: mock(() =>
        Promise.resolve({
          source: "releases",
          entries: [{ version: "4.4.3", body: "Breaking: removed an API." }],
        } satisfies ChangelogReport),
      ),
    });

    const response = await buildPackageUpgradeReview(
      service,
      request.packages,
      request.options,
    );

    expect(response.reviews[0]?.changelog.breakingSignals).toContain(
      "breaking",
    );
  });

  it("reports when direct vulnerability checks are severity-filtered", async () => {
    const request = buildPackageUpgradeReviewRequest({
      registry: "npm",
      packageName: "zod",
      currentVersion: "4.3.6",
      targetVersion: "4.4.3",
      minSeverity: "high",
    });
    const service = serviceWith({
      packageVulnerabilities: mock((params) =>
        Promise.resolve(cleanVulnReport(params.version ?? "4.4.3", false)),
      ) as never,
      packageChangelog: mock(() =>
        Promise.resolve({
          source: "releases",
          entries: [{ version: "4.4.3", body: "Patch fixes." }],
        } satisfies ChangelogReport),
      ),
      packageUpgradeDependencyProbe: mock((params) =>
        Promise.resolve(
          cleanDependencyReport(params.version, {
            transitive: { vulnerabilitySummary: transitiveSummary([]) },
          }),
        ),
      ) as never,
    });

    const response = await buildPackageUpgradeReview(
      service,
      request.packages,
      request.options,
    );

    expect(response.reviews[0]?.unknowns).toContain(
      "direct vulnerability checks were filtered by min_severity",
    );
    expect(formatPackageUpgradeReviewTerminal(response)).not.toContain(
      "transitive counts are not filtered by min_severity",
    );
  });

  it("treats min_severity=low as an unfiltered upgrade-review check", async () => {
    const request = buildPackageUpgradeReviewRequest({
      registry: "npm",
      packageName: "zod",
      currentVersion: "4.3.6",
      targetVersion: "4.4.3",
      minSeverity: "low",
    });
    const service = serviceWith({
      packageVulnerabilities: mock((params) =>
        Promise.resolve(cleanVulnReport(params.version ?? "4.4.3", false)),
      ) as never,
      packageChangelog: mock(() =>
        Promise.resolve({
          source: "releases",
          entries: [{ version: "4.4.3", body: "Patch fixes." }],
        } satisfies ChangelogReport),
      ),
    });

    const response = await buildPackageUpgradeReview(
      service,
      request.packages,
      request.options,
    );

    expect(request.options.minSeverity).toBeUndefined();
    expect(response.reviews[0]?.unknowns).not.toContain(
      "direct vulnerability checks were filtered by min_severity",
    );
  });

  it("detects changelog signals outside the displayed changelog limit", async () => {
    const request = buildPackageUpgradeReviewRequest({
      registry: "npm",
      packageName: "zod",
      currentVersion: "4.3.6",
      targetVersion: "4.4.3",
    });
    const service = serviceWith({
      packageVulnerabilities: mock((params) =>
        Promise.resolve(cleanVulnReport(params.version ?? "4.4.3", false)),
      ) as never,
      packageChangelog: mock(() =>
        Promise.resolve({
          source: "releases",
          entries: [
            ...Array.from({ length: 20 }, (_, index) => ({
              version: `4.4.${23 - index}`,
              body: "Patch fixes.",
            })),
            { version: "4.4.2", body: "Breaking: removed an API." },
          ],
        } satisfies ChangelogReport),
      ),
    });

    const response = await buildPackageUpgradeReview(
      service,
      request.packages,
      request.options,
    );

    expect(response.reviews[0]?.changelog.entries).toHaveLength(20);
    expect(response.reviews[0]?.changelog.keywordEntries).toHaveLength(1);
    expect(response.reviews[0]?.changelog.totalKeywordEntries).toBe(1);
    expect(response.reviews[0]?.changelog.breakingSignals).toContain(
      "breaking",
    );
    expect(formatPackageUpgradeReviewTerminal(response)).toContain(
      "keyword hits: 1 entries (breaking, removed); heuristic text match",
    );
    expect(formatPackageUpgradeReviewTerminal(response)).toContain(
      "[breaking]: Breaking: removed an API.",
    );
  });

  it("renders peer dependency compatibility facts without advice", async () => {
    const request = buildPackageUpgradeReviewRequest({
      registry: "npm",
      packageName: "zod",
      currentVersion: "4.3.6",
      targetVersion: "4.4.3",
    });
    const service = serviceWith({
      packageVulnerabilities: mock((params) =>
        Promise.resolve(cleanVulnReport(params.version ?? "4.4.3", false)),
      ) as never,
      packageChangelog: mock(() =>
        Promise.resolve({
          source: "releases",
          entries: [{ version: "4.4.3", body: "Patch fixes." }],
        } satisfies ChangelogReport),
      ),
      packageUpgradeDependencyProbe: mock((params) =>
        Promise.resolve({
          ...cleanDependencyReport(params.version),
          dependencyGroups: {
            groups:
              params.version === "4.4.3"
                ? [
                    {
                      name: "peer",
                      lifecycle: "peer",
                      conditionType: "always",
                      selectionMode: "required",
                      dependencies: [{ name: "react", constraint: ">=19" }],
                    },
                  ]
                : [
                    {
                      name: "peer",
                      lifecycle: "peer",
                      conditionType: "always",
                      selectionMode: "required",
                      dependencies: [{ name: "react", constraint: ">=18" }],
                    },
                  ],
          },
        } satisfies DependencyReport),
      ) as never,
    });

    const response = await buildPackageUpgradeReview(
      service,
      request.packages,
      request.options,
    );
    const output = formatPackageUpgradeReviewTerminal(response);

    expect(response.reviews[0]?.compatibility?.peerDependencyChanges).toEqual([
      "added react@>=19",
      "removed react@>=18",
    ]);
    expect(response.reviews[0]?.compatibility?.notes[0]).toBe(
      "Consumer-project compatibility cannot be determined from package metadata alone.",
    );
    expect(output).toContain("compatibility");
    expect(output).toContain("peer dependency metadata changes:");
    expect(output).toContain("- added react@>=19");
    expect(output).not.toContain("validate against");
  });

  it("renders deprecated target and malicious advisory facts", async () => {
    const request = buildPackageUpgradeReviewRequest({
      registry: "npm",
      packageName: "zod",
      currentVersion: "4.3.6",
      targetVersion: "4.4.3",
    });
    const target: VulnerabilityReport = {
      ...cleanVulnReport("4.4.3", true),
      package: {
        name: "zod",
        registry: "NPM",
        version: "4.4.3",
        deprecated: true,
        deprecationReason: "Use 4.4.4.",
      },
      security: {
        affectedVulnerabilityCount: 1,
        nonAffectingVulnerabilityCount: 0,
        allVulnerabilityCount: 1,
        vulnerabilities: [
          {
            osvId: "MAL-2026-0001",
            summary: "Malicious package version",
            severityScore: 9.8,
            affectedVersionRangesCount: 1,
            affectedVersionRangesTruncated: false,
            affectsInspectedVersion: true,
            matchedAffectedVersionRanges: ["=4.4.3"],
            duplicateIds: [],
            isMalicious: true,
          },
        ],
      },
    };
    const service = serviceWith({
      packageVulnerabilities: mock((params) =>
        Promise.resolve(
          params.version === "4.4.3"
            ? target
            : cleanVulnReport(params.version ?? "4.3.6", false),
        ),
      ) as never,
      packageChangelog: mock(() =>
        Promise.resolve({
          source: "releases",
          entries: [{ version: "4.4.3", body: "Patch fixes." }],
        } satisfies ChangelogReport),
      ),
      packageUpgradeDependencyProbe: mock((params) =>
        Promise.resolve({
          ...cleanDependencyReport(params.version),
          package:
            params.version === "4.4.3"
              ? target.package
              : cleanDependencyReport(params.version).package,
        } satisfies DependencyReport),
      ) as never,
    });

    const response = await buildPackageUpgradeReview(
      service,
      request.packages,
      request.options,
    );
    const output = formatPackageUpgradeReviewTerminal(response);

    expect(response.reviews[0]?.security.target?.deprecated).toBe(true);
    expect(response.reviews[0]?.security.added[0]?.isMalicious).toBe(true);
    expect(output).toContain("target deprecated: Use 4.4.4.");
    expect(output).toContain("MAL-2026-0001 critical(9.8) malicious");
  });

  it("reports current-vs-target transitive vulnerability diffs", async () => {
    const request = buildPackageUpgradeReviewRequest({
      registry: "npm",
      packageName: "zod",
      currentVersion: "4.3.6",
      targetVersion: "4.4.3",
      includeTransitiveSecurity: true,
    });
    const service = serviceWith({
      packageVulnerabilities: mock((params) =>
        Promise.resolve(cleanVulnReport(params.version ?? "4.4.3", false)),
      ) as never,
      packageChangelog: mock(() =>
        Promise.resolve({
          source: "releases",
          entries: [{ version: "4.4.3", body: "Patch fixes." }],
        } satisfies ChangelogReport),
      ),
      packageUpgradeDependencyProbe: mock((params) =>
        Promise.resolve(
          cleanDependencyReport(params.version, {
            transitive: {
              vulnerabilitySummary:
                params.version === "4.4.3"
                  ? transitiveSummary([
                      {
                        registry: "NPM",
                        name: "dep",
                        versions: ["1.0.0"],
                        affectedCount: 1,
                        nonAffectingCount: 0,
                        totalCount: 1,
                        advisoryIds: ["GHSA-dep"],
                      },
                    ])
                  : transitiveSummary([]),
            },
          }),
        ),
      ) as never,
    });

    const response = await buildPackageUpgradeReview(
      service,
      request.packages,
      request.options,
    );

    expect(
      response.reviews[0]?.security.transitive?.introducedPackageDetails[0],
    ).toMatchObject({
      id: "npm:dep",
      name: "dep",
      advisoryIds: ["GHSA-dep"],
    });
  });

  it("does not count non-affecting transitive packages as introduced vulnerabilities", async () => {
    const request = buildPackageUpgradeReviewRequest({
      registry: "npm",
      packageName: "zod",
      currentVersion: "4.3.6",
      targetVersion: "4.4.3",
      includeTransitiveSecurity: true,
    });
    const service = serviceWith({
      packageVulnerabilities: mock((params) =>
        Promise.resolve(cleanVulnReport(params.version ?? "4.4.3", false)),
      ) as never,
      packageChangelog: mock(() =>
        Promise.resolve({
          source: "releases",
          entries: [{ version: "4.4.3", body: "Patch fixes." }],
        } satisfies ChangelogReport),
      ),
      packageUpgradeDependencyProbe: mock((params) =>
        Promise.resolve(
          cleanDependencyReport(params.version, {
            transitive: {
              vulnerabilitySummary:
                params.version === "4.4.3"
                  ? transitiveSummary([
                      {
                        registry: "NPM",
                        name: "dep",
                        versions: ["1.0.0"],
                        affectedCount: 0,
                        nonAffectingCount: 1,
                        totalCount: 1,
                        advisoryIds: [],
                      },
                    ])
                  : transitiveSummary([]),
            },
          }),
        ),
      ) as never,
    });

    const response = await buildPackageUpgradeReview(
      service,
      request.packages,
      request.options,
    );

    expect(
      response.reviews[0]?.security.transitive?.introducedPackages,
    ).toEqual([]);
    expect(
      response.reviews[0]?.security.transitive?.introducedPackageDetails,
    ).toEqual([]);
  });

  it("classifies same transitive advisory across version changes as still affected", async () => {
    const request = buildPackageUpgradeReviewRequest({
      registry: "npm",
      packageName: "zod",
      currentVersion: "4.3.6",
      targetVersion: "4.4.3",
      includeTransitiveSecurity: true,
    });
    const service = serviceWith({
      packageVulnerabilities: mock((params) =>
        Promise.resolve(cleanVulnReport(params.version ?? "4.4.3", false)),
      ) as never,
      packageChangelog: mock(() =>
        Promise.resolve({
          source: "releases",
          entries: [{ version: "4.4.3", body: "Patch fixes." }],
        } satisfies ChangelogReport),
      ),
      packageUpgradeDependencyProbe: mock((params) =>
        Promise.resolve(
          cleanDependencyReport(params.version, {
            transitive: {
              vulnerabilitySummary:
                params.version === "4.4.3"
                  ? transitiveSummary([
                      {
                        registry: "NPM",
                        name: "dep",
                        versions: ["2.0.0"],
                        affectedCount: 1,
                        nonAffectingCount: 0,
                        totalCount: 1,
                        advisoryIds: ["GHSA-same"],
                      },
                    ])
                  : transitiveSummary([
                      {
                        registry: "NPM",
                        name: "dep",
                        versions: ["1.0.0"],
                        affectedCount: 1,
                        nonAffectingCount: 0,
                        totalCount: 1,
                        advisoryIds: ["GHSA-same"],
                      },
                    ]),
            },
          }),
        ),
      ) as never,
    });

    const response = await buildPackageUpgradeReview(
      service,
      request.packages,
      request.options,
    );

    expect(
      response.reviews[0]?.security.transitive?.introducedPackageDetails,
    ).toEqual([]);
    expect(
      response.reviews[0]?.security.transitive?.fixedPackageDetails,
    ).toEqual([]);
    expect(
      response.reviews[0]?.security.transitive?.stillAffectedPackageDetails[0],
    ).toMatchObject({ id: "npm:dep", versions: ["2.0.0"] });
  });

  it("classifies alias-linked transitive advisories as still affected", async () => {
    const request = buildPackageUpgradeReviewRequest({
      registry: "npm",
      packageName: "zod",
      currentVersion: "4.3.6",
      targetVersion: "4.4.3",
      includeTransitiveSecurity: true,
    });
    const service = serviceWith({
      packageVulnerabilities: mock((params) =>
        Promise.resolve(cleanVulnReport(params.version ?? "4.4.3", false)),
      ) as never,
      packageChangelog: mock(() =>
        Promise.resolve({
          source: "releases",
          entries: [{ version: "4.4.3", body: "Patch fixes." }],
        } satisfies ChangelogReport),
      ),
      packageUpgradeDependencyProbe: mock((params) =>
        Promise.resolve(
          cleanDependencyReport(params.version, {
            transitive: {
              vulnerabilitySummary:
                params.version === "4.4.3"
                  ? transitiveSummary([
                      {
                        registry: "NPM",
                        name: "dep",
                        versions: ["2.0.0"],
                        affectedCount: 1,
                        nonAffectingCount: 0,
                        totalCount: 1,
                        advisoryIds: ["CVE-2026-0001"],
                        advisoryOccurrences: [
                          {
                            version: "2.0.0",
                            affectsResolvedVersion: true,
                            matchedAffectedVersionRanges: ["<3.0.0"],
                            fixVersionsAboveResolved: [],
                            advisory: {
                              osvId: "CVE-2026-0001",
                              aliases: ["GHSA-aaaa-bbbb-cccc"],
                            },
                          },
                        ],
                      },
                    ])
                  : transitiveSummary([
                      {
                        registry: "NPM",
                        name: "dep",
                        versions: ["1.0.0"],
                        affectedCount: 1,
                        nonAffectingCount: 0,
                        totalCount: 1,
                        advisoryIds: ["GHSA-aaaa-bbbb-cccc"],
                        advisoryOccurrences: [
                          {
                            version: "1.0.0",
                            affectsResolvedVersion: true,
                            matchedAffectedVersionRanges: ["<3.0.0"],
                            fixVersionsAboveResolved: [],
                            advisory: {
                              osvId: "GHSA-aaaa-bbbb-cccc",
                              aliases: ["CVE-2026-0001"],
                            },
                          },
                        ],
                      },
                    ]),
            },
          }),
        ),
      ) as never,
    });

    const response = await buildPackageUpgradeReview(
      service,
      request.packages,
      request.options,
    );

    expect(
      response.reviews[0]?.security.transitive?.introducedPackageDetails,
    ).toEqual([]);
    expect(
      response.reviews[0]?.security.transitive?.fixedPackageDetails,
    ).toEqual([]);
    expect(
      response.reviews[0]?.security.transitive?.stillAffectedPackageDetails[0],
    ).toMatchObject({ id: "npm:dep", advisoryIds: ["CVE-2026-0001"] });
  });

  it("keeps transitive advisory ids that are not covered by occurrence samples", async () => {
    const request = buildPackageUpgradeReviewRequest({
      registry: "npm",
      packageName: "zod",
      currentVersion: "4.3.6",
      targetVersion: "4.4.3",
      includeTransitiveSecurity: true,
    });
    const service = serviceWith({
      packageVulnerabilities: mock((params) =>
        Promise.resolve(cleanVulnReport(params.version ?? "4.4.3", false)),
      ) as never,
      packageChangelog: mock(() =>
        Promise.resolve({
          source: "releases",
          entries: [{ version: "4.4.3", body: "Patch fixes." }],
        } satisfies ChangelogReport),
      ),
      packageUpgradeDependencyProbe: mock((params) =>
        Promise.resolve(
          cleanDependencyReport(params.version, {
            transitive: {
              vulnerabilitySummary:
                params.version === "4.4.3"
                  ? transitiveSummary([
                      {
                        registry: "NPM",
                        name: "dep",
                        versions: ["2.0.0"],
                        affectedCount: 2,
                        nonAffectingCount: 0,
                        totalCount: 2,
                        advisoryIds: ["GHSA-same", "GHSA-new"],
                        advisoryOccurrences: [
                          {
                            version: "2.0.0",
                            affectsResolvedVersion: true,
                            matchedAffectedVersionRanges: ["<3.0.0"],
                            fixVersionsAboveResolved: [],
                            advisory: { osvId: "GHSA-same" },
                          },
                        ],
                      },
                    ])
                  : transitiveSummary([
                      {
                        registry: "NPM",
                        name: "dep",
                        versions: ["1.0.0"],
                        affectedCount: 1,
                        nonAffectingCount: 0,
                        totalCount: 1,
                        advisoryIds: ["GHSA-same"],
                        advisoryOccurrences: [
                          {
                            version: "1.0.0",
                            affectsResolvedVersion: true,
                            matchedAffectedVersionRanges: ["<3.0.0"],
                            fixVersionsAboveResolved: [],
                            advisory: { osvId: "GHSA-same" },
                          },
                        ],
                      },
                    ]),
            },
          }),
        ),
      ) as never,
    });

    const response = await buildPackageUpgradeReview(
      service,
      request.packages,
      request.options,
    );

    expect(
      response.reviews[0]?.security.transitive?.introducedPackageDetails[0],
    ).toMatchObject({ id: "npm:dep", advisoryIds: ["GHSA-same", "GHSA-new"] });
    expect(
      response.reviews[0]?.security.transitive?.stillAffectedPackageDetails[0],
    ).toMatchObject({ id: "npm:dep" });
  });

  it("reports major upgrades even without detected breaking signals", async () => {
    const request = buildPackageUpgradeReviewRequest({
      registry: "npm",
      packageName: "zod",
      currentVersion: "4.3.6",
      targetVersion: "5.0.0",
    });
    const service = serviceWith({
      packageVulnerabilities: mock((params) =>
        Promise.resolve(cleanVulnReport(params.version ?? "5.0.0", false)),
      ) as never,
      packageChangelog: mock(() =>
        Promise.resolve({
          source: "releases",
          entries: [{ version: "5.0.0", body: "Release notes." }],
        } satisfies ChangelogReport),
      ),
    });

    const response = await buildPackageUpgradeReview(
      service,
      request.packages,
      request.options,
    );

    expect(response.reviews[0]?.versionDelta).toBe("major");
  });

  it("classifies v-prefixed Swift versions", async () => {
    const request = buildPackageUpgradeReviewRequest({
      registry: "swift",
      packageName: "github.com/apple/swift-crypto",
      currentVersion: "v3.10.0",
      targetVersion: "v4.5.0",
      includeTransitiveSecurity: false,
    });
    const service = serviceWith({
      packageVulnerabilities: mock((params) =>
        Promise.resolve(cleanVulnReport(params.version ?? "4.5.0", false)),
      ) as never,
      packageChangelog: mock(() =>
        Promise.resolve({
          source: "releases",
          entries: [{ version: "4.5.0", body: "Release notes." }],
        } satisfies ChangelogReport),
      ),
    });

    const response = await buildPackageUpgradeReview(
      service,
      request.packages,
      request.options,
    );

    expect(response.reviews[0]?.versionDelta).toBe("major");
  });

  it("does not count the target root package being outdated as a transitive issue", async () => {
    const request = buildPackageUpgradeReviewRequest({
      registry: "npm",
      packageName: "zod",
      currentVersion: "4.3.6",
      targetVersion: "4.4.3",
      includeDependencyIssues: true,
    });
    const service = serviceWith({
      packageVulnerabilities: mock((params) =>
        Promise.resolve(cleanVulnReport(params.version ?? "4.4.3", false)),
      ) as never,
      packageChangelog: mock(() =>
        Promise.resolve({
          source: "releases",
          entries: [{ version: "4.4.3", body: "Patch fixes." }],
        } satisfies ChangelogReport),
      ),
      packageUpgradeDependencyProbe: mock((params) =>
        Promise.resolve(
          cleanDependencyReport(params.version, {
            transitive: {
              dependencyIssues: {
                totalCount: 1,
                deprecatedCount: 0,
                outdatedCount: 1,
                duplicateCount: 0,
                conflictCount: 0,
                deprecatedPackages: [],
                duplicatePackages: [],
                conflicts: [],
                outdatedPackages:
                  params.version === "4.4.3"
                    ? [
                        {
                          registry: "NPM",
                          name: "zod",
                          latestVersion: "4.5.0",
                          severity: "MINOR",
                          versions: [{ version: "4.4.3", severity: "MINOR" }],
                        },
                      ]
                    : [],
              },
            },
          }),
        ),
      ) as never,
    });

    const response = await buildPackageUpgradeReview(
      service,
      request.packages,
      request.options,
    );

    expect(response.reviews[0]?.dependencyIssues?.introducedOutdated).toEqual(
      [],
    );
    expect(response.reviews[0]?.dependencyIssues?.introducedDeprecated).toEqual(
      [],
    );
  });

  it("reports requested dependency probe failures as unknowns", async () => {
    const request = buildPackageUpgradeReviewRequest({
      registry: "npm",
      packageName: "zod",
      currentVersion: "4.3.6",
      targetVersion: "4.4.3",
      includeDependencyIssues: true,
    });
    const service = serviceWith({
      packageVulnerabilities: mock((params) =>
        Promise.resolve(cleanVulnReport(params.version ?? "4.4.3", false)),
      ) as never,
      packageChangelog: mock(() =>
        Promise.resolve({
          source: "releases",
          entries: [{ version: "4.4.3", body: "Patch fixes." }],
        } satisfies ChangelogReport),
      ),
      packageUpgradeDependencyProbe: mock(() =>
        Promise.reject(new Error("dependency probe unavailable")),
      ) as never,
    });

    const response = await buildPackageUpgradeReview(
      service,
      request.packages,
      request.options,
    );

    expect(response.reviews[0]?.unknowns.join("\n")).toContain(
      "dependency probe failed",
    );
  });

  it("reports default dependency-change probe failures as unknowns", async () => {
    const request = buildPackageUpgradeReviewRequest({
      registry: "npm",
      packageName: "zod",
      currentVersion: "4.3.6",
      targetVersion: "4.4.3",
    });
    const service = serviceWith({
      packageVulnerabilities: mock((params) =>
        Promise.resolve(cleanVulnReport(params.version ?? "4.4.3", false)),
      ) as never,
      packageChangelog: mock(() =>
        Promise.resolve({
          source: "releases",
          entries: [{ version: "4.4.3", body: "Patch fixes." }],
        } satisfies ChangelogReport),
      ),
      packageUpgradeDependencyProbe: mock(() =>
        Promise.reject(new Error("dependency probe unavailable")),
      ) as never,
    });

    const response = await buildPackageUpgradeReview(
      service,
      request.packages,
      request.options,
    );

    expect(response.reviews[0]?.unknowns.join("\n")).toContain(
      "dependency probe failed",
    );
  });

  it("reports direct and transitive dependency changes without root package noise", async () => {
    const request = buildPackageUpgradeReviewRequest({
      registry: "npm",
      packageName: "zod",
      currentVersion: "4.3.6",
      targetVersion: "4.4.3",
    });
    const service = serviceWith({
      packageVulnerabilities: mock((params) =>
        Promise.resolve(cleanVulnReport(params.version ?? "4.4.3", false)),
      ) as never,
      packageChangelog: mock(() =>
        Promise.resolve({
          source: "releases",
          entries: [{ version: "4.4.3", body: "Patch fixes." }],
        } satisfies ChangelogReport),
      ),
      packageUpgradeDependencyProbe: mock((params) => {
        const isTarget = params.version === "4.4.3";
        return Promise.resolve({
          package: {
            name: "zod",
            registry: "NPM",
            version: params.version,
            deprecated: false,
          },
          dependencies: {
            direct: isTarget
              ? [
                  { name: "shared", versionConstraint: "^2.0.0" },
                  { name: "added-direct", versionConstraint: "^1.0.0" },
                ]
              : [
                  { name: "shared", versionConstraint: "^1.0.0" },
                  { name: "removed-direct", versionConstraint: "^1.0.0" },
                ],
            transitive: {
              dependencyGraph: {
                formatVersion: 1,
                nodes: isTarget
                  ? [
                      { registry: "synthetic", name: "root", version: "0.0.0" },
                      { registry: "NPM", name: "zod", version: "4.4.3" },
                      {
                        registry: "NPM",
                        name: "shared-transitive",
                        version: "2.0.0",
                      },
                      {
                        registry: "NPM",
                        name: "added-transitive",
                        version: "1.0.0",
                      },
                    ]
                  : [
                      { registry: "synthetic", name: "root", version: "0.0.0" },
                      { registry: "NPM", name: "zod", version: "4.3.6" },
                      {
                        registry: "NPM",
                        name: "shared-transitive",
                        version: "1.0.0",
                      },
                      {
                        registry: "NPM",
                        name: "removed-transitive",
                        version: "1.0.0",
                      },
                    ],
                edges: [],
              },
            },
          },
          dependencyGroups: { groups: [] },
        } satisfies DependencyReport);
      }) as never,
    });

    const response = await buildPackageUpgradeReview(
      service,
      request.packages,
      request.options,
    );
    const review = response.reviews[0];

    expect(
      review?.dependencyChanges?.direct.added.map((dep) => dep.name),
    ).toEqual(["added-direct"]);
    expect(
      review?.dependencyChanges?.direct.removed.map((dep) => dep.name),
    ).toEqual(["removed-direct"]);
    expect(review?.dependencyChanges?.direct.changed[0]).toMatchObject({
      name: "shared",
      fromVersions: ["^1.0.0"],
      toVersions: ["^2.0.0"],
    });
    expect(review?.dependencyChanges?.transitive.changed[0]).toMatchObject({
      registry: "npm",
      name: "shared-transitive",
      fromVersions: ["1.0.0"],
      toVersions: ["2.0.0"],
    });
    expect(
      [
        ...(review?.dependencyChanges?.transitive.added ?? []),
        ...(review?.dependencyChanges?.transitive.removed ?? []),
        ...(review?.dependencyChanges?.transitive.changed ?? []),
      ].map((dep) => dep.name),
    ).not.toContain("zod");
    expect(
      formatPackageUpgradeReviewTerminal(response, { verbose: true }),
    ).toContain("- npm:shared-transitive 1.0.0 -> 2.0.0");
  });

  it("caps default package-level concurrency at three", async () => {
    const request = buildPackageUpgradeReviewRequest({
      packages: ["one", "two", "three", "four", "five"].map((name) => ({
        registry: "npm",
        packageName: name,
        currentVersion: "1.0.0",
        targetVersion: "1.0.1",
      })),
      includeTransitiveSecurity: false,
    });
    let active = 0;
    let maxActive = 0;
    const service = serviceWith({
      packageSummary: mock(async (params) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        return {
          ...defaultPackageSummary,
          package: {
            ...defaultPackageSummary.package,
            name: params.packageName,
          },
        };
      }) as never,
      packageVulnerabilities: mock((params) =>
        Promise.resolve(cleanVulnReport(params.version ?? "1.0.1", false)),
      ) as never,
      packageChangelog: mock(() =>
        Promise.resolve({
          source: "releases",
          entries: [{ version: "1.0.1", body: "Patch fixes." }],
        } satisfies ChangelogReport),
      ),
    });

    await buildPackageUpgradeReview(service, request.packages, request.options);

    expect(maxActive).toBeLessThanOrEqual(3);
    expect(maxActive).toBeGreaterThan(1);
  });

  it("renders concrete evidence samples and follow-up commands", () => {
    const output = formatPackageUpgradeReviewTerminal({
      summary: {
        total: 1,
        withUnknowns: 0,
        withAddedAdvisories: 0,
        withBreakingSignals: 1,
        withDirectDependencyChanges: 1,
        withTransitiveVulnerabilityAdditions: 0,
      },
      reviews: [
        {
          registry: "npm",
          name: "express",
          currentVersion: "4.0.0",
          targetVersion: "5.0.0",
          versionDelta: "major",
          security: {
            current: {
              version: "4.0.0",
              deprecated: false,
              affectedCount: 1,
              nonAffectingCount: 0,
              allCount: 1,
              advisories: [],
            },
            target: {
              version: "5.0.0",
              deprecated: false,
              affectedCount: 0,
              nonAffectingCount: 0,
              allCount: 0,
              advisories: [],
            },
            added: [],
            removed: [
              {
                id: "GHSA-test",
                severity: 6.1,
                severityLabel: "medium",
                summary: "Removed advisory summary",
                fixedIn: ["5.0.0"],
              },
            ],
            notAddressed: [],
            fixed: [],
            introduced: [],
            unchanged: [],
          },
          changelog: {
            source: "releases",
            entries: [
              {
                version: "5.0.0",
                body: "Removed deprecated APIs.",
                bodyPreview: "Removed deprecated APIs.",
                headline: "Removed deprecated APIs.",
                htmlUrl: "https://example.test/release",
                signals: ["removed", "deprecated"],
              },
            ],
            sampledEntries: [
              {
                version: "5.0.0",
                body: "Removed deprecated APIs.",
                bodyPreview: "Removed deprecated APIs.",
                headline: "Removed deprecated APIs.",
                htmlUrl: "https://example.test/release",
                signals: ["removed", "deprecated"],
              },
            ],
            keywordEntries: [
              {
                version: "5.0.0",
                body: "Removed deprecated APIs.",
                bodyPreview: "Removed deprecated APIs.",
                headline: "Removed deprecated APIs.",
                htmlUrl: "https://example.test/release",
                signals: ["removed", "deprecated"],
              },
            ],
            totalKeywordEntries: 1,
            totalEntries: 1,
            totalEntriesWithBodies: 1,
            truncated: false,
            hasReleaseNoteBodies: true,
            breakingSignals: ["removed", "deprecated"],
            migrationSignals: [],
          },
          dependencyChanges: {
            direct: {
              added: [],
              removed: [],
              changed: [
                {
                  name: "accepts",
                  fromVersions: ["1.0.0"],
                  toVersions: ["2.0.0"],
                },
              ],
            },
            transitive: { added: [], removed: [], changed: [] },
          },
          unknowns: [],
        },
      ],
    });

    expect(output).toContain(
      "vulnerabilities\n  direct package advisories: current version affected=1, target version affected=0, fixed by target=1",
    );
    expect(output).toContain("  fixed:");
    expect(output).toContain("GHSA-test medium(6.1): Removed advisory summary");
    expect(output).toContain("changes");
    expect(output).toContain(
      "keyword hits: 1 entries (removed, deprecated); heuristic text match",
    );
    expect(output).toContain("keyword hit entries:");
    expect(output).toContain("[removed]: Removed deprecated APIs.");
    expect(output).toContain("dependencies");
    expect(output).toContain("- accepts 1.0.0 -> 2.0.0");
    expect(output).not.toContain("follow-up:");
    expect(output).not.toContain("verification:");
  });

  it("labels changelog samples as rudimentary and ignores no-breaking negation", async () => {
    const request = buildPackageUpgradeReviewRequest({
      registry: "npm",
      packageName: "zod",
      currentVersion: "4.3.6",
      targetVersion: "4.4.3",
    });
    const service = serviceWith({
      packageVulnerabilities: mock((params) =>
        Promise.resolve(cleanVulnReport(params.version ?? "4.4.3", false)),
      ) as never,
      packageChangelog: mock(() =>
        Promise.resolve({
          source: "releases",
          entries: [
            {
              version: "4.4.3",
              body: "No breaking changes.\n\n- 91dcd30 removed unnecessary console logs",
            },
            {
              version: "4.4.2",
              body: "Migration docs updated.\n\n- 1234567 docs: update links",
            },
          ],
        } satisfies ChangelogReport),
      ),
    });

    const response = await buildPackageUpgradeReview(
      service,
      request.packages,
      request.options,
    );
    const output = formatPackageUpgradeReviewTerminal(response);

    expect(response.reviews[0]?.changelog.breakingSignals).not.toContain(
      "breaking",
    );
    expect(output).toContain(
      "keyword hits: 1 entries (removed, migration); heuristic text match",
    );
    expect(output).toContain("keyword hit entries:");
    expect(output).toContain("[migration]: Migration docs updated.");
    expect(output).not.toContain("91dcd30 removed unnecessary console logs");
  });
});
