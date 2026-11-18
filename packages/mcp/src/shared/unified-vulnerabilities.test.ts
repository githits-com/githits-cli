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
    "uses ordinary %s advisory rows and keeps provenance out of compact text",
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
        /digest-current|REPOSITORY_COMMIT|\[non-affecting\]/,
      );
      expect(text).not.toMatch(/Coverage:|Assessment coverage is incomplete/);
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
  });
  it.each(["AFFECTED", "NON_AFFECTING"])(
    "explains incomplete coverage without weakening the %s verdict or repeating reasons",
    (status) => {
      const r = fixture();
      const row = r.security!.vulnerabilities![0]!;
      row.assessmentStatus = status;
      row.affectsInspectedVersion = status === "AFFECTED";
      row.assessmentReasons = ["RELATED_APPLICABILITY_UNPROVED"];
      r.related = { totalCount: 0, vulnerabilities: [] };
      for (const verbose of [false, true]) {
        const text = formatPackageVulnerabilitiesTerminal(r, { verbose });
        expect(text).toContain(
          "Review the related evidence to establish package applicability.",
        );
        expect(text).toContain(
          status === "AFFECTED" ? "[affects this version]" : "[non-affecting]",
        );
        expect(text).not.toContain("Assessment incomplete.");
        expect(text).not.toContain("    reason");
      }
      expect(
        buildPackageVulnerabilitiesSuccessPayload(r).advisories?.[0]
          ?.assessmentReasons,
      ).toEqual(["RELATED_APPLICABILITY_UNPROVED"]);
    },
  );
  it("groups readable provenance after advisory details while JSON keeps exact fields", () => {
    const r = fixture();
    const evidence = r.security!.vulnerabilities![0]!.evidence![0]!;
    evidence.evaluatedAt = "2026-11-10T12:00:00Z";
    evidence.checkedAt = "2026-11-11T12:00:00Z";
    evidence.sourceStale = true;
    evidence.complete = false;
    evidence.reasons = ["SOURCE_INCOMPLETE"];
    const compact = formatPackageVulnerabilitiesTerminal(r);
    const verbose = formatPackageVulnerabilitiesTerminal(r, {
      verbose: true,
      terminalWidth: 100,
    });
    expect(compact).not.toContain("Evidence:");
    for (const text of [
      "Evidence: repository commit | related | CVE-original | affected; incomplete",
      "Repository: https://github.com/example/mono @aaaaaaaaaaaa (release)",
      "Reason: some repository checks unresolved",
      "Evaluated: 2026-11-10T12:00:00Z",
      "Checked: 2026-11-11T12:00:00Z",
      "Source check: stale.",
      "Source content changed since assessment.",
    ])
      expect(verbose).toContain(text);
    expect(verbose.indexOf("severity")).toBeLessThan(
      verbose.indexOf("Evidence:"),
    );
    expect(verbose).not.toMatch(
      /digest-current|digest-assessed|1790000000123456789|affectedEntryIndices|REPOSITORY_COMMIT|RELATED|\[package applicability unproved\]/,
    );
    expect(
      buildPackageVulnerabilitiesSuccessPayload(r).advisories?.[0]
        ?.evidence?.[0],
    ).toEqual(evidence);
    const narrow = formatPackageVulnerabilitiesTerminal(r, {
      verbose: true,
      terminalWidth: 60,
    });
    for (const line of narrow.split("\n").filter((line) => /^ {4,}/.test(line)))
      expect(line.length).toBeLessThanOrEqual(60);
  });
  it("does not infer freshness or a content change from null evidence", () => {
    const r = fixture();
    const evidence = r.security!.vulnerabilities![0]!.evidence![0]!;
    evidence.contentDigest = null;
    evidence.assessmentStatus = "NON_AFFECTING";
    const verbose = formatPackageVulnerabilitiesTerminal(r, { verbose: true });
    expect(verbose).toContain("CVE-original | non-affecting");
    expect(verbose).toContain("[affects this version]");
    expect(verbose).not.toMatch(/Source check:|Evaluated:|Checked:/);
    expect(verbose).not.toContain("Source content changed since assessment.");
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

it.each(["affected", "unknown"] as const)(
  "shows the specific Related advisory with PACKAGE scope %s instead of a global coverage warning",
  (scope) => {
    const report = fixture();
    Object.assign(report.security!, {
      affectedVulnerabilityCount: 0,
      currentVersionAffected: false,
      assessmentStatus: "NON_AFFECTING",
      vulnerabilities: [],
      upgradePaths: [],
    });
    const text = formatPackageVulnerabilitiesTerminal(report, {
      filter: { advisoryScope: scope },
    });
    expect(text).toContain("No confirmed vulnerabilities affect this version.");
    expect(text).toContain(
      "Related vulnerabilities (package applicability unproved)",
    );
    expect(text).toContain("CVE-related");
    expect(text).toContain("Other component's confirmed advisory");
    expect(text).not.toMatch(
      /Coverage:|coverage is incomplete|retry|wait|Upgrade to/,
    );
    expect(
      buildPackageVulnerabilitiesSuccessPayload(report).summary.total,
    ).toBe(0);
  },
);

it.each(["cli", "mcp"] as const)(
  "ALL verbose follow-up exposes grouped native-negative plus Related-positive evidence in %s",
  (surface) => {
    const report = fixture();
    const mixed = structuredClone(report.security!.vulnerabilities![0]!);
    mixed.osvId = "GHSA-mixed";
    mixed.aliases = ["CVE-mixed"];
    mixed.assessmentStatus = "NON_AFFECTING";
    mixed.affectsInspectedVersion = false;
    mixed.assessmentReasons = ["RELATED_APPLICABILITY_UNPROVED"];
    const source = structuredClone(mixed.evidence![0]!);
    source.sourceId = "CVE-mixed";
    mixed.evidence = [
      {
        ...source,
        kind: "PACKAGE_VERSION",
        relationship: "PACKAGE",
        sourceId: "GHSA-mixed",
        assessmentStatus: "NON_AFFECTING",
      },
      source,
    ];
    report.related = { totalCount: 0, vulnerabilities: [] };
    Object.assign(report.security!, {
      affectedVulnerabilityCount: 0,
      currentVersionAffected: false,
      assessmentStatus: "NON_AFFECTING",
      nonAffectingVulnerabilityCount: 6,
      allVulnerabilityCount: 6,
      upgradePaths: [],
      vulnerabilities: [
        ...Array.from({ length: 5 }, (_, i) => ({
          ...mixed,
          osvId: `GHSA-history-${i}`,
          aliases: [],
          evidence: [],
          assessmentReasons: [],
          assessmentComplete: true,
        })),
        mixed,
      ],
    });
    const compact = formatPackageVulnerabilitiesTerminal(report, {
      surface,
      filter: { advisoryScope: "all" },
    });
    if (surface === "mcp") expect(compact).not.toContain("GHSA-mixed");
    expect(compact).not.toContain("aliases      CVE-mixed");
    const text = formatPackageVulnerabilitiesTerminal(report, {
      surface,
      verbose: true,
      filter: { advisoryScope: "all" },
    });
    const flat = text.replace(/\s+/g, " ");
    expect(text).toContain("GHSA-mixed");
    expect(text).toContain("CVE-mixed");
    expect(flat).toContain(
      "Evidence: package version | package | GHSA-mixed | non-affecting",
    );
    expect(flat).toContain(
      "Evidence: repository commit | related | CVE-mixed | affected",
    );
    expect(text).not.toContain("Related vulnerabilities (");
    expect(text).not.toMatch(/Coverage|Upgrade to/);
    const payload = buildPackageVulnerabilitiesSuccessPayload(report);
    expect(payload.summary.total).toBe(0);
    expect(payload.related?.totalCount).toBe(0);
  },
);

it("keeps package-assessment reasons beside the related evidence action", () => {
  const report = fixture();
  report.security!.vulnerabilities![0]!.assessmentReasons = [
    "RELATED_APPLICABILITY_UNPROVED",
    "INVALID_RANGE",
  ];
  const text = formatPackageVulnerabilitiesTerminal(report).replace(
    /\s+/g,
    " ",
  );
  expect(text).toContain(
    "Review the related evidence to establish package applicability.",
  );
  expect(text).toContain("Advisory range could not be evaluated");
  expect(text).not.toContain("Coverage");
});
