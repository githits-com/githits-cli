import { describe, expect, it, mock } from "bun:test";
import type { PackageUpgradeReviewResponse } from "@githits/core-internal";
import { createMockPackageIntelligenceService } from "../services/test-helpers.js";
import { buildPackageUpgradeReviewRequest } from "./package-upgrade-review-request.js";
import {
  buildPackageUpgradeReview,
  formatPackageUpgradeReviewTerminal,
} from "./package-upgrade-review-response.js";

const backendResponse: PackageUpgradeReviewResponse = {
  summary: {
    total: 1,
    withUnknowns: 1,
    withAddedAdvisories: 1,
    withBreakingSignals: 1,
    withDirectDependencyChanges: 1,
    withTransitiveVulnerabilityAdditions: 1,
  },
  reviews: [
    {
      registry: "NPM",
      name: "zod",
      currentVersion: "4.3.6",
      targetVersion: "4.4.3",
      latestVersion: "4.4.3",
      versionDelta: "MINOR",
      security: {
        current: {
          version: "4.3.6",
          deprecated: false,
          affectedCount: 0,
          nonAffectingCount: 0,
          allCount: 0,
          advisories: [],
        },
        target: {
          version: "4.4.3",
          deprecated: true,
          deprecationReason: "bad release",
          affectedCount: 1,
          nonAffectingCount: 0,
          allCount: 1,
          advisories: [],
        },
        added: [
          {
            id: "GHSA-new",
            aliases: [],
            summary: "new advisory",
            severity: 7.5,
            severityLabel: "HIGH",
            fixedIn: ["4.4.4"],
            isMalicious: false,
          },
        ],
        removed: [],
        notAddressed: [],
        fixed: [],
        introduced: [],
        unchanged: [],
        transitive: {
          currentAffected: 0,
          targetAffected: 1,
          introducedPackages: ["NPM:left-pad"],
          fixedPackages: [],
          introducedPackageDetails: {
            entries: [
              {
                id: "npm:left-pad",
                registry: "NPM",
                name: "left-pad",
                versions: ["1.0.0"],
                affectedCount: 1,
                maxSeverityScore: 4,
                maxSeverityLabel: "MEDIUM",
                advisoryIds: ["GHSA-transitive"],
              },
            ],
            totalCount: 2,
            truncated: true,
          },
          fixedPackageDetails: { entries: [], totalCount: 0, truncated: false },
          stillAffectedPackageDetails: {
            entries: [],
            totalCount: 0,
            truncated: false,
          },
        },
      },
      changelog: {
        source: "RELEASES",
        entries: [
          {
            version: "4.4.3",
            bodyPreview: "Breaking: removed an API.",
            headline: "Breaking: removed an API.",
            signals: ["breaking", "removed"],
          },
        ],
        sampledEntries: [],
        keywordEntries: [
          {
            version: "4.4.3",
            bodyPreview: "Breaking: removed an API.",
            headline: "Breaking: removed an API.",
            signals: ["breaking", "removed"],
          },
        ],
        totalKeywordEntries: 1,
        totalEntries: 1,
        totalEntriesWithBodies: 1,
        truncated: false,
        hasReleaseNoteBodies: true,
        breakingSignals: ["breaking"],
        migrationSignals: [],
      },
      compatibility: { peerDependencyChanges: [], notes: [] },
      dependencyChanges: {
        direct: {
          added: [
            {
              name: "left-pad",
              registry: "NPM",
              version: "1.0.0",
              fromVersions: [],
              toVersions: ["1.0.0"],
              type: "RUNTIME",
            },
          ],
          removed: [],
          changed: [],
        },
        transitive: { added: [], removed: [], changed: [] },
      },
      dependencyIssues: {
        currentTotal: 0,
        targetTotal: 1,
        introducedDeprecated: ["npm:left-pad@1.0.0"],
        introducedDuplicates: [],
        introducedConflicts: [],
        introducedOutdated: [],
      },
      unknowns: ["changelog evidence incomplete"],
    },
  ],
};

describe("package upgrade review response", () => {
  it("uses backend aggregate upgrade reviews and normalizes enum casing", async () => {
    const packageUpgradeReview = mock((_params: unknown) =>
      Promise.resolve(backendResponse),
    );
    const packageVulnerabilities = mock(() =>
      Promise.reject(new Error("unused")),
    );
    const packageUpgradeDependencyProbe = mock(() =>
      Promise.reject(new Error("unused")),
    );
    const request = buildPackageUpgradeReviewRequest({
      registry: "npm",
      packageName: "zod",
      currentVersion: "4.3.6",
      targetVersion: "4.4.3",
      includeDependencyIssues: true,
    });
    const service = createMockPackageIntelligenceService({
      packageUpgradeReview: packageUpgradeReview as never,
      packageVulnerabilities: packageVulnerabilities as never,
      packageUpgradeDependencyProbe: packageUpgradeDependencyProbe as never,
    });

    const response = await buildPackageUpgradeReview(
      service,
      request.packages,
      request.options,
    );

    expect(packageUpgradeReview).toHaveBeenCalledTimes(1);
    expect(packageVulnerabilities).not.toHaveBeenCalled();
    expect(packageUpgradeDependencyProbe).not.toHaveBeenCalled();
    expect(packageUpgradeReview.mock.calls[0]?.[0]).toMatchObject({
      packages: [
        {
          registry: "NPM",
          name: "zod",
          currentVersion: "4.3.6",
          targetVersion: "4.4.3",
        },
      ],
      includeTransitiveSecurity: true,
      includeDependencyIssues: true,
      changelogLimit: 20,
    });
    expect(response.reviews[0]).toMatchObject({
      registry: "npm",
      versionDelta: "minor",
      security: {
        added: [{ severityLabel: "high" }],
        transitive: {
          introducedPackages: ["npm:left-pad"],
          introducedPackageDetails: [
            { registry: "npm", maxSeverityLabel: "medium" },
          ],
          introducedPackageDetailsTotalCount: 2,
          introducedPackageDetailsTruncated: true,
        },
      },
      changelog: { source: "releases" },
      dependencyChanges: {
        direct: { added: [{ registry: "npm", type: "runtime" }] },
      },
    });
  });

  it("formats normalized backend evidence without assessment language", async () => {
    const request = buildPackageUpgradeReviewRequest({
      registry: "npm",
      packageName: "zod",
      currentVersion: "4.3.6",
      targetVersion: "4.4.3",
      includeDependencyIssues: true,
    });
    const service = createMockPackageIntelligenceService({
      packageUpgradeReview: mock(() =>
        Promise.resolve(backendResponse),
      ) as never,
    });

    const response = await buildPackageUpgradeReview(
      service,
      request.packages,
      request.options,
    );
    const text = formatPackageUpgradeReviewTerminal(response);

    expect(text).toContain("pkg_upgrade_review | 1 upgrades");
    expect(text).toContain("npm:zod 4.3.6 -> 4.4.3 | minor");
    expect(text).toContain("added in target=1");
    expect(text).toContain("added packages=2");
    expect(text).toContain("+1 more not returned by backend page");
    expect(text).toContain("target deprecated: bad release");
    expect(text).toContain(
      "keyword hits: 1 entries (breaking); heuristic text match",
    );
    expect(text).toContain("introduced deprecated: npm:left-pad@1.0.0");
    expect(text).not.toContain("recommendation");
    expect(text).not.toContain("risk level");
  });

  it("passes min_severity=low as an unfiltered backend request", async () => {
    const packageUpgradeReview = mock((_params: unknown) =>
      Promise.resolve(backendResponse),
    );
    const request = buildPackageUpgradeReviewRequest({
      registry: "npm",
      packageName: "zod",
      currentVersion: "4.3.6",
      targetVersion: "4.4.3",
      minSeverity: "low",
    });
    const service = createMockPackageIntelligenceService({
      packageUpgradeReview: packageUpgradeReview as never,
    });

    await buildPackageUpgradeReview(service, request.packages, request.options);

    expect(packageUpgradeReview.mock.calls[0]?.[0]).toMatchObject({
      minSeverity: undefined,
    });
  });
});
