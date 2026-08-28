import { describe, expect, it, mock } from "bun:test";
import type { PackageUpgradeReviewResponse } from "@githits/core-internal";
import { createMockPackageIntelligenceService } from "../services/test-helpers.js";
import { buildPackageUpgradeReviewRequest } from "./package-upgrade-review-request.js";
import type {
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
    expect(text).toContain(
      "Repository releases | 1 entry | 1 with release notes",
    );
    expect(text).toContain("Heuristic signals: breaking | 1 matching entry");
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
    });

    expect(
      text.startsWith("Upgrade review - 2 packages\nAcross packages: "),
    ).toBe(true);
    const aggregateClauses = [
      "1 with evidence gaps",
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
      "Package versions (no release notes) | 0 entries | 0 with release notes",
    );
    expect(
      makeText({ ...base.changelog, source: "hexdocs", fallback: undefined }),
    ).toContain("hexdocs | 1 entry | 1 with release notes");
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
    const text = formatPackageUpgradeReviewTerminal(
      {
        summary: backendResponse.summary,
        reviews: [
          {
            ...base,
            dependencyIssues: {
              currentTotal: 1,
              targetTotal: 4,
              introducedDeprecated: [
                "npm:deprecated-one@1.0.0",
                "npm:deprecated-two@1.0.0",
              ],
              introducedDuplicates: ["npm:duplicate-one@1.0.0"],
              introducedConflicts: [],
              introducedOutdated: [],
            },
          },
        ],
      },
      { terminalWidth: 20 },
    );
    expect(text).toContain(
      "Introduced deprecated\n    - npm:deprecated-one@1.0.0\n    - npm:deprecated-two@1.0.0",
    );
    expect(text).not.toContain("deprecated-one@1.0.0, npm:deprecated-two");
    expect(text).toContain(
      "Introduced duplicates\n    - npm:duplicate-one@1.0.0",
    );
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
      "    - 5.2.1 (2025-12-01T20:49:43.268Z)\n      https://github.com/expressjs/express/releases/tag/v5.2.1",
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
            },
          }),
        ]),
        { terminalWidth: 80 },
      ),
    );
    expect(ordinary).toContain(
      "Sampled release entries\n    - 5.2.1 (2025-12-01T20:49:43.268Z)\n      https://github.com/expressjs/express/releases/tag/v5.2.1",
    );
    expect(
      Math.max(
        ...ordinary
          .split("\n")
          .filter((line) => line.length > 0)
          .map((line) => line.length),
      ),
    ).toBeLessThanOrEqual(80);

    const overlongUrl = "https://example.com/releases/" + "x".repeat(80);
    const overlongCoordinate = "transitive-" + "x".repeat(80);
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
    expect(plain).not.toContain("⚠");
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
