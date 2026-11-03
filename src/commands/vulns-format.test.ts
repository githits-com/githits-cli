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
  it("leads with package evidence, attributes live/local independently and gives installed-version follow-up", () => {
    const output = formatVulns([result()]);
    expect(output.indexOf("npm:minimatch")).toBeLessThan(
      output.indexOf("Source advisory"),
    );
    expect(output).toContain("GHSA-example [local corpus]");
    expect(output).toContain("Source fixes: 10.2.1");
    expect(output).toContain(
      "githits pkg vulns 'npm:minimatch@<installed-version>'",
    );
    expect(output).toContain("https://osv.dev/vulnerability/GHSA-example");
    expect(output).toContain("Source advisory: OSV-example");
    expect(output).toContain("Requested: CVE-example; served: OSV-example");
    expect(output).toContain("live source AVAILABLE; local corpus AVAILABLE");
    expect(output).not.toContain("Source explanation:");
  });
  it("verbose retains package-less Git event order, raw vectors, precise revisions and normalization", () => {
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
    expect(output).toContain("Full source explanation.");
    expect(output).toContain("FUTURE_REFERENCE: URL unavailable");
    expect(output).toContain("résumé with Unicode");
  });
  it("marks withdrawal, source severity-label approximations and range/page truncation", () => {
    const item = result();
    const local = item.lookup!.affectedPackages!.entries[0]!.advisories[0]!;
    local.withdrawnAt = "2026-11-03T00:00:00Z";
    local.severityType = "SEVERITY_LABEL";
    local.affectedVersionDisplay = {
      ranges: ["display-one"],
      totalCount: 3,
      truncated: true,
    };
    item.packagePagination!.complete = false;
    const output = formatVulns([item], { width: 120 });
    expect(output).toContain("[WITHDRAWN]");
    expect(output).toContain("label approximation, not calculated CVSS");
    expect(output).toContain("Display truncated: 1 of 3 spans");
    expect(output).toContain("INCOMPLETE pagination");
  });
  it("shows unknown ecosystems/coverage and never fabricates a registry or package command", () => {
    const item = result();
    item.lookup!.affectedPackages!.entries[0]!.package = {
      name: "future",
      registry: null,
      ecosystem: "NEW_OS",
    };
    item.lookup!.affectedPackages!.coverage.sourceStatus = "FUTURE";
    const output = formatVulns([item]);
    expect(output).toContain("NEW_OS (unmapped registry):future");
    expect(output).toContain("live source FUTURE");
    expect(output).not.toContain("githits pkg vulns");
  });
  it("shows empty evidence as unknown and ambiguity candidates/truncation and retryability", () => {
    const item = result();
    item.lookup!.advisory = null;
    item.lookup!.affectedPackages!.entries = [];
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
    const output = formatVulns([item], { width: 120 });
    expect(output).toContain("No named package mappings");
    expect(output).toContain("Candidates (truncated): GHSA-a, OSV-b");
    expect(output).toContain("retryable=false");
  });
  it("wraps prose, sanitizes all terminal fields and retains printable Unicode", () => {
    const item = result();
    item.lookup!.advisory!.summary =
      `${"Repeated source prose for width verification ".repeat(4)}résumé`;
    item.lookup!.affectedPackages!.entries[0]!.package.name =
      "bad\u001b[31m-name";
    item.lookup!.affectedPackages!.entries[0]!.advisories[0]!.fixedInVersions =
      ["fix\u0007-version"];
    const output = formatVulns([item], { width: 48 });
    expect(output).not.toContain(String.fromCharCode(27));
    expect(output).not.toContain(String.fromCharCode(7));
    expect(output).toContain("résumé");
    expect(output).toContain("fix-version");
    expect(
      output
        .split("\n")
        .filter(
          (line) => line.includes("Repeated") || line.includes("verification"),
        )
        .every((line) => line.length <= 48),
    ).toBe(true);
  });
});

describe("source package evidence", () => {
  it("attributes named source entries separately, preserving raw ranges and normalization", () => {
    const item = result();
    const group = item.lookup!.affectedPackages!.entries[0]!;
    group.sourceEvidence = {
      osvId: "OSV-example",
      sourceUrl: "https://osv.dev/vulnerability/OSV-example",
      modifiedAt: "2026-11-03T00:00:00.123456789Z",
      withdrawnAt: null,
      affected: [],
      affectedVersionRanges: ["osv-invalid:source-marker"],
      fixedInVersions: [],
      affectedVersionDisplay: null,
      contentSafety: { filtered: true, modifications: [] },
    };
    const output = formatVulns([item], { verbose: true, width: 120 });
    expect(output).toContain("OSV-example [live source]");
    expect(output).toContain("GHSA-example [local corpus]");
    expect(output).toContain("osv-invalid:source-marker");
    expect(output).toContain("Source fixes: unknown");
  });
  it("compact empty mappings point to original/package-less source evidence", () => {
    const item = result();
    item.lookup!.affectedPackages!.entries = [];
    const output = formatVulns([item], { width: 120 });
    expect(output).toContain("does not establish non-affectedness");
    expect(output.replace(/\s+/g, " ")).toContain(
      "Use --verbose for original source/Git evidence",
    );
  });
});
