import { describe, expect, it, mock } from "bun:test";
import type { PackageUpgradeReviewResponse } from "@githits/core-internal";
import { createMockPackageIntelligenceService } from "../services/test-helpers.js";
import expressChangelog from "./fixtures/upgrade-review-express-changelog.json";
import type { LeanChangelogStatement } from "./package-changelog-response.js";
import { normaliseChangelogStatements } from "./package-changelog-response.js";
import type { UpgradeChangelogSelection } from "./package-upgrade-review-request.js";
import { buildPackageUpgradeReviewRequest } from "./package-upgrade-review-request.js";
import type {
  UpgradeChangelog,
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
        statements: {
          totalCount: 0,
          matchingCount: 0,
          items: [],
          coverage: [
            {
              version: "4.4.3",
              status: "CLASSIFIED",
              statementsTotal: 0,
              statementsAssessed: 0,
              statementsNotAssessed: 0,
              statementsNoImpact: 0,
              statementsUnclassified: 0,
            },
          ],
        },
        riskCoverage: {
          versionsClassified: 0,
          versionsNotAssessed: 0,
          versionsWithoutNotes: 0,
          versionsUnparseable: 0,
          unitsNoImpact: 0,
          itemsMustActConfident: 0,
          itemsMustActAmbiguous: 0,
          itemsShouldKnowConfident: 0,
          itemsShouldKnowAmbiguous: 0,
          itemsUnclassified: 0,
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
    entry: NonNullable<typeof review.changelog.entries>[number],
  ): NonNullable<UpgradeReview["changelog"]["entries"]>[number] => ({
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
      riskCoverage: { ...review.changelog.riskCoverage },
      statements: {
        ...normaliseChangelogStatements(review.changelog.statements!),
        selection: "focused",
      },
      source: "releases",
      fallback: undefined,
      entries: review.changelog.entries!.map(normalizeEntry),
      sampledEntries: review.changelog.sampledEntries!.map(normalizeEntry),
      keywordEntries: review.changelog.keywordEntries!.map(normalizeEntry),
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
    expect(text).toContain("[breaking, removed] Breaking: removed an API.");
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
                ...formatterReview().changelog.entries![0]!,
                htmlUrl: "https://example.com/releases/4.4.3",
              },
            ],
            keywordEntries: [
              {
                ...formatterReview().changelog.keywordEntries![0]!,
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

function statementReview(
  items: LeanChangelogStatement[],
  selection: UpgradeChangelogSelection = "focused",
): UpgradeReview {
  const review = formatterReview();
  review.changelog.statements = {
    selection,
    count: items.length,
    totalCount: items.length,
    matchingCount: items.length,
    items,
    coverage: [
      {
        version: "4.4.3",
        status: "classified",
        statementsTotal: items.length,
        statementsAssessed: items.length,
        statementsNotAssessed: 0,
        statementsNoImpact: 0,
        statementsUnclassified: 0,
      },
    ],
  };
  review.changelog.entries = [];
  review.changelog.sampledEntries = [];
  review.changelog.keywordEntries = [];
  review.changelog.breakingSignals = [];
  review.changelog.migrationSignals = [];
  return review;
}
function unit(
  position = 0,
  tier = "must_act",
  ambiguous = false,
): LeanChangelogStatement {
  return {
    version: "4.4.3",
    position,
    sourceIndex: 0,
    sourcePosition: position,
    text: `* Evidence ${position}`,
    textTruncated: false,
    fullText: `Full evidence ${position}`,
    heading: "Changes",
    source: "releases",
    url: "https://example.com/notes",
    classification: {
      tier,
      ambiguous,
      kind: "changes_behavior_or_default",
      tierConfidence: 0.01,
      model: "jev",
      formulation: "v3",
    },
  };
}

describe("complete upgrade statement presentation", () => {
  it("renders captured complete Express evidence with source order and whole-range counts", () => {
    const review = formatterReview({
      changelog: expressChangelog as UpgradeChangelog,
    });
    const text = formatPackageUpgradeReviewTerminal(
      formatterResponse([review]),
    );
    expect(text).toContain("0 require action (+8 uncertain)");
    expect(text).toContain("6 should know (+1 uncertain)");
    expect(text).toContain("15 matching statements of 141 parsed");
    expect(text.match(/^ {2}5\.2\.1/gm)).toHaveLength(1);
    expect(text).toContain("[!behavior] (uncertain)");
  });
  it("keeps one version and nearby sources in backend source order, without preview dumps", () => {
    const a = unit();
    const b = {
      ...unit(1, "should_know"),
      sourceIndex: 1,
      source: "changelog_file",
      url: "https://example.com/History.md",
      heading: "Security",
    };
    const review = statementReview([a, b]);
    review.changelog.entries = [
      { version: "4.4.3", bodyPreview: "DUPLICATE PREVIEW", signals: [] },
    ];
    const text = formatPackageUpgradeReviewTerminal(
      formatterResponse([review]),
    );
    expect(text.match(/^ {2}4\.4\.3/gm)).toHaveLength(1);
    expect(text).not.toContain("DUPLICATE PREVIEW");
    expect(
      text.indexOf("Release notes: https://example.com/notes"),
    ).toBeLessThan(text.indexOf("Evidence 0"));
    expect(text.indexOf("Evidence 0")).toBeLessThan(
      text.indexOf("Changelog: https://example.com/History.md"),
    );
    expect(text).not.toContain("Sources\n");
    expect(text).not.toContain("Requires action (");
  });
  it("uses ambiguity alone, with optional kinds and no-impact plain bullets", () => {
    const a = unit();
    const b = unit(1, "should_know", true);
    b.classification!.tierConfidence = 0.99;
    const c = unit(2);
    delete c.classification!.kind;
    const d = unit(3, "should_know");
    delete d.classification!.kind;
    const n = unit(4, "no_impact");
    const u = unit(5);
    u.classification = null;
    const o = unit(6, "unclassified");
    const text = formatPackageUpgradeReviewTerminal(
      formatterResponse([statementReview([a, b, c, d, n, u, o], "all")]),
    );
    expect(text).toContain("* [!behavior] Evidence 0");
    expect(text).toContain("* [behavior] (uncertain) Evidence 1");
    expect(text).toContain("* [!] Evidence 2");
    expect(text).toContain("* [should know] Evidence 3");
    expect(text).toContain("* Evidence 4");
    expect(text).toContain("* [not assessed] Evidence 5");
    expect(text).toContain("* [too long to classify - read it] Evidence 6");
    expect(text.match(/\(uncertain\)/g)).toHaveLength(1);
  });
  it("uses color as an aid while uncertain annotations stay muted", () => {
    const response = formatterResponse([
      statementReview([
        unit(),
        unit(1, "should_know"),
        unit(2, "must_act", true),
      ]),
    ]);
    const plain = formatPackageUpgradeReviewTerminal(response);
    const color = formatPackageUpgradeReviewTerminal(response, {
      useColors: true,
    });
    expect(stripAnsi(color)).toBe(plain);
    expect(color).toContain("\x1b[31m[!behavior]");
    expect(color).toContain("\x1b[33m[behavior]");
    expect(color).toContain("\x1b[2m[!behavior]");
  });
  it("keeps action quotes full, excerpts other tiers by Unicode characters and expands bounded text with verbose", () => {
    const action = unit();
    action.text = `* ${"🚀".repeat(260)}ACTION_END`;
    const note = unit(1, "should_know");
    note.text = `* ${"🚀".repeat(260)}NOTE_END`;
    const response = formatterResponse([statementReview([action, note])]);
    const compact = formatPackageUpgradeReviewTerminal(response);
    const verbose = formatPackageUpgradeReviewTerminal(response, {
      verbose: true,
    });
    expect(compact).toContain("ACTION_END");
    expect(compact).not.toContain("NOTE_END");
    expect(compact).toContain("Excerpt; use verbose");
    expect(compact).not.toContain("�");
    expect(verbose).toContain("NOTE_END");
    expect(verbose).not.toContain("Full evidence");
  });
  it("marks backend truncation separately and preserves predecessor context", () => {
    const item = unit();
    item.textTruncated = true;
    item.context = {
      heading: "Important",
      text: "* Parent context\n  * Nested detail",
      textTruncated: true,
      fullText: "UNSELECTED FULL CONTEXT",
    };
    const text = formatPackageUpgradeReviewTerminal(
      formatterResponse([statementReview([item])]),
    );
    expect(text).toContain("Parent context");
    expect(text).toContain("Nested detail");
    expect(text).toContain("Statement truncated; use --json for full text");
    expect(text).toContain("Context truncated");
    expect(text).not.toContain("UNSELECTED FULL CONTEXT");
  });
  it.each(["focused", "actionable", "important", "all"] as const)(
    "always discloses effective selection %s even with no items",
    (selection) => {
      const review = statementReview([], selection);
      review.changelog.riskCoverage.versionsNotAssessed = 4;
      review.changelog.riskCoverage.unitsNoImpact = 20;
      review.changelog.riskCoverage.itemsUnclassified = 2;
      review.changelog.statements!.coverage[0]!.status = "not_assessed";
      review.changelog.statements!.coverage[0]!.statementsNotAssessed = 6;
      const text = formatPackageUpgradeReviewTerminal(
        formatterResponse([review]),
      );
      expect(text).toContain(`Selection: ${selection}`);
      expect(text).toContain("4 not assessed");
      expect(text).toContain("Rerun");
      expect(text.includes("Filter excludes")).toBe(selection !== "all");
      expect(text).not.toMatch(/\bsafe\b/i);
    },
  );
  it("shows zero-note and unparseable versions without treating them as no impact", () => {
    const review = statementReview([]);
    const cov = review.changelog.statements!.coverage[0]!;
    cov.status = "without_notes";
    review.changelog.riskCoverage.versionsWithoutNotes = 1;
    const text = formatPackageUpgradeReviewTerminal(
      formatterResponse([review]),
    );
    expect(text).toContain("No release notes available");
    expect(text).toContain("not evidence of no risk");
    cov.status = "unparseable";
    expect(
      formatPackageUpgradeReviewTerminal(formatterResponse([review])),
    ).toContain("Notes contain no parsed statements");
  });
  it("preserves beyond-preview keyword excerpts and suppresses only quoted same-source chunks", () => {
    const item = unit();
    item.text = "* Removed the old API";
    const review = statementReview([item]);
    review.changelog.keywordEntries = [
      {
        version: "4.4.3",
        detailSource: "releases",
        bodyPreview: "Unrelated",
        body: "* Removed the old API\n* Breaking default after a long note",
        signals: ["removed", "breaking"],
        htmlUrl: "https://example.com/notes",
      },
    ];
    const text = formatPackageUpgradeReviewTerminal(
      formatterResponse([review]),
    );
    expect(text.match(/Removed the old API/g)).toHaveLength(1);
    expect(text).toContain("Keyword matches (lexical evidence)");
    expect(text).toContain("Breaking default after a long note");
    review.changelog.keywordEntries[0]!.detailSource = "changelog_file";
    expect(
      formatPackageUpgradeReviewTerminal(formatterResponse([review])).match(
        /Removed the old API/g,
      ),
    ).toHaveLength(2);
  });
  it("preserves unversioned keyword facts, bounded quotes and aggregate missing-excerpt counts", () => {
    const review = statementReview([]);
    review.changelog.keywordEntries = [
      {
        version: null,
        body: `* Breaking ${"x".repeat(280)}END`,
        signals: ["breaking"],
        htmlUrl: "https://example.com/unversioned",
      },
    ];
    const response = formatterResponse([review]);
    const compact = formatPackageUpgradeReviewTerminal(response);
    expect(compact).toContain("(unversioned)");
    expect(compact).toContain("https://example.com/unversioned");
    expect(compact).not.toContain("END");
    expect(compact).toContain("full keyword quote");
    expect(
      formatPackageUpgradeReviewTerminal(response, { verbose: true }),
    ).toContain("END");
    review.changelog.keywordEntries = [];
    review.changelog.totalKeywordEntries = 4;
    expect(formatPackageUpgradeReviewTerminal(response)).toContain(
      "Keyword matches without excerpts: 4 matching entries",
    );
  });
  it("nests source groups under versions and shows keyword-only sources once", () => {
    const review = statementReview([unit()]);
    review.changelog.entries = [
      { version: "4.4.4", htmlUrl: "https://example.com/keyword-only" },
    ];
    review.changelog.keywordEntries = [
      {
        version: "4.4.4",
        htmlUrl: "https://example.com/keyword-only",
        body: "* Breaking keyword-only change",
        signals: ["breaking"],
      },
    ];
    const text = formatPackageUpgradeReviewTerminal(
      formatterResponse([review]),
    );
    expect(text).toContain("\n  4.4.3\n    Release notes:");
    expect(text.match(/https:\/\/example.com\/keyword-only/g)).toHaveLength(1);
    expect(text).toContain("* [breaking] Breaking keyword-only change");
    expect(text).not.toContain("[breaking] * Breaking");
  });
  it("sanitizes release text, metadata, context and URLs while JSON remains faithful", () => {
    const item = unit();
    item.text = "* raw\x1b[31m quote";
    item.url = "https://example.com/notes\x1b[31m";
    item.heading = "heading\x1b[31m";
    item.context = { text: "context\x1b[31m", textTruncated: false };
    const review = statementReview([item]);
    review.changelog.entries = [
      {
        version: "4.4.4",
        htmlUrl: "https://example.com/entry\x1b]8;;evil\x07",
      },
    ];
    review.changelog.keywordEntries = [
      {
        version: "4.4.4",
        htmlUrl: "https://example.com/keyword\x1b[2J",
        body: "* Breaking \x1b[31m keyword quote",
        signals: ["breaking", "removed\x1b[2J"],
      },
    ];
    review.changelog.breakingSignals = ["breaking", "extra\x1b[2J"];
    const response = formatterResponse([review]);
    const text = formatPackageUpgradeReviewTerminal(response);
    expect(text).toContain("keyword quote");
    expect(text).toContain("https://example.com/entry");
    expect(text).toContain("https://example.com/keyword");
    expect(text).toContain("extra");
    expect(text).not.toContain("\x07");
    expect(text).not.toContain("\x1b");
    expect(JSON.stringify(response)).toContain("\\u001b");
  });
  it("uses whole-range counters for batch ranking and never mutates JSON order", () => {
    const first = statementReview([unit()]);
    first.name = "first";
    first.changelog.riskCoverage.itemsMustActConfident = 1;
    first.changelog.riskCoverage.itemsMustActAmbiguous = 20;
    const second = statementReview([], "actionable");
    second.name = "second";
    second.changelog.riskCoverage.itemsMustActConfident = 13;
    second.changelog.riskCoverage.itemsMustActAmbiguous = 28;
    const response = formatterResponse([first, second]);
    response.filter = { changes: "actionable" };
    const text = formatPackageUpgradeReviewTerminal(response);
    expect(text.indexOf("npm:second")).toBeLessThan(text.indexOf("npm:first"));
    expect(text).toContain("13 act (+28 uncertain)");
    expect(text).toContain("applies to detailed reports");
    expect(text).not.toContain("Evidence 0");
    expect(response.reviews[0]!.name).toBe("first");
    expect(
      formatPackageUpgradeReviewTerminal(response, { verbose: true }),
    ).toContain("Evidence 0");
  });
  it("retains complete normalized JSON evidence and explicit-only filter echo", async () => {
    const backend = structuredClone(backendResponse);
    backend.reviews[0]!.changelog.statements = {
      totalCount: 2,
      matchingCount: 2,
      items: [
        {
          ...unit(),
          classification: {
            tier: "MUST_ACT",
            ambiguous: false,
            kind: "CHANGES_BEHAVIOR_OR_DEFAULT",
            tierConfidence: 0.01,
            model: "old",
            formulation: "v2",
          },
        },
        { ...unit(1), classification: null },
      ],
      coverage: [],
    };
    const service = createMockPackageIntelligenceService({
      packageUpgradeReview: mock(async () => backend),
    });
    const request = buildPackageUpgradeReviewRequest({
      registry: "npm",
      packageName: "zod",
      currentVersion: "4.3.6",
      targetVersion: "4.4.3",
      changes: "all",
    });
    const result = await buildPackageUpgradeReview(service, request.packages, {
      ...request.options,
      changelogView: "json",
    });
    expect(result.filter).toEqual({ changes: "all" });
    expect(result.reviews[0]!.changelog.statements).toMatchObject({
      selection: "all",
      count: 2,
      items: [
        {
          source: "releases",
          classification: {
            tier: "must_act",
            tierConfidence: 0.01,
            model: "old",
            formulation: "v2",
          },
        },
        { classification: null },
      ],
    });
    expect(JSON.stringify(result)).not.toContain('"riskItems"');
    expect(JSON.stringify(result)).not.toContain('"itemsOmitted"');
    delete request.options.explicitChanges;
    expect(
      (
        await buildPackageUpgradeReview(
          service,
          request.packages,
          request.options,
        )
      ).filter,
    ).toBeUndefined();
  });
});
