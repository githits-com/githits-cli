import { describe, expect, it } from "bun:test";
import type { VulnerabilityReport } from "@githits/core-internal";
import { defaultAdvisoryDetails } from "../../../core-internal/src/services/advisory-test-helpers.js";
import { defaultVulnerabilityReport } from "../services/test-helpers.js";
import {
  buildPackageVulnerabilitiesSuccessPayload,
  formatPackageVulnerabilitiesTerminal,
} from "./package-vulnerabilities-response.js";

function report(): VulnerabilityReport {
  const report = structuredClone(defaultVulnerabilityReport);
  const { affected: _, ...source } = structuredClone(defaultAdvisoryDetails);
  report.security!.vulnerabilities = [
    {
      ...report.security!.vulnerabilities![0]!,
      osvId: source.osvId,
      aliases: [],
      isMalicious: false,
    },
  ];
  report.security!.affectedVulnerabilityCount = 1;
  report.security!.allVulnerabilityCount = 1;
  report.sourceDetails = [
    {
      advisoryId: source.osvId,
      source: {
        ...source,
        credits: [
          {
            name: "Researcher",
            contact: ["", "researcher@example.org", "mailto:other@example.org"],
            type: "FUTURE_ROLE",
          },
          { name: "Another", contact: [], type: null },
        ],
        relatedIds: ["RELATED-ID"],
        upstreamIds: ["UPSTREAM-ID"],
        withdrawnAt: "2026-11-04T12:00:00.123Z",
        details:
          "## Impact\r\n\r\n```go\r\n\tif affected {\r\n\t\treturn err\r\n\t}\r\n```\r\n" +
          "Long source prose. ".repeat(600) +
          "END-OF-SOURCE",
      },
    },
  ];
  return report;
}

describe("full package source evidence", () => {
  it.each(["cli", "mcp"] as const)(
    "retains all Markdown and typed metadata on %s text and JSON",
    (surface) => {
      const item = report();
      const source = item.sourceDetails![0]!.source!;
      const output = formatPackageVulnerabilitiesTerminal(item, {
        surface,
        terminalWidth: 48,
      });
      expect(output).toContain(
        "  ```go\n      if affected {\n          return err\n      }\n  ```",
      );
      expect(output).toContain(
        `${"Long source prose. ".repeat(600)}END-OF-SOURCE`,
      );
      expect(output).toContain("[WITHDRAWN]");
      expect(output).toContain(source.modifiedAt);
      expect(output).toContain(source.withdrawnAt!);
      expect(output).toContain("OSV schema: 1.9.0");
      expect(output).toContain("Related IDs: RELATED-ID");
      expect(output).toContain("Upstream IDs: UPSTREAM-ID");
      expect(output).toContain("Researcher [FUTURE_ROLE]");
      expect(output).toContain("researcher@example.org");
      expect(output).toContain("Another");
      expect(output).not.toContain("details=true");
      expect(output).not.toContain("--details");
      expect(
        buildPackageVulnerabilitiesSuccessPayload(item).sourceDetails,
      ).toEqual(item.sourceDetails);
    },
  );
  it("preserves distinct original source rows despite assessment alias dedup, repeated and null IDs", () => {
    const item = report();
    const first = item.security!.vulnerabilities![0]!;
    item.security!.vulnerabilities = [
      { ...first, osvId: "A", aliases: ["B"] },
      { ...first, osvId: "B", aliases: ["A"] },
    ];
    const source = item.sourceDetails![0]!.source!;
    item.security!.vulnerabilities!.push({ ...first, osvId: "A" }, {}, {});
    item.sourceDetails = ["A", "B", "A", null, null].map((id) => ({
      advisoryId: id,
      source: id ? { ...source, osvId: id } : null,
    }));
    const payload = buildPackageVulnerabilitiesSuccessPayload(item);
    expect(payload.advisories).toHaveLength(3);
    expect(payload.sourceDetails).toEqual(item.sourceDetails);
    expect(payload.sourceDetails).toHaveLength(5);
    const text = formatPackageVulnerabilitiesTerminal(item).replace(
      /\s+/g,
      " ",
    );
    expect(text).toContain("[1/5] A");
    expect(text).toContain("[2/5] B");
    expect(text).toContain("[3/5] A");
    expect(text).toContain("[4/5] (no source ID)");
    expect(text).toContain("[5/5] (no source ID)");
  });
  it("does not cap source bodies at the MCP assessment cap", () => {
    const item = report();
    const entry = item.sourceDetails![0]!;
    item.sourceDetails = Array.from({ length: 6 }, (_, i) => ({
      ...entry,
      advisoryId: `OSV-${i}`,
      source: { ...entry.source!, osvId: `OSV-${i}`, details: `BODY-${i}` },
    }));
    item.security!.vulnerabilities = item.sourceDetails.map((entry) => ({
      osvId: entry.advisoryId ?? undefined,
    }));
    const output = formatPackageVulnerabilitiesTerminal(item, {
      surface: "mcp",
    });
    for (let i = 0; i < 6; i++) expect(output).toContain(`BODY-${i}`);
  });
  it("keeps unavailable/error outcomes and empty explanation separate from local risk", () => {
    const item = report();
    item.sourceDetails![0]!.source!.details = null;
    item.sourceDetails!.push(
      { advisoryId: "MISSING", source: null },
      {
        advisoryId: "FAILED",
        source: null,
        error: {
          code: "RATE_LIMITED",
          message: "Current OSV source unavailable (RATE_LIMITED).",
          retryable: true,
          retryAfterSeconds: 1.5,
        },
      },
    );
    item.security!.vulnerabilities = item.sourceDetails!.map((entry) => ({
      osvId: entry.advisoryId ?? undefined,
      severityScore: 7.5,
    }));
    const output = formatPackageVulnerabilitiesTerminal(item);
    expect(output).toContain("No advisory text supplied by source.");
    expect(output).toContain("Current OSV source unavailable.");
    expect(output).toContain("RATE_LIMITED");
    expect(output.replace(/\s+/g, " ")).toContain("Retry after 1.5s.");
    const { sourceDetails: _, ...without } = item;
    const { sourceDetails: __, ...payload } =
      buildPackageVulnerabilitiesSuccessPayload(item);
    expect(payload).toEqual(buildPackageVulnerabilitiesSuccessPayload(without));
  });
  it("uses surface-native discoverability without source reads or empty-result noise", () => {
    const item = report();
    delete item.sourceDetails;
    expect(
      formatPackageVulnerabilitiesTerminal(item, { surface: "cli" }),
    ).toContain("githits vulns --verbose -- 'OSV-example'");
    const mcp = formatPackageVulnerabilitiesTerminal(item, { surface: "mcp" });
    expect(mcp).toContain("details=true");
    expect(mcp).not.toContain("--details");
    item.security!.vulnerabilities = [];
    expect(formatPackageVulnerabilitiesTerminal(item)).not.toContain(
      "Full advisory report:",
    );
  });
});

it("keeps metadata word boundaries and labels source Markdown separately", () => {
  const item = report();
  const source = item.sourceDetails![0]!.source!;
  source.summary = "First line\nSecond line\ttabbed";
  source.credits = [{ name: "A\nB", contact: ["first\r\nsecond"], type: null }];
  source.details = "Modified: 1999-01-01";
  const output = formatPackageVulnerabilitiesTerminal(item);
  expect(output).toContain("First line Second line tabbed");
  expect(output).toContain("    A B");
  expect(output).toContain("      first second");
  expect(output).toContain("  Advisory text:\n  Modified: 1999-01-01");
  expect(
    buildPackageVulnerabilitiesSuccessPayload(item).sourceDetails![0]!.source,
  ).toEqual(source);
});

it("normalizes zero-column terminal widths for full source metadata and default hints", () => {
  const item = report();
  expect(formatPackageVulnerabilitiesTerminal(item, { terminalWidth: 0 })).toBe(
    formatPackageVulnerabilitiesTerminal(item, { terminalWidth: 20 }),
  );
  delete item.sourceDetails;
  expect(formatPackageVulnerabilitiesTerminal(item, { terminalWidth: 0 })).toBe(
    formatPackageVulnerabilitiesTerminal(item, { terminalWidth: 20 }),
  );
});

it("offers a real advisory command and the details option in native text", () => {
  const item = report();
  delete item.sourceDetails;
  const first = buildPackageVulnerabilitiesSuccessPayload(
    item,
  ).advisories!.find((a) => a.id)!.id!;
  const cli = formatPackageVulnerabilitiesTerminal(item, {
    surface: "cli",
  }).replace(/\s+/g, " ");
  expect(cli).toContain(
    `Full advisory report: githits vulns --verbose -- '${first}'`,
  );
  expect(cli).toContain("--details");
  expect(cli).not.toContain("<id>");
  const mcp = formatPackageVulnerabilitiesTerminal(item, { surface: "mcp" });
  expect(mcp).toContain("details=true");
  expect(mcp).not.toContain("githits vulns");
});

it.each([false, true])(
  "orders source reports by actual alias groups and retains raw context (alias=%s)",
  (alias) => {
    const item = report();
    const template = item.sourceDetails![0]!.source!;
    const raw = [
      {
        osvId: "LOW",
        severityScore: 3,
        aliases: alias ? ["HIGH"] : [],
        duplicateIds: ["HIGH"],
        assessmentStatus: "AFFECTED",
        affectsInspectedVersion: true,
      },
      {
        osvId: "HIGH",
        severityScore: 9.5,
        aliases: [],
        assessmentStatus: "NON_AFFECTING",
        affectsInspectedVersion: false,
      },
      {
        severityScore: 1,
        aliases: [],
        assessmentStatus: "UNKNOWN",
        affectsInspectedVersion: false,
      },
      {
        severityScore: 8,
        aliases: [],
        assessmentStatus: "AFFECTED",
        affectsInspectedVersion: true,
      },
    ];
    item.security!.vulnerabilities = raw;
    item.security!.affectedVulnerabilityCount = 2;
    item.security!.nonAffectingVulnerabilityCount = 1;
    item.security!.unknownVulnerabilityCount = 1;
    item.security!.allVulnerabilityCount = 4;
    item.sourceDetails = raw.map((row) => ({
      advisoryId: row.osvId ?? null,
      source: row.osvId
        ? {
            ...template,
            osvId: row.osvId,
            sourceUrl: `https://osv.dev/vulnerability/${row.osvId}`,
            details: `BODY-${row.osvId}`,
          }
        : null,
    }));
    const before = JSON.stringify(item);
    const output = formatPackageVulnerabilitiesTerminal(item).replace(
      /\s+/g,
      " ",
    );
    const reports = output.split("Current advisory reports from OSV")[1]!;
    expect(reports).toBeDefined();
    if (alias)
      expect(reports.indexOf("BODY-LOW")).toBeLessThan(
        reports.indexOf("BODY-HIGH"),
      );
    else
      expect(reports.indexOf("BODY-HIGH")).toBeLessThan(
        reports.indexOf("BODY-LOW"),
      );
    expect(reports).toContain("LOW | Assessment: low; affects this version");
    expect(reports).toContain("HIGH | Assessment: critical; non-affecting");
    expect(reports).toContain("Unlinked source records:");
    expect(reports).toContain(
      "[3/4] (no source ID) | Assessment: low; unknown",
    );
    expect(reports).toContain(
      "[4/4] (no source ID) | Assessment: high; affects this version",
    );
    expect(
      buildPackageVulnerabilitiesSuccessPayload(item).sourceDetails,
    ).toEqual(item.sourceDetails);
    expect(JSON.stringify(item)).toBe(before);
  },
);

it.each([
  "$(touch /tmp/unwanted)",
  "-GHSA-leading",
  "GHSA-quote'and;semicolon",
])("quotes the real advisory ID in runnable commands: %s", (id) => {
  const item = report();
  delete item.sourceDetails;
  item.security!.vulnerabilities = [{ osvId: id }];
  const output = formatPackageVulnerabilitiesTerminal(item, {
    terminalWidth: 160,
  });
  const quoted = `'${id.replaceAll("'", `'"'"'`)}'`;
  expect(output).toContain(`githits vulns --verbose -- ${quoted}`);
});

it("links null-ID source outcomes only through recorded aliases", () => {
  const item = report();
  const source = item.sourceDetails![0]!.source!;
  item.security!.vulnerabilities = [
    { aliases: [source.osvId], severityScore: 3 },
    { osvId: source.osvId, severityScore: 9 },
  ];
  item.sourceDetails = [
    { advisoryId: null, source: null },
    { advisoryId: source.osvId, source },
  ];
  const output = formatPackageVulnerabilitiesTerminal(item).replace(
    /\s+/g,
    " ",
  );
  expect(output).toContain("[1/2] (no source ID) | Assessment: low");
  expect(output).toContain(`[2/2] ${source.osvId} | Assessment: critical`);
  expect(output).not.toContain("Unlinked source records:");
});

it("shows backend matched strings only for affecting rows with distinct evidence", () => {
  const item = report();
  delete item.sourceDetails;
  const row = {
    osvId: "A",
    assessmentStatus: "AFFECTED",
    affectsInspectedVersion: true,
    affectedVersionRanges: ["first backend range", "second backend range"],
    matchedAffectedVersionRanges: ["second backend range"],
  };
  item.security!.vulnerabilities = [row];
  expect(formatPackageVulnerabilitiesTerminal(item)).toContain(
    "matched  second backend range",
  );
  row.matchedAffectedVersionRanges = [...row.affectedVersionRanges];
  expect(formatPackageVulnerabilitiesTerminal(item)).not.toContain("matched ");
  row.assessmentStatus = "UNKNOWN";
  row.affectsInspectedVersion = false;
  row.matchedAffectedVersionRanges = ["second backend range"];
  expect(formatPackageVulnerabilitiesTerminal(item)).not.toContain("matched ");
});
