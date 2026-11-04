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
      expect(output).not.toContain("source_details=true");
      expect(output).not.toContain("--source-details");
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
    item.sourceDetails!.push(
      structuredClone(item.sourceDetails![0]!),
      { advisoryId: null, source: null },
      { advisoryId: null, source: null },
    );
    const payload = buildPackageVulnerabilitiesSuccessPayload(item);
    expect(payload.advisories).toHaveLength(1);
    expect(payload.sourceDetails).toEqual(item.sourceDetails);
    expect(payload.sourceDetails).toHaveLength(4);
  });
  it("does not cap source bodies at the MCP assessment cap", () => {
    const item = report();
    const entry = item.sourceDetails![0]!;
    item.sourceDetails = Array.from({ length: 6 }, (_, i) => ({
      ...entry,
      advisoryId: `OSV-${i}`,
      source: { ...entry.source!, osvId: `OSV-${i}`, details: `BODY-${i}` },
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
    const output = formatPackageVulnerabilitiesTerminal(item);
    expect(output).toContain("No explanation supplied by source.");
    expect(output).toContain("MISSING: Current OSV source unavailable.");
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
    ).toContain("githits vulns <id> --verbose");
    const mcp = formatPackageVulnerabilitiesTerminal(item, { surface: "mcp" });
    expect(mcp).toContain("source_details=true");
    expect(mcp).not.toContain("--source-details");
    item.security!.vulnerabilities = [];
    expect(formatPackageVulnerabilitiesTerminal(item)).not.toContain(
      "Full current OSV",
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
  expect(output).toContain("  Explanation:\n  Modified: 1999-01-01");
  expect(
    buildPackageVulnerabilitiesSuccessPayload(item).sourceDetails![0]!.source,
  ).toEqual(source);
});
