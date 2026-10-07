import { describe, expect, it, mock } from "bun:test";
import type { PackageUpgradeReviewResponse } from "@githits/core-internal";
import { createMockPackageIntelligenceService } from "../services/test-helpers.js";
import expressChangelog from "./fixtures/upgrade-review-express-changelog.json";
import { buildPackageUpgradeReviewRequest } from "./package-upgrade-review-request.js";
import type {
  UpgradeChangelog,
  UpgradeChangelogRiskItem,
  UpgradeReview,
  UpgradeReviewResponse,
} from "./package-upgrade-review-response.js";
import {
  buildPackageUpgradeReview,
  formatPackageUpgradeReviewTerminal,
} from "./package-upgrade-review-response.js";

const ANSI_SGR_PATTERN = new RegExp(
  `${String.fromCharCode(27)}\\[[0-9;]*m`,
  "g",
);

function stripAnsi(text: string): string {
  return text.replace(ANSI_SGR_PATTERN, "");
}

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
        riskItems: [],
        riskCoverage: {
          versionsClassified: 0,
          versionsNotAssessed: 0,
          versionsWithoutNotes: 0,
          versionsUnparseable: 0,
          unitsNoImpact: 0,
          itemsOmitted: 0,
        },
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

function formatterReview(
  overrides: Partial<UpgradeReview> = {},
): UpgradeReview {
  const review = backendResponse.reviews[0]!;
  const transitive = review.security.transitive!;
  const normalizeEntry = (
    entry: (typeof review.changelog.entries)[number],
  ): UpgradeReview["changelog"]["entries"][number] => ({
    ...entry,
    version: entry.version ?? null,
    signals: entry.signals.length > 0 ? entry.signals : undefined,
  });
  return {
    ...review,
    registry: "npm",
    versionDelta: "minor",
    security: {
      ...review.security,
      transitive: {
        ...transitive,
        introducedPackageDetails: transitive.introducedPackageDetails.entries,
        fixedPackageDetails: transitive.fixedPackageDetails.entries,
        stillAffectedPackageDetails:
          transitive.stillAffectedPackageDetails.entries,
        introducedPackageDetailsTotalCount:
          transitive.introducedPackageDetails.totalCount,
        introducedPackageDetailsTruncated:
          transitive.introducedPackageDetails.truncated,
        fixedPackageDetailsTotalCount:
          transitive.fixedPackageDetails.totalCount,
        fixedPackageDetailsTruncated: transitive.fixedPackageDetails.truncated,
        stillAffectedPackageDetailsTotalCount:
          transitive.stillAffectedPackageDetails.totalCount,
        stillAffectedPackageDetailsTruncated:
          transitive.stillAffectedPackageDetails.truncated,
      },
    },
    changelog: {
      ...review.changelog,
      riskItems: review.changelog.riskItems.map((item) => ({
        ...item,
        tier: item.tier.toLowerCase() as UpgradeChangelogRiskItem["tier"],
      })),
      source: "releases",
      fallback: undefined,
      entries: review.changelog.entries.map(normalizeEntry),
      sampledEntries: review.changelog.sampledEntries.map(normalizeEntry),
      keywordEntries: review.changelog.keywordEntries.map(normalizeEntry),
    },
    ...overrides,
  };
}

function formatterResponse(
  reviews: UpgradeReview[] = [formatterReview()],
): UpgradeReviewResponse {
  return {
    summary: {
      ...backendResponse.summary,
      total: reviews.length,
    },
    reviews,
  };
}

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

  it("formats grouped evidence without assessment language", async () => {
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

    expect(text.startsWith("Upgrade review - 1 package")).toBe(true);
    expect(text).not.toContain("pkg_upgrade_review");
    expect(text).toContain("npm:zod 4.3.6 -> 4.4.3 (minor)");
    expect(text).toContain("Security");
    expect(text).toContain(
      "Direct: 0 affected -> 1 affected | 0 fixed | 1 added | 0 still present",
    );
    expect(text).toContain(
      "Transitive: 0 affected packages -> 1 | 0 fixed | 2 added | 0 still affected",
    );
    expect(text).toContain("Added direct advisories");
    expect(text).toContain("Added transitive vulnerable packages");
    expect(
      text.indexOf(
        "Direct: 0 affected -> 1 affected | 0 fixed | 1 added | 0 still present",
      ),
    ).toBeLessThan(
      text.indexOf(
        "Transitive: 0 affected packages -> 1 | 0 fixed | 2 added | 0 still affected",
      ),
    );
    expect(
      text.indexOf(
        "Transitive: 0 affected packages -> 1 | 0 fixed | 2 added | 0 still affected",
      ),
    ).toBeLessThan(text.indexOf("Added direct advisories"));
    expect(text.indexOf("Added direct advisories")).toBeLessThan(
      text.indexOf("Added transitive vulnerable packages"),
    );
    expect(text).toContain("+1 more not returned by backend page");
    expect(text).toContain("Target: deprecated: bad release");
    expect(text).toContain("Changes");
    expect(text).not.toContain("Heuristic keywords:");
    expect(text).toContain('[breaking, removed] "Breaking: removed an API."');
    expect(text).toContain("Dependencies");
    expect(text).toContain("Direct: 1 added | 0 removed | 0 changed");
    expect(text).toContain("Dependency issues");
    expect(text).toContain("Introduced deprecated\n    - npm:left-pad@1.0.0");
    expect(text).toContain("Unknown evidence");
    expect(text).not.toContain("recommendation");
    expect(text).not.toContain("risk level");
  });

  it("groups batch evidence in a stable aggregate order", () => {
    const first = formatterReview();
    const second = {
      ...first,
      name: "express",
      security: { ...first.security, transitive: undefined },
      unknowns: [],
    };
    const response = formatterResponse([first, second]);
    const text = formatPackageUpgradeReviewTerminal(response, {
      terminalWidth: 80,
      verbose: true,
    });

    expect(
      text.startsWith("Upgrade review - 2 packages\nAcross packages: "),
    ).toBe(true);
    const aggregateClauses = [
      "1 with reported unknowns",
      "1 with added direct vulnerabilities",
      "1 with added transitive vulnerabilities",
      "1 without transitive security evidence",
      "1 with heuristic change signals",
      "1 with direct dependency changes",
    ];
    const compactAggregate = text.replace(/\s+/g, " ");
    let previousClause = -1;
    for (const clause of aggregateClauses) {
      const index = compactAggregate.indexOf(clause);
      expect(index).toBeGreaterThan(previousClause);
      previousClause = index;
    }
    expect(text.indexOf("Security")).toBeLessThan(text.indexOf("Changes"));
    expect(text.indexOf("Changes")).toBeLessThan(
      text.indexOf("Unknown evidence"),
    );
  });

  it("omits the batch line for zero and one review", () => {
    const empty = formatPackageUpgradeReviewTerminal({
      summary: backendResponse.summary,
      reviews: [],
    });
    expect(empty).toBe("Upgrade review - 0 packages\n");
    const single = formatPackageUpgradeReviewTerminal({
      summary: backendResponse.summary,
      reviews: [formatterReview()],
    });
    expect(single).not.toContain("Across packages:");
  });

  it("maps changelog sources without inferring providers", () => {
    const base = formatterReview();
    const makeText = (changelog: typeof base.changelog): string =>
      formatPackageUpgradeReviewTerminal({
        summary: backendResponse.summary,
        reviews: [{ ...base, changelog }],
      });
    const packageVersions = makeText({
      ...base.changelog,
      source: undefined,
      fallback: "package_versions",
      totalEntries: 0,
      totalEntriesWithBodies: 0,
      keywordEntries: [],
      sampledEntries: [],
    });
    expect(packageVersions).toContain(
      "Release notes unavailable; using package versions.",
    );
    const entry = {
      ...base.changelog.entries[0]!,
      detailSource: "hexdocs",
      htmlUrl: "https://example.com/notes",
    };
    const hexdocs = makeText({
      ...base.changelog,
      entries: [entry],
      keywordEntries: [entry],
    });
    expect(hexdocs).toContain("hexdocs: https://example.com/notes");
    expect(hexdocs).not.toContain("Repository releases");
  });

  it("renders zero-valued dependency issues and omits undefined evidence", () => {
    const base = formatterReview();
    const zero = formatPackageUpgradeReviewTerminal({
      summary: backendResponse.summary,
      reviews: [
        {
          ...base,
          dependencyIssues: {
            currentTotal: 2,
            targetTotal: 2,
            introducedDeprecated: [],
            introducedDuplicates: [],
            introducedConflicts: [],
            introducedOutdated: [],
          },
        },
      ],
    });
    expect(zero).toContain(
      "none introduced | current total: 2 | target total: 2",
    );
    const omitted = formatPackageUpgradeReviewTerminal({
      summary: backendResponse.summary,
      reviews: [{ ...base, dependencyIssues: undefined }],
    });
    expect(omitted).not.toContain("Dependency issues");
  });

  it("preserves defined zero-valued dependency changes and omits undefined evidence", () => {
    const base = formatterReview();
    const zero = formatPackageUpgradeReviewTerminal({
      summary: backendResponse.summary,
      reviews: [
        {
          ...base,
          dependencyChanges: {
            direct: { added: [], removed: [], changed: [] },
            transitive: { added: [], removed: [], changed: [] },
          },
        },
      ],
    });
    expect(zero).toContain("Dependencies");
    expect(zero).toContain("Direct: 0 added | 0 removed | 0 changed");
    expect(zero).toContain("Transitive: 0 added | 0 removed | 0 changed");
    expect(zero).not.toContain("Direct added");
    expect(zero).not.toContain("Transitive added");

    const omitted = formatPackageUpgradeReviewTerminal({
      summary: backendResponse.summary,
      reviews: [{ ...base, dependencyChanges: undefined }],
    });
    expect(omitted).not.toContain("Dependencies");
  });

  it("keeps missing target deprecation evidence explicit", () => {
    const base = formatterReview();
    const missingTarget = formatPackageUpgradeReviewTerminal({
      summary: backendResponse.summary,
      reviews: [
        {
          ...base,
          security: { ...base.security, target: undefined },
        },
      ],
    });
    expect(missingTarget).toContain(
      "Deprecation\n  Target: deprecation unknown",
    );

    const missingBoth = formatPackageUpgradeReviewTerminal({
      summary: backendResponse.summary,
      reviews: [
        {
          ...base,
          security: {
            ...base.security,
            current: undefined,
            target: undefined,
          },
        },
      ],
    });
    expect(missingBoth).toContain("Deprecation\n  Target: deprecation unknown");

    const knownNotDeprecated = formatPackageUpgradeReviewTerminal({
      summary: backendResponse.summary,
      reviews: [
        {
          ...base,
          security: {
            ...base.security,
            target: { ...base.security.target!, deprecated: false },
          },
        },
      ],
    });
    expect(knownNotDeprecated).not.toContain("Deprecation");
  });

  it("groups dependency issue locators as bounded bullets", () => {
    const base = formatterReview();
    const deprecated = Array.from(
      { length: 12 },
      (_, index) => `npm:deprecated-${index + 1}@1.0.0`,
    );
    const duplicates = Array.from(
      { length: 12 },
      (_, index) => `npm:duplicate-${index + 1}@1.0.0`,
    );
    const conflicts = Array.from(
      { length: 12 },
      (_, index) => `npm:conflict-${index + 1}@1.0.0`,
    );
    const outdated = Array.from(
      { length: 12 },
      (_, index) => `npm:outdated-${index + 1}@1.0.0`,
    );
    const dependencyIssues = {
      currentTotal: 0,
      targetTotal: 48,
      introducedDeprecated: deprecated,
      introducedDuplicates: duplicates,
      introducedConflicts: conflicts,
      introducedOutdated: outdated,
    };
    const text = formatPackageUpgradeReviewTerminal(
      {
        summary: backendResponse.summary,
        reviews: [
          {
            ...base,
            dependencyIssues,
          },
        ],
      },
      { terminalWidth: 80 },
    );
    const compactSection = text.slice(text.indexOf("Dependency issues"));
    expect(compactSection).toContain(
      "  48 introduced | current total: 0 | target total: 48",
    );
    expect(compactSection).toContain(
      "Introduced deprecated\n    - npm:deprecated-1@1.0.0",
    );
    expect(compactSection).toContain("    - ... +7 more with verbose output");
    expect(compactSection).not.toContain("npm:deprecated-6@1.0.0");
    expect(compactSection).toContain(
      "Introduced duplicates\n    - npm:duplicate-1@1.0.0",
    );
    expect(compactSection).toContain("    - ... +7 more with verbose output");
    expect(compactSection).not.toContain("npm:duplicate-6@1.0.0");
    expect(
      compactSection.split("\n").filter((line) => line.startsWith("    - ")),
    ).toHaveLength(24);

    const verbose = formatPackageUpgradeReviewTerminal(
      {
        summary: backendResponse.summary,
        reviews: [{ ...base, dependencyIssues }],
      },
      { terminalWidth: 80, verbose: true },
    );
    const verboseSection = verbose.slice(verbose.indexOf("Dependency issues"));
    expect(verboseSection).not.toContain("more with verbose output");
    expect(verboseSection).toContain("npm:deprecated-12@1.0.0");
    expect(verboseSection).toContain("npm:duplicate-12@1.0.0");
    expect(verboseSection).toContain("npm:conflict-12@1.0.0");
    expect(verboseSection).toContain("npm:outdated-12@1.0.0");
    expect(
      verboseSection.split("\n").filter((line) => line.startsWith("    - ")),
    ).toHaveLength(48);
  });

  it("wraps prose at the configured width without splitting locators", () => {
    const long = formatPackageUpgradeReviewTerminal(
      formatterResponse([
        {
          ...formatterReview(),
          changelog: {
            ...formatterReview().changelog,
            entries: [
              {
                ...formatterReview().changelog.entries[0]!,
                htmlUrl: "https://example.com/releases/4.4.3",
              },
            ],
            keywordEntries: [
              {
                ...formatterReview().changelog.keywordEntries[0]!,
                htmlUrl: "https://example.com/releases/4.4.3",
              },
            ],
          },
          unknowns: [
            "This is a deliberately long evidence limitation that should wrap beneath its bullet while preserving the backend wording.",
          ],
        },
      ]),
      { terminalWidth: 30 },
    );
    expect(long).toContain("    its bullet while");
    expect(long).toContain("GHSA-new");
    expect(long).toContain("npm:left-pad@1.0.0");
    expect(long).toContain("https://example.com/releases/4.4.3");
    const narrow = formatPackageUpgradeReviewTerminal(formatterResponse(), {
      terminalWidth: 1,
    });
    expect(narrow).toContain("Upgrade review - 1 package");
  });

  it("bounds multi-locator rows while preserving overlong single locators", () => {
    const base = formatterReview();
    const transitive = base.security.transitive!;
    const response = formatterResponse([
      formatterReview({
        security: {
          ...base.security,
          transitive: {
            ...transitive,
            introducedPackageDetails: [
              {
                ...transitive.introducedPackageDetails[0]!,
                registry: "npm",
                name: "qs",
                versions: ["6.13.0", "6.15.3"],
                advisoryIds: [
                  "GHSA-6rw7-vpxm-498p",
                  "GHSA-q8mj-m7cp-5q26",
                  "GHSA-w7fw-mjwx-w883",
                  "GHSA-extra-long-locator",
                ],
                maxSeverityLabel: "medium",
              },
            ],
            introducedPackageDetailsTotalCount: 1,
            introducedPackageDetailsTruncated: false,
          },
        },
        changelog: {
          ...base.changelog,
          entries: [
            {
              ...base.changelog.entries[0]!,
              version: "5.2.1",
              publishedAt: "2025-12-01T20:49:43.268Z",
              htmlUrl:
                "https://github.com/expressjs/express/releases/tag/v5.2.1",
            },
          ],
          keywordEntries: [
            {
              ...base.changelog.keywordEntries[0]!,
              version: "5.2.1",
              publishedAt: "2025-12-01T20:49:43.268Z",
              htmlUrl:
                "https://github.com/expressjs/express/releases/tag/v5.2.1",
            },
          ],
        },
      }),
    ]);
    const text = formatPackageUpgradeReviewTerminal(response, {
      terminalWidth: 80,
    });
    const plain = stripAnsi(text);
    const lines = plain.split("\n").filter((line) => line.length > 0);

    expect(plain).toContain("    - npm:qs@6.13.0|6.15.3 affected=1 medium(4)");
    expect(plain).toContain(
      "      Advisories: GHSA-6rw7-vpxm-498p, GHSA-q8mj-m7cp-5q26, GHSA-w7fw-mjwx-w883,",
    );
    expect(plain).toContain("                  GHSA-extra-long-locator");
    expect(plain).toContain(
      "    [1] https://github.com/expressjs/express/releases/tag/v5.2.1",
    );
    expect(Math.max(...lines.map((line) => line.length))).toBeLessThanOrEqual(
      80,
    );

    const ordinary = stripAnsi(
      formatPackageUpgradeReviewTerminal(
        formatterResponse([
          formatterReview({
            changelog: {
              ...base.changelog,
              entries: [
                {
                  ...base.changelog.entries[0]!,
                  version: "5.2.1",
                  publishedAt: "2025-12-01T20:49:43.268Z",
                  htmlUrl:
                    "https://github.com/expressjs/express/releases/tag/v5.2.1",
                },
              ],
              sampledEntries: [
                {
                  ...base.changelog.entries[0]!,
                  version: "5.2.1",
                  publishedAt: "2025-12-01T20:49:43.268Z",
                  htmlUrl:
                    "https://github.com/expressjs/express/releases/tag/v5.2.1",
                },
              ],
              keywordEntries: [],
              totalKeywordEntries: 0,
              breakingSignals: [],
              migrationSignals: [],
              riskItems: [],
              riskCoverage: {
                versionsClassified: 0,
                versionsNotAssessed: 0,
                versionsWithoutNotes: 0,
                versionsUnparseable: 0,
                unitsNoImpact: 0,
                itemsOmitted: 0,
              },
            },
          }),
        ]),
        { terminalWidth: 80, verbose: true },
      ),
    );
    expect(ordinary).toContain(
      "    [1] https://github.com/expressjs/express/releases/tag/v5.2.1",
    );
    expect(
      Math.max(
        ...ordinary
          .split("\n")
          .filter((line) => line.length > 0)
          .map((line) => line.length),
      ),
    ).toBeLessThanOrEqual(80);

    const overlongUrl = `https://example.com/releases/${"x".repeat(80)}`;
    const overlongCoordinate = `transitive-${"x".repeat(80)}`;
    const overlong = stripAnsi(
      formatPackageUpgradeReviewTerminal(
        formatterResponse([
          formatterReview({
            security: {
              ...base.security,
              transitive: {
                ...transitive,
                introducedPackageDetails: [
                  {
                    ...transitive.introducedPackageDetails[0]!,
                    name: overlongCoordinate,
                    advisoryIds: [],
                  },
                ],
                introducedPackageDetailsTotalCount: 1,
                introducedPackageDetailsTruncated: false,
              },
            },
            changelog: {
              ...base.changelog,
              entries: [
                {
                  ...base.changelog.entries[0]!,
                  htmlUrl: overlongUrl,
                },
              ],
              keywordEntries: [
                {
                  ...base.changelog.keywordEntries[0]!,
                  htmlUrl: overlongUrl,
                },
              ],
            },
          }),
        ]),
        { terminalWidth: 80 },
      ),
    );
    expect(overlong).toContain(overlongUrl);
    expect(overlong).toContain(overlongCoordinate);
    expect(
      overlong
        .split("\n")
        .some((line) => line.includes(overlongUrl) && line.length > 80),
    ).toBe(true);
    expect(
      overlong
        .split("\n")
        .some((line) => line.includes(overlongCoordinate) && line.length > 80),
    ).toBe(true);
    expect(
      overlong
        .split("\n")
        .filter((line) => line.length > 80)
        .every(
          (line) =>
            line.includes(overlongUrl) || line.includes(overlongCoordinate),
        ),
    ).toBe(true);
  });

  it("hides no-impact-only previews by default and keeps their locators in verbose", () => {
    const review = riskReview([]);
    const entry = {
      version: "4.4.2",
      headline: "Routine fixes.",
      htmlUrl: "https://example.com/notes",
      signals: [],
    };
    review.changelog.entries = [entry];
    review.changelog.sampledEntries = [entry];
    review.changelog.keywordEntries = [];
    review.changelog.breakingSignals = [];
    review.changelog.totalKeywordEntries = 0;
    const response = formatterResponse([review]);
    const text = formatPackageUpgradeReviewTerminal(response);
    expect(text.replace(/\s+/g, " ")).toContain(
      "56 statements labeled no impact",
    );
    expect(text).not.toContain("Routine fixes.");
    expect(text).not.toContain("https://example.com/notes");
    const verbose = formatPackageUpgradeReviewTerminal(response, {
      verbose: true,
    });
    expect(verbose).toContain('"Routine fixes."');
    expect(verbose.split("https://example.com/notes")).toHaveLength(2);
    expect(verbose.match(/^ {2}4\.4\.2$/gm)).toHaveLength(1);
    expect(verbose).not.toContain("Sampled release entries");
  });

  it("keeps unassessed entry locators in verbose without attributing per-version status", () => {
    const review = riskReview([]);
    review.changelog.riskCoverage.versionsClassified = 0;
    review.changelog.riskCoverage.versionsNotAssessed = 2;
    review.changelog.entries = [
      {
        version: "1.0.post2",
        htmlUrl: "https://example.com/post2",
        signals: [],
      },
      {
        version: "1.0.post1",
        htmlUrl: "https://example.com/post1",
        signals: [],
      },
      { version: null, signals: [] },
    ];
    review.changelog.keywordEntries = [];
    review.changelog.sampledEntries = [...review.changelog.entries];
    const response = formatterResponse([review]);
    const text = formatPackageUpgradeReviewTerminal(response);
    expect(text).toContain("2 not assessed");
    expect(text.replace(/\s+/g, " ")).toContain(
      "Rerun in a few seconds to a minute",
    );
    expect(text).not.toContain("1.0.post");
    const verbose = formatPackageUpgradeReviewTerminal(response, {
      verbose: true,
    });
    expect(verbose.indexOf("  1.0.post2")).toBeLessThan(
      verbose.indexOf("  1.0.post1"),
    );
    expect(verbose).toContain("Unversioned notes");
    expect(verbose.split("https://example.com/post2")).toHaveLength(2);
    expect(verbose).not.toContain("post2 not assessed");
  });

  it("combines overlapping entry views without losing keyword bodies or inventing sources", () => {
    const review = riskReview([]);
    const entry = {
      version: "4.4.3",
      detailSource: "releases",
      htmlUrl: "https://example.com/release",
      signals: ["breaking"],
    };
    review.changelog.entries = [entry];
    review.changelog.sampledEntries = [entry];
    review.changelog.keywordEntries = [
      {
        ...entry,
        body: "## Commits\n- abcdef123 breaking commit noise\n## Changes\n- Breaking: removed an API.",
      },
    ];
    const response = formatterResponse([review]);
    const before = JSON.stringify(response);
    const text = formatPackageUpgradeReviewTerminal(response);
    expect(text.match(/^ {2}4\.4\.3$/gm)).toHaveLength(1);
    expect(text.split("https://example.com/release")).toHaveLength(2);
    expect(text).toContain('[breaking] "Breaking: removed an API."');
    expect(text).not.toContain("commit noise");
    expect(text).not.toContain("Sampled release entries");
    expect(text).not.toContain("Heuristic release entries");
    expect(JSON.stringify(response)).toBe(before);
  });

  it("reports missing notes and entry sampling without implying statement coverage is sampled", () => {
    const review = riskReview([]);
    review.changelog.entries = [];
    review.changelog.keywordEntries = [];
    review.changelog.sampledEntries = [];
    review.changelog.riskCoverage.versionsWithoutNotes = 2;
    review.changelog.truncated = true;
    review.changelog.fallback = "package_versions";
    const text = formatPackageUpgradeReviewTerminal(
      formatterResponse([review]),
    );
    expect(text).toContain("2 without notes");
    expect(text.replace(/\s+/g, " ")).toContain(
      "Release-note entries and links are sampled; statement coverage spans the upgrade range.",
    );
    expect(text).toContain("Release notes unavailable");
    expect(text).not.toContain("  Sources");
    expect(text).not.toMatch(/\bsafe\b/);
  });

  it("keeps no-color text ASCII-authored and colors attention without changing words", () => {
    const plain = formatPackageUpgradeReviewTerminal(formatterResponse(), {
      useColors: false,
    });
    const colored = formatPackageUpgradeReviewTerminal(formatterResponse(), {
      useColors: true,
    });
    expect(colored.replace(ANSI_SGR_PATTERN, "")).toBe(plain);
    expect(colored).toContain("\x1b[33m");
    expect(colored).toContain("\x1b[1mUpgrade review - 1 package\x1b[0m");
    expect(colored).toContain("\x1b[1mSecurity\x1b[0m");
    expect(colored).toContain(
      "\x1b[1m\x1b[36mnpm:zod 4.3.6 -> 4.4.3 (minor)\x1b[0m",
    );
    expect(colored).not.toContain("\x1b[36mUpgrade review");
    expect(colored).not.toContain("\x1b[36mSecurity");
    expect(colored).toContain(
      "\x1b[33m  Added direct advisories\x1b[0m\n    - GHSA-new",
    );
    expect(colored).toContain(
      "\x1b[33m  Introduced deprecated\x1b[0m\n    - npm:left-pad@1.0.0",
    );
    expect(colored).toContain(
      "\x1b[1m\x1b[33mUnknown evidence\x1b[0m\n  - changelog evidence incomplete",
    );
    expect(colored).toContain(
      "[\x1b[33mbreaking\x1b[0m, \x1b[33mremoved\x1b[0m]",
    );
    expect(plain).toContain("* [breaking, removed]");
    expect(colored).not.toContain("\x1b[33m  Heuristic keywords:");
    expect(colored).not.toContain("\x1b[33m  Heuristic release entries");
    expect(colored).not.toContain("\x1b[33m    - GHSA-new");
    expect(colored).not.toContain("\x1b[33m    - npm:left-pad@1.0.0");
    expect(colored).not.toContain("\x1b[33m  - changelog evidence incomplete");
    expect(plain).not.toContain("⚠");
    expect(plain).toMatch(/^[\x20-\x7e\n]*$/);

    const styledBase = formatterReview();
    const styledTransitive = styledBase.security.transitive!;
    const styledDetail = styledTransitive.introducedPackageDetails[0]!;
    const styled = formatPackageUpgradeReviewTerminal(
      formatterResponse([
        formatterReview({
          security: {
            ...styledBase.security,
            transitive: {
              ...styledTransitive,
              introducedPackageDetails: [styledDetail],
              introducedPackageDetailsTotalCount: 1,
              introducedPackageDetailsTruncated: false,
              stillAffectedPackageDetails: [styledDetail],
              stillAffectedPackageDetailsTotalCount: 1,
              stillAffectedPackageDetailsTruncated: false,
              fixedPackageDetails: [styledDetail],
              fixedPackageDetailsTotalCount: 1,
              fixedPackageDetailsTruncated: false,
            },
          },
        }),
      ]),
      { useColors: true },
    );
    expect(styled).toContain("\x1b[33m  Added transitive vulnerable packages");
    expect(styled).toContain("\x1b[33m  Still affected transitive packages");
    expect(styled).toContain("  Fixed transitive vulnerable packages");
    expect(styled).not.toContain(
      "\x1b[33m  Fixed transitive vulnerable packages",
    );

    const unicodeSummary = "安全 review 🚀";
    const unicodeExcerpt = "breaking: 修复 parser 🚀";
    const unicodeBase = formatterReview();
    const unicodeEntry = {
      ...unicodeBase.changelog.entries[0]!,
      body: unicodeExcerpt,
      bodyPreview: unicodeExcerpt,
      headline: unicodeExcerpt,
      signals: ["breaking"],
    };
    const unicodeResponse = formatterResponse([
      formatterReview({
        security: {
          ...unicodeBase.security,
          added: [
            {
              ...unicodeBase.security.added[0]!,
              summary: unicodeSummary,
            },
          ],
        },
        changelog: {
          ...unicodeBase.changelog,
          entries: [unicodeEntry],
          keywordEntries: [unicodeEntry],
        },
      }),
    ]);
    const unicodePlain = formatPackageUpgradeReviewTerminal(unicodeResponse, {
      useColors: false,
    });
    const unicodeColored = formatPackageUpgradeReviewTerminal(unicodeResponse, {
      useColors: true,
    });
    expect(unicodePlain).toContain(unicodeSummary);
    expect(unicodePlain).toContain(unicodeExcerpt);
    expect(stripAnsi(unicodeColored)).toBe(unicodePlain);
    expect(unicodePlain).toContain('* [breaking] "breaking: 修复 parser 🚀');
    expect(unicodeColored).toContain("[\x1b[33mbreaking\x1b[0m]");
  });

  it("preserves default samples and expands them only in verbose mode", () => {
    const base = formatterReview();
    const advisories = Array.from({ length: 6 }, (_, index) => ({
      id: `GHSA-${index + 1}`,
      aliases: [],
      summary: `advisory ${index + 1}`,
      severity: 5,
      severityLabel: "medium",
      fixedIn: [],
      isMalicious: false,
    }));
    const transitivePackages = Array.from({ length: 6 }, (_, index) => ({
      id: `npm:transitive-${index + 1}`,
      registry: "npm",
      name: `transitive-${index + 1}`,
      versions: ["1.0.0"],
      affectedCount: 1,
      maxSeverityScore: 5,
      maxSeverityLabel: "medium",
      advisoryIds: [`GHSA-transitive-${index + 1}`],
    }));
    const dependencyChanges = Array.from({ length: 6 }, (_, index) => ({
      name: `dependency-${index + 1}`,
      registry: "npm",
      fromVersions: ["1.0.0"],
      toVersions: ["2.0.0"],
      type: "runtime",
    }));
    const review = formatterReview({
      security: {
        ...base.security,
        added: advisories,
        transitive: {
          ...base.security.transitive!,
          introducedPackageDetails: transitivePackages,
          introducedPackageDetailsTotalCount: transitivePackages.length,
          introducedPackageDetailsTruncated: false,
        },
      },
      dependencyChanges: {
        direct: { added: dependencyChanges, removed: [], changed: [] },
        transitive: { added: dependencyChanges, removed: [], changed: [] },
      },
    });
    const response = formatterResponse([review]);
    const compact = formatPackageUpgradeReviewTerminal(response);
    const verbose = formatPackageUpgradeReviewTerminal(response, {
      verbose: true,
    });

    expect(compact).toContain("GHSA-1");
    expect(compact).toContain("... +1 more with verbose output");
    expect(compact).not.toContain("GHSA-6 medium");
    expect(compact).not.toContain("npm:transitive-6");
    expect(compact).not.toContain("dependency-6");
    expect(compact).toContain(
      "More transitive dependency details are available with verbose output.",
    );
    expect(verbose).toContain("GHSA-6 medium(5): advisory 6");
    expect(verbose).toContain("npm:transitive-6@1.0.0");
    expect(verbose).toContain("npm:dependency-6 1.0.0 -> 2.0.0");
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

function riskItem(
  overrides: Partial<UpgradeChangelogRiskItem> = {},
): UpgradeChangelogRiskItem {
  return {
    version: "4.4.3",
    tier: "must_act",
    tierConfidence: 0.98,
    kind: "removes_or_renames_api",
    kindConfidence: 0.99,
    text: "Removed an API.",
    textTruncated: false,
    heading: "Removed",
    source: "releases",
    model: "jev-1.13.0",
    formulation: "d-hier-v1",
    ...overrides,
  };
}

function riskReview(
  items: UpgradeChangelogRiskItem[] = [riskItem()],
): UpgradeReview {
  const base = formatterReview();
  return {
    ...base,
    changelog: {
      ...base.changelog,
      riskItems: items,
      riskCoverage: {
        versionsClassified: 1,
        versionsNotAssessed: 0,
        versionsWithoutNotes: 0,
        versionsUnparseable: 0,
        unitsNoImpact: 56,
        itemsOmitted: 0,
      },
      entries: [
        {
          version: "4.4.3",
          detailSource: "releases",
          htmlUrl: "https://example.com/release",
          signals: [],
        },
      ],
    },
  };
}

describe("upgrade review model statement evidence", () => {
  it("separates confidence below 0.4 from confident actions and marks uncertain knowledge", () => {
    const review = riskReview([
      riskItem({ tierConfidence: 0, text: "Action at zero." }),
      riskItem({
        tierConfidence: 0.399,
        kind: undefined,
        kindConfidence: undefined,
        text: "Possibly removed API.",
      }),
      riskItem({
        tierConfidence: 0.4,
        kindConfidence: 0.4,
        text: "Action at boundary.",
      }),
      riskItem({ tierConfidence: 1, text: "Action at one." }),
      riskItem({
        tier: "should_know",
        tierConfidence: 0,
        text: "Knowledge at zero.",
      }),
      riskItem({
        tier: "should_know",
        tierConfidence: 0.399,
        text: "Uncertain knowledge.",
      }),
      riskItem({
        tier: "should_know",
        tierConfidence: 0.4,
        text: "Confident knowledge.",
      }),
      riskItem({
        tier: "should_know",
        tierConfidence: 1,
        text: "Knowledge at one.",
      }),
      riskItem({
        tier: "unclassified",
        tierConfidence: undefined,
        kind: undefined,
        kindConfidence: undefined,
        text: "Oversize statement.",
        textTruncated: true,
      }),
    ]);
    const response = formatterResponse([review]);
    const before = JSON.stringify(response);
    const text = formatPackageUpgradeReviewTerminal(response, {
      terminalWidth: 200,
    });
    expect(text).toContain(
      "2 require action (+2 uncertain) | 2 should know (+2 uncertain) | 1 too long to classify",
    );
    expect(text).toContain("Requires action (2)");
    expect(text).toContain("Possibly requires action (2)");
    expect(text).toContain('(uncertain) "Possibly removed API."');
    expect(text).toContain('[removal] "Action at boundary."');
    expect(text).toContain('(uncertain) "Uncertain knowledge."');
    expect(text.indexOf("Confident knowledge.")).toBeLessThan(
      text.indexOf("Uncertain knowledge."),
    );
    expect(text).toContain("Too long to classify - read it (1)");
    expect(text).toContain('"Oversize statement."');
    expect(text).not.toContain('(uncertain) "Oversize statement."');
    expect(text).toContain("statement truncated by backend");
    expect(text).not.toContain("Unclassified - read if relevant");
    const colored = formatPackageUpgradeReviewTerminal(response, {
      useColors: true,
      terminalWidth: 200,
    });
    expect(colored).toContain("\x1b[2m(uncertain)\x1b[0m");
    expect(colored.replace(ANSI_SGR_PATTERN, "")).toBe(text);
    expect(JSON.stringify(response)).toBe(before);
  });

  it("ranks batches only by confident actions, preserving zero-count ties and JSON order", () => {
    const zero = riskReview([]);
    zero.name = "zero";
    const uncertain = riskReview([
      riskItem({ tierConfidence: 0.1 }),
      riskItem({ tierConfidence: 0.3 }),
    ]);
    uncertain.name = "uncertain";
    const confident = riskReview([riskItem({ tierConfidence: 0.4 })]);
    confident.name = "confident";
    const response = formatterResponse([zero, uncertain, confident]);
    for (const verbose of [false, true]) {
      const text = formatPackageUpgradeReviewTerminal(response, { verbose });
      expect(text.indexOf("npm:confident")).toBeLessThan(
        text.indexOf("npm:zero"),
      );
      expect(text.indexOf("npm:zero")).toBeLessThan(
        text.indexOf("npm:uncertain"),
      );
      expect(text).toContain("0 act (+2 uncertain)");
      expect(text).toContain("ranking uses only confident action counts");
    }
    expect(response.reviews.map((review) => review.name)).toEqual([
      "zero",
      "uncertain",
      "confident",
    ]);
  });

  it("combines coverage, brackets and colors optional kinds, and separates lexical matches", () => {
    const review = riskReview([
      riskItem({
        tier: "should_know",
        kind: "security_fix",
        text: "Fixed a vulnerability.",
      }),
      riskItem({
        tier: "should_know",
        kind: undefined,
        text: "Added a warning.",
      }),
    ]);
    const response = formatterResponse([review]);
    const plain = formatPackageUpgradeReviewTerminal(response, {
      terminalWidth: 200,
    });
    expect(plain).toContain(
      "Classification versions: 1 classified | 0 not assessed | 0 without notes | 56 statements labeled no impact\n",
    );
    expect(plain).toContain('* [security fix] "Fixed a vulnerability."');
    expect(plain).toContain('* "Added a warning."');
    expect(plain).not.toContain("[notable change]");
    expect(plain).toContain("    Keyword matches\n      * [breaking, removed]");
    expect(plain.indexOf("Keyword matches")).toBeGreaterThan(
      plain.indexOf("Added a warning."),
    );
    const colored = formatPackageUpgradeReviewTerminal(response, {
      terminalWidth: 200,
      useColors: true,
    });
    expect(colored).toContain(
      '\x1b[33m[security fix]\x1b[0m "Fixed a vulnerability."',
    );
    expect(colored.replace(ANSI_SGR_PATTERN, "")).toBe(plain);
  });

  it("renders the real Express range once per version with unique sources and no sample dump", () => {
    const review = formatterReview({
      changelog: expressChangelog as UpgradeChangelog,
    });
    const response = formatterResponse([review]);
    const before = JSON.stringify(response);
    for (const verbose of [false, true]) {
      const text = formatPackageUpgradeReviewTerminal(response, { verbose });
      const compact = text.replace(/\s+/g, " ");
      expect(
        [...text.matchAll(/^ {2}(5\.\d+\.\d+)$/gm)].map((match) => match[1]),
      ).toEqual(["5.2.1", "5.2.0", "5.1.0", "5.0.1"]);
      const urls = text.match(/https?:\/\/\S+/g) ?? [];
      expect(new Set(urls).size).toBe(urls.length);
      expect(text.split("IMPORTANT:")).toHaveLength(2);
      expect(text).toContain(
        "Keyword matches\n      * [breaking] matched quoted statement",
      );
      expect(text).not.toContain("Heuristic keywords:");
      expect(text).not.toContain("Keyword matches without excerpts:");
      expect(text.match(/^ {6}\* (?=.*")/gm)).toHaveLength(16);
      expect(compact).toContain(
        "0 require action (+8 uncertain) | 6 should know (+2 uncertain) | 0 too long to classify",
      );
      expect(text).toContain("Possibly requires action (6)");
      expect(text).not.toContain("    Requires action (");
      expect(compact).toContain('(uncertain) "deps: remove safe-buffer"');
      for (const entry of expressChangelog.entries.filter(
        (entry) => entry.htmlUrl,
      )) {
        expect(text).toContain(entry.htmlUrl!);
      }
      expect(compact).toContain(
        "There is no actual security vulnerability associated with this behavior",
      );
      expect(text).not.toContain("Sampled release entries");
      expect(text).not.toContain("Heuristic release entries");
      expect(text).not.toContain("Other release entries");
      expect(text).not.toContain("jev-1.13.0");
      expect(text).not.toContain("d-hier-v1");
      expect(text).toContain("Release notes (entry URL not returned)");
      expect(text).toContain("Changelog (entry URL not returned)");
      expect(compact).toContain(
        "4 classified | 0 not assessed | 0 without notes",
      );
      expect(compact).toContain("125 statements labeled no impact");
    }
    expect(JSON.stringify(response)).toBe(before);
  });

  it("suppresses only full keyword chunks covered by a same-source statement", () => {
    const body =
      "> [!IMPORTANT]\n> Breaking: removed an API. Read the migration guide.";
    const review = riskReview([riskItem({ text: body })]);
    const entry = {
      ...review.changelog.entries[0]!,
      body,
      signals: ["breaking", "removed"],
    };
    review.changelog.keywordEntries = [entry];
    const text = formatPackageUpgradeReviewTerminal(
      formatterResponse([review]),
    );
    expect(
      text.replace(/\s+/g, " ").split("Read the migration guide."),
    ).toHaveLength(2);
    expect(text).toContain(
      "Keyword matches\n      * [breaking, removed] matched quoted",
    );
    expect(
      text.replace(/\s+/g, " ").split("Read the migration guide."),
    ).toHaveLength(2);
    const otherSource = {
      ...entry,
      detailSource: "changelog_file",
      htmlUrl: "https://example.com/file",
    };
    review.changelog.keywordEntries = [entry, otherSource];
    const both = formatPackageUpgradeReviewTerminal(
      formatterResponse([review]),
    );
    expect(
      both.replace(/\s+/g, " ").split("Read the migration guide."),
    ).toHaveLength(3);
    expect(both).toContain("[breaking, removed]");
    expect(both).toContain("Changelog: https://example.com/file");
  });

  it("retains aggregate keyword evidence when its matching excerpts were not returned", () => {
    const review = riskReview([]);
    review.changelog.entries = [];
    review.changelog.sampledEntries = [];
    review.changelog.keywordEntries = [];
    review.changelog.breakingSignals = ["breaking"];
    review.changelog.migrationSignals = ["migration"];
    const text = formatPackageUpgradeReviewTerminal(
      formatterResponse([review]),
    );
    expect(text).toContain(
      "Keyword matches without excerpts: breaking, migration",
    );
    expect(text).not.toContain("Heuristic keywords:");
    review.changelog.breakingSignals = [];
    review.changelog.migrationSignals = [];
    review.changelog.totalKeywordEntries = 2;
    expect(
      formatPackageUpgradeReviewTerminal(formatterResponse([review])),
    ).toContain("Keyword matches without excerpts: 2 entries");
  });

  it("keeps additional keyword evidence and risk versions beyond the entry sample", () => {
    const review = riskReview([
      riskItem(),
      riskItem({ version: "4.0.0", text: "Old API removed." }),
    ]);
    review.changelog.keywordEntries = [
      {
        ...review.changelog.entries[0]!,
        body: "Removed different config setting.",
        signals: ["removed"],
      },
    ];
    const text = formatPackageUpgradeReviewTerminal(
      formatterResponse([review]),
    );
    expect(text).toContain('[removed] "Removed different config setting."');
    expect(text).toContain('"Old API removed."');
    expect(text.match(/^ {2}4\.0\.0$/gm)).toHaveLength(1);
    expect(text).toContain("Release notes (entry URL not returned)");
  });

  it("renders link labels as evidence and lists each URL once, retaining raw JSON", () => {
    const text =
      "- Removed `API` documented in [migration guide](https://example.com/guide). See https://example.com/guide.";
    const review = riskReview([riskItem({ text })]);
    review.changelog.keywordEntries = [];
    const before = JSON.stringify(review);
    const output = formatPackageUpgradeReviewTerminal(
      formatterResponse([review]),
    );
    expect(output).toContain(
      '"Removed API documented in migration guide [2]. See [2]."',
    );
    expect(output.split("https://example.com/guide")).toHaveLength(2);
    expect(JSON.stringify(review)).toBe(before);
    expect(review.changelog.riskItems[0]!.text).toBe(text);
  });

  it("distinguishes note-authored references from source citations in every note path", () => {
    const text = `See the [migration guide][1] and [reference][named] before upgrading. Footnote [3]. Link [2](https://example.com/numeric). ${"context ".repeat(50)}See https://example.com/clipped.`;
    const review = riskReview([
      riskItem({ tier: "should_know", text, heading: "Migration [3]" }),
    ]);
    review.changelog.keywordEntries = [
      {
        version: "4.4.2",
        detailSource: "changelog_file",
        signals: ["removed"],
        body: "Removed API; see [migration guide][1]. Footnote [3].",
      },
    ];
    review.changelog.entries.push({
      version: "4.4.1",
      detailSource: "releases",
      signals: [],
      bodyPreview: "See [documentation][docs]. Footnote [3].",
    });
    const before = JSON.stringify(review);
    const response = formatterResponse([review]);
    const compact = formatPackageUpgradeReviewTerminal(response);
    expect(compact.replace(/\s+/g, " ")).toContain(
      "See the migration guide and reference before upgrading. Footnote (3).",
    );
    expect(compact).toContain(
      '"Removed API; see migration guide. Footnote (3)."',
    );
    expect(compact).not.toContain("https://example.com/clipped");
    expect(compact).toContain("Link 2 [2].");
    const verbose = formatPackageUpgradeReviewTerminal(response, {
      verbose: true,
    });
    expect(verbose).toContain("heading: Migration (3)");
    expect(verbose).toContain('"See documentation. Footnote (3)."');
    expect(verbose).toContain("https://example.com/clipped");
    expect(JSON.stringify(review)).toBe(before);
  });

  it("omits in-note URLs clipped out of compact statement and keyword quotes", () => {
    const text = `Important change. ${"context ".repeat(50)}See [details](https://example.com/late).`;
    const review = riskReview([riskItem({ tier: "should_know", text })]);
    review.changelog.keywordEntries = [
      {
        version: "4.4.2",
        detailSource: "changelog_file",
        signals: ["removed"],
        body: `Removed something. ${"context ".repeat(50)}See https://example.com/late-keyword.`,
      },
    ];
    const response = formatterResponse([review]);
    const compact = formatPackageUpgradeReviewTerminal(response);
    expect(compact).toContain("https://example.com/release");
    expect(compact).not.toContain("https://example.com/late");
    const verbose = formatPackageUpgradeReviewTerminal(response, {
      verbose: true,
    });
    expect(verbose).toContain("https://example.com/late");
    expect(verbose).toContain("https://example.com/late-keyword");
    expect(review.changelog.riskItems[0]!.text).toBe(text);
  });

  it("omits classifier identifiers from batch text while preserving per-item JSON provenance", () => {
    const review = riskReview([
      riskItem({ formulation: "other-formulation" }),
      riskItem({ model: "other-model" }),
    ]);
    const response = formatterResponse([review, { ...review, name: "other" }]);
    for (const verbose of [false, true]) {
      const text = formatPackageUpgradeReviewTerminal(response, { verbose });
      expect(text).toContain("Classified by an agent.");
      expect(text).not.toContain("jev-1.13.0");
      expect(text).not.toContain("other-model");
      expect(text).not.toContain("d-hier-v1");
      expect(text).not.toContain("other-formulation");
    }
    expect(response.reviews[0]!.changelog.riskItems[0]!.model).toBe(
      "jev-1.13.0",
    );
    expect(response.reviews[0]!.changelog.riskItems[1]!.model).toBe(
      "other-model",
    );
  });

  it("shows tier, optional kind, full action quotes, matching source links and provenance", () => {
    const longText = `Removed an API. ${"evidence ".repeat(100)}END`;
    const review = riskReview([
      riskItem({ text: longText }),
      riskItem({
        tier: "should_know",
        kind: "deprecates_without_removal",
        text: `Deprecated API. ${"detail ".repeat(50)}KNOW_END`,
      }),
      riskItem({
        tier: "unclassified",
        tierConfidence: undefined,
        kind: undefined,
        kindConfidence: undefined,
        text: `Too long. ${"detail ".repeat(50)}READ_END`,
      }),
    ]);
    const text = formatPackageUpgradeReviewTerminal(
      formatterResponse([review]),
    );
    const compact = text.replace(/\s+/g, " ");
    expect(compact).toContain(longText.trim());
    expect(text).toContain("Requires action (1)");
    expect(text).toContain("Should know (1)");
    expect(text).toContain("Too long to classify - read it (1)");
    expect(text.indexOf("Requires action")).toBeLessThan(
      text.indexOf("Should know"),
    );
    expect(text.indexOf("Should know")).toBeLessThan(
      text.indexOf("Too long to classify - read it"),
    );
    expect(compact).toContain('[removal] "Removed an API.');
    expect(text).toContain("https://example.com/release");
    expect(text).toContain("Classified by an agent.");
    expect(text).not.toContain("jev-1.13.0");
    expect(text).not.toContain("d-hier-v1");
    expect(compact).toContain("Not a compatibility verdict.");
    expect(text).not.toContain("KNOW_END");
    expect(text).not.toContain("READ_END");
    expect(text.replace(/\s+/g, " ")).toContain(
      "Quotes ending in ... are excerpts; use verbose for full text.",
    );
    const verbose = formatPackageUpgradeReviewTerminal(
      formatterResponse([review]),
      { verbose: true },
    );
    expect(verbose).toContain("KNOW_END");
    expect(verbose).toContain("READ_END");
    expect(verbose).toContain("tier confidence: 0.98");
    expect(verbose).toContain("heading: Removed");
  });

  it("keeps source links unique, matches version and source exactly, and preserves Unicode in excerpts", () => {
    const review = riskReview([
      riskItem(),
      riskItem({ text: "Removed another API." }),
      riskItem({ source: "changelog_file", text: "Other source." }),
      riskItem({ version: "4.4.2", text: "Other version." }),
      riskItem({
        tier: "unclassified",
        tierConfidence: undefined,
        kind: undefined,
        kindConfidence: undefined,
        text: `${"x".repeat(239)}😀TAIL`,
      }),
    ]);
    const text = formatPackageUpgradeReviewTerminal(
      formatterResponse([review]),
    ).split("\nDependencies\n")[0]!;
    expect(text.match(/https:\/\/example.com\/release/g)).toHaveLength(1);
    expect(text).not.toContain("Statement sources");
    expect(text).toContain("Changelog (entry URL not returned)");
    expect(text).toContain('😀..."');
    expect(text).not.toContain("TAIL");
    expect(text).not.toContain("4.4.2 [releases] https:");
    expect(text).not.toContain("4.4.3 [changelog_file] https:");
  });

  it("keeps reported unknowns separate from pending classification in the batch summary", () => {
    const pending = riskReview([]);
    pending.unknowns = [];
    pending.changelog.riskCoverage.versionsNotAssessed = 4;
    const complete = riskReview();
    complete.unknowns = [];
    const response = formatterResponse([pending, complete]);
    response.summary.withUnknowns = 0;
    const text = formatPackageUpgradeReviewTerminal(response).replace(
      /\s+/g,
      " ",
    );
    expect(text).toContain("0 with reported unknowns");
    expect(text).toContain("1 with classification coverage gaps");
    expect(text).not.toContain("0 with evidence gaps");
    expect(response.summary.withUnknowns).toBe(0);
  });

  it("reports required coverage, zero items and entirely unassessed ranges", () => {
    const review = riskReview([]);
    review.changelog.riskCoverage = {
      versionsClassified: 0,
      versionsNotAssessed: 20,
      versionsWithoutNotes: 2,
      versionsUnparseable: 1,
      unitsNoImpact: 0,
      itemsOmitted: 0,
    };
    const text = formatPackageUpgradeReviewTerminal(
      formatterResponse([review]),
    ).replace(/\s+/g, " ");
    expect(text).toContain(
      "0 classified | 20 not assessed | 2 without notes | 1 unparseable",
    );
    expect(text).toContain("0 statements labeled no impact");
    expect(text.replace(/\s+/g, " ")).toContain(
      "Rerun in a few seconds to a minute",
    );
    expect(text).toContain(
      "Missing or unparseable notes are not evidence of no risk",
    );
    expect(text).not.toContain("Requires action");
    expect(text).not.toMatch(/\bsafe\b/);
    review.changelog.riskCoverage.versionsNotAssessed = 0;
    const empty = formatPackageUpgradeReviewTerminal(
      formatterResponse([review]),
    );
    expect(empty).not.toContain("Rerun to fill");
    expect(empty).toContain("0 statements labeled no impact");
  });

  it("distinguishes omitted items and backend-truncated quotes from local excerpts", () => {
    const review = riskReview([
      riskItem({
        text: "X".repeat(1000),
        textTruncated: true,
        kind: undefined,
        kindConfidence: undefined,
      }),
    ]);
    review.changelog.riskCoverage.itemsOmitted = 7;
    const text = formatPackageUpgradeReviewTerminal(
      formatterResponse([review]),
    );
    expect(text).toContain("7 statements omitted by backend");
    expect(text).toContain("[statement truncated by backend]");
    expect(text).toContain("X".repeat(1000));
    expect(text).not.toContain("[excerpt;");
    expect(text).not.toContain("undefined");
  });

  it("sanitizes new release-note text and metadata only at presentation, without mismatched links", () => {
    const terminalEscape = String.fromCharCode(27);
    const review = riskReview([
      riskItem({
        text: `quote ${terminalEscape}[31mred${terminalEscape}[0m 漢字\nnext\tword\u0000`,
        version: `4.4.3${terminalEscape}[2J`,
        heading: `Removed${terminalEscape}[2J`,
        source: `changelog_file${terminalEscape}[2J`,
        model: `jev${terminalEscape}[2J`,
        formulation: `d${terminalEscape}[2J`,
      }),
    ]);
    const before = JSON.stringify(review);
    const text = formatPackageUpgradeReviewTerminal(
      formatterResponse([review]),
      { verbose: true, terminalWidth: 40 },
    );
    expect(text).not.toContain(terminalEscape);
    expect(text).not.toContain("\u0000");
    expect(text.replace(/\s+/g, " ")).toContain("quote red 漢字 next word");
    expect(text).toContain("changelog_file (entry URL not returned)");
    expect(text).toContain("Notes:");
    expect(JSON.stringify(review)).toBe(before);
  });

  it("retains peer changes and compatibility notes in default batch triage", () => {
    const changed = riskReview();
    changed.compatibility = {
      peerDependencyChanges: ["react: ^18 -> ^19"],
      notes: ["Runtime requirement changed", "Peer support changed"],
    };
    const unchecked = riskReview([]);
    unchecked.compatibility = undefined;
    const text = formatPackageUpgradeReviewTerminal(
      formatterResponse([changed, unchecked]),
    );
    expect(text).toContain("1 peer dependency changes | 2 compatibility notes");
    expect(text).toContain(
      "not checked peer dependency changes | not checked compatibility notes",
    );
    expect(text).not.toContain("Runtime requirement changed");
    const verbose = formatPackageUpgradeReviewTerminal(
      formatterResponse([changed, unchecked]),
      { verbose: true },
    );
    expect(verbose).toContain("react: ^18 -> ^19");
    expect(verbose).toContain("Runtime requirement changed");
  });

  it("renders sorted batch triage once per package, honest coverage and verbose detail without mutating JSON order", () => {
    const noItems = riskReview([]);
    noItems.name = "none";
    noItems.changelog.riskCoverage.versionsClassified = 0;
    noItems.changelog.riskCoverage.versionsNotAssessed = 2;
    const one = riskReview();
    one.name = "one";
    const two = riskReview([
      riskItem(),
      riskItem({ text: "Removed other API." }),
    ]);
    two.name = "two";
    two.changelog.riskCoverage.itemsOmitted = 4;
    const response = formatterResponse([noItems, one, two]);
    const text = formatPackageUpgradeReviewTerminal(response);
    expect(text.indexOf("npm:two")).toBeLessThan(text.indexOf("npm:one"));
    expect(text.indexOf("npm:one")).toBeLessThan(text.indexOf("npm:none"));
    expect(
      text.split("\n").filter((line) => line.includes("npm:two")),
    ).toHaveLength(1);
    expect(text).toContain("2 act | 0 know | 0 too long to classify");
    expect(text).toContain("0 classified"); // pending coverage independently returned
    expect(text.replace(/\s+/g, " ")).toContain(
      "Rerun in a few seconds to a minute",
    );
    expect(text.replace(/\s+/g, " ")).toContain(
      "1 with classification coverage gaps",
    );
    expect(text).not.toContain("Requires action (");
    expect(text).toContain("verbose");
    expect(response.reviews.map((review) => review.name)).toEqual([
      "none",
      "one",
      "two",
    ]);
    const verbose = formatPackageUpgradeReviewTerminal(response, {
      verbose: true,
    });
    expect(verbose).toContain('"Removed other API."');
    expect(verbose).toContain("Security");
  });
});
