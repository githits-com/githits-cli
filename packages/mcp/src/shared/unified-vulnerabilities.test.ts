import { describe, expect, it } from "bun:test";
import type {
  VulnerabilityEvidence,
  VulnerabilityReport,
} from "@githits/core-internal";
import {
  buildPackageVulnerabilitiesSuccessPayload,
  formatPackageVulnerabilitiesTerminal,
} from "./package-vulnerabilities-response.js";

function fixture(): VulnerabilityReport {
  const evidence: VulnerabilityEvidence = {
    kind: "REPOSITORY_COMMIT",
    relationship: "RELATED",
    sourceId: "CVE-original",
    assessmentStatus: "AFFECTED",
    complete: true,
    reasons: [],
    affectedEntryIndices: [0],
    repositoryUrl: "https://github.com/example/mono",
    commitSha: "a".repeat(40),
    proofKind: "RELEASE",
    sourceModifiedNs: "1790000000123456789",
    contentDigest: "digest-current",
    assessedContentDigest: "digest-assessed",
    evaluatedAt: null,
    checkedAt: null,
    sourceStale: null,
    withdrawnAt: null,
  };
  return {
    package: { registry: "NPM", name: "example", version: "1" },
    security: {
      assessmentComplete: false,
      assessmentReasons: ["RELATED_APPLICABILITY_UNPROVED"],
      assessmentStatus: "AFFECTED",
      affectedVulnerabilityCount: 1,
      nonAffectingVulnerabilityCount: 0,
      unknownVulnerabilityCount: 0,
      allVulnerabilityCount: 1,
      currentVersionAffected: true,
      upgradePaths: ["2"],
      vulnerabilities: [
        {
          osvId: "GHSA-package",
          relationship: "PACKAGE",
          assessmentStatus: "AFFECTED",
          assessmentComplete: false,
          affectsInspectedVersion: true,
          severityScore: 7.5,
          summary: "Canonical package severity and summary",
          evidence: [evidence],
        },
      ],
    },
    related: {
      totalCount: 1,
      vulnerabilities: [
        {
          osvId: "CVE-related",
          relationship: "RELATED",
          assessmentStatus: "NOT_ASSESSED",
          assessmentComplete: false,
          affectsInspectedVersion: false,
          severityScore: 9.8,
          summary: "Other component's confirmed advisory",
          evidence: [evidence],
        },
      ],
    },
  };
}
describe("ordinary package and Related output", () => {
  it("renders history without inventing an inspected release", () => {
    const r = fixture();
    r.package.version = null;
    r.security!.assessmentStatus = "NOT_ASSESSED";
    r.security!.currentVersionAffected = undefined;
    r.security!.affectedVulnerabilityCount = 0;
    expect(buildPackageVulnerabilitiesSuccessPayload(r).version).toBeNull();
    expect(formatPackageVulnerabilitiesTerminal(r)).toContain(
      "no release selected",
    );
  });
  it.each(["cli", "mcp"] as const)(
    "uses same advisory formatter for %s without split-source report",
    (surface) => {
      const r = fixture();
      const text = formatPackageVulnerabilitiesTerminal(r, { surface });
      for (const word of [
        "1 vulnerability affects this version",
        "GHSA-package",
        "Canonical package severity",
        "Related vulnerabilities",
        "CVE-related",
        "Other component's confirmed advisory",
        "package applicability unproved",
      ])
        expect(text).toContain(word);
      expect(text).not.toMatch(
        /Upstream Git evidence|Native package advisories|UPSTREAM_GIT|digest-current|REPOSITORY_COMMIT|\[non-affecting\]/,
      );
      expect(text).toContain(
        "related findings have unproved package applicability",
      );
    },
  );
  it("keeps backend canonical identity/severity and evidence relationships lossless without client alias union", () => {
    const r = fixture();
    r.related!.vulnerabilities[0]!.aliases = ["GHSA-package"];
    const json = buildPackageVulnerabilitiesSuccessPayload(r);
    expect(json.summary.total).toBe(1);
    expect(json.advisories).toHaveLength(1);
    expect(json.advisories?.[0]?.severity).toBe(7.5);
    expect(json.related?.advisories[0]?.severity).toBe(9.8);
    expect(json.advisories?.[0]?.evidence).toEqual(
      r.security!.vulnerabilities![0]!.evidence,
    );
    expect(json.related?.advisories[0]?.assessmentStatus).toBe("NOT_ASSESSED");
    expect(json.upgradePaths).toEqual(["2"]);
    expect(json).not.toHaveProperty("upstreamSource");
  });
  it("renders selected provenance only in verbose text and keeps nullable clocks unavailable", () => {
    const r = fixture();
    const compact = formatPackageVulnerabilitiesTerminal(r);
    const verbose = formatPackageVulnerabilitiesTerminal(r, { verbose: true });
    expect(compact).not.toContain("digest-current");
    for (const word of [
      "REPOSITORY_COMMIT",
      "RELATED",
      "CVE-original",
      "digest-current",
      "digest-assessed",
      "1790000000123456789",
    ])
      expect(verbose).toContain(word);
    expect(
      buildPackageVulnerabilitiesSuccessPayload(r).advisories?.[0]
        ?.evidence?.[0]?.sourceStale,
    ).toBeNull();
  });
  it("does not claim a completed clean result when coverage is incomplete or paging churned", () => {
    const r = fixture();
    Object.assign(r.security!, {
      assessmentStatus: "NON_AFFECTING",
      currentVersionAffected: false,
      affectedVulnerabilityCount: 0,
      vulnerabilities: [],
    });
    r.paginationComplete = false;
    const text = formatPackageVulnerabilitiesTerminal(r);
    expect(text).toContain("No confirmed");
    expect(text).toContain("pagination");
    expect(text).toContain("Related vulnerabilities");
    expect(text).not.toContain("No active vulnerabilities");
  });
});
