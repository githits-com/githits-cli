import { describe, expect, it } from "bun:test";
import type { VulnerabilityReport } from "../services/index.js";
import { defaultVulnerabilityReport } from "../services/test-helpers.js";
import {
  buildPackageVulnerabilitiesSuccessPayload,
  compareVersionsAscending,
  computeBySeverity,
  formatPackageVulnerabilitiesTerminal,
  vulnSeverityLabel,
} from "./package-vulnerabilities-response.js";

function cloneFixture(): VulnerabilityReport {
  return structuredClone(defaultVulnerabilityReport);
}

function zeroVulnsFixture(): VulnerabilityReport {
  return {
    package: { name: "clean", registry: "NPM", version: "1.0.0" },
    security: {
      vulnerabilityCount: 0,
      currentVersionAffected: false,
      upgradePaths: [],
      vulnerabilities: [],
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
    const total = defaultVulnerabilityReport.security?.vulnerabilityCount ?? 0;
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

describe("buildPackageVulnerabilitiesSuccessPayload — omission rules", () => {
  it("zero-vulns case strips summary blocks and omits advisories", () => {
    const payload = buildPackageVulnerabilitiesSuccessPayload(
      zeroVulnsFixture(),
    );
    expect(payload.summary).toEqual({ total: 0 });
    expect(payload.advisories).toBeUndefined();
    expect(payload.upgradePaths).toBeUndefined();
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

  it("partition invariant: bucket sum equals vulnerabilities.length (and summary.total when backend is consistent)", () => {
    // Client-side guarantee: the six buckets partition
    // `security.vulnerabilities[]`. In the default fixture the
    // backend also keeps `vulnerabilityCount` in sync with the list
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

describe("formatPackageVulnerabilitiesTerminal", () => {
  it("renders zero-vulns hot path as header + one summary body line", () => {
    const output = formatPackageVulnerabilitiesTerminal(zeroVulnsFixture(), {
      useColors: false,
    });
    expect(output).toBe("clean @ 1.0.0 · npm\nNo known vulnerabilities.\n");
  });

  it("renders default terminal block with header, summary, breakdown, advisories, footer", () => {
    const output = formatPackageVulnerabilitiesTerminal(
      defaultVulnerabilityReport,
      { useColors: false },
    );
    expect(output).toContain("express @ 4.18.0 · npm");
    expect(output).toContain("6 known vulnerabilities · latest affected");
    expect(output).toContain("MALWARE");
    expect(output).toContain("GHSA-mmmm-mmmm-mmmm");
    expect(output).toContain("Upgrade to 4.18.2.");
  });

  it("shows MALWARE · crit combined label for malicious + severe advisory", () => {
    const fixture = cloneFixture();
    if (fixture.security?.vulnerabilities?.[0]) {
      fixture.security.vulnerabilities[0].severityScore = 9.5;
    }
    const output = formatPackageVulnerabilitiesTerminal(fixture, {
      useColors: false,
    });
    expect(output).toContain("MALWARE · critical");
  });

  it("omits breakdown line when total is 1", () => {
    const fixture = cloneFixture();
    if (fixture.security) {
      fixture.security.vulnerabilityCount = 1;
      fixture.security.vulnerabilities =
        fixture.security.vulnerabilities?.slice(2, 3) ?? []; // keep one high CVE
    }
    const output = formatPackageVulnerabilitiesTerminal(fixture, {
      useColors: false,
    });
    expect(output).toContain("1 known vulnerability");
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

  it("renders Upgrade options: A, B, C. for multiple paths", () => {
    const fixture = cloneFixture();
    if (fixture.security) {
      fixture.security.upgradePaths = ["4.17.4", "4.18.2"];
    }
    const output = formatPackageVulnerabilitiesTerminal(fixture, {
      useColors: false,
    });
    expect(output).toContain("Upgrade options: 4.17.4, 4.18.2.");
  });

  it("omits upgrade footer when no paths", () => {
    const fixture = cloneFixture();
    if (fixture.security) fixture.security.upgradePaths = [];
    const output = formatPackageVulnerabilitiesTerminal(fixture, {
      useColors: false,
    });
    expect(output).not.toContain("Upgrade");
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
      { useColors: false },
    );
    // Fixture has 6 advisories: 1 malware, 1 crit, 1 high, 1 medium, 1 low,
    // 1 unrated. Breakdown line must enumerate all six to match the total.
    expect(output).toMatch(
      /1 MALWARE · 1 crit · 1 high · 1 medium · 1 low · 1 unrated/,
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
      "affected ==1.0.0, ==1.0.1, ==1.0.2, ==1.0.3, … (+3 more; use -v)",
    );
    expect(output).not.toContain("==1.0.4,");
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

  it("singular vulnerability noun when total is 1", () => {
    const fixture = cloneFixture();
    if (fixture.security) {
      fixture.security.vulnerabilityCount = 1;
      fixture.security.vulnerabilities =
        fixture.security.vulnerabilities?.slice(2, 3) ?? [];
    }
    const output = formatPackageVulnerabilitiesTerminal(fixture, {
      useColors: false,
    });
    expect(output).toContain("1 known vulnerability ·");
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
      { useColors: false },
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
    expect(output).toContain("==1.0.0, ==1.1.0, ==1.2.0, ==1.3.0, …");
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
