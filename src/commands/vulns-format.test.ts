import { describe, expect, it } from "bun:test";
import { defaultAdvisoryLookup } from "../../packages/core-internal/src/services/advisory-test-helpers.js";
import { formatVulns, type VulnsResult } from "./vulns-format.js";

function result(): VulnsResult {
  const lookup = structuredClone(defaultAdvisoryLookup);
  lookup.advisory!.aliases!.push("GHSA-example");
  return {
    inputId: "CVE-example",
    status: "success",
    lookup,
    packagePagination: { complete: true, pagesRead: 1 },
  };
}

describe("vulns formatter", () => {
  it("leads with requested identity and attributed CVSS, labels aliases and omits healthy boilerplate", () => {
    const output = formatVulns([result()]);
    expect(output).toStartWith(
      "CVE-example | 1 package\nCVSS v3: 7.5\nResolved advisory: OSV-example\nSource résumé with Unicode",
    );
    expect(output).toContain("https://www.npmjs.com/package/minimatch");
    expect(output).toContain("Affected: >=10.0.0 <10.2.1");
    expect(output).toContain("Source fixes: 10.2.1");
    expect(output).toContain("Alias: GHSA-example");
    expect(output).toContain("https://osv.dev/vulnerability/GHSA-example");
    expect(output).not.toMatch(
      /Evidence:|Packages: 1\/1|githits pkg vulns|add --verbose|missing evidence does not establish safety|local corpus/,
    );
    expect(output).not.toContain("Full source explanation");
  });

  it("prints shared source metadata and scores once across packages", () => {
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
    expect(output.match(/CVSS v3: 7.5/g)).toHaveLength(1);
    expect(output).not.toContain("githits pkg vulns");
    expect(output.match(/Affected:/g)).toHaveLength(2);
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

  it("marks withdrawn/malicious evidence next to its package reference without synthetic scores", () => {
    const item = result();
    const local = item.lookup!.affectedPackages!.entries[0]!.advisories[0]!;
    local.withdrawnAt = "2026-11-03T00:00:00Z";
    local.isMalicious = true;
    local.severityType = "SEVERITY_LABEL";
    item.status = "partial";
    item.packagePagination!.complete = false;
    const output = formatVulns([item], { width: 120 });
    expect(output).toContain("Affected [WITHDRAWN MALICIOUS]");
    expect(output).toContain("[MALICIOUS] [WITHDRAWN]");
    expect(output).not.toMatch(/CVSS|approximation|7\.5/);
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
    expect(formatVulns([item])).toContain("Affected: unknown");
    expect(formatVulns([item])).not.toContain("Affected: none reported");
    row.affectedVersionRanges = [];
    expect(formatVulns([item])).toContain("Affected: none reported");
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
    expect(output).not.toContain("Go entries");
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

  it("empty mappings state the result without generic guidance", () => {
    const item = result();
    item.lookup!.affectedPackages!.entries = [];
    item.lookup!.affectedPackages!.pageInfo.totalCount = 0;
    expect(formatVulns([item])).toStartWith("CVE-example | 0 packages");
    expect(formatVulns([item])).not.toContain(
      "missing evidence does not establish safety",
    );
    expect(formatVulns([item])).not.toContain("add --verbose");
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
      ">=6.0.0 <6.2.1",
      ">=5.0.0 <5.1.7",
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
        .find((line) => line.trimStart().startsWith(">="));
      expect(continuation).toStartWith("      ");
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

  it("shows conflicting CVSS reports at the top with their source references", () => {
    const item = result();
    const group = item.lookup!.affectedPackages!.entries[0]!;
    group.advisories.push({
      ...structuredClone(group.advisories[0]!),
      severityScore: 9.8,
    });
    const output = formatVulns([item]);
    expect(output).toStartWith(
      "CVE-example | 1 package\nCVSS v3: 7.5 [1]\nCVSS v3: 9.8 [2]\n",
    );
  });

  it("deduplicates a shared alias summary without promoting a related record's summary", () => {
    const item = result();
    item.lookup!.advisory!.summary = null;
    const group = item.lookup!.affectedPackages!.entries[0]!;
    group.advisories.push({
      ...structuredClone(group.advisories[0]!),
      severityScore: 9.8,
    });
    let output = formatVulns([item]);
    expect(output.match(/Local source evidence/g)).toHaveLength(1);
    expect(output.indexOf("Local source evidence")).toBeLessThan(
      output.indexOf("npm:minimatch"),
    );
    item.lookup!.advisory!.aliases = [];
    output = formatVulns([item]);
    expect(output.indexOf("Local source evidence")).toBeGreaterThan(
      output.indexOf("npm:minimatch"),
    );
  });

  it("distinguishes proven aliases from source records without a resolved advisory", () => {
    const item = result();
    item.lookup!.advisory!.aliases = ["GHSA-example"];
    expect(formatVulns([item])).toContain("Alias: GHSA-example");
    expect(formatVulns([item])).toContain(
      "https://osv.dev/vulnerability/GHSA-example",
    );
    expect(formatVulns([item])).not.toMatch(/Affected \[1\]|Advisory records:/);
    item.lookup!.advisory = null;
    expect(formatVulns([item])).toContain("Source: GHSA-example");
    expect(formatVulns([item])).not.toContain("Alias:");
  });

  it("puts concrete incomplete coverage ahead of packages without repeating healthy statuses", () => {
    const item = result();
    item.packagePagination!.complete = false;
    item.lookup!.affectedPackages!.pageInfo.totalCount = 5;
    item.lookup!.affectedPackages!.coverage.sourceStatus = "UNAVAILABLE";
    const output = formatVulns([item]);
    expect(output).toContain("Package coverage: 1/5 (INCOMPLETE).");
    expect(output).toContain("Missing evidence: live source unavailable.");
    expect(output.indexOf("Package coverage")).toBeLessThan(
      output.indexOf("npm:minimatch"),
    );
    expect(output).not.toContain("local corpus available");
  });

  it("distinguishes live and local observations when their record identity repeats", () => {
    const item = result();
    const group = item.lookup!.affectedPackages!.entries[0]!;
    const row = group.advisories[0]!;
    row.summary = item.lookup!.advisory!.summary;
    row.severityType = "SEVERITY_LABEL";
    group.sourceEvidence = {
      osvId: row.osvId!,
      sourceUrl: row.sourceUrl,
      withdrawnAt: null,
      affectedVersionRanges: row.affectedVersionRanges,
      fixedInVersions: row.fixedInVersions!,
      affectedVersionDisplay: row.affectedVersionDisplay,
    };
    const output = formatVulns([item]);
    expect(output).toContain("[1] Alias: GHSA-example | live source");
    expect(output).toContain("[2] Alias: GHSA-example | local corpus");
    expect(output).toContain("Affected [1, 2]");
  });

  it.each([false, true])(
    "keeps unrelated or unresolved scores on their own source rows (unresolved=%s)",
    (unresolved) => {
      const item = result();
      if (unresolved) item.lookup!.advisory = null;
      else item.lookup!.advisory!.aliases = [];
      const output = formatVulns([item]);
      expect(output).not.toContain("\nCVSS v3:");
      expect(output).toContain(
        ` [1] ${unresolved ? "Source" : "Related advisory"}: GHSA-example | CVSS v3: 7.5`,
      );
      expect(output.indexOf("CVSS v3:")).toBeGreaterThan(
        output.indexOf("npm:minimatch"),
      );
    },
  );

  it("omits redundant same-ID source identity while preserving malicious markers", () => {
    const item = result();
    const row = item.lookup!.affectedPackages!.entries[0]!.advisories[0]!;
    row.osvId = item.lookup!.advisory!.osvId;
    row.sourceUrl = item.lookup!.advisory!.sourceUrl;
    row.summary = item.lookup!.advisory!.summary;
    expect(formatVulns([item])).not.toContain("Advisory: OSV-example");
    row.isMalicious = true;
    expect(formatVulns([item])).toContain("Advisory: OSV-example [MALICIOUS]");
  });

  it("avoids repeated ambiguity/not-found status while retaining partial local-only coverage", () => {
    const item = result();
    item.lookup!.advisory = null;
    item.lookup!.affectedPackages!.coverage.sourceStatus = "AMBIGUOUS";
    item.lookup!.unknownDetails = [
      {
        section: "ADVISORY",
        code: "AMBIGUOUS_VULNERABILITY_ID",
        message: "Choose a record",
        retryable: false,
        candidateIds: ["GHSA-example"],
        candidateIdsTruncated: false,
      },
    ];
    item.status = "partial";
    expect(formatVulns([item])).not.toContain("Missing evidence:");
    item.lookup!.unknownDetails = [
      {
        ...item.lookup!.unknownDetails[0]!,
        code: "NOT_FOUND",
        message: "No source record",
        candidateIds: null,
      },
    ];
    item.lookup!.affectedPackages!.coverage.sourceStatus = "NOT_FOUND";
    expect(formatVulns([item])).toContain(
      "Missing evidence: live source not found.",
    );
    item.lookup!.affectedPackages!.entries = [];
    item.lookup!.affectedPackages!.pageInfo.totalCount = 0;
    item.status = "error";
    expect(formatVulns([item])).not.toContain("Missing evidence:");
  });
});
