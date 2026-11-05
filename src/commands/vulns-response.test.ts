import { describe, expect, it } from "bun:test";
import { defaultAdvisoryLookup } from "../../packages/core-internal/src/services/advisory-test-helpers.js";
import { buildVulnsResponse, type VulnsResult } from "./vulns-response.js";

function result(): VulnsResult {
  return {
    inputId: " CVE-example ",
    status: "success",
    lookup: structuredClone(defaultAdvisoryLookup),
    packagePagination: { complete: true, pagesRead: 1 },
  };
}

function report(item = result(), verbose = false) {
  return buildVulnsResponse([item], { verbose }).results[0]!;
}

describe("vulns response", () => {
  it("exposes source fixes without a positional range mapping", () => {
    const item = result();
    const row = item.lookup!.affectedPackages!.entries[0]!.advisories[0]!;
    row.affectedVersionDisplay = null;
    row.affectedVersionRanges = ["<2", ">=3 <4", ">=5"];
    row.fixedInVersions = ["4", "2"];
    const evidence = report(item).packages![0]!.evidence[0]!;
    expect(evidence).toMatchObject({
      affectedRanges: ["<2", ">=3 <4", ">=5"],
      sourceFixVersions: ["4", "2"],
    });
    expect(evidence).not.toHaveProperty("fixed");
    expect(evidence).not.toHaveProperty("affected");
  });

  it("separates reported numeric scores, CVSS vectors and opaque severity values", () => {
    const item = result();
    item.lookup!.advisory!.severity!.push({
      type: "FUTURE_SEVERITY",
      score: "opaque-source-value",
      source: "provider",
    });
    item.lookup!.advisory!.severity!.push({
      type: "CVSS_V2",
      score: "AV:L/AC:M/Au:N/C:N/I:P/A:C",
      source: null,
    });
    item.lookup!.advisory!.affected![0]!.severity = [
      { type: "CVSS_V3", score: "CVSS:3.1/AV:N", source: null },
    ];
    const output = report(item, true);
    expect(output.sources![0]!.severity!.score).toBe(7.5);
    expect(output.advisory!.severity).toEqual([
      { type: "CVSS_V4", vector: "CVSS:4.0/AV:N/AC:L" },
      {
        type: "FUTURE_SEVERITY",
        value: "opaque-source-value",
        source: "provider",
      },
      { type: "CVSS_V2", vector: "AV:L/AC:M/Au:N/C:N/I:P/A:C" },
    ]);
    expect(output.advisory!.originalAffected![0]!.severity).toEqual([
      { type: "CVSS_V3", vector: "CVSS:3.1/AV:N" },
    ]);
  });

  it("reuses exact same-record originals in source order, without merging different observations", () => {
    const item = result();
    const root = item.lookup!.advisory!;
    const first = structuredClone(root.affected![0]!);
    const second = structuredClone(first);
    second.versions = ["other-version"];
    root.affected = [first, second];
    const group = item.lookup!.affectedPackages!.entries[0]!;
    const local = group.advisories[0]!;
    const source = {
      osvId: root.osvId,
      sourceUrl: root.sourceUrl,
      withdrawnAt: null,
      affectedVersionRanges: local.affectedVersionRanges,
      fixedInVersions: local.fixedInVersions!,
      affectedVersionDisplay: local.affectedVersionDisplay,
      contentSafety: { filtered: true, modifications: ["PACKAGE_ONLY"] },
      affected: [
        structuredClone(second),
        structuredClone(first),
        structuredClone(second),
      ],
    };
    group.sourceEvidence = source;
    const before = structuredClone(item);
    const output = report(item, true);
    const detail = output.packages![0]!.evidence[0]!.details![0]!;
    expect(detail.advisoryAffectedIndexes).toEqual([1, 0, 1]);
    expect(detail).not.toHaveProperty("originalAffected");
    expect(detail.normalization).toEqual(source.contentSafety);
    expect(
      detail.advisoryAffectedIndexes!.map(
        (i) => output.advisory!.originalAffected![i],
      ),
    ).toEqual([
      output.advisory!.originalAffected![1],
      output.advisory!.originalAffected![0],
      output.advisory!.originalAffected![1],
    ]);
    expect(item).toEqual(before);
    source.osvId = "OSV-another";
    expect(
      report(item, true).packages![0]!.evidence[0]!.details![0]!,
    ).not.toHaveProperty("advisoryAffectedIndexes");
    source.osvId = root.osvId;
    source.affected![0]!.versions = ["different-observation"];
    const different = report(item, true).packages![0]!.evidence[0]!
      .details![0]!;
    expect(different.originalAffected).toHaveLength(3);
    expect(different).not.toHaveProperty("advisoryAffectedIndexes");
  });
  it.each(["No summary available", "  NO SUMMARY AVAILABLE  "])(
    "omits placeholder summaries from text/JSON projections (%s)",
    (summary) => {
      const item = result();
      item.lookup!.advisory!.summary = summary;
      item.lookup!.affectedPackages!.entries[0]!.advisories[0]!.summary =
        summary;
      for (const verbose of [false, true]) {
        const output = report(item, verbose);
        expect(output.advisory!.summary).toBeUndefined();
        expect(output.sources![0]!.summary).toBeUndefined();
      }
    },
  );
  it("projects actionable package evidence without transport or original source dumps", () => {
    const output = report();
    expect(output).toMatchObject({
      inputId: " CVE-example ",
      status: "success",
      advisory: {
        id: "OSV-example",
        url: "https://osv.dev/vulnerability/OSV-example",
      },
      packages: [
        {
          target: "npm:minimatch",
          url: "https://www.npmjs.com/package/minimatch",
          evidence: [
            {
              affectedRanges: [">=10.0.0 <10.2.1"],
              sourceFixVersions: ["10.2.1"],
              sourceIndexes: [0],
            },
          ],
        },
      ],
      sources: [
        {
          id: "GHSA-example",
          origin: "local",
          severity: { score: 7.5, type: "CVSS_V3" },
        },
      ],
      coverage: {
        live: "AVAILABLE",
        local: "AVAILABLE",
        returned: 1,
        total: 1,
        complete: true,
      },
    });
    const json = JSON.stringify(output);
    expect(json).not.toMatch(
      /lookup|pageInfo|endCursor|pagesRead|source-version|ffff|Full source explanation/,
    );
    expect(output.diagnostics).toBeUndefined();
  });

  it.each([
    ["NPM", "@scope/a b", "https://www.npmjs.com/package/%40scope/a%20b"],
    ["PYPI", "requests", "https://pypi.org/project/requests/"],
    ["HEX", "phoenix", "https://hex.pm/packages/phoenix"],
    ["CRATES", "rsa", "https://crates.io/crates/rsa"],
    [
      "NUGET",
      "Example.Package",
      "https://www.nuget.org/packages/Example.Package",
    ],
    [
      "MAVEN",
      "org.example:thing",
      "https://central.sonatype.com/artifact/org.example/thing",
    ],
    [
      "PACKAGIST",
      "symfony/http-foundation",
      "https://packagist.org/packages/symfony/http-foundation",
    ],
    ["RUBYGEMS", "rack", "https://rubygems.org/gems/rack"],
    [
      "GO",
      "golang.org/x/net/http2",
      "https://pkg.go.dev/golang.org/x/net/http2",
    ],
    ["GO", "stdlib", "https://pkg.go.dev/std"],
    ["SWIFT", "github.com/vapor/vapor", "https://github.com/vapor/vapor"],
    ["PUB", "archive", "https://pub.dev/packages/archive"],
  ])("links registry %s package %s", (registry, name, url) => {
    const item = result();
    item.lookup!.affectedPackages!.entries[0]!.package = {
      registry,
      name,
      ecosystem: registry,
    };
    const pkg = report(item).packages![0]!;
    expect(pkg.url).toBe(url);
    if (registry === "GO") expect(pkg.assessment).toBe("module_or_toolchain");
  });

  it("keeps unfamiliar ecosystems and explicit Swift provider boundaries", () => {
    for (const pkg of [
      { registry: null, ecosystem: "FutureOS:4", name: "thing" },
      {
        registry: "SWIFT",
        ecosystem: "SwiftURL",
        name: "unknown.example/owner/repo",
      },
    ]) {
      const item = result();
      item.lookup!.affectedPackages!.entries[0]!.package = pkg;
      const output = report(item).packages![0]!;
      expect(output.url).toBeUndefined();
      if (pkg.registry === null) {
        expect(output).toMatchObject({
          name: "thing",
          ecosystem: "FutureOS:4",
        });
        expect(output.target).toBeUndefined();
        expect(output.assessment).toBe("unsupported_registry");
      }
    }
  });

  it("groups equal range/fix evidence without merging differing evidence or trust markers", () => {
    const item = result();
    const group = item.lookup!.affectedPackages!.entries[0]!;
    const local = group.advisories[0]!;
    group.sourceEvidence = {
      osvId: local.osvId!,
      sourceUrl: local.sourceUrl,
      modifiedAt: "source-revision",
      withdrawnAt: null,
      affectedVersionRanges: local.affectedVersionRanges,
      fixedInVersions: local.fixedInVersions!,
      affectedVersionDisplay: local.affectedVersionDisplay,
    };
    local.withdrawnAt = "withdrawn-revision";
    local.isMalicious = true;
    const output = report(item);
    const evidence = output.packages![0]!.evidence;
    expect(evidence).toHaveLength(1);
    expect(evidence[0]!.sourceIndexes).toEqual([0, 1]);
    expect(output.sources).toEqual([
      expect.objectContaining({ origin: "live", id: "GHSA-example" }),
      expect.objectContaining({
        origin: "local",
        id: "GHSA-example",
        withdrawnAt: "withdrawn-revision",
        malicious: true,
      }),
    ]);
    local.fixedInVersions = ["10.2.2"];
    expect(report(item).packages![0]!.evidence).toHaveLength(2);
  });

  it("shares identical source metadata across packages and preserves differing metadata", () => {
    const item = result();
    const group = item.lookup!.affectedPackages!.entries[0]!;
    item.lookup!.affectedPackages!.entries.push({
      ...structuredClone(group),
      package: { ...group.package, name: "other" },
    });
    const output = report(item);
    expect(output.sources).toHaveLength(1);
    expect(
      output.packages!.map((pkg) => pkg.evidence[0]!.sourceIndexes),
    ).toEqual([[0], [0]]);
    item.lookup!.affectedPackages!.entries[1]!.advisories[0]!.severityScore =
      4.2;
    expect(report(item).sources).toHaveLength(2);
  });

  it("only projects actual reported CVSS scores, never severity-label stand-ins", () => {
    const item = result();
    const row = item.lookup!.affectedPackages!.entries[0]!.advisories[0]!;
    for (const type of ["SEVERITY_LABEL", "UNKNOWN", null]) {
      row.severityType = type;
      expect(report(item).sources![0]!.severity).toBeUndefined();
      expect(report(item, true).sources![0]!.severity).toBeUndefined();
    }
    for (const type of ["CVSS_V2", "CVSS_V3", "CVSS_V4"] as const) {
      row.severityType = type;
      expect(report(item).sources![0]!.severity).toEqual({ score: 7.5, type });
    }
  });

  it("classifies source relationships from backend identity and aliases without guessing", () => {
    const item = result();
    const advisory = item.lookup!.advisory!;
    const row = item.lookup!.affectedPackages!.entries[0]!.advisories[0]!;
    expect(report(item).sources![0]!.relationship).toBe("related");
    advisory.aliases = [row.osvId!];
    expect(report(item).sources![0]!.relationship).toBe("alias");
    advisory.aliases = [];
    row.aliases = [advisory.osvId];
    expect(report(item).sources![0]!.relationship).toBe("alias");
    row.osvId = advisory.osvId;
    expect(report(item).sources![0]!.relationship).toBe("advisory");
    item.lookup!.advisory = null;
    expect(report(item).sources![0]!.relationship).toBeUndefined();
  });

  it("keeps alias summaries attributed to their original records", () => {
    const item = result();
    const advisory = item.lookup!.advisory!;
    advisory.summary = null;
    advisory.aliases = ["GHSA-example"];
    const group = item.lookup!.affectedPackages!.entries[0]!;
    group.advisories.push({
      ...structuredClone(group.advisories[0]!),
      severityScore: 9.8,
    });
    expect(report(item).advisory!.summary).toBeUndefined();
    expect(
      report(item).sources!.every(
        (source) => source.summary === "Local source evidence",
      ),
    ).toBe(true);
    group.advisories[1]!.summary = "Different source summary";
    expect(report(item).advisory!.summary).toBeUndefined();
    expect(report(item).sources![1]!.summary).toBe("Different source summary");
    group.advisories[1]!.summary = "Local source evidence";
    advisory.aliases = [];
    expect(report(item).advisory!.summary).toBeUndefined();
  });

  it("does not merge unavailable ranges or conflate unknown fixes with none reported", () => {
    const item = result();
    const group = item.lookup!.affectedPackages!.entries[0]!;
    const second = structuredClone(group.advisories[0]!);
    group.advisories.push(second);
    group.advisories[0]!.fixedInVersions = null;
    second.fixedInVersions = [];
    expect(
      report(item).packages![0]!.evidence.map((e) => e.sourceFixVersions),
    ).toEqual([null, []]);
    for (const row of group.advisories) {
      row.affectedVersionRanges = null;
      row.fixedInVersions = [];
    }
    expect(report(item).packages![0]!.evidence).toHaveLength(2);
  });

  it("uses normalized spans without dumping redundant exact versions and keeps display fallback truth", () => {
    const item = result();
    const local = item.lookup!.affectedPackages!.entries[0]!.advisories[0]!;
    local.affectedVersionRanges = ["<2", "==1.0.0", "==1.1.0"];
    local.affectedVersionDisplay = {
      ranges: ["<2"],
      totalCount: 1,
      truncated: false,
    };
    expect(report(item).packages![0]!.evidence[0]!.affectedRanges).toEqual([
      "<2",
    ]);
    expect(
      report(item, true).packages![0]!.evidence[0]!.details,
    ).toBeUndefined();
    local.affectedVersionDisplay.truncated = true;
    local.affectedVersionDisplay.totalCount = 2;
    expect(
      report(item, true).packages![0]!.evidence[0]!.details![0]!.rawAffected,
    ).toEqual(local.affectedVersionRanges);
    local.affectedVersionDisplay.truncated = false;
    local.affectedVersionDisplay.totalCount = 1;
    item.lookup!.affectedPackages!.entries[0]!.package.registry = null;
    expect(
      report(item, true).packages![0]!.evidence[0]!.details![0]!.rawAffected,
    ).toEqual(local.affectedVersionRanges);
    local.affectedVersionRanges = null;
    local.affectedVersionDisplay = {
      ranges: ["one"],
      totalCount: 3,
      truncated: true,
    };
    expect(report(item).packages![0]!.evidence[0]).toMatchObject({
      affectedRanges: null,
      affectedDisplay: { ranges: ["one"], truncated: true, totalCount: 3 },
    });
  });

  it("bounds large raw fallback lists explicitly when display normalization is unavailable", () => {
    const item = result();
    const local = item.lookup!.affectedPackages!.entries[0]!.advisories[0]!;
    local.affectedVersionRanges = Array.from(
      { length: 20 },
      (_, i) => `==${i}`,
    );
    local.affectedVersionDisplay = null;
    expect(report(item).packages![0]!.evidence[0]).toMatchObject({
      affectedTruncated: true,
      affectedTotal: 20,
    });
    expect(report(item).packages![0]!.evidence[0]!.affectedRanges).toHaveLength(
      10,
    );
  });

  it("keeps ambiguity and recovery once, with coverage independent of success", () => {
    const item = result();
    item.status = "partial";
    item.lookup!.advisory = null;
    item.lookup!.unknownDetails = [
      {
        section: "ADVISORY",
        code: "AMBIGUOUS_VULNERABILITY_ID",
        message: "Choose an ID",
        retryable: false,
        candidateIds: ["GHSA-one", "GHSA-two"],
        candidateIdsTruncated: true,
      },
    ];
    item.error = {
      code: "AMBIGUOUS_VULNERABILITY_ID",
      error: "Choose an ID",
      retryable: false,
    };
    const output = report(item);
    expect(output.advisory).toBeUndefined();
    expect(output.advisory).toBeUndefined();
    expect(output.diagnostics).toHaveLength(1);
    expect(output.diagnostics![0]).toMatchObject({
      candidateIds: ["GHSA-one", "GHSA-two"],
      candidateIdsTruncated: true,
    });
    expect(output.coverage!.complete).toBe(true);
  });

  it("preserves structured remediation, timing and admission stop without arbitrary error detail", () => {
    const output = report({
      inputId: "CVE-example",
      status: "error",
      error: {
        code: "TERMS_ACCEPTANCE_REQUIRED",
        error: "Accept terms",
        retryable: false,
        details: {
          action: "githits settings terms accept",
          hint: "Read the current terms",
          retryAfterSeconds: 12,
          notAttempted: true,
          internal: "do not serialize",
        },
      },
    });
    expect(output.diagnostics![0]).toMatchObject({
      code: "TERMS_ACCEPTANCE_REQUIRED",
      action: "githits settings terms accept",
      hint: "Read the current terms",
      retryAfterSeconds: 12,
      notAttempted: true,
    });
    expect(JSON.stringify(output)).not.toContain("do not serialize");
  });

  it("keeps verbose package detail scoped while source facts remain shared", () => {
    const item = result();
    const group = item.lookup!.affectedPackages!.entries[0]!;
    group.sourceEvidence = {
      osvId: "OSV-example",
      sourceUrl: "https://osv.dev/vulnerability/OSV-example",
      withdrawnAt: null,
      modifiedAt: "one-revision",
      affectedVersionRanges: ["<2"],
      fixedInVersions: ["2"],
      affectedVersionDisplay: null,
      affected: structuredClone(item.lookup!.advisory!.affected!),
    };
    const second = structuredClone(group);
    second.package.name = "another";
    second.sourceEvidence!.affected![0]!.versions = ["different-version"];
    group.advisories = [];
    second.advisories = [];
    item.lookup!.affectedPackages!.entries.push(second);
    const output = report(item, true);
    expect(output.sources).toHaveLength(1);
    expect(output.sources![0]).not.toHaveProperty("originalAffected");
    expect(
      output.packages![0]!.evidence[0]!.details![0]!.originalAffected,
    ).not.toEqual(
      output.packages![1]!.evidence[0]!.details![0]!.originalAffected,
    );
  });

  it.each([
    ["AUTH_REQUIRED", {}, { action: "githits login" }],
    [
      "UPDATE_REQUIRED",
      { updateCommand: "npm i -g githits@latest" },
      { action: "npm i -g githits@latest" },
    ],
    ["RATE_LIMITED", { retryAfterMs: 1500 }, { retryAfterSeconds: 1.5 }],
  ])("keeps actionable recovery for %s", (code, details, expected) => {
    const output = report({
      inputId: "CVE-example",
      status: "error",
      error: {
        code,
        error: "Recovery needed",
        retryable: code === "RATE_LIMITED",
        details,
      },
    });
    expect(output.diagnostics![0]).toMatchObject({ code, ...expected });
  });

  it("maps diagnostic entry paths to the projected package and selects the primary error first", () => {
    const item = result();
    item.status = "partial";
    item.error = {
      code: "TIMEOUT",
      error: "Source timed out",
      retryable: true,
    };
    item.lookup!.unknownDetails = [
      {
        section: "ADVISORY",
        code: "NOT_FOUND",
        message: "Source absent",
        retryable: false,
        candidateIds: null,
        candidateIdsTruncated: null,
      },
      {
        section: "AFFECTED_PACKAGES",
        code: "DISPLAY_ERROR",
        message: "Display unavailable",
        retryable: false,
        candidateIds: null,
        candidateIdsTruncated: null,
        path: [
          "affectedPackages",
          "entries",
          0,
          "advisories",
          0,
          "affectedVersionDisplay",
        ],
      },
    ];
    const output = report(item);
    expect(output.diagnostics![0]!.code).toBe("TIMEOUT");
    expect(output.diagnostics![2]).toMatchObject({ packageIndex: 0 });
    expect(output.diagnostics![2]).not.toHaveProperty("path");
  });

  it("adds curated original source evidence only when explicitly verbose", () => {
    const output = report(result(), true);
    expect(output.advisory).toMatchObject({
      explanation: "Full source explanation.\n\nSecond paragraph.",
      originalAffected: [
        expect.objectContaining({
          ranges: [
            expect.objectContaining({
              events: [
                expect.objectContaining({ introduced: "ffff" }),
                expect.objectContaining({ fixed: "aaaa" }),
                expect.anything(),
                expect.anything(),
              ],
            }),
          ],
        }),
      ],
    });
    expect(JSON.stringify(output)).not.toContain('"fixed":null');
  });
});

it("attributes typed source metadata to verbose advisory only, preserving roles and contacts", () => {
  const item = result();
  Object.assign(item.lookup!.advisory!, {
    relatedIds: ["RELATED-ID"],
    upstreamIds: ["UPSTREAM-ID"],
    credits: [
      {
        name: "Source author",
        contact: ["", "author@example.org"],
        type: "FUTURE_ROLE",
      },
    ],
  });
  const compact = report(item).advisory!;
  expect(compact).not.toHaveProperty("schemaVersion");
  expect(compact).not.toHaveProperty("credits");
  expect(report(item, true).advisory).toMatchObject({
    schemaVersion: "1.9.0",
    relatedIds: ["RELATED-ID"],
    upstreamIds: ["UPSTREAM-ID"],
    credits: item.lookup!.advisory!.credits,
  });
});
