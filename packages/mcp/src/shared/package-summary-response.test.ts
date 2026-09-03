import { describe, expect, it } from "bun:test";
import type { PackageSummary } from "@githits/core-internal";
import { defaultPackageSummary } from "../services/test-helpers.js";
import { colors } from "./colors.js";
import {
  buildPackageSummarySuccessPayload,
  formatPackageSummaryTerminal,
  severityLabel,
} from "./package-summary-response.js";
import { terminalWidth } from "./terminal-width.js";

const FIXED_NOW = new Date("2024-06-01T12:00:00Z");

function happyFixture(): PackageSummary {
  return structuredClone(defaultPackageSummary);
}

function getVulnerabilityLines(output: string): string[] {
  const lines = output.trimEnd().split("\n");
  const start = lines.findIndex((line) => line.startsWith("Vulnerabilities"));
  if (start < 0) return [];
  const continuationPrefix = " ".repeat("Vulnerabilities".length + 2);
  const first = lines[start];
  if (first === undefined) return [];
  const result: string[] = [first];
  for (const line of lines.slice(start + 1)) {
    if (!line.startsWith(continuationPrefix)) break;
    result.push(line);
  }
  return result;
}

function vulnerabilityText(output: string): string {
  const lines = getVulnerabilityLines(output);
  if (lines.length === 0) return "";
  const first = lines[0];
  if (first === undefined) return "";
  const valuePrefix = `${"Vulnerabilities"}  `;
  return [
    first.slice(valuePrefix.length),
    ...lines.slice(1).map((line) => line.trim()),
  ].join(" ");
}

function displayWidth(line: string): number {
  return terminalWidth(line.replace(ANSI_SGR_PATTERN, ""));
}

const ESC = String.fromCharCode(0x1b);
const ANSI_SGR_PATTERN = new RegExp(`${ESC}\\[[0-9;]*m`, "g");

describe("buildPackageSummarySuccessPayload — happy path", () => {
  it("includes every top-level section when the fixture is fully populated", () => {
    const payload = buildPackageSummarySuccessPayload(defaultPackageSummary);
    expect(payload.registry).toBe("npm");
    expect(payload.name).toBe("express");
    expect(payload.version).toBe("4.18.2");
    expect(payload.description).toContain("Fast");
    expect(payload.license).toBe("MIT");
    expect(payload.homepage).toBe("https://expressjs.com");
    expect(payload.repository).toBe("https://github.com/expressjs/express");
    expect(payload.publishedAt).toBe("2023-05-28");
    expect(payload.versionCount).toBe(214);
    expect(payload.downloads?.lastMonth).toBe(86_000_000);
    expect(payload.downloads?.refreshedAt).toBe("2024-06-15");
    expect(payload.github?.stars).toBe(63_400);
    expect("install" in payload).toBe(false);
    expect("usage" in payload).toBe(false);
    expect(payload.vulnerabilities?.total).toBe(5);
    expect(payload.vulnerabilities?.affectsLatest).toBe(true);
    expect(payload.advisoryHistory).toEqual({ total: 5 });
    expect(payload.vulnerabilities?.recent?.[0]?.severityLabel).toBe("high");
    expect(payload.recentChanges?.length).toBe(3);
  });

  it("lowercases the registry value", () => {
    const fixture = happyFixture();
    fixture.package.registry = "NPM";
    expect(buildPackageSummarySuccessPayload(fixture).registry).toBe("npm");
  });
});

describe("buildPackageSummarySuccessPayload — omission rules", () => {
  it("omits description/license/homepage/repository/publishedAt when null", () => {
    const fixture = happyFixture();
    fixture.package.description = undefined;
    fixture.package.license = undefined;
    fixture.package.homepage = undefined;
    fixture.package.repositoryUrl = undefined;
    fixture.package.latestVersionPublishedAt = undefined;
    const payload = buildPackageSummarySuccessPayload(fixture);
    expect(payload.description).toBeUndefined();
    expect(payload.license).toBeUndefined();
    expect(payload.homepage).toBeUndefined();
    expect(payload.repository).toBeUndefined();
    expect(payload.publishedAt).toBeUndefined();
  });

  it("omits downloads block when both lastMonth and total are undefined", () => {
    const fixture = happyFixture();
    fixture.package.downloadsLastMonth = undefined;
    fixture.package.downloadsTotal = undefined;
    fixture.package.downloadsRefreshedAt = undefined;
    const payload = buildPackageSummarySuccessPayload(fixture);
    expect(payload.downloads).toBeUndefined();
  });

  it("keeps downloads partial-object when only one leaf is populated", () => {
    const fixture = happyFixture();
    fixture.package.downloadsTotal = undefined;
    fixture.package.downloadsRefreshedAt = undefined;
    const payload = buildPackageSummarySuccessPayload(fixture);
    expect(payload.downloads).toEqual({ lastMonth: 86_000_000 });
  });

  it("omits github block entirely when the fixture has no github data", () => {
    const fixture = happyFixture();
    fixture.package.githubRepository = undefined;
    const payload = buildPackageSummarySuccessPayload(fixture);
    expect(payload.github).toBeUndefined();
  });

  it("omits github.topics when empty array", () => {
    const fixture = happyFixture();
    if (fixture.package.githubRepository) {
      fixture.package.githubRepository.topics = [];
    }
    const payload = buildPackageSummarySuccessPayload(fixture);
    expect(payload.github?.topics).toBeUndefined();
  });

  it("keeps vulnerabilities block when total is 0", () => {
    const fixture = happyFixture();
    fixture.package.versionCount = 0;
    fixture.security = {
      vulnerabilityCount: 0,
      allVulnerabilityCount: 0,
      hasCurrentVulnerabilities: false,
      recentVulnerabilities: [],
    };
    const payload = buildPackageSummarySuccessPayload(fixture);
    expect(payload.vulnerabilities).toEqual({
      total: 0,
      affectsLatest: false,
    });
    expect(payload.versionCount).toBe(0);
    expect(payload.advisoryHistory).toEqual({ total: 0 });
  });

  it("omits vulnerabilities block when vulnerabilityCount is null/missing", () => {
    const fixture = happyFixture();
    fixture.security = {
      vulnerabilityCount: undefined,
      allVulnerabilityCount: 5,
      hasCurrentVulnerabilities: false,
      recentVulnerabilities: [],
    };
    expect(
      buildPackageSummarySuccessPayload(fixture).vulnerabilities,
    ).toBeUndefined();
    expect(
      buildPackageSummarySuccessPayload(fixture).advisoryHistory,
    ).toBeDefined();

    fixture.security = undefined;
    expect(
      buildPackageSummarySuccessPayload(fixture).vulnerabilities,
    ).toBeUndefined();
    expect(
      buildPackageSummarySuccessPayload(fixture).advisoryHistory,
    ).toBeUndefined();
  });

  it("keeps total+affectsLatest when total > 0 but recent list is empty", () => {
    const fixture = happyFixture();
    fixture.security = {
      vulnerabilityCount: 3,
      allVulnerabilityCount: 3,
      hasCurrentVulnerabilities: true,
      recentVulnerabilities: [],
    };
    const payload = buildPackageSummarySuccessPayload(fixture);
    expect(payload.vulnerabilities?.total).toBe(3);
    expect(payload.vulnerabilities?.affectsLatest).toBe(true);
    expect(payload.vulnerabilities?.recent).toBeUndefined();
  });

  it("drops recentChanges entries with null version but preserves backend order", () => {
    const fixture = happyFixture();
    fixture.latestChangelogs = [
      { version: undefined, body: "mystery" },
      { version: "2.0.0", body: "second" },
      { version: "1.0.0", body: "first" },
    ];
    const payload = buildPackageSummarySuccessPayload(fixture);
    expect(payload.recentChanges?.map((e) => e.version)).toEqual([
      "2.0.0",
      "1.0.0",
    ]);
  });

  it("omits recentChanges entirely when all entries have null version", () => {
    const fixture = happyFixture();
    fixture.latestChangelogs = [
      { version: undefined },
      { version: undefined },
      { version: undefined },
    ];
    const payload = buildPackageSummarySuccessPayload(fixture);
    expect(payload.recentChanges).toBeUndefined();
  });

  it("derives summary from body's first non-empty line (120-char trim)", () => {
    const fixture = happyFixture();
    const longBody = "A".repeat(200);
    fixture.latestChangelogs = [
      {
        version: "1.0.0",
        body: longBody,
      },
    ];
    const summary =
      buildPackageSummarySuccessPayload(fixture).recentChanges?.[0]?.summary;
    expect(summary).toBeDefined();
    expect(summary?.length).toBeLessThanOrEqual(120);
    expect(summary?.endsWith("...")).toBe(true);
  });
});

describe("buildPackageSummarySuccessPayload — data transformations", () => {
  it("converts publishedAt to UTC YYYY-MM-DD", () => {
    const fixture = happyFixture();
    // 23:59 UTC still falls on the stated date.
    fixture.package.latestVersionPublishedAt = "2024-05-10T23:59:00Z";
    const payload = buildPackageSummarySuccessPayload(fixture);
    expect(payload.publishedAt).toBe("2024-05-10");
  });

  it("normalizes download refresh date even when download counts are absent", () => {
    const fixture = happyFixture();
    fixture.package.downloadsLastMonth = undefined;
    fixture.package.downloadsTotal = undefined;
    fixture.package.downloadsRefreshedAt = "2024-06-15T23:59:00Z";
    const payload = buildPackageSummarySuccessPayload(fixture);
    expect(payload.downloads).toEqual({ refreshedAt: "2024-06-15" });
  });

  it("omits severity/severityLabel when the score is null or non-positive", () => {
    const fixture = happyFixture();
    fixture.security = {
      vulnerabilityCount: 1,
      allVulnerabilityCount: 1,
      hasCurrentVulnerabilities: true,
      recentVulnerabilities: [
        {
          osvId: "GHSA-a",
          summary: "no score",
          severityScore: undefined,
          publishedAt: "2024-01-01T00:00:00Z",
        },
        {
          osvId: "GHSA-b",
          summary: "zero score",
          severityScore: 0,
          publishedAt: "2024-01-01T00:00:00Z",
        },
      ],
    };
    const payload = buildPackageSummarySuccessPayload(fixture);
    const recent = payload.vulnerabilities?.recent ?? [];
    expect(recent[0]?.severity).toBeUndefined();
    expect(recent[0]?.severityLabel).toBeUndefined();
    expect(recent[1]?.severity).toBeUndefined();
  });
});

describe("severityLabel — CVSS banding boundaries", () => {
  it("bands at the locked thresholds (<4 low, <7 medium, <9 high, ≥9 critical)", () => {
    expect(severityLabel(0.1)).toBe("low");
    expect(severityLabel(3.9)).toBe("low");
    expect(severityLabel(4.0)).toBe("medium");
    expect(severityLabel(6.9)).toBe("medium");
    expect(severityLabel(7.0)).toBe("high");
    expect(severityLabel(8.9)).toBe("high");
    expect(severityLabel(9.0)).toBe("critical");
    expect(severityLabel(10.0)).toBe("critical");
  });
});

describe("formatPackageSummaryTerminal", () => {
  it("renders the default triage block with repository popularity and vulnerability status", () => {
    const output = formatPackageSummaryTerminal(defaultPackageSummary, {
      useColors: false,
      now: FIXED_NOW,
    });
    expect(output).toContain("express @ 4.18.2 | MIT");
    expect(output).toContain("Fast, unopinionated");
    expect(output).toContain(
      "Repository       https://github.com/expressjs/express (63k stars, 14k forks, 123 issues)",
    );
    expect(vulnerabilityText(output)).toBe(
      "Latest: 5 affected History: 5 known advisories across all versions",
    );
    expect(output).not.toContain("Versions");
    expect(output).not.toContain("refreshed 2024-06-15");
    expect(output).not.toContain("GHSA-xxxx-xxxx-xxxx");
    expect(output).not.toContain("Install");
    expect(output).not.toContain("Usage");
  });

  it("verbose mode adds GitHub details, advisory history, and Recent changes", () => {
    const output = formatPackageSummaryTerminal(defaultPackageSummary, {
      verbose: true,
      useColors: false,
      now: FIXED_NOW,
    });
    expect(output).toContain("GitHub");
    expect(output).toContain("  Language     JavaScript");
    expect(output).toContain(
      "  Topics       framework, http, middleware, nodejs, web",
    );
    expect(output).toContain("Advisory history (all versions)");
    expect(output).toContain("GHSA-xxxx-xxxx-xxxx");
    expect(output).toContain("Recent changes");
    expect(output).toContain("Versions");
    expect(output).toContain("214 published");
    expect(output).toContain("refreshed 2024-06-15");
  });

  it("wraps vulnerability status at standard width with aligned continuation", () => {
    const output = formatPackageSummaryTerminal(defaultPackageSummary, {
      useColors: false,
      now: FIXED_NOW,
      terminalWidth: 80,
    });
    const lines = getVulnerabilityLines(output);
    const continuationPrefix = " ".repeat("Vulnerabilities".length + 2);
    expect(lines.length).toBe(2);
    expect(lines[1]?.startsWith(continuationPrefix)).toBe(true);
    expect(lines[1]?.slice(continuationPrefix.length)).toBe(
      "History: 5 known advisories across all versions",
    );
    expect(lines.every((line) => displayWidth(line) <= 80)).toBe(true);
    expect(vulnerabilityText(output)).toBe(
      "Latest: 5 affected History: 5 known advisories across all versions",
    );
  });

  it("text output stays printable ASCII", () => {
    const output = formatPackageSummaryTerminal(defaultPackageSummary, {
      verbose: true,
      useColors: false,
      now: FIXED_NOW,
    });
    for (const char of output) {
      const code = char.charCodeAt(0);
      expect(
        code === 9 || code === 10 || code === 13 || (code >= 32 && code <= 126),
      ).toBe(true);
    }
  });

  it("no-color output contains no ANSI escape sequences", () => {
    const output = formatPackageSummaryTerminal(defaultPackageSummary, {
      useColors: false,
      now: FIXED_NOW,
      verbose: true,
    });
    expect(output).not.toContain("\x1b[");
  });

  it("uses non-bold cyan for URL substrings without coloring repository statistics", () => {
    const colored = formatPackageSummaryTerminal(defaultPackageSummary, {
      useColors: true,
      now: FIXED_NOW,
    });
    const plain = formatPackageSummaryTerminal(defaultPackageSummary, {
      useColors: false,
      now: FIXED_NOW,
    });

    expect(colored).toContain(
      `${colors.cyan}https://github.com/expressjs/express${colors.reset} (63k stars, 14k forks, 123 issues)`,
    );
    expect(colored).toContain(
      `${colors.cyan}https://expressjs.com${colors.reset}`,
    );
    expect(colored).not.toContain(`${colors.dim}https://`);
    expect(colored.replace(ANSI_SGR_PATTERN, "")).toBe(plain);
  });

  it("vulnerability status uses singular form for total = 1", () => {
    const fixture = happyFixture();
    fixture.security = {
      vulnerabilityCount: 1,
      allVulnerabilityCount: 1,
      hasCurrentVulnerabilities: true,
      recentVulnerabilities: [],
    };
    const output = formatPackageSummaryTerminal(fixture, {
      useColors: false,
      now: FIXED_NOW,
    });
    expect(vulnerabilityText(output)).toBe(
      "Latest: 1 affected History: 1 known advisory across all versions",
    );
  });

  it("renders explicit zero-vulnerability status", () => {
    const fixture = happyFixture();
    fixture.security = {
      vulnerabilityCount: 0,
      allVulnerabilityCount: 0,
      hasCurrentVulnerabilities: false,
      recentVulnerabilities: [],
    };
    const output = formatPackageSummaryTerminal(fixture, {
      useColors: false,
      now: FIXED_NOW,
    });
    expect(vulnerabilityText(output)).toBe(
      "Latest: none affected History: none known across all versions",
    );
  });

  it("renders history independently when latest vulnerability count is unavailable", () => {
    const fixture = happyFixture();
    fixture.security = {
      vulnerabilityCount: undefined,
      allVulnerabilityCount: 5,
      hasCurrentVulnerabilities: false,
      recentVulnerabilities: [],
    };
    const payload = buildPackageSummarySuccessPayload(fixture);
    expect(payload.vulnerabilities).toBeUndefined();
    expect(payload.advisoryHistory).toEqual({ total: 5 });

    const output = formatPackageSummaryTerminal(fixture, {
      useColors: false,
      now: FIXED_NOW,
    });
    expect(vulnerabilityText(output)).toBe(
      "Latest: unavailable History: 5 known advisories across all versions",
    );
  });

  it("uses the numeric latest count as authoritative when the auxiliary flag is false", () => {
    const fixture = happyFixture();
    fixture.security = {
      vulnerabilityCount: 2,
      allVulnerabilityCount: 2,
      hasCurrentVulnerabilities: false,
      recentVulnerabilities: [],
    };
    const payload = buildPackageSummarySuccessPayload(fixture);
    expect(payload.vulnerabilities?.affectsLatest).toBe(false);
    const output = formatPackageSummaryTerminal(fixture, {
      useColors: false,
      now: FIXED_NOW,
    });
    expect(vulnerabilityText(output)).toBe(
      "Latest: 2 affected History: 2 known advisories across all versions",
    );
  });

  it("wraps contradictory history evidence at standard width without a hint", () => {
    const fixture = happyFixture();
    fixture.security = {
      vulnerabilityCount: 5,
      allVulnerabilityCount: 3,
      hasCurrentVulnerabilities: true,
      recentVulnerabilities: [],
    };
    const output = formatPackageSummaryTerminal(fixture, {
      useColors: false,
      now: FIXED_NOW,
      terminalWidth: 80,
    });
    const lines = getVulnerabilityLines(output);
    expect(vulnerabilityText(output)).toBe(
      "Latest: 5 affected History: 3 known advisories across all versions (inconsistent backend evidence)",
    );
    expect(lines.every((line) => displayWidth(line) <= 80)).toBe(true);
    expect(
      lines.slice(1).every((line) => line.startsWith(" ".repeat(17))),
    ).toBe(true);
    expect(output).not.toContain("Inspect history");
  });

  it("labels zero history as inconsistent when latest has a positive count", () => {
    const fixture = happyFixture();
    fixture.security = {
      vulnerabilityCount: 1,
      allVulnerabilityCount: 0,
      hasCurrentVulnerabilities: true,
      recentVulnerabilities: [],
    };
    const output = formatPackageSummaryTerminal(fixture, {
      useColors: false,
      now: FIXED_NOW,
    });
    expect(vulnerabilityText(output)).toBe(
      "Latest: 1 affected History: none known across all versions (inconsistent backend evidence)",
    );
  });

  it("keeps vulnerability continuations within a narrow width", () => {
    const output = formatPackageSummaryTerminal(defaultPackageSummary, {
      useColors: false,
      now: FIXED_NOW,
      terminalWidth: 40,
    });
    const lines = getVulnerabilityLines(output);
    expect(lines.length).toBeGreaterThan(2);
    expect(lines.every((line) => displayWidth(line) <= 40)).toBe(true);
    expect(
      lines.slice(1).every((line) => line.startsWith(" ".repeat(17))),
    ).toBe(true);
    expect(vulnerabilityText(output)).toBe(
      "Latest: 5 affected History: 5 known advisories across all versions",
    );
  });

  it("keeps the vulnerability field evidence-only when history exceeds latest", () => {
    const fixture = happyFixture();
    fixture.security = {
      vulnerabilityCount: 0,
      allVulnerabilityCount: 5,
      hasCurrentVulnerabilities: false,
      recentVulnerabilities: [],
    };

    const output = formatPackageSummaryTerminal(fixture, {
      useColors: false,
      now: FIXED_NOW,
    });
    expect(vulnerabilityText(output)).toBe(
      "Latest: none affected History: 5 known advisories across all versions",
    );
    expect(output).not.toContain("Inspect history");
  });

  it("does not append an action when latest evidence is unavailable", () => {
    const fixture = happyFixture();
    fixture.security = {
      vulnerabilityCount: undefined,
      allVulnerabilityCount: 5,
      hasCurrentVulnerabilities: false,
      recentVulnerabilities: [],
    };

    const output = formatPackageSummaryTerminal(fixture, {
      useColors: false,
      now: FIXED_NOW,
    });
    expect(output).not.toContain("Inspect history");

    fixture.security.allVulnerabilityCount = 0;
    const zeroHistory = formatPackageSummaryTerminal(fixture, {
      useColors: false,
      now: FIXED_NOW,
    });
    expect(zeroHistory).not.toContain("Inspect history");
  });

  it("does not render refresh metadata when no download count exists", () => {
    const fixture = happyFixture();
    fixture.package.downloadsLastMonth = undefined;
    fixture.package.downloadsTotal = undefined;
    fixture.package.downloadsRefreshedAt = "2024-06-15T23:59:00Z";
    const output = formatPackageSummaryTerminal(fixture, {
      verbose: true,
      useColors: false,
      now: FIXED_NOW,
    });
    expect(output).not.toContain("Downloads");
    expect(output).not.toContain("refreshed 2024-06-15");
  });

  it("omits license separator when license is null", () => {
    const fixture = happyFixture();
    fixture.package.license = undefined;
    const output = formatPackageSummaryTerminal(fixture, {
      useColors: false,
      now: FIXED_NOW,
    });
    expect(output.startsWith("express @ 4.18.2\n")).toBe(true);
  });

  it("renders without github block when fixture has no github repo", () => {
    const fixture = happyFixture();
    fixture.package.githubRepository = undefined;
    const output = formatPackageSummaryTerminal(fixture, {
      useColors: false,
      now: FIXED_NOW,
    });
    expect(output).not.toContain("GitHub");
    expect(output).not.toContain("stars");
  });

  it("renders GitHub popularity when repository URL is missing", () => {
    const fixture = happyFixture();
    fixture.package.repositoryUrl = undefined;
    const output = formatPackageSummaryTerminal(fixture, {
      useColors: false,
      now: FIXED_NOW,
    });
    expect(output).toContain(
      "GitHub           63k stars, 14k forks, 123 issues",
    );
  });

  it("marks archived repositories in default popularity text", () => {
    const fixture = happyFixture();
    if (fixture.package.githubRepository) {
      fixture.package.githubRepository.archived = true;
    }
    const output = formatPackageSummaryTerminal(fixture, {
      useColors: false,
      now: FIXED_NOW,
    });
    expect(output).toContain(
      "Repository       https://github.com/expressjs/express ([ARCHIVED], 63k stars, 14k forks, 123 issues)",
    );
  });

  it("wraps description at 80 cols and uses 80-col fallback when stdout.columns is undefined", () => {
    const fixture = happyFixture();
    fixture.package.description = "lorem ipsum ".repeat(20).trim();
    const output = formatPackageSummaryTerminal(fixture, {
      useColors: false,
      now: FIXED_NOW,
      terminalWidth: undefined,
    });
    const descriptionLines = output
      .split("\n")
      .filter((line) => line.startsWith("lorem"));
    for (const line of descriptionLines) {
      expect(line.length).toBeLessThanOrEqual(80);
    }
  });

  it("renders topics in verbose GitHub block", () => {
    const output = formatPackageSummaryTerminal(defaultPackageSummary, {
      verbose: true,
      useColors: false,
      now: FIXED_NOW,
    });
    expect(output).toContain(
      "  Topics       framework, http, middleware, nodejs, web",
    );
    expect(output.match(/Topics/g)?.length).toBe(1);
  });
});
