import { describe, expect, it } from "bun:test";
import { defaultAdvisoryLookup } from "../../packages/core-internal/src/services/advisory-test-helpers.js";
import { formatVulns, type VulnsResult } from "./vulns-format.js";

function result(): VulnsResult {
  return {
    inputId: "CVE-example",
    status: "success",
    lookup: structuredClone(defaultAdvisoryLookup),
    packagePagination: { complete: true, pagesRead: 1 },
  };
}

describe("vulns formatter", () => {
  it("leads with identity/summary/count, links packages and attributes source references", () => {
    const output = formatVulns([result()]);
    expect(output).toStartWith(
      "CVE-example -> OSV-example | 1 package\nSource résumé with Unicode",
    );
    expect(output).toContain("https://www.npmjs.com/package/minimatch");
    expect(output).toContain("Affected [1]: >=10.0.0 <10.2.1");
    expect(output).toContain("Source fixes: 10.2.1");
    expect(output).toContain("[1] GHSA-example | local corpus | 7.5 (CVSS v3)");
    expect(output).toContain("https://osv.dev/vulnerability/GHSA-example");
    expect(output).toContain(
      "githits pkg vulns '<target>@<installed-version>'",
    );
    expect(output).toContain("live source available; local corpus available");
    expect(output).not.toContain("Full source explanation");
  });

  it("prints shared source metadata and one assessment template across packages", () => {
    const item = result();
    const groups = item.lookup!.affectedPackages!.entries;
    groups.push({
      ...structuredClone(groups[0]!),
      package: { registry: "NPM", name: "another", ecosystem: "npm" },
    });
    item.lookup!.affectedPackages!.pageInfo.totalCount = 2;
    const output = formatVulns([item]);
    expect(
      output.match(/https:\/\/osv.dev\/vulnerability\/GHSA-example/g),
    ).toHaveLength(1);
    expect(output.match(/7.5 \(CVSS v3\)/g)).toHaveLength(1);
    expect(output.match(/githits pkg vulns/g)).toHaveLength(1);
    expect(output.match(/Affected \[1\]/g)).toHaveLength(2);
  });

  it("verbose retains original Git event order, raw vectors, revisions and normalization", () => {
    const output = formatVulns([result()], { verbose: true, width: 120 });
    expect(output).toContain("package-less repository/commit evidence");
    expect(output.indexOf("introduced: ffff")).toBeLessThan(
      output.indexOf("fixed: aaaa"),
    );
    expect(output).toContain("fixed: aaaa (source fix event)");
    expect(output).toContain("lastAffected: zzzz (boundary, not a fix)");
    expect(output).toContain("limit: * (boundary, not a fix)");
    expect(output).toContain("CVSS:4.0/AV:N/AC:L");
    expect(output).toContain("2026-11-03T12:34:56.123456789Z");
    expect(output).toContain("UNSAFE_LINKS_NEUTRALIZED");
    expect(output).toContain("Full source explanation.\n\n  Second paragraph.");
    expect(output).toContain("FUTURE_REFERENCE: URL unavailable");
    expect(output).not.toContain("add --verbose");
  });

  it("marks withdrawn/malicious evidence next to its package reference and preserves label qualification", () => {
    const item = result();
    const local = item.lookup!.affectedPackages!.entries[0]!.advisories[0]!;
    local.withdrawnAt = "2026-11-03T00:00:00Z";
    local.isMalicious = true;
    local.severityType = "SEVERITY_LABEL";
    item.status = "partial";
    item.packagePagination!.complete = false;
    const output = formatVulns([item], { width: 120 });
    expect(output).toContain("Affected [1 WITHDRAWN MALICIOUS]");
    expect(output).toContain("[MALICIOUS] [WITHDRAWN]");
    expect(output).toContain("label approximation, not calculated CVSS");
    expect(output).toContain("INCOMPLETE");
  });

  it("shows all normalized spans and distinguishes unknown from no source fixes", () => {
    const item = result();
    const row = item.lookup!.affectedPackages!.entries[0]!.advisories[0]!;
    row.affectedVersionRanges = ["first", "second", "third", "fourth"];
    row.affectedVersionDisplay = {
      ranges: ["first", "second", "third", "fourth"],
      totalCount: 4,
      truncated: false,
    };
    row.fixedInVersions = [];
    const output = formatVulns([item]);
    expect(output).toContain("first; second; third; fourth");
    expect(output).not.toContain("truncated");
    expect(output).toContain("Source fixes: none reported");
    row.fixedInVersions = null;
    row.affectedVersionRanges = null;
    row.affectedVersionDisplay = {
      ranges: ["first"],
      totalCount: 4,
      truncated: true,
    };
    expect(formatVulns([item])).toContain("Source fixes: unknown");
    expect(formatVulns([item])).toContain("1 of 4 spans");
  });

  it("keeps null affected evidence unknown when the display fallback has no spans", () => {
    const item = result();
    const row = item.lookup!.affectedPackages!.entries[0]!.advisories[0]!;
    row.affectedVersionRanges = null;
    row.affectedVersionDisplay = {
      ranges: [],
      totalCount: 0,
      truncated: false,
    };
    expect(formatVulns([item])).toContain("Affected [1]: unknown");
    expect(formatVulns([item])).not.toContain("Affected [1]: none reported");
    row.affectedVersionRanges = [];
    expect(formatVulns([item])).toContain("Affected [1]: none reported");
  });

  it("verbose raw evidence does not recommend verbose again for a large fallback", () => {
    const item = result();
    const local = item.lookup!.affectedPackages!.entries[0]!.advisories[0]!;
    local.affectedVersionRanges = Array.from(
      { length: 20 },
      (_, index) => `==${index}`,
    );
    local.affectedVersionDisplay = null;
    const output = formatVulns([item], { verbose: true });
    expect(output).toContain("raw evidence follows");
    expect(output).toContain("==19");
    expect(output).not.toContain("--verbose");
  });

  it("keeps unfamiliar ecosystem identity without fabricated links or actions", () => {
    const item = result();
    item.lookup!.affectedPackages!.entries[0]!.package = {
      name: "future",
      registry: null,
      ecosystem: "NEW_OS",
    };
    item.lookup!.affectedPackages!.coverage.sourceStatus = "FUTURE";
    const output = formatVulns([item]);
    expect(output).toContain("NEW_OS:future (unmapped registry)");
    expect(output).toContain("live source future");
    expect(output).not.toContain("githits pkg vulns");
  });

  it("puts ambiguity and candidate actions before retained package evidence", () => {
    const item = result();
    item.status = "partial";
    item.lookup!.advisory = null;
    item.lookup!.unknownDetails = [
      {
        section: "ADVISORY",
        code: "AMBIGUOUS_VULNERABILITY_ID",
        message: "Pick a source",
        retryable: false,
        candidateIds: ["GHSA-a", "OSV-b"],
        candidateIdsTruncated: true,
      },
    ];
    const output = formatVulns([item]);
    expect(output.indexOf("Pick a source")).toBeLessThan(
      output.indexOf("npm:minimatch"),
    );
    expect(output).toContain("Candidates (more omitted): GHSA-a, OSV-b");
    expect(output).toContain("githits vulns <candidate-id>");
    expect(output).not.toContain("retryable=false");
  });

  it("error-only results omit mappings, source hints and safety boilerplate", () => {
    const output = formatVulns([
      {
        inputId: "bad id",
        status: "error",
        error: {
          code: "VALIDATION_ERROR",
          error: "Invalid ID",
          retryable: false,
        },
      },
    ]);
    expect(output).toBe("bad id | error\n  VALIDATION_ERROR: Invalid ID\n");
  });

  it.each(["cve-2026-26996", "ghsa-3ppc-4f35-3m26", "GHSA-3PPC-4F35-3M26"])(
    "suggests known-prefix casing without changing the input %s",
    (inputId) => {
      const output = formatVulns([
        {
          inputId,
          status: "error",
          error: {
            code: "NOT_FOUND",
            error: "No source record found",
            retryable: false,
          },
        },
      ]);
      expect(output).toStartWith(`${inputId} | error`);
      expect(output).toContain("IDs are case-sensitive; try");
      expect(output).not.toContain("--verbose");
    },
  );

  it("does not offer broken Go import/stdlib assessment commands", () => {
    const item = result();
    item.lookup!.affectedPackages!.entries[0]!.package = {
      registry: "GO",
      name: "stdlib",
      ecosystem: "Go",
    };
    const output = formatVulns([item]);
    expect(output).toContain("https://pkg.go.dev/std");
    expect(output).not.toContain("githits pkg vulns");
    expect(output).toContain("Go release");
  });

  it("wraps prose and sanitizes all terminal fields while preserving Unicode", () => {
    const item = result();
    item.lookup!.advisory!.summary =
      `${"Repeated source prose for width verification ".repeat(4)}résumé`;
    item.lookup!.affectedPackages!.entries[0]!.package.name =
      "bad\u001b[31m-name";
    item.lookup!.affectedPackages!.entries[0]!.advisories[0]!.fixedInVersions =
      ["fix\u0007-version"];
    for (const width of [48, 80, 120]) {
      const output = formatVulns([item], { width });
      expect(output).not.toContain(String.fromCharCode(27));
      expect(output).not.toContain(String.fromCharCode(7));
      expect(output).toContain("résumé");
      expect(output).toContain("fix-version");
      expect(
        output
          .split("\n")
          .filter(
            (line) =>
              line.includes("Repeated") || line.includes("verification"),
          )
          .every((line) => line.length <= width),
      ).toBe(true);
    }
  });

  it("keeps unevaluable expressions in JSON, but labels them as unknown evidence in text", () => {
    const item = result();
    const local = item.lookup!.affectedPackages!.entries[0]!.advisories[0]!;
    local.affectedVersionRanges = ["osv-invalid:source-marker"];
    local.affectedVersionDisplay = null;
    expect(formatVulns([item])).toContain("(unevaluable source range)");
    expect(formatVulns([item])).not.toContain("osv-invalid:");
  });

  it("empty mappings point to source evidence without a circular verbose hint", () => {
    const item = result();
    item.lookup!.affectedPackages!.entries = [];
    item.lookup!.affectedPackages!.pageInfo.totalCount = 0;
    expect(formatVulns([item])).toContain("No named package mappings");
    expect(formatVulns([item])).toContain(
      "missing evidence does not establish safety",
    );
    expect(formatVulns([item])).toContain("add --verbose");
    expect(formatVulns([item], { verbose: true })).not.toContain(
      "add --verbose",
    );
  });

  it("identifies inputs not attempted after admission stopped", () => {
    const output = formatVulns([
      {
        inputId: "another",
        status: "error",
        error: {
          code: "AUTH_REQUIRED",
          error: "Authentication required.",
          retryable: false,
          details: { notAttempted: true },
        },
      },
    ]);
    expect(output).toContain("Not attempted after an earlier access failure.");
    expect(output).not.toContain("Remaining pages");
  });

  it("keeps spans whole with hanging continuation indentation at narrow widths", () => {
    const item = result();
    const row = item.lookup!.affectedPackages!.entries[0]!.advisories[0]!;
    row.affectedVersionRanges = [
      ">=10.0.0 <10.2.1",
      ">=9.0.0 <9.0.6",
      ">=8.0.0 <8.0.5",
      ">=7.0.0 <7.4.7",
    ];
    row.affectedVersionDisplay = null;
    for (const width of [48, 80]) {
      const output = formatVulns([item], { width });
      for (const span of row.affectedVersionRanges)
        expect(output.split("\n").some((line) => line.includes(span))).toBe(
          true,
        );
      const continuation = output
        .split("\n")
        .find(
          (line) =>
            line.trimStart().startsWith(">=9.0.0") ||
            line.trimStart().startsWith(">=7.0.0"),
        );
      expect(continuation).toStartWith("      ");
      row.severityType = "SEVERITY_LABEL";
      row.osvId = "GHSA-3ppc-4f35-3m26";
      const sourceLines = formatVulns([item], { width }).split("\n");
      const header = sourceLines.findIndex((line) => line.startsWith("  [1]"));
      expect(sourceLines[header + 1]).toStartWith("    ");
      expect(sourceLines.slice(header, header + 4).join(" ")).toMatch(
        /label approximation,\s+not\s+calculated\s+CVSS/,
      );
    }
  });

  it("prints a common withdrawal date once while preserving differing source dates", () => {
    const item = result();
    item.lookup!.advisory!.withdrawnAt = "2026-11-03T00:00:00Z";
    const row = item.lookup!.affectedPackages!.entries[0]!.advisories[0]!;
    row.withdrawnAt = item.lookup!.advisory!.withdrawnAt;
    expect(
      formatVulns([item]).match(/Withdrawn: 2026-11-03T00:00:00Z/g),
    ).toHaveLength(1);
    row.withdrawnAt = "2026-11-02T00:00:00Z";
    expect(formatVulns([item])).toContain("Withdrawn: 2026-11-02T00:00:00Z");
  });
});
