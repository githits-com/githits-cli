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
          assessmentComplete: true,
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
  it("shows verified vcpkg source guidance only for the Related row carrying proof", () => {
    const report = fixture();
    report.package = { registry: "VCPKG", name: "curl", version: "8.19.0#0" };
    const proof = {
      version: "8.20.0#0",
      candidateSourceSha: "b".repeat(40),
      fixSha: "c".repeat(40),
    };
    const related = report.related!;
    const row = related.vulnerabilities[0]!;
    related.vulnerabilities.push({ ...row, osvId: "CVE-without-proof" });
    related.totalCount++;
    report.security!.vulnerabilities![0]!.fixedInVersions = ["8.19.0#1"];
    const baseline = buildPackageVulnerabilitiesSuccessPayload(report);
    row.verifiedSourceFix = proof;

    for (const surface of ["cli", "mcp"] as const) {
      const compact = formatPackageVulnerabilitiesTerminal(report, { surface });
      const guidance = "Upstream fix verified in vcpkg source: 8.20.0#0";
      expect(compact).toContain(
        "Related vulnerabilities (package applicability unproved)",
      );
      expect(compact).toMatch(/fixed in\s+8\.19\.0#1/);
      const lines = compact.split("\n");
      expect(lines.filter((line) => line.includes(guidance))).toHaveLength(1);
      const rowIndex = lines.findIndex((line) => line.includes("CVE-related"));
      expect(lines[rowIndex + 1]?.trim()).toBe(guidance);
      expect(compact).toContain("CVE-without-proof");
      expect(compact).not.toContain(proof.candidateSourceSha);
      expect(compact).not.toContain(proof.fixSha);

      const verbose = formatPackageVulnerabilitiesTerminal(report, {
        surface,
        verbose: true,
      });
      expect(verbose).toContain(guidance);
      expect(verbose).toMatch(
        new RegExp(`source SHA\\s+${proof.candidateSourceSha}`),
      );
      expect(verbose).toMatch(new RegExp(`fix SHA\\s+${proof.fixSha}`));
      const verboseLines = verbose.split("\n");
      const source = verboseLines.find((line) => line.includes("source SHA"));
      const fix = verboseLines.find((line) => line.includes("fix SHA"));
      const nativeFix = verboseLines.find((line) => line.includes("fixed in"));
      const valueColumn = nativeFix?.indexOf("8.19.0#1");
      expect(source?.indexOf(proof.candidateSourceSha)).toBe(valueColumn);
      expect(fix?.indexOf(proof.fixSha)).toBe(valueColumn);
    }

    expect(buildPackageVulnerabilitiesSuccessPayload(report)).toEqual({
      ...baseline,
      related: {
        totalCount: 2,
        advisories: [
          { ...baseline.related!.advisories[0], verifiedSourceFix: proof },
          baseline.related!.advisories[1]!,
        ],
      },
    });
  });
  it("offers full reports when only Related rows are returned", () => {
    const report = fixture();
    report.security!.vulnerabilities = [];
    report.security!.affectedVulnerabilityCount = 0;
    report.security!.allVulnerabilityCount = 0;
    report.security!.currentVersionAffected = false;
    const cli = formatPackageVulnerabilitiesTerminal(report, {
      surface: "cli",
    });
    const mcp = formatPackageVulnerabilitiesTerminal(report, {
      surface: "mcp",
    });
    expect(cli).toContain("githits vulns --verbose -- 'CVE-related'");
    expect(cli).toContain("add --details");
    expect(mcp).toContain("use details=true");
    for (const text of [cli, mcp]) {
      expect(text.replace(/\s+/g, " ")).toContain(
        "for selected package and Related advisories.",
      );
    }
  });
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
  it.each(["AFFECTED", "UNKNOWN"])(
    "explains incomplete coverage without weakening the %s verdict or repeating reasons",
    (status) => {
      const r = fixture();
      const row = r.security!.vulnerabilities![0]!;
      row.assessmentStatus = status;
      row.affectsInspectedVersion = status === "AFFECTED";
      row.assessmentReasons = ["INVALID_RANGE"];
      row.assessmentComplete = false;
      r.related = { totalCount: 0, vulnerabilities: [] };
      for (const verbose of [false, true]) {
        const text = formatPackageVulnerabilitiesTerminal(r, { verbose });
        expect(text).toContain("Advisory range could not be evaluated");
        expect(text).toContain(
          status === "AFFECTED" ? "[affects this version]" : "[unknown]",
        );
        expect(text).not.toContain("Assessment incomplete.");
        expect(text).not.toContain("    reason");
      }
      expect(
        buildPackageVulnerabilitiesSuccessPayload(r).advisories?.[0]
          ?.assessmentReasons,
      ).toEqual(["INVALID_RANGE"]);
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
      "Reason: Some advisory results could not be determined",
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
  "keeps the backend resolved result beside contradictory raw provenance in %s",
  (surface) => {
    const report = fixture();
    const row = report.security!.vulnerabilities![0]!;
    row.osvId = "GHSA-fixed";
    row.aliases = ["CVE-broader"];
    row.assessmentStatus = "NON_AFFECTING";
    row.affectsInspectedVersion = false;
    row.assessmentComplete = true;
    row.assessmentReasons = [];
    const source = structuredClone(row.evidence![0]!);
    source.sourceId = "CVE-broader";
    source.contentDigest = "same";
    source.assessedContentDigest = "same";
    row.evidence = [
      {
        ...source,
        kind: "PACKAGE_VERSION",
        relationship: "PACKAGE",
        sourceId: "GHSA-fixed",
        assessmentStatus: "NON_AFFECTING",
      },
      source,
    ];
    report.related = { totalCount: 0, vulnerabilities: [] };
    Object.assign(report.security!, {
      affectedVulnerabilityCount: 0,
      nonAffectingVulnerabilityCount: 1,
      allVulnerabilityCount: 1,
      currentVersionAffected: false,
      assessmentStatus: "NON_AFFECTING",
      assessmentComplete: true,
      assessmentReasons: [],
      upgradePaths: [],
    });
    const before = structuredClone(row.evidence);
    for (const verbose of [false, true]) {
      const text = formatPackageVulnerabilitiesTerminal(report, {
        surface,
        verbose,
        filter: { advisoryScope: "all" },
      });
      expect(text).toContain("No active vulnerabilities affect this version");
      expect(text).toContain("GHSA-fixed");
      expect(text).not.toMatch(
        /Coverage|Review|package applicability|--scope all --verbose|Some advisory/,
      );
      if (verbose) {
        const flat = text.replace(/\s+/g, " ");
        expect(flat).toContain(
          "Evidence: package version | package | GHSA-fixed | non-affecting",
        );
        expect(flat).toContain(
          "Evidence: repository commit | related | CVE-broader | affected",
        );
      }
    }
    const payload = buildPackageVulnerabilitiesSuccessPayload(report);
    expect(payload.summary.total).toBe(0);
    expect(payload.summary.assessmentComplete).toBe(true);
    expect(payload.summary.assessmentReasons).toEqual([]);
    expect(payload.advisories?.[0]?.evidence).toEqual(before);
  },
);
