import { describe, expect, it } from "bun:test";
import type { VulnerabilityReport } from "@githits/core-internal";
import { defaultVulnerabilityReport } from "../services/test-helpers.js";
import {
  buildPackageVulnerabilitiesSuccessPayload,
  compareVersionsAscending,
  computeBySeverity,
  DEFAULT_ADVISORY_CAP,
  dedupAdvisoriesByAlias,
  formatPackageVulnerabilitiesTerminal,
  vulnSeverityLabel,
} from "./package-vulnerabilities-response.js";

const ESC = "\u001b";
const ANSI_SGR_PATTERN = new RegExp(`${ESC}\\[[0-9;]*m`, "g");

function stripAnsi(value: string): string {
  return value.replace(ANSI_SGR_PATTERN, "");
}

function containsTerminalControl(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return (code >= 0 && code <= 0x1f) || (code >= 0x7f && code <= 0x9f);
  });
}

function cloneFixture(): VulnerabilityReport {
  return structuredClone(defaultVulnerabilityReport);
}

function zeroVulnsFixture(): VulnerabilityReport {
  return {
    package: { name: "clean", registry: "NPM", version: "1.0.0" },
    security: {
      affectedVulnerabilityCount: 0,
      nonAffectingVulnerabilityCount: 0,
      allVulnerabilityCount: 0,
      currentVersionAffected: false,
      upgradePaths: [],
      vulnerabilities: [],
    },
  };
}

function transitiveVulnerabilityFixture(): VulnerabilityReport {
  return {
    package: { name: "express", registry: "NPM", version: "5.2.1" },
    security: {
      affectedVulnerabilityCount: 0,
      nonAffectingVulnerabilityCount: 0,
      allVulnerabilityCount: 0,
      currentVersionAffected: false,
      vulnerabilities: [],
      upgradePaths: [],
    },
    transitive: {
      totalPackagesAnalyzed: 49,
      affectedPackageCount: 3,
      affectedOccurrenceCount: 7,
      calculatedAt: "2025-01-01T12:00:00Z",
      packages: [
        {
          registry: "PYPI",
          name: "zeta",
          affectedOccurrenceCount: 2,
          occurrences: [
            {
              version: "2.0.0",
              affectsResolvedVersion: true,
              matchedAffectedVersionRanges: [">= 1.0.0, < 2.1.0"],
              fixVersionsAboveResolved: ["2.1.0"],
              nearestFixedVersion: "2.1.0",
              advisory: {
                osvId: "GHSA-zeta-medium",
                aliases: [],
                summary: "Medium zeta issue",
                severityScore: 5.5,
                publishedAt: "2024-03-01T00:00:00Z",
                modifiedAt: "2024-03-02T00:00:00Z",
              },
            },
            {
              version: "2.0.0",
              affectsResolvedVersion: true,
              matchedAffectedVersionRanges: ["< 2.0.2"],
              fixVersionsAboveResolved: ["2.0.2"],
              nearestFixedVersion: "2.0.2",
              advisory: {
                osvId: "GHSA-zeta-low",
                summary: "Low zeta issue",
                severityScore: 1.1,
                publishedAt: "2024-02-01T00:00:00Z",
                modifiedAt: "2024-02-01T00:00:00Z",
              },
            },
          ],
        },
        {
          registry: "NPM",
          name: "body-parser",
          affectedOccurrenceCount: 3,
          occurrences: [
            {
              version: "1.19.0",
              affectsResolvedVersion: true,
              matchedAffectedVersionRanges: [">= 1.0.0, < 2.0.0"],
              fixVersionsAboveResolved: ["2.0.0"],
              nearestFixedVersion: "2.0.0",
              advisory: {
                osvId: "GHSA-body-mal",
                aliases: ["CVE-shared", "CVE-malware"],
                summary: "Malware body-parser issue",
                severityScore: 9.8,
                publishedAt: "2024-05-01T00:00:00Z",
                modifiedAt: "2024-05-01T00:00:00Z",
                isMalicious: true,
              },
            },
            {
              version: "1.19.0",
              affectsResolvedVersion: true,
              matchedAffectedVersionRanges: [">= 1.0.0, < 1.20.3"],
              fixVersionsAboveResolved: ["1.20.3", "2.0.0"],
              nearestFixedVersion: "1.20.3",
              advisory: {
                osvId: "GHSA-body-high",
                aliases: ["CVE-shared"],
                summary: "High body-parser issue",
                severityScore: 8.0,
                publishedAt: "2024-04-01T00:00:00Z",
                modifiedAt: "2024-06-02T00:00:00Z",
              },
            },
            {
              version: "1.19.1",
              affectsResolvedVersion: true,
              matchedAffectedVersionRanges: ["< 1.19.2"],
              fixVersionsAboveResolved: [],
              advisory: {
                aliases: ["CVE-unrated"],
                summary: "No score body-parser issue",
                publishedAt: "2024-01-01T00:00:00Z",
              },
            },
          ],
        },
        {
          registry: "NPM",
          name: "accepts",
          affectedOccurrenceCount: 2,
          occurrences: [
            {
              version: "1.3.8",
              affectsResolvedVersion: true,
              matchedAffectedVersionRanges: ["< 1.3.9"],
              fixVersionsAboveResolved: ["1.3.9"],
              nearestFixedVersion: "1.3.9",
              advisory: {
                osvId: "GHSA-accept-critical",
                summary: "Critical accepts issue",
                severityScore: 9.1,
                publishedAt: "2024-07-01T00:00:00Z",
              },
            },
            {
              version: "1.3.8",
              affectsResolvedVersion: true,
              matchedAffectedVersionRanges: ["< 1.3.9"],
              fixVersionsAboveResolved: ["1.3.9"],
              nearestFixedVersion: "1.3.9",
              advisory: {
                osvId: "GHSA-accept-low",
                summary: "Low accepts issue",
                severityScore: 3.2,
                publishedAt: "2024-01-15T00:00:00Z",
              },
            },
          ],
        },
      ],
    },
  };
}

describe("vulnSeverityLabel — CVSS banding", () => {
  it("lands at locked boundaries", () => {
    expect(vulnSeverityLabel(0.1)).toBe("low");
    expect(vulnSeverityLabel(3.9)).toBe("low");
    expect(vulnSeverityLabel(4.0)).toBe("medium");
    expect(vulnSeverityLabel(6.9)).toBe("medium");
    expect(vulnSeverityLabel(7.0)).toBe("high");
    expect(vulnSeverityLabel(8.9)).toBe("high");
    expect(vulnSeverityLabel(9.0)).toBe("critical");
    expect(vulnSeverityLabel(10.0)).toBe("critical");
  });

  it("returns undefined for null / zero / negative", () => {
    expect(vulnSeverityLabel(undefined)).toBeUndefined();
    expect(vulnSeverityLabel(null)).toBeUndefined();
    expect(vulnSeverityLabel(0)).toBeUndefined();
    expect(vulnSeverityLabel(-1)).toBeUndefined();
  });
});

describe("computeBySeverity — partitioning buckets", () => {
  it("counts malicious advisories only in the malware bucket; buckets partition total", () => {
    const advisories = cloneFixture().security?.vulnerabilities ?? [];
    const histogram = computeBySeverity(advisories);
    expect(histogram).toEqual({
      malware: 1,
      critical: 1,
      high: 1,
      medium: 1,
      low: 1,
      unrated: 1,
    });
    // Every advisory lands in exactly one bucket — the sum equals total.
    const total =
      defaultVulnerabilityReport.security?.affectedVulnerabilityCount ?? 0;
    const bucketSum =
      histogram.malware +
      histogram.critical +
      histogram.high +
      histogram.medium +
      histogram.low +
      histogram.unrated;
    expect(bucketSum).toBe(total);
  });

  it("malicious + high advisory counts only in malware bucket", () => {
    const histogram = computeBySeverity([
      { severityScore: 8.0, isMalicious: true },
    ]);
    expect(histogram.malware).toBe(1);
    expect(histogram.high).toBe(0);
  });

  it("null-severity non-malicious advisory counts as unrated", () => {
    const histogram = computeBySeverity([
      { severityScore: null as unknown as number, isMalicious: false },
    ]);
    expect(histogram).toEqual({
      malware: 0,
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      unrated: 1,
    });
  });
});

describe("buildPackageVulnerabilitiesSuccessPayload — happy path", () => {
  it("shapes the full envelope from the default fixture", () => {
    const payload = buildPackageVulnerabilitiesSuccessPayload(
      defaultVulnerabilityReport,
    );
    expect(payload.registry).toBe("npm");
    expect(payload.name).toBe("express");
    expect(payload.version).toBe("4.18.0");
    expect(payload.summary.total).toBe(6);
    expect(payload.summary.affectedVulnerabilityCount).toBe(6);
    expect(payload.summary.nonAffectingVulnerabilityCount).toBe(0);
    expect(payload.summary.allVulnerabilityCount).toBe(6);
    expect(payload.summary.affected).toBe(true);
    expect(payload.summary.bySeverity).toEqual({
      malware: 1,
      critical: 1,
      high: 1,
      medium: 1,
      low: 1,
      unrated: 1,
    });
    expect(payload.advisories?.length).toBe(6);
    expect(payload.advisories?.[0]?.affectsInspectedVersion).toBe(true);
    expect(payload.advisories?.[0]?.matchedAffectedVersionRanges).toEqual([
      ">= 4.17.0, < 4.18.1",
    ]);
    expect(payload.upgradePaths).toEqual(["4.18.2"]);
  });

  it("places malicious advisory first in the sorted list", () => {
    const payload = buildPackageVulnerabilitiesSuccessPayload(
      defaultVulnerabilityReport,
    );
    expect(payload.advisories?.[0]?.isMalicious).toBe(true);
  });

  it("sorts non-malicious advisories severity desc → date desc → id asc", () => {
    const payload = buildPackageVulnerabilitiesSuccessPayload(
      defaultVulnerabilityReport,
    );
    const ids = payload.advisories?.map((a) => a.id);
    // malware first, then critical → high → medium → low → null-severity
    expect(ids).toEqual([
      "GHSA-mmmm-mmmm-mmmm", // malware
      "GHSA-cccc-cccc-cccc", // critical 9.2
      "GHSA-xxxx-xxxx-xxxx", // high 7.5
      "GHSA-yyyy-yyyy-yyyy", // medium 5.3
      "GHSA-zzzz-zzzz-zzzz", // low 3.2
      "GHSA-nnnn-nnnn-nnnn", // null severity
    ]);
  });
});

describe("buildPackageVulnerabilitiesSuccessPayload — transitive audit", () => {
  it("maps a positive audit completely, lowercases registries, and keeps occurrence aliases distinct", () => {
    const payload = buildPackageVulnerabilitiesSuccessPayload(
      transitiveVulnerabilityFixture(),
    );

    expect(payload.transitive).toEqual({
      scope: "resolved_dependencies",
      withdrawnAdvisoriesIncluded: false,
      summary: {
        totalPackagesAnalyzed: 49,
        affectedPackageCount: 3,
        affectedOccurrenceCount: 7,
        bySeverity: {
          malware: 1,
          critical: 1,
          high: 1,
          medium: 1,
          low: 2,
          unrated: 1,
        },
      },
      calculatedAt: "2025-01-01T12:00:00Z",
      packages: [
        {
          registry: "npm",
          name: "accepts",
          affectedOccurrenceCount: 2,
          occurrences: [
            {
              resolvedVersion: "1.3.8",
              id: "GHSA-accept-critical",
              summary: "Critical accepts issue",
              severity: 9.1,
              severityLabel: "critical",
              matchedAffectedVersionRanges: ["< 1.3.9"],
              fixVersionsAboveResolved: ["1.3.9"],
              nearestFixedVersion: "1.3.9",
              publishedAt: "2024-07-01",
            },
            {
              resolvedVersion: "1.3.8",
              id: "GHSA-accept-low",
              summary: "Low accepts issue",
              severity: 3.2,
              severityLabel: "low",
              matchedAffectedVersionRanges: ["< 1.3.9"],
              fixVersionsAboveResolved: ["1.3.9"],
              nearestFixedVersion: "1.3.9",
              publishedAt: "2024-01-15",
            },
          ],
        },
        {
          registry: "npm",
          name: "body-parser",
          affectedOccurrenceCount: 3,
          occurrences: [
            {
              resolvedVersion: "1.19.0",
              id: "GHSA-body-mal",
              aliases: ["CVE-shared", "CVE-malware"],
              summary: "Malware body-parser issue",
              severity: 9.8,
              severityLabel: "critical",
              matchedAffectedVersionRanges: [">= 1.0.0, < 2.0.0"],
              fixVersionsAboveResolved: ["2.0.0"],
              nearestFixedVersion: "2.0.0",
              publishedAt: "2024-05-01",
              isMalicious: true,
            },
            {
              resolvedVersion: "1.19.0",
              id: "GHSA-body-high",
              aliases: ["CVE-shared"],
              summary: "High body-parser issue",
              severity: 8,
              severityLabel: "high",
              matchedAffectedVersionRanges: [">= 1.0.0, < 1.20.3"],
              fixVersionsAboveResolved: ["1.20.3", "2.0.0"],
              nearestFixedVersion: "1.20.3",
              publishedAt: "2024-04-01",
              modifiedAt: "2024-06-02",
            },
            {
              resolvedVersion: "1.19.1",
              aliases: ["CVE-unrated"],
              summary: "No score body-parser issue",
              matchedAffectedVersionRanges: ["< 1.19.2"],
              fixVersionsAboveResolved: [],
              publishedAt: "2024-01-01",
            },
          ],
        },
        {
          registry: "pypi",
          name: "zeta",
          affectedOccurrenceCount: 2,
          occurrences: [
            {
              resolvedVersion: "2.0.0",
              id: "GHSA-zeta-medium",
              summary: "Medium zeta issue",
              severity: 5.5,
              severityLabel: "medium",
              matchedAffectedVersionRanges: [">= 1.0.0, < 2.1.0"],
              fixVersionsAboveResolved: ["2.1.0"],
              nearestFixedVersion: "2.1.0",
              publishedAt: "2024-03-01",
              modifiedAt: "2024-03-02",
            },
            {
              resolvedVersion: "2.0.0",
              id: "GHSA-zeta-low",
              summary: "Low zeta issue",
              severity: 1.1,
              severityLabel: "low",
              matchedAffectedVersionRanges: ["< 2.0.2"],
              fixVersionsAboveResolved: ["2.0.2"],
              nearestFixedVersion: "2.0.2",
              publishedAt: "2024-02-01",
            },
          ],
        },
      ],
    });
    expect(payload.transitive?.packages[1]?.occurrences).toHaveLength(3);
    expect(payload.transitive?.packages[1]?.occurrences[0]?.aliases).toContain(
      "CVE-shared",
    );
    expect(payload.transitive?.packages[1]?.occurrences[1]?.aliases).toContain(
      "CVE-shared",
    );
  });

  it("emits an exact checked-clean transitive block with an empty package list", () => {
    const fixture = transitiveVulnerabilityFixture();
    fixture.transitive = {
      totalPackagesAnalyzed: 101,
      affectedPackageCount: 0,
      affectedOccurrenceCount: 0,
      packages: [],
    };
    expect(
      buildPackageVulnerabilitiesSuccessPayload(fixture).transitive,
    ).toEqual({
      scope: "resolved_dependencies",
      withdrawnAdvisoriesIncluded: false,
      summary: {
        totalPackagesAnalyzed: 101,
        affectedPackageCount: 0,
        affectedOccurrenceCount: 0,
      },
      packages: [],
    });
  });
});

describe("buildPackageVulnerabilitiesSuccessPayload — omission rules", () => {
  it("zero-vulns case strips summary blocks and omits advisories", () => {
    const payload = buildPackageVulnerabilitiesSuccessPayload(
      zeroVulnsFixture(),
    );
    expect(payload.summary).toEqual({
      total: 0,
      affectedVulnerabilityCount: 0,
      nonAffectingVulnerabilityCount: 0,
      allVulnerabilityCount: 0,
      affected: false,
    });
    expect(payload.advisories).toBeUndefined();
    expect(payload.upgradePaths).toBeUndefined();
  });

  it("reports historical advisories separately from active version risk", () => {
    const fixture = zeroVulnsFixture();
    if (fixture.security) {
      fixture.security.nonAffectingVulnerabilityCount = 2;
      fixture.security.allVulnerabilityCount = 2;
    }
    const payload = buildPackageVulnerabilitiesSuccessPayload(fixture);
    expect(payload.summary.total).toBe(0);
    expect(payload.summary.nonAffectingVulnerabilityCount).toBe(2);
    expect(payload.summary.allVulnerabilityCount).toBe(2);
    expect(payload.advisories).toBeUndefined();
  });

  it("can return historical advisory rows while preserving zero active risk", () => {
    const fixture = zeroVulnsFixture();
    if (fixture.security) {
      fixture.security.nonAffectingVulnerabilityCount = 1;
      fixture.security.allVulnerabilityCount = 1;
      fixture.security.vulnerabilities = [
        {
          osvId: "GHSA-old-old-old",
          summary: "Old vulnerable range",
          severityScore: 6.1,
          affectedVersionRanges: ["< 1.0.0"],
          affectedVersionRangesCount: 1,
          affectedVersionRangesTruncated: false,
          fixedInVersions: ["1.0.0"],
          publishedAt: "2024-01-01T00:00:00Z",
          affectsInspectedVersion: false,
          matchedAffectedVersionRanges: [],
          duplicateIds: [],
        },
      ];
    }
    const payload = buildPackageVulnerabilitiesSuccessPayload(fixture, {
      filter: { advisoryScope: "non_affecting" },
    });
    expect(payload.summary.total).toBe(0);
    expect(payload.summary.bySeverity).toEqual({ medium: 1 });
    expect(payload.filter).toEqual({ advisoryScope: "non_affecting" });
    expect(payload.advisories).toHaveLength(1);
    expect(payload.advisories?.[0]?.affectsInspectedVersion).toBe(false);
  });

  it("omits empty aliases / fixedIn / affectedRanges arrays", () => {
    const fixture = cloneFixture();
    const malware = fixture.security?.vulnerabilities?.[0];
    if (malware) {
      malware.aliases = [];
      malware.fixedInVersions = [];
    }
    const payload = buildPackageVulnerabilitiesSuccessPayload(fixture);
    const lean = payload.advisories?.[0];
    expect(lean?.aliases).toBeUndefined();
    expect(lean?.fixedIn).toBeUndefined();
    expect(lean?.affectedRanges).toEqual([">= 4.17.0, < 4.18.1"]);
  });

  it("omits modifiedAt when it equals publishedAt", () => {
    const fixture = cloneFixture();
    const advisory = fixture.security?.vulnerabilities?.find(
      (v) => v.osvId === "GHSA-yyyy-yyyy-yyyy",
    );
    if (advisory) advisory.modifiedAt = advisory.publishedAt;
    const payload = buildPackageVulnerabilitiesSuccessPayload(fixture);
    const lean = payload.advisories?.find(
      (a) => a.id === "GHSA-yyyy-yyyy-yyyy",
    );
    expect(lean?.modifiedAt).toBeUndefined();
  });

  it("includes modifiedAt only when it differs from publishedAt", () => {
    const payload = buildPackageVulnerabilitiesSuccessPayload(
      defaultVulnerabilityReport,
    );
    const lean = payload.advisories?.find(
      (a) => a.id === "GHSA-yyyy-yyyy-yyyy",
    );
    expect(lean?.modifiedAt).toBe("2024-04-02");
    expect(lean?.publishedAt).toBe("2024-03-12");
  });

  it("omits severity/severityLabel when score is null or non-positive", () => {
    const payload = buildPackageVulnerabilitiesSuccessPayload(
      defaultVulnerabilityReport,
    );
    const nullSeverity = payload.advisories?.find(
      (a) => a.id === "GHSA-nnnn-nnnn-nnnn",
    );
    expect(nullSeverity?.severity).toBeUndefined();
    expect(nullSeverity?.severityLabel).toBeUndefined();
  });

  it("only includes isMalicious when true", () => {
    const payload = buildPackageVulnerabilitiesSuccessPayload(
      defaultVulnerabilityReport,
    );
    const malware = payload.advisories?.find((a) => a.isMalicious === true);
    expect(malware?.isMalicious).toBe(true);
    const regular = payload.advisories?.find(
      (a) => a.id === "GHSA-xxxx-xxxx-xxxx",
    );
    expect(regular?.isMalicious).toBeUndefined();
  });

  it("includes withdrawnAt when set; withdrawn advisories sink to the bottom", () => {
    const fixture = cloneFixture();
    const advisory = fixture.security?.vulnerabilities?.find(
      (v) => v.osvId === "GHSA-yyyy-yyyy-yyyy",
    );
    if (advisory) advisory.withdrawnAt = "2024-05-01T00:00:00Z";
    const payload = buildPackageVulnerabilitiesSuccessPayload(fixture);
    const lean = payload.advisories?.find(
      (a) => a.id === "GHSA-yyyy-yyyy-yyyy",
    );
    expect(lean?.withdrawnAt).toBe("2024-05-01");
    // Withdrawn should be at the bottom of the list.
    expect(payload.advisories?.[payload.advisories.length - 1]?.id).toBe(
      "GHSA-yyyy-yyyy-yyyy",
    );
  });

  it("omits upgradePaths when empty", () => {
    const fixture = cloneFixture();
    if (fixture.security) fixture.security.upgradePaths = [];
    const payload = buildPackageVulnerabilitiesSuccessPayload(fixture);
    expect(payload.upgradePaths).toBeUndefined();
  });
});

describe("buildPackageVulnerabilitiesSuccessPayload — requestedVersion echo", () => {
  it("omits requestedVersion when caller supplied none", () => {
    const payload = buildPackageVulnerabilitiesSuccessPayload(
      defaultVulnerabilityReport,
    );
    expect(payload.requestedVersion).toBeUndefined();
  });

  it("omits requestedVersion when caller and backend match exactly", () => {
    const payload = buildPackageVulnerabilitiesSuccessPayload(
      defaultVulnerabilityReport,
      { requestedVersion: "4.18.0" },
    );
    expect(payload.requestedVersion).toBeUndefined();
  });

  it("surfaces requestedVersion on any non-empty divergence, including v-prefix forms", () => {
    // The vulnerabilities query takes a version string, not a git
    // ref. `v4.18.0` is a tag convention; no registry accepts it as
    // a canonical version, so surfacing the divergence here points
    // at a real caller mistake rather than masking it.
    const payload = buildPackageVulnerabilitiesSuccessPayload(
      defaultVulnerabilityReport,
      { requestedVersion: "v4.18.0" },
    );
    expect(payload.requestedVersion).toBe("v4.18.0");
  });

  it("includes requestedVersion on non-trivial mismatch", () => {
    const payload = buildPackageVulnerabilitiesSuccessPayload(
      defaultVulnerabilityReport,
      { requestedVersion: "4.17" },
    );
    expect(payload.requestedVersion).toBe("4.17");
  });

  it("echoes explicit filters additively in the JSON payload", () => {
    const payload = buildPackageVulnerabilitiesSuccessPayload(
      defaultVulnerabilityReport,
      { filter: { minSeverity: "high", includeWithdrawn: true } },
    );
    expect(payload.filter).toEqual({
      minSeverity: "high",
      includeWithdrawn: true,
    });
    expect(payload.advisories?.[0]?.id).toBe("GHSA-mmmm-mmmm-mmmm");
  });

  it("omits filter from JSON when caller supplied none", () => {
    const payload = buildPackageVulnerabilitiesSuccessPayload(
      defaultVulnerabilityReport,
    );
    expect(payload.filter).toBeUndefined();
  });

  it("partition invariant: bucket sum equals vulnerabilities.length (and summary.total when backend is consistent)", () => {
    // Client-side guarantee: the six buckets partition
    // `security.vulnerabilities[]`. In the default fixture the
    // backend also keeps `affectedVulnerabilityCount` in sync with the list
    // length, so the sum additionally matches `summary.total` — the
    // visible CLI / MCP reconciliation users see.
    const payload = buildPackageVulnerabilitiesSuccessPayload(
      defaultVulnerabilityReport,
    );
    const buckets = payload.summary.bySeverity ?? {};
    const sum =
      (buckets.malware ?? 0) +
      (buckets.critical ?? 0) +
      (buckets.high ?? 0) +
      (buckets.medium ?? 0) +
      (buckets.low ?? 0) +
      (buckets.unrated ?? 0);
    const returnedCount =
      defaultVulnerabilityReport.security?.vulnerabilities?.length ?? 0;
    expect(sum).toBe(returnedCount);
    expect(sum).toBe(payload.summary.total);
  });
});

describe("dedupAdvisoriesByAlias — alias-cluster collapse", () => {
  it("returns input unchanged when no aliases overlap", () => {
    const input = cloneFixture().security?.vulnerabilities ?? [];
    const out = dedupAdvisoriesByAlias(input);
    expect(out.length).toBe(input.length);
  });

  it("returns empty array on empty input", () => {
    expect(dedupAdvisoriesByAlias([])).toEqual([]);
  });

  it("collapses GHSA + RUSTSEC pair sharing a CVE alias", () => {
    const out = dedupAdvisoriesByAlias([
      {
        osvId: "GHSA-xjxc-vfw2-cg96",
        aliases: ["CVE-2018-20997", "RUSTSEC-2018-0010"],
        severityScore: 9.8,
        publishedAt: "2021-08-25T00:00:00Z",
        affectedVersionRanges: [">=0.10.8 <0.10.9"],
        affectedVersionRangesCount: 1,
        affectedVersionRangesTruncated: false,
        fixedInVersions: ["0.10.9"],
      },
      {
        osvId: "RUSTSEC-2018-0010",
        aliases: ["CVE-2018-20997", "GHSA-xjxc-vfw2-cg96"],
        publishedAt: "2018-06-01T00:00:00Z",
        affectedVersionRanges: [">=0.10.8 <0.10.9"],
        affectedVersionRangesCount: 3,
        affectedVersionRangesTruncated: true,
        fixedInVersions: ["0.10.9"],
      },
    ]);
    expect(out.length).toBe(1);
    const merged = out[0];
    if (!merged) throw new Error("expected one merged advisory");
    // GHSA wins because it carries a positive severity score.
    expect(merged.osvId).toBe("GHSA-xjxc-vfw2-cg96");
    // The other id and shared CVE survive as aliases on the canonical.
    expect(merged.aliases?.sort()).toEqual([
      "CVE-2018-20997",
      "RUSTSEC-2018-0010",
    ]);
    expect(merged.aliases).not.toContain("GHSA-xjxc-vfw2-cg96");
    expect(merged.severityScore).toBe(9.8);
    expect(merged.affectedVersionRangesCount).toBe(3);
    expect(merged.affectedVersionRangesTruncated).toBe(true);
  });

  it("links chains via shared aliases (transitive merge)", () => {
    // Three entries: A↔B share CVE-X; B↔C share CVE-Y. All three end up
    // in one cluster because B bridges A and C.
    const out = dedupAdvisoriesByAlias([
      {
        osvId: "GHSA-aaa",
        aliases: ["CVE-X"],
        severityScore: 8.0,
      },
      {
        osvId: "RUSTSEC-2024-A",
        aliases: ["CVE-X", "CVE-Y"],
      },
      {
        osvId: "RUSTSEC-2024-B",
        aliases: ["CVE-Y"],
      },
    ]);
    expect(out.length).toBe(1);
    const merged = out[0];
    if (!merged) throw new Error("expected merged advisory");
    expect(merged.osvId).toBe("GHSA-aaa");
    expect(merged.aliases?.sort()).toEqual([
      "CVE-X",
      "CVE-Y",
      "RUSTSEC-2024-A",
      "RUSTSEC-2024-B",
    ]);
  });

  it("prefers GHSA over RUSTSEC when neither has severity", () => {
    const out = dedupAdvisoriesByAlias([
      {
        osvId: "RUSTSEC-2025-0099",
        aliases: ["GHSA-zzz"],
      },
      {
        osvId: "GHSA-zzz",
        aliases: ["RUSTSEC-2025-0099"],
      },
    ]);
    expect(out.length).toBe(1);
    expect(out[0]?.osvId).toBe("GHSA-zzz");
  });

  it("falls back to lexicographic id when prefix and severity tie", () => {
    const out = dedupAdvisoriesByAlias([
      {
        osvId: "GHSA-bbb",
        aliases: ["CVE-Z"],
      },
      {
        osvId: "GHSA-aaa",
        aliases: ["CVE-Z"],
      },
    ]);
    expect(out[0]?.osvId).toBe("GHSA-aaa");
  });

  it("unions affectedVersionRanges and fixedInVersions across the cluster", () => {
    const out = dedupAdvisoriesByAlias([
      {
        osvId: "GHSA-xxx",
        aliases: ["CVE-Q"],
        severityScore: 7.5,
        affectedVersionRanges: [">=1.0.0 <1.1.0"],
        fixedInVersions: ["1.1.0"],
      },
      {
        osvId: "RUSTSEC-2024-X",
        aliases: ["CVE-Q"],
        affectedVersionRanges: [">=0.9.0 <1.0.0"],
        fixedInVersions: ["1.0.0"],
      },
    ]);
    const merged = out[0];
    if (!merged) throw new Error("expected merged");
    expect(merged.affectedVersionRanges?.sort()).toEqual([
      ">=0.9.0 <1.0.0",
      ">=1.0.0 <1.1.0",
    ]);
    expect(merged.fixedInVersions?.sort()).toEqual(["1.0.0", "1.1.0"]);
  });

  it("inherits malware flag from any cluster member", () => {
    const out = dedupAdvisoriesByAlias([
      {
        osvId: "GHSA-mal",
        aliases: ["CVE-MAL"],
        severityScore: 9.0,
      },
      {
        osvId: "RUSTSEC-MAL",
        aliases: ["CVE-MAL"],
        isMalicious: true,
      },
    ]);
    expect(out[0]?.isMalicious).toBe(true);
  });

  it("clears withdrawn flag if any cluster member is still active", () => {
    const out = dedupAdvisoriesByAlias([
      {
        osvId: "GHSA-aaa",
        aliases: ["CVE-W"],
        severityScore: 7.0,
      },
      {
        osvId: "RUSTSEC-W",
        aliases: ["CVE-W"],
        withdrawnAt: "2024-01-01T00:00:00Z",
      },
    ]);
    expect(out[0]?.withdrawnAt).toBeUndefined();
  });

  it("keeps withdrawn flag when every cluster member is withdrawn", () => {
    const out = dedupAdvisoriesByAlias([
      {
        osvId: "GHSA-aaa",
        aliases: ["CVE-W"],
        severityScore: 7.0,
        withdrawnAt: "2024-01-15T00:00:00Z",
      },
      {
        osvId: "RUSTSEC-W",
        aliases: ["CVE-W"],
        withdrawnAt: "2024-01-01T00:00:00Z",
      },
    ]);
    expect(out[0]?.withdrawnAt).toBe("2024-01-15T00:00:00Z");
  });

  it("passes singletons (no aliases, no overlap) through unchanged", () => {
    const out = dedupAdvisoriesByAlias([
      { osvId: "GHSA-solo", severityScore: 5.0 },
    ]);
    expect(out.length).toBe(1);
    expect(out[0]?.osvId).toBe("GHSA-solo");
  });

  it("does not merge advisories that lack ids and aliases", () => {
    const out = dedupAdvisoriesByAlias([
      { summary: "ghost A" },
      { summary: "ghost B" },
    ]);
    expect(out.length).toBe(2);
  });

  it("merges advisories with no osvId but overlapping aliases", () => {
    // Backend occasionally ships advisories with aliases populated but
    // no top-level osvId (e.g. legacy CVE-only entries on PyPI). They
    // should still cluster on shared aliases.
    const out = dedupAdvisoriesByAlias([
      {
        aliases: ["CVE-NO-ID"],
        severityScore: 6.0,
      },
      {
        aliases: ["CVE-NO-ID"],
        affectedVersionRanges: [">=1.0.0 <2.0.0"],
      },
    ]);
    expect(out.length).toBe(1);
    const merged = out[0];
    if (!merged) throw new Error("expected merged advisory");
    // Canonical pick (severity-bearing wins) keeps the first member's
    // shape; aliases on the merged are the union minus the canonical's
    // own osvId — but neither has an osvId, so the alias survives.
    expect(merged.aliases).toEqual(["CVE-NO-ID"]);
    expect(merged.severityScore).toBe(6.0);
    expect(merged.affectedVersionRanges).toEqual([">=1.0.0 <2.0.0"]);
  });

  it("does not promote a withdrawn sibling's severity into the merged record", () => {
    // The merged advisory survives because the GHSA member is active.
    // The RUSTSEC sibling was retracted; its score is no longer
    // authoritative and must not inflate the merged band.
    const out = dedupAdvisoriesByAlias([
      {
        osvId: "GHSA-active",
        aliases: ["CVE-W"],
        severityScore: 5.0,
      },
      {
        osvId: "RUSTSEC-2023-W",
        aliases: ["CVE-W"],
        severityScore: 9.8,
        withdrawnAt: "2024-01-15T00:00:00Z",
      },
    ]);
    const merged = out[0];
    if (!merged) throw new Error("expected merged advisory");
    expect(merged.severityScore).toBe(5.0);
    expect(merged.withdrawnAt).toBeUndefined();
  });

  it("reports the maximum severity across the cluster (not the canonical's)", () => {
    // GHSA wins canonical pick on prefix, but RUSTSEC sibling has a
    // higher score. Merged should reflect the higher band so the
    // bySeverity histogram is conservative.
    const out = dedupAdvisoriesByAlias([
      {
        osvId: "GHSA-low",
        aliases: ["CVE-X"],
        severityScore: 5.0,
      },
      {
        osvId: "RUSTSEC-2025-X",
        aliases: ["CVE-X"],
        severityScore: 9.5,
      },
    ]);
    const merged = out[0];
    if (!merged) throw new Error("expected merged advisory");
    expect(merged.osvId).toBe("GHSA-low");
    expect(merged.severityScore).toBe(9.5);
  });

  it("does not promote a sibling's publishedAt to the merged modifiedAt", () => {
    // Canonical was last touched 2024-01-15; sibling was published
    // 2025-06-01 but has no explicit modifiedAt. The merged record
    // should keep the canonical's modifiedAt (or none) — a publish
    // date is not a modification date.
    const out = dedupAdvisoriesByAlias([
      {
        osvId: "GHSA-aaa",
        aliases: ["CVE-Y"],
        severityScore: 7.0,
        publishedAt: "2024-01-01T00:00:00Z",
        modifiedAt: "2024-01-15T00:00:00Z",
      },
      {
        osvId: "RUSTSEC-2025-Y",
        aliases: ["CVE-Y"],
        publishedAt: "2025-06-01T00:00:00Z",
      },
    ]);
    expect(out[0]?.modifiedAt).toBe("2024-01-15T00:00:00Z");
  });

  it("advances modifiedAt when a sibling has a newer real modifiedAt", () => {
    const out = dedupAdvisoriesByAlias([
      {
        osvId: "GHSA-aaa",
        aliases: ["CVE-Z"],
        severityScore: 7.0,
        publishedAt: "2024-01-01T00:00:00Z",
        modifiedAt: "2024-01-15T00:00:00Z",
      },
      {
        osvId: "RUSTSEC-2025-Z",
        aliases: ["CVE-Z"],
        modifiedAt: "2025-06-15T00:00:00Z",
      },
    ]);
    expect(out[0]?.modifiedAt).toBe("2025-06-15T00:00:00Z");
  });
});

describe("buildPackageVulnerabilitiesSuccessPayload — alias-cluster dedup integration", () => {
  it("recomputes total and bySeverity from deduped list", () => {
    // Two GHSA/RUSTSEC pairs + one solo advisory. Pre-dedup: 5; after: 3.
    // Backend affected count is already deduped, while the inline list
    // still carries source-level duplicates. Verify both the count and
    // advisory list stay internally consistent after client-side dedup.
    const fixture = {
      package: { name: "pkg", registry: "CRATES" as const, version: "0.10.0" },
      security: {
        affectedVulnerabilityCount: 3,
        nonAffectingVulnerabilityCount: 0,
        allVulnerabilityCount: 3,
        currentVersionAffected: true,
        upgradePaths: ["0.10.78"],
        vulnerabilities: [
          {
            osvId: "GHSA-xxx",
            aliases: ["CVE-A", "RUSTSEC-2018-0010"],
            severityScore: 9.8,
            publishedAt: "2021-08-25T00:00:00Z",
          },
          {
            osvId: "RUSTSEC-2018-0010",
            aliases: ["CVE-A"],
            publishedAt: "2018-06-01T00:00:00Z",
          },
          {
            osvId: "GHSA-yyy",
            aliases: ["CVE-B", "RUSTSEC-2024-B"],
            severityScore: 6.0,
          },
          {
            osvId: "RUSTSEC-2024-B",
            aliases: ["CVE-B"],
          },
          {
            osvId: "GHSA-solo",
            // No CVSS — exercises the `unrated` bucket post-dedup.
          },
        ],
      },
    };

    const payload = buildPackageVulnerabilitiesSuccessPayload(fixture);
    expect(payload.summary.total).toBe(3);
    expect(payload.advisories?.length).toBe(3);

    // Buckets reconcile with deduped total.
    const buckets = payload.summary.bySeverity ?? {};
    const sum =
      (buckets.malware ?? 0) +
      (buckets.critical ?? 0) +
      (buckets.high ?? 0) +
      (buckets.medium ?? 0) +
      (buckets.low ?? 0) +
      (buckets.unrated ?? 0);
    expect(sum).toBe(3);
    expect(payload.summary.bySeverity).toEqual({
      critical: 1,
      medium: 1,
      unrated: 1,
    });

    // Canonical preference: GHSA-xxx wins over its RUSTSEC counterpart.
    const ids = payload.advisories?.map((a) => a.id);
    expect(ids).toContain("GHSA-xxx");
    expect(ids).not.toContain("RUSTSEC-2018-0010");
  });

  it("preserves total when no aliases cluster (express fixture)", () => {
    // Sanity: the default 6-advisory fixture has no overlapping aliases,
    // so dedup is a no-op and total/bySeverity match the pre-dedup
    // expectations from the partition-invariant test.
    const payload = buildPackageVulnerabilitiesSuccessPayload(
      defaultVulnerabilityReport,
    );
    expect(payload.summary.total).toBe(6);
    expect(payload.advisories?.length).toBe(6);
  });
});

describe("formatPackageVulnerabilitiesTerminal", () => {
  it("appends positive resolved-dependency evidence after direct clean evidence", () => {
    const output = formatPackageVulnerabilitiesTerminal(
      transitiveVulnerabilityFixture(),
      { useColors: false, terminalWidth: 120 },
    );
    expect(output).toContain(
      "No active vulnerabilities affect this version.\n\nResolved dependencies",
    );
    expect(output).toContain(
      "7 affected advisory occurrences in 3 dependency packages; 49 resolved package versions checked.",
    );
    expect(output).toContain(
      "1 MALWARE | 1 critical | 1 high | 1 medium | 2 low | 1 unrated",
    );
    expect(output).toContain("MALWARE   body-parser@1.19.0  GHSA-body-mal");
    expect(output).toContain("critical  accepts@1.3.8  GHSA-accept-critical");
    expect(output).toContain("matched      >= 1.0.0, < 2.0.0");
    expect(output).toContain("nearest fix  2.0.0");
    expect(output.indexOf("Resolved dependencies")).toBeGreaterThan(
      output.indexOf("No active vulnerabilities affect this version."),
    );
  });

  it("renders exact zero and singular transitive wording", () => {
    const zero = transitiveVulnerabilityFixture();
    zero.transitive = {
      totalPackagesAnalyzed: 1,
      affectedPackageCount: 0,
      affectedOccurrenceCount: 0,
      packages: [],
    };
    const zeroOutput = formatPackageVulnerabilitiesTerminal(zero, {
      useColors: false,
      terminalWidth: 120,
    });
    expect(zeroOutput).toContain(
      "No affected advisory occurrences found; 1 resolved package version checked.",
    );

    const singular = transitiveVulnerabilityFixture();
    const firstPackage = singular.transitive?.packages[0];
    const firstOccurrence = firstPackage?.occurrences[0];
    if (!firstPackage || !firstOccurrence) {
      throw new Error("fixture missing singular transitive occurrence");
    }
    singular.transitive = {
      totalPackagesAnalyzed: 1,
      affectedPackageCount: 1,
      affectedOccurrenceCount: 1,
      packages: [
        {
          ...firstPackage,
          affectedOccurrenceCount: 1,
          occurrences: [firstOccurrence],
        },
      ],
    };
    const singularOutput = formatPackageVulnerabilitiesTerminal(singular, {
      useColors: false,
      terminalWidth: 120,
    });
    expect(singularOutput).toContain(
      "1 affected advisory occurrence in 1 dependency package; 1 resolved package version checked.",
    );
  });

  it("caps transitive compact rows globally and uses surface-native hints", () => {
    const cli = formatPackageVulnerabilitiesTerminal(
      transitiveVulnerabilityFixture(),
      { useColors: false, terminalWidth: 120 },
    );
    expect(cli).toContain("GHSA-body-mal");
    expect(cli).toContain("GHSA-accept-critical");
    expect(cli).toContain("GHSA-body-high");
    expect(cli).toContain("GHSA-zeta-medium");
    expect(cli).toContain("GHSA-accept-low");
    expect(cli).not.toContain("GHSA-zeta-low");
    expect(cli).not.toContain("CVE-unrated");
    expect(cli).toContain("... (+2 more; use -v)");

    const mcp = formatPackageVulnerabilitiesTerminal(
      transitiveVulnerabilityFixture(),
      { useColors: false, surface: "mcp", terminalWidth: 120 },
    );
    expect(mcp).toContain("... (+2 more; use verbose=true or format=json)");
    expect(mcp).not.toContain("use -v");
  });

  it("wraps mixed-severity breakdowns and capped-row hints at narrow widths", () => {
    const output = formatPackageVulnerabilitiesTerminal(
      transitiveVulnerabilityFixture(),
      { useColors: false, terminalWidth: 20 },
    );
    const sectionLines = output
      .slice(output.indexOf("Resolved dependencies"))
      .split("\n");
    const breakdownLines = sectionLines.filter((line) =>
      /^ {2}\d+ (?:MALWARE|critical|high|medium|low|unrated)(?: |$)/.test(line),
    );
    expect(breakdownLines.length).toBeGreaterThan(1);
    expect(breakdownLines.every((line) => line.length <= 20)).toBe(true);

    const hintIndex = sectionLines.findIndex((line) =>
      line.startsWith("... (+2"),
    );
    expect(hintIndex).toBeGreaterThan(-1);
    const hintLines = sectionLines.slice(hintIndex);
    expect(hintLines.every((line) => line.length <= 20)).toBe(true);
    expect(hintLines.join(" ").replace(/\s+/g, " ")).toContain(
      "... (+2 more; use -v)",
    );
  });

  it("shows every transitive occurrence and verbose fixes, aliases, and missing-fix evidence", () => {
    const output = formatPackageVulnerabilitiesTerminal(
      transitiveVulnerabilityFixture(),
      { useColors: false, verbose: true, terminalWidth: 120 },
    );
    expect(output).toContain("GHSA-zeta-low");
    expect(output).toContain("CVE-shared");
    expect(output).toContain("higher fixes 1.20.3, 2.0.0");
    expect(output).toContain("no higher fixed version known");
    expect(output).not.toContain("+2 more; use -v");
  });

  it("states transitive withdrawn-advisory semantics once", () => {
    const output = formatPackageVulnerabilitiesTerminal(
      transitiveVulnerabilityFixture(),
      {
        useColors: false,
        filter: { includeWithdrawn: true },
        terminalWidth: 120,
      },
    );
    expect(output).toContain("Filter  include withdrawn");
    expect(output).toContain(
      "Dependency analysis excludes withdrawn advisories.",
    );
    expect(
      output.match(/Dependency analysis excludes withdrawn advisories\./g),
    ).toHaveLength(1);
  });

  it("sorts flattened transitive rows by risk then stable package identity", () => {
    const output = formatPackageVulnerabilitiesTerminal(
      transitiveVulnerabilityFixture(),
      { useColors: false, verbose: true, terminalWidth: 120 },
    );
    const ordered = [
      "GHSA-body-mal",
      "GHSA-accept-critical",
      "GHSA-body-high",
      "GHSA-zeta-medium",
      "GHSA-accept-low",
      "GHSA-zeta-low",
      "CVE-unrated",
    ];
    const positions = ordered.map((id) => output.indexOf(id));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it("keeps splittable transitive prose and detail lines within narrow widths", () => {
    const fixture = transitiveVulnerabilityFixture();
    fixture.transitive = {
      totalPackagesAnalyzed: 1,
      affectedPackageCount: 1,
      affectedOccurrenceCount: 1,
      packages: [
        {
          registry: "NPM",
          name: "x",
          affectedOccurrenceCount: 1,
          occurrences: [
            {
              version: "1",
              affectsResolvedVersion: true,
              matchedAffectedVersionRanges: ["r1", "r2"],
              fixVersionsAboveResolved: ["2", "3"],
              nearestFixedVersion: "2",
              advisory: {
                osvId: "A",
                summary: "one two three four five six seven",
                severityScore: 8,
              },
            },
          ],
        },
      ],
    };
    for (const width of [20, 40, 80, 120]) {
      const output = formatPackageVulnerabilitiesTerminal(fixture, {
        useColors: false,
        verbose: true,
        terminalWidth: width,
      });
      const section = output.slice(output.indexOf("Resolved dependencies"));
      const [heading, ...wrappedLines] = section.split("\n");
      expect(heading).toBe("Resolved dependencies");
      expect(wrappedLines.every((line) => line.length <= width)).toBe(true);
    }
  });

  it("does not split atomic coordinates, advisory IDs, or URLs", () => {
    const fixture = transitiveVulnerabilityFixture();
    const firstPackage = fixture.transitive?.packages[0];
    const firstOccurrence = firstPackage?.occurrences[0];
    if (!firstPackage || !firstOccurrence) {
      throw new Error("fixture missing atomic transitive occurrence");
    }
    firstPackage.name = "package-with-a-long-coordinate";
    firstOccurrence.version = "123456789.0.0";
    firstOccurrence.advisory.osvId =
      "GHSA-very-long-advisory-identity-123456789";
    firstOccurrence.advisory.summary =
      "See https://example.com/advisories/very-long-advisory-reference";
    const output = formatPackageVulnerabilitiesTerminal(fixture, {
      useColors: false,
      verbose: true,
      terminalWidth: 20,
    });
    expect(output).toContain("package-with-a-long-coordinate@123456789.0.0");
    expect(output).toContain("GHSA-very-long-advisory-identity-123456789");
    expect(output).toContain(
      "https://example.com/advisories/very-long-advisory-reference",
    );
  });

  it("keeps color and no-color words identical and preserves Unicode", () => {
    const fixture = transitiveVulnerabilityFixture();
    const firstPackage = fixture.transitive?.packages[0];
    if (!firstPackage) throw new Error("fixture missing Unicode package");
    firstPackage.name = "zéta-日本";
    const plain = formatPackageVulnerabilitiesTerminal(fixture, {
      useColors: false,
      verbose: true,
      terminalWidth: 120,
    });
    const colored = formatPackageVulnerabilitiesTerminal(fixture, {
      useColors: true,
      verbose: true,
      terminalWidth: 120,
    });
    expect(colored).toContain("\u001b[");
    expect(stripAnsi(colored)).toBe(plain);
    expect(plain).toContain("zéta-日本@2.0.0");
  });

  it("sanitizes direct and transitive display fields while JSON retains source strings", () => {
    const fixture = transitiveVulnerabilityFixture();
    fixture.package.name = "express\u001b[31m";
    fixture.package.version = "5.2.1\u001b]0;owned\u0007";
    fixture.security = {
      affectedVulnerabilityCount: 1,
      nonAffectingVulnerabilityCount: 0,
      allVulnerabilityCount: 1,
      currentVersionAffected: true,
      upgradePaths: ["6.0.0\u001bM"],
      vulnerabilities: [
        {
          osvId: "GHSA-direct\u001b[31m",
          aliases: ["CVE-direct\u009b"],
          summary: "direct\nsummary\u0007",
          severityScore: 7.5,
          affectedVersionRanges: [">= 5.0.0\u001b[31m, < 6.0.0"],
          affectedVersionRangesCount: 1,
          affectedVersionRangesTruncated: false,
          fixedInVersions: ["6.0.0\u001b]8;;evil\u0007"],
          publishedAt: "2024-01-01T00:00:00Z",
          modifiedAt: "2024-01-02T00:00:00Z",
          affectsInspectedVersion: true,
          matchedAffectedVersionRanges: [],
          duplicateIds: [],
        },
      ],
    };
    const transitivePackage = fixture.transitive?.packages[0];
    const transitiveOccurrence = transitivePackage?.occurrences[0];
    if (!transitivePackage || !transitiveOccurrence) {
      throw new Error("fixture missing hostile transitive occurrence");
    }
    transitivePackage.name = "dep\u0080";
    transitiveOccurrence.version = "2.0.0\u001b8";
    transitiveOccurrence.matchedAffectedVersionRanges = ["< 2.1.0\u0000"];
    transitiveOccurrence.fixVersionsAboveResolved = ["2.1.0\u001b[32m"];
    transitiveOccurrence.nearestFixedVersion = "2.1.0\u009f";
    transitiveOccurrence.advisory.osvId = "GHSA-transitive\u001b]0;x\u0007";
    transitiveOccurrence.advisory.aliases = ["CVE-transitive\u0007"];
    transitiveOccurrence.advisory.summary = "transitive\tadvisory\u001bM";

    const requestedVersion = "5.0.0\u0007";
    const filter = {
      minSeverity: "high\u001b[31m" as "high",
      includeWithdrawn: true as const,
    };
    const payload = buildPackageVulnerabilitiesSuccessPayload(fixture, {
      requestedVersion,
      filter,
    });
    expect(payload.name).toBe(fixture.package.name);
    expect(payload.version).toBe(fixture.package.version);
    expect(payload.advisories?.[0]?.id).toBe("GHSA-direct\u001b[31m");
    expect(payload.advisories?.[0]?.summary).toBe("direct\nsummary\u0007");
    const hostilePackage = payload.transitive?.packages.find(
      (pkg) => pkg.name === "dep\u0080",
    );
    expect(hostilePackage?.name).toBe("dep\u0080");
    expect(hostilePackage?.occurrences[0]?.id).toBe(
      "GHSA-transitive\u001b]0;x\u0007",
    );

    const output = formatPackageVulnerabilitiesTerminal(fixture, {
      requestedVersion,
      filter,
      useColors: false,
      verbose: true,
      terminalWidth: 120,
    });
    const withoutLineBreaks = output.replace(/\n/g, "");
    expect(containsTerminalControl(withoutLineBreaks)).toBe(false);
    expect(output).toContain("direct summary");
    expect(output).toContain("dep@2.0.0");
    expect(output).toContain("CVE-transitive");
    expect(output).toContain("Filter  severity >= high");
    expect(output).toContain("(requested 5.0.0)");
  });

  it("renders zero-vulns hot path as header + one summary body line", () => {
    const output = formatPackageVulnerabilitiesTerminal(zeroVulnsFixture(), {
      useColors: false,
    });
    expect(output).toBe(
      "clean @ 1.0.0 | npm\nNo active vulnerabilities affect this version.\n",
    );
  });

  it("renders historical package advisories without marking the version vulnerable", () => {
    const fixture = zeroVulnsFixture();
    if (fixture.security) {
      fixture.security.nonAffectingVulnerabilityCount = 2;
      fixture.security.allVulnerabilityCount = 2;
    }
    const output = formatPackageVulnerabilitiesTerminal(fixture, {
      useColors: false,
    });
    expect(output).toBe(
      "clean @ 1.0.0 | npm\nNo active vulnerabilities affect this version (2 historical advisories do not apply).\n",
    );
  });

  it("uses singular grammar for one historical advisory", () => {
    const fixture = zeroVulnsFixture();
    if (fixture.security) {
      fixture.security.nonAffectingVulnerabilityCount = 1;
      fixture.security.allVulnerabilityCount = 1;
    }
    const output = formatPackageVulnerabilitiesTerminal(fixture, {
      useColors: false,
    });
    expect(output).toBe(
      "clean @ 1.0.0 | npm\nNo active vulnerabilities affect this version (1 historical advisory does not apply).\n",
    );
  });

  it("renders filtered zero-vulns with filter context", () => {
    const output = formatPackageVulnerabilitiesTerminal(zeroVulnsFixture(), {
      useColors: false,
      filter: { minSeverity: "high" },
    });
    expect(output).toBe(
      "clean @ 1.0.0 | npm\nFilter  severity >= high\nNo vulnerabilities matching the filter affect this version.\n",
    );
  });

  it("renders selected historical advisory rows under non-affecting scope", () => {
    const fixture = zeroVulnsFixture();
    if (fixture.security) {
      fixture.security.nonAffectingVulnerabilityCount = 1;
      fixture.security.allVulnerabilityCount = 1;
      fixture.security.vulnerabilities = [
        {
          osvId: "GHSA-old-old-old",
          summary: "Old vulnerable range",
          severityScore: 6.1,
          affectedVersionRanges: ["< 1.0.0"],
          affectedVersionRangesCount: 1,
          affectedVersionRangesTruncated: false,
          fixedInVersions: ["1.0.0"],
          publishedAt: "2024-01-01T00:00:00Z",
          affectsInspectedVersion: false,
          matchedAffectedVersionRanges: [],
          duplicateIds: [],
        },
      ];
    }
    const output = formatPackageVulnerabilitiesTerminal(fixture, {
      useColors: false,
      filter: { advisoryScope: "non_affecting" },
    });
    expect(output).toContain("Scope   historical advisories only");
    expect(output).toContain(
      "No active vulnerabilities affect this version; historical advisories are listed below.",
    );
    expect(output).toContain("GHSA-old-old-old");
    expect(output).toContain("affected < 1.0.0");
  });

  it("renders default terminal block with header, summary, breakdown, advisories, footer", () => {
    const output = formatPackageVulnerabilitiesTerminal(
      defaultVulnerabilityReport,
      { useColors: false, verbose: true },
    );
    expect(output).toContain("express @ 4.18.0 | npm");
    expect(output).toContain("6 vulnerabilities affect this version");
    expect(output).toContain("MALWARE");
    expect(output).toContain("GHSA-mmmm-mmmm-mmmm");
    expect(output).toContain("Fix version: 4.18.2.");
  });

  it("shows MALWARE | crit combined label for malicious + severe advisory", () => {
    const fixture = cloneFixture();
    if (fixture.security?.vulnerabilities?.[0]) {
      fixture.security.vulnerabilities[0].severityScore = 9.5;
    }
    const output = formatPackageVulnerabilitiesTerminal(fixture, {
      useColors: false,
    });
    expect(output).toContain("MALWARE | critical");
  });

  it("omits breakdown line when total is 1", () => {
    const fixture = cloneFixture();
    if (fixture.security) {
      fixture.security.affectedVulnerabilityCount = 1;
      fixture.security.allVulnerabilityCount = 1;
      fixture.security.vulnerabilities =
        fixture.security.vulnerabilities?.slice(2, 3) ?? []; // keep one high CVE
    }
    const output = formatPackageVulnerabilitiesTerminal(fixture, {
      useColors: false,
    });
    expect(output).toContain("1 vulnerability affects this version");
    expect(output).not.toContain("1 high");
  });

  it("appends (requested X) line when requestedVersion fires", () => {
    const output = formatPackageVulnerabilitiesTerminal(
      defaultVulnerabilityReport,
      { useColors: false, requestedVersion: "4.17" },
    );
    expect(output).toContain("(requested 4.17)");
  });

  it("appends (requested vX.Y.Z) line when caller used a `v`-prefixed form (tag ≠ version)", () => {
    const output = formatPackageVulnerabilitiesTerminal(
      defaultVulnerabilityReport,
      { useColors: false, requestedVersion: "v4.18.0" },
    );
    expect(output).toContain("(requested v4.18.0)");
  });

  it("renders Fix versions: A, B, C. for multiple paths", () => {
    const fixture = cloneFixture();
    if (fixture.security) {
      fixture.security.upgradePaths = ["4.17.4", "4.18.2"];
    }
    const output = formatPackageVulnerabilitiesTerminal(fixture, {
      useColors: false,
    });
    expect(output).toContain("Fix versions: 4.17.4, 4.18.2.");
  });

  it("omits fix-version footer when no paths", () => {
    const fixture = cloneFixture();
    if (fixture.security) fixture.security.upgradePaths = [];
    const output = formatPackageVulnerabilitiesTerminal(fixture, {
      useColors: false,
    });
    expect(output).not.toContain("Fix version");
  });

  it("verbose adds aliases, severity, published/modified rows where applicable", () => {
    const output = formatPackageVulnerabilitiesTerminal(
      defaultVulnerabilityReport,
      { useColors: false, verbose: true },
    );
    expect(output).toContain("aliases");
    expect(output).toContain("CVE-2024-5678, CVE-2024-5679");
    expect(output).toContain("severity");
    expect(output).toContain("7.5 (CVSS)");
    expect(output).toContain("modified");
    expect(output).toContain("2024-04-02");
    expect(output).toContain("malicious");
  });

  it("no-color output contains no ANSI escape sequences", () => {
    const output = formatPackageVulnerabilitiesTerminal(
      defaultVulnerabilityReport,
      { useColors: false, verbose: true },
    );
    expect(output).not.toContain("\x1b[");
  });

  it("breakdown line includes unrated bucket so the sum reconciles with total", () => {
    const output = formatPackageVulnerabilitiesTerminal(
      defaultVulnerabilityReport,
      { useColors: false, verbose: true },
    );
    // Fixture has 6 advisories: 1 malware, 1 crit, 1 high, 1 medium, 1 low,
    // 1 unrated. Breakdown line must enumerate all six to match the total.
    expect(output).toMatch(
      /1 MALWARE \| 1 crit \| 1 high \| 1 medium \| 1 low \| 1 unrated/,
    );
  });

  it("truncates long affected-range lists in compact mode with a +N more hint", () => {
    const fixture = cloneFixture();
    const advisory = fixture.security?.vulnerabilities?.[1]; // GHSA-cccc critical
    if (advisory) {
      advisory.affectedVersionRanges = [
        "==1.0.0",
        "==1.0.1",
        "==1.0.2",
        "==1.0.3",
        "==1.0.4",
        "==1.0.5",
        "==1.0.6",
      ];
    }
    const output = formatPackageVulnerabilitiesTerminal(fixture, {
      useColors: false,
    });
    // First 4 ranges shown; the remaining 3 collapse into the hint.
    expect(output).toContain(
      "affected ==1.0.0, ==1.0.1, ==1.0.2, ==1.0.3, ... (+3 more; use -v)",
    );
    expect(output).not.toContain("==1.0.4,");
  });

  it("surfaces backend-truncated affected ranges in compact output", () => {
    const fixture = cloneFixture();
    const advisory = fixture.security?.vulnerabilities?.[1];
    if (advisory) {
      advisory.affectedVersionRanges = ["==1.0.0", "==1.0.1"];
      advisory.affectedVersionRangesCount = 5;
      advisory.affectedVersionRangesTruncated = true;
    }
    const output = formatPackageVulnerabilitiesTerminal(fixture, {
      useColors: false,
    });
    expect(output).toContain(
      "affected ==1.0.0, ==1.0.1, ... (+3 ranges omitted by service)",
    );
  });

  it("verbose mode shows every affected range without truncation", () => {
    const fixture = cloneFixture();
    const advisory = fixture.security?.vulnerabilities?.[1];
    if (advisory) {
      advisory.affectedVersionRanges = [
        "==1.0.0",
        "==1.0.1",
        "==1.0.2",
        "==1.0.3",
        "==1.0.4",
        "==1.0.5",
      ];
    }
    const output = formatPackageVulnerabilitiesTerminal(fixture, {
      useColors: false,
      verbose: true,
    });
    expect(output).toContain("==1.0.4, ==1.0.5");
    expect(output).not.toContain("+2 more");
  });

  it("caps default advisory rows and bases hidden count on rendered advisories", () => {
    const fixture = cloneFixture();
    if (fixture.security) {
      fixture.security.affectedVulnerabilityCount = 99;
    }
    const output = formatPackageVulnerabilitiesTerminal(fixture, {
      useColors: false,
    });
    expect(DEFAULT_ADVISORY_CAP).toBe(5);
    expect(output).toContain("... (+1 more; use -v)");
    expect(output).not.toContain("... (+94 more");
    expect(output).not.toContain("GHSA-nnnn-nnnn-nnnn");
  });

  it("verbose mode shows all advisory rows", () => {
    const output = formatPackageVulnerabilitiesTerminal(
      defaultVulnerabilityReport,
      { useColors: false, verbose: true },
    );
    expect(output).not.toContain("... (+1 more; use -v)");
    expect(output).toContain("GHSA-nnnn-nnnn-nnnn");
  });

  it("uses MCP-native truncation hints", () => {
    const output = formatPackageVulnerabilitiesTerminal(
      defaultVulnerabilityReport,
      { useColors: false, surface: "mcp" },
    );
    expect(output).toContain("... (+1 more; use verbose=true or format=json)");
    expect(output).not.toContain("use -v");
  });

  it("echoes filters in the terminal header", () => {
    const output = formatPackageVulnerabilitiesTerminal(
      defaultVulnerabilityReport,
      {
        useColors: false,
        filter: { minSeverity: "high", includeWithdrawn: true },
      },
    );
    expect(output).toContain("Filter  severity >= high");
    expect(output).toContain("Filter  include withdrawn");
  });

  it("pkg_vulns text output is printable ASCII", () => {
    const output = formatPackageVulnerabilitiesTerminal(
      defaultVulnerabilityReport,
      { useColors: false, verbose: true },
    );
    expect(output).not.toMatch(/[·…—–]/);
  });

  it("singular vulnerability noun when total is 1", () => {
    const fixture = cloneFixture();
    if (fixture.security) {
      fixture.security.affectedVulnerabilityCount = 1;
      fixture.security.allVulnerabilityCount = 1;
      fixture.security.vulnerabilities =
        fixture.security.vulnerabilities?.slice(2, 3) ?? [];
    }
    const output = formatPackageVulnerabilitiesTerminal(fixture, {
      useColors: false,
    });
    expect(output).toContain("1 vulnerability affects this version");
  });
});

describe("compareVersionsAscending — semver-ish display ordering", () => {
  it("orders base versions numerically across major/minor/patch", () => {
    const input = ["4.20.0", "3.11.0", "4.5.0", "5.0.0", "4.19.2"];
    const sorted = input.slice().sort(compareVersionsAscending);
    expect(sorted).toEqual(["3.11.0", "4.5.0", "4.19.2", "4.20.0", "5.0.0"]);
  });

  it("places pre-release suffixes below the matching base version", () => {
    const input = ["4.0.0", "4.0.0-rc1", "4.0.0-alpha.1", "3.11.0"];
    const sorted = input.slice().sort(compareVersionsAscending);
    expect(sorted).toEqual(["3.11.0", "4.0.0-alpha.1", "4.0.0-rc1", "4.0.0"]);
  });

  it("orders Swift v-prefixed versions numerically", () => {
    const input = ["v4.5.0", "v3.11.0", "v3.10.0", "v4.0.0-rc1"];
    const sorted = input.slice().sort(compareVersionsAscending);
    expect(sorted).toEqual(["v3.10.0", "v3.11.0", "v4.0.0-rc1", "v4.5.0"]);
  });

  it("recovers exotic strings via lex fallback without throwing", () => {
    const input = ["abc", "1.2.3", "zzz", "0.1.0"];
    const sorted = input.slice().sort(compareVersionsAscending);
    // Unparseable segments parse to 0, so "abc" and "zzz" both look
    // like 0.0.0 numerically; lex tiebreak gives stable ordering.
    expect(sorted[0]).toBe("abc");
    expect(sorted.includes("1.2.3")).toBe(true);
    expect(sorted.includes("0.1.0")).toBe(true);
  });
});

describe("upgrade-path display ordering", () => {
  it("sorts upgradePaths ascending and dedupes", () => {
    const fixture = structuredClone(defaultVulnerabilityReport);
    if (fixture.security) {
      // Matches the express-like shape the live backend produces —
      // advisory iteration order mixes majors and pre-releases.
      fixture.security.upgradePaths = [
        "4.19.2",
        "5.0.0-beta.3",
        "3.11.0",
        "4.5.0",
        "4.20.0",
        "5.0.0",
        "4.0.0-rc1",
        "4.19.2", // duplicate — should be stripped
      ];
    }
    const payload = buildPackageVulnerabilitiesSuccessPayload(fixture);
    expect(payload.upgradePaths).toEqual([
      "3.11.0",
      "4.0.0-rc1",
      "4.5.0",
      "4.19.2",
      "4.20.0",
      "5.0.0-beta.3",
      "5.0.0",
    ]);
  });

  it("sorts Swift v-prefixed upgradePaths ascending", () => {
    const fixture = structuredClone(defaultVulnerabilityReport);
    if (fixture.security) {
      fixture.security.upgradePaths = [
        "v4.5.0",
        "v3.11.0",
        "v3.10.0",
        "v4.5.0",
      ];
    }
    const payload = buildPackageVulnerabilitiesSuccessPayload(fixture);
    expect(payload.upgradePaths).toEqual(["v3.10.0", "v3.11.0", "v4.5.0"]);
  });
});

describe("placeholder summary stripping", () => {
  it("drops literal 'No summary available' from JSON and terminal output", () => {
    const fixture = structuredClone(defaultVulnerabilityReport);
    const target = fixture.security?.vulnerabilities?.find(
      (v) => v.osvId === "GHSA-nnnn-nnnn-nnnn",
    );
    if (target) target.summary = "No summary available";
    const payload = buildPackageVulnerabilitiesSuccessPayload(fixture);
    const lean = payload.advisories?.find(
      (a) => a.id === "GHSA-nnnn-nnnn-nnnn",
    );
    expect(lean?.summary).toBeUndefined();

    const terminal = formatPackageVulnerabilitiesTerminal(fixture, {
      useColors: false,
    });
    expect(terminal).not.toContain("No summary available");
  });

  it("preserves real summaries (only the placeholder is stripped)", () => {
    const payload = buildPackageVulnerabilitiesSuccessPayload(
      defaultVulnerabilityReport,
    );
    const lean = payload.advisories?.find(
      (a) => a.id === "GHSA-cccc-cccc-cccc",
    );
    expect(lean?.summary).toBe("RCE via crafted JSON body");
  });
});

describe("unrated severity column", () => {
  it("fills the severity gutter for null-CVSS non-malicious advisories", () => {
    const output = formatPackageVulnerabilitiesTerminal(
      defaultVulnerabilityReport,
      { useColors: false, verbose: true },
    );
    // The fixture's null-severity advisory (GHSA-nnnn) used to render
    // with a blank severity column. It now reads "unrated", matching
    // the header-breakdown vocabulary.
    expect(output).toMatch(/unrated\s+GHSA-nnnn-nnnn-nnnn/);
  });
});

describe("affected-range cap adapts to terminal width", () => {
  function buildManyRangesFixture(rangeCount: number): VulnerabilityReport {
    const fixture = structuredClone(defaultVulnerabilityReport);
    const advisory = fixture.security?.vulnerabilities?.[1]; // critical CVE
    if (advisory) {
      advisory.affectedVersionRanges = Array.from(
        { length: rangeCount },
        (_, i) => `==1.${i}.0`,
      );
    }
    return fixture;
  }

  it("narrow terminal (≤119 cols) caps at 4 ranges", () => {
    const output = formatPackageVulnerabilitiesTerminal(
      buildManyRangesFixture(10),
      { useColors: false, terminalWidth: 80 },
    );
    expect(output).toContain("==1.0.0, ==1.1.0, ==1.2.0, ==1.3.0, ...");
    expect(output).toContain("(+6 more; use -v)");
    expect(output).not.toContain("==1.4.0");
  });

  it("wide terminal (120–159 cols) caps at 6 ranges", () => {
    const output = formatPackageVulnerabilitiesTerminal(
      buildManyRangesFixture(10),
      { useColors: false, terminalWidth: 120 },
    );
    expect(output).toContain(
      "==1.0.0, ==1.1.0, ==1.2.0, ==1.3.0, ==1.4.0, ==1.5.0",
    );
    expect(output).toContain("(+4 more; use -v)");
  });

  it("ultrawide terminal (≥160 cols) caps at 8 ranges", () => {
    const output = formatPackageVulnerabilitiesTerminal(
      buildManyRangesFixture(10),
      { useColors: false, terminalWidth: 160 },
    );
    expect(output).toContain("(+2 more; use -v)");
    expect(output).not.toContain("(+4 more");
  });
});
