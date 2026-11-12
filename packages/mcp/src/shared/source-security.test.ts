import { describe, expect, it } from "bun:test";
import type {
  SourceSecurity,
  VulnerabilityReport,
} from "@githits/core-internal";
import {
  sourceAssertionFixture,
  sourceSecurityCases,
  sourceSecurityFixture,
} from "../../../core-internal/src/services/source-security-test-helpers.js";
import {
  buildPackageVulnerabilitiesSuccessPayload,
  formatPackageVulnerabilitiesTerminal,
} from "./package-vulnerabilities-response.js";
import { formatSourceSecurity } from "./source-security.js";
import { terminalWidth } from "./terminal-width.js";

function report(source: SourceSecurity | null): VulnerabilityReport {
  return {
    package: { registry: "NPM", name: "example", version: "1" },
    security: {
      source,
      affectedVulnerabilityCount: 0,
      nonAffectingVulnerabilityCount: 0,
      allVulnerabilityCount: 0,
      assessmentStatus: "NON_AFFECTING",
      currentVersionAffected: false,
      vulnerabilities: [],
    },
  };
}

describe("upstream Git security presentation", () => {
  it.each(sourceSecurityCases)(
    "retains %s JSON without changing native totals",
    (_name, source) => {
      const result = buildPackageVulnerabilitiesSuccessPayload(report(source));
      expect(result.upstreamSource).toEqual(source);
      expect(result.summary.total).toBe(0);
      expect(result.advisories).toBeUndefined();
      const text = formatPackageVulnerabilitiesTerminal(report(source));
      expect(text).toContain("Upstream Git evidence");
      expect(text).toContain("does not establish global safety");
      if (!source || source.totalAssertions === 0) {
        expect(text).not.toContain("0 affected");
        expect(text).not.toContain("filters do not filter");
      }
      if (source && source.affectedVulnerabilityCount === 0)
        expect(text).not.toContain("Unknown ranges can coexist");
    },
  );

  it("qualifies every native zero-result branch at its sentence formatter", () => {
    const source = sourceSecurityFixture();
    for (const scope of [
      undefined,
      "non_affecting",
      "all",
      "unknown",
    ] as const) {
      for (const withRows of [false, true]) {
        const value = report(source);
        value.security!.nonAffectingVulnerabilityCount = withRows ? 1 : 0;
        value.security!.vulnerabilities = withRows
          ? [{ osvId: "native-other", affectsInspectedVersion: false }]
          : [];
        const text = formatPackageVulnerabilitiesTerminal(value, {
          filter: scope ? { advisoryScope: scope } : undefined,
        });
        expect(text).toContain("native package vulnerabilities");
        expect(text).not.toMatch(/No (?:active |confirmed )?vulnerabilities/);
      }
    }
    const unknown = report(source);
    unknown.security!.unknownVulnerabilityCount = 1;
    expect(formatPackageVulnerabilitiesTerminal(unknown)).toContain(
      "No confirmed native package vulnerabilities",
    );
  });

  it("keeps native-zero/source-positive output unambiguous on both surfaces", () => {
    for (const surface of ["cli", "mcp"] as const) {
      const text = formatPackageVulnerabilitiesTerminal(
        report(sourceSecurityFixture()),
        {
          surface,
          filter: {
            minSeverity: "critical",
            advisoryScope: "unknown",
            includeWithdrawn: true,
          },
        },
      );
      expect(text).toContain(
        "No native package vulnerabilities matching the filter",
      );
      expect(text).toContain("native package vulnerabilities");
      expect(text).toContain("1 affected finding");
      expect(text).toContain("do not sum");
      expect(text).toContain("advisory-scope filters do not filter");
      expect(text).not.toContain("No active vulnerabilities affect");
    }
  });

  it("shows incomplete positive, independent range ownership, stale and withdrawn evidence", () => {
    const source = sourceSecurityFixture({
      unknownAssertions: 1,
      sourceStale: true,
      assertions: [
        sourceAssertionFixture({
          complete: false,
          sourceStale: true,
          reasons: ["unresolved_range"],
          otherRepositoryRanges: 2,
        }),
        sourceAssertionFixture({
          sourceId: "withdrawn-id",
          status: "WITHDRAWN",
        }),
      ],
    });
    const text = formatSourceSecurity(source, true, 80);
    for (const expected of [
      "Unknown ranges can coexist",
      "AFFECTED; incomplete; source stale",
      "unresolved_range",
      "Other repository ranges: 2",
      "WITHDRAWN (inactive provenance)",
      "Current digest: current-digest",
      "Assessed digest: assessed-digest",
      "1790000000123456789",
      "2026-11-12T10:00:00Z",
    ])
      expect(text).toContain(expected);
    expect(text).not.toMatch(
      /globally safe|is safe|No upstream vulnerabilities/,
    );
  });

  it("does not cap or dedup the twenty backend assertions", () => {
    const source = sourceSecurityCases.find(
      ([name]) => name === "truncated",
    )![1]!;
    const text = formatSourceSecurity(source, false, 80);
    expect(text.match(/OSV-\d+: AFFECTED/g)).toHaveLength(20);
    expect(text).toContain("truncated by backend (20 shown)");
    expect(text).toContain("22 active");
  });

  it("wraps and sanitizes backend prose while JSON retains it verbatim", () => {
    const source = sourceSecurityFixture({
      reason: "future\nreason\t\u001b[31m",
    });
    source.assertions[0]!.reasons = ["long backend reason ".repeat(6)];
    const text = formatSourceSecurity(source, false, 60);
    expect(text).not.toContain("\u001b");
    expect(text).toContain("future reason");
    // Repository/commit identities are atomic and can exceed the caller width.
    expect(
      text
        .split("\n")
        .filter((line) => !line.includes("https://"))
        .every((line) => terminalWidth(line) <= 60),
    ).toBe(true);
    expect(
      buildPackageVulnerabilitiesSuccessPayload(report(source)).upstreamSource,
    ).toEqual(source);
  });
});
