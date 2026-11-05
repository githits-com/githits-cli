import { describe, expect, it } from "bun:test";
import { defaultAdvisoryLookup } from "../../packages/core-internal/src/services/advisory-test-helpers.js";
import { formatVulns, type VulnsResult } from "./vulns-format.js";
import { buildVulnsResponse } from "./vulns-response.js";

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
  it("preserves the human label for a CVSS v2 vector without a CVSS prefix", () => {
    const item = result();
    item.lookup!.advisory!.severity = [
      {
        type: "CVSS_V2",
        score: "AV:L/AC:M/Au:N/C:N/I:P/A:C",
        source: null,
      },
    ];
    const output = formatVulns([item], { verbose: true });
    expect(output).toContain("CVSS v2: AV:L/AC:M/Au:N/C:N/I:P/A:C");
    expect(output).not.toContain("CVSS v2 vector:");
  });
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
      /Evidence:|Packages: 1\/1|githits pkg vulns|missing evidence does not establish safety|indexed record/,
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
    expect(output).toContain("Repository evidence");
    expect(output.indexOf("introduced: ffff")).toBeLessThan(
      output.indexOf("fixed: aaaa"),
    );
    expect(output).toContain("fixed: aaaa");
    expect(output).toContain("last affected: zzzz");
    expect(output).toContain("limit: *");
    expect(output).not.toContain("(source fix event)");
    expect(output).toContain("CVSS v4 vector:");
    expect(output).toContain("CVSS:4.0/AV:N/AC:L");
    expect(output).toContain("2026-11-03T12:34:56.123456789Z");
    expect(output).toContain("UNSAFE_LINKS_NEUTRALIZED");
    expect(output).toContain("Full source explanation.\n\n  Second paragraph.");
    expect(output).toContain("FUTURE_REFERENCE:\n      URL unavailable");
    expect(output).not.toContain("add --verbose");
  });

  it("names the package evidence record and its relationship in verbose output", () => {
    const item = result();
    const before = JSON.stringify(
      buildVulnsResponse([item], { verbose: true }),
    );
    const output = formatVulns([item], { verbose: true });
    expect(output).toContain("Affected [1]");
    expect(output).toContain(
      "Package evidence sources:\n  [1] GHSA-example (same vulnerability)",
    );
    expect(output).not.toContain("[1] Alias:");
    expect(output).not.toMatch(/local corpus|indexed record|live source/);
    expect(output).toContain("https://osv.dev/vulnerability/GHSA-example");
    expect(output).toContain("Updated: 2026-11-03T00:00:00Z");
    expect(JSON.stringify(buildVulnsResponse([item], { verbose: true }))).toBe(
      before,
    );
    item.lookup!.advisory!.aliases = [];
    expect(formatVulns([item], { verbose: true })).toContain(
      "[1] Related advisory: GHSA-example",
    );
    expect(formatVulns([item], { verbose: true })).not.toContain(
      "(same vulnerability)",
    );
  });

  it("sorts copied verbose version labels naturally while retaining JSON and compact source order", () => {
    const item = result();
    const versions = ["v10.0.0", "v2.0.0", "release10", "release2"];
    const fixes = ["10.0.0", "2.0.0"];
    item.lookup!.advisory!.affected![0]!.versions = [...versions];
    item.lookup!.affectedPackages!.entries[0]!.advisories[0]!.fixedInVersions =
      [...fixes];
    const row = item.lookup!.affectedPackages!.entries[0]!.advisories[0]!;
    row.affectedVersionRanges = [">=10.0.0 <11.0.0", ">=2.0.0 <3.0.0"];
    row.affectedVersionDisplay = null;
    const output = formatVulns([item], { verbose: true, width: 120 });
    expect(output).toContain(
      "Affected versions/tags: release2, release10, v2.0.0, v10.0.0",
    );
    expect(output).toContain("Source fixes: 2.0.0, 10.0.0");
    expect(output).toContain("Affected [1]: >=2.0.0 <3.0.0; >=10.0.0 <11.0.0");
    expect(formatVulns([item])).toContain("Source fixes: 10.0.0, 2.0.0");
    const json = buildVulnsResponse([item], { verbose: true }).results[0]!;
    expect(json.advisory!.originalAffected![0]!.versions).toEqual(versions);
    expect(json.packages![0]!.evidence[0]!.sourceFixVersions).toEqual(fixes);
    expect(json.packages![0]!.evidence[0]!.affectedRanges).toEqual(
      row.affectedVersionRanges!,
    );
  });

  it("avoids repeated aliases, same-time dates and reference scaffolding in verbose text only", () => {
    const item = result();
    const advisory = item.lookup!.advisory!;
    advisory.aliases!.push("EXTRA-alias");
    advisory.publishedAt = advisory.modifiedAt;
    advisory.references = [
      { type: "ADVISORY", url: "https://example.com/one" },
      { type: "FIX", url: "https://example.com/fix" },
      { type: "ADVISORY", url: "https://example.com/one" },
      { type: "ADVISORY", url: "https://example.com/two" },
    ];
    const output = formatVulns([item], { verbose: true });
    expect(output).toContain("Details: OSV-example");
    expect(output).toContain("Aliases: EXTRA-alias");
    expect(output).not.toMatch(/Aliases:.*(?:CVE-example|GHSA-example)/);
    expect(output.match(/https:\/\/example.com\/one/g)).toHaveLength(1);
    expect(output.match(/ {4}ADVISORY:/g)).toHaveLength(1);
    expect(output).not.toContain(`Updated: ${advisory.modifiedAt}`);
    const json = buildVulnsResponse([item], { verbose: true }).results[0]!
      .advisory!;
    expect(json.aliases).toEqual(advisory.aliases!);
    expect(json.references).toEqual(advisory.references!);
    expect(json.modifiedAt).toBe(advisory.modifiedAt!);
    advisory.aliases = [];
    expect(formatVulns([item], { verbose: true })).toContain(
      "Aliases: CVE-example",
    );
    item.lookup!.advisory = null;
    expect(formatVulns([item], { verbose: true })).toContain(
      "Aliases: CVE-example",
    );
  });

  it("omits repeated same-record detail from text and references root JSON, retaining differing observations", () => {
    const item = result();
    const group = item.lookup!.affectedPackages!.entries[0]!;
    const row = group.advisories[0]!;
    group.sourceEvidence = {
      osvId: item.lookup!.advisory!.osvId,
      sourceUrl: item.lookup!.advisory!.sourceUrl,
      withdrawnAt: null,
      affectedVersionRanges: row.affectedVersionRanges,
      fixedInVersions: row.fixedInVersions!,
      affectedVersionDisplay: row.affectedVersionDisplay,
      affected: structuredClone(item.lookup!.advisory!.affected!),
    };
    const output = formatVulns([item], { verbose: true });
    expect(output.match(/introduced: ffff/g)).toHaveLength(1);
    expect(output).not.toContain("Original package evidence");
    const json = buildVulnsResponse([item], { verbose: true }).results[0]!;
    expect(
      json.packages![0]!.evidence[0]!.details![0]!.advisoryAffectedIndexes,
    ).toEqual([0]);
    const other = structuredClone(item.lookup!.advisory!.affected![0]!);
    other.versions = ["other-observation"];
    item.lookup!.advisory!.affected!.push(other);
    expect(formatVulns([item], { verbose: true })).not.toContain(
      "Original package evidence",
    );
    group.sourceEvidence.affected![0]!.ranges[0]!.events[0]!.introduced =
      "package-only";
    const different = formatVulns([item], { verbose: true });
    expect(different).toContain("introduced: package-only");
    expect(different).toContain("introduced: ffff");
  });

  it("groups consecutive same-package original entries and condenses non-Git event lines", () => {
    const item = result();
    const first = item.lookup!.advisory!.affected![0]!;
    first.package = {
      name: "minimatch",
      ecosystem: "npm",
      purl: "pkg:npm/minimatch",
    };
    first.ranges[0]!.type = "SEMVER";
    first.ranges[0]!.repo = null;
    const second = structuredClone(first);
    second.ranges[0]!.events[0]!.introduced = "next-branch";
    item.lookup!.advisory!.affected!.push(second);
    item.lookup!.advisory!.affected!.push(structuredClone(first));
    const output = formatVulns([item], { verbose: true, width: 160 });
    expect(output.match(/Original affected: npm:minimatch/g)).toHaveLength(1);
    expect(output.match(/Purl: pkg:npm\/minimatch/g)).toHaveLength(1);
    expect(output).toContain(
      "SEMVER: introduced: ffff; fixed: aaaa; last affected: zzzz; limit: *",
    );
    expect(output).toContain("SEMVER: introduced: next-branch;");
    expect(output.match(/SEMVER: introduced: ffff/g)).toHaveLength(1);
    expect(
      buildVulnsResponse([item], { verbose: true }).results[0]!.advisory!
        .originalAffected,
    ).toHaveLength(3);
  });

  it("keeps wrapped source paragraphs at a uniform indent", () => {
    const item = result();
    item.lookup!.advisory!.details =
      "A long source explanation that should remain one paragraph. ".repeat(6);
    const output = formatVulns([item], { verbose: true, width: 48 });
    const prose = output
      .split("Details: OSV-example\n")[1]!
      .split("  CVSS v4 vector:")[0]!;
    expect(
      prose
        .trimEnd()
        .split("\n")
        .every((line) => /^ {2}\S/.test(line)),
    ).toBe(true);
  });

  it("prints same-record alias/date metadata once without changing source JSON or hiding different revisions", () => {
    const item = result();
    const root = item.lookup!.advisory!;
    root.publishedAt = "2020-01-01T00:00:00Z";
    const row = item.lookup!.affectedPackages!.entries[0]!.advisories[0]!;
    row.osvId = root.osvId;
    row.sourceUrl = root.sourceUrl;
    row.aliases = [...root.aliases!];
    row.publishedAt = root.publishedAt;
    row.modifiedAt = root.modifiedAt;
    const output = formatVulns([item], { verbose: true });
    expect(output.match(/Aliases: GHSA-example/g)).toHaveLength(1);
    expect(output.match(/Published: 2020-01-01/g)).toHaveLength(1);
    expect(output.match(/Updated: 2026-11-03T12:34:56/g)).toHaveLength(1);
    const source = buildVulnsResponse([item], { verbose: true }).results[0]!
      .sources![0]!;
    expect(source.aliases).toEqual(row.aliases);
    expect(source.modifiedAt).toBe(row.modifiedAt!);
    row.modifiedAt = "different-source-revision";
    expect(formatVulns([item], { verbose: true })).toContain(
      "Updated: different-source-revision",
    );
  });

  it("keeps package-less Git and ecosystem evidence under their own headings", () => {
    for (const reverse of [false, true]) {
      const item = result();
      const git = item.lookup!.advisory!.affected![0]!;
      const ecosystem = structuredClone(git);
      ecosystem.ranges[0]!.type = "ECOSYSTEM";
      ecosystem.ranges[0]!.repo = null;
      item.lookup!.advisory!.affected = reverse
        ? [ecosystem, git]
        : [git, ecosystem];
      const output = formatVulns([item], { verbose: true });
      expect(output).toContain("Original affected: Repository evidence");
      expect(output).toContain("Original affected: Unmapped evidence");
      expect(output.match(/Original affected:/g)).toHaveLength(2);
    }
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
      (_, index) => `==${19 - index}`,
    );
    local.affectedVersionDisplay = null;
    const output = formatVulns([item], { verbose: true });
    expect(output).toContain("raw evidence follows");
    expect(output).toContain("==19");
    expect(output).toContain("Raw affected: ==0; ==1; ==2;");
    expect(
      buildVulnsResponse([item], { verbose: true }).results[0]!.packages![0]!
        .evidence[0]!.details![0]!.rawAffected,
    ).toEqual(local.affectedVersionRanges);
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
    expect(formatVulns([item])).toContain(
      "Full advisory report: add --verbose.",
    );
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
    expect(output).not.toContain("indexed records available");
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
    expect(output).toContain("[2] Alias: GHSA-example | indexed record");
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

it("preserves complete source Markdown structure through final verbose output", () => {
  const item = result();
  const markdown =
    "## Impact\r\n\r\n```go\r\n\tif affected {\r\n\t\treturn err\r\n\t}\r\n```\r\n\r\n| A | B |\r| --- | --- |\r| value | more |\r\n" +
    "Long source paragraph. ".repeat(500) +
    "END-OF-SOURCE\u001b[31m";
  item.lookup!.advisory!.details = markdown;
  const output = formatVulns([item], { verbose: true, width: 48 });
  expect(output).toContain(
    "  ## Impact\n\n  ```go\n      if affected {\n          return err\n      }\n  ```\n\n  | A | B |\n  | --- | --- |\n  | value | more |\n",
  );
  expect(output).toContain(
    `${"Long source paragraph. ".repeat(500)}END-OF-SOURCE`,
  );
  expect(output).not.toContain("\u001b");
  expect(
    buildVulnsResponse([item], { verbose: true }).results[0]!.advisory!
      .explanation,
  ).toBe(markdown);
});

it("advertises the full report only on compact resolved advisory output", () => {
  const item = result();
  expect(formatVulns([item])).toContain("Full advisory report: add --verbose.");
  expect(formatVulns([item], { verbose: true })).not.toContain(
    "Full advisory report: add --verbose.",
  );
  item.lookup!.advisory = null;
  expect(formatVulns([item])).not.toContain(
    "Full advisory report: add --verbose.",
  );
});

it("shows one full-report hint for a multi-ID invocation including partial results", () => {
  const partial = result();
  partial.status = "partial";
  expect(
    formatVulns([result(), partial]).match(
      /Full advisory report: add --verbose\./g,
    ),
  ).toHaveLength(1);
});
