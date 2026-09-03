/**
 * Hand-crafted response envelope for the `package_summary` tool,
 * shared by CLI `--json` output and MCP `content[0].text`.
 *
 * Principles:
 * - **Token-efficient.** Every field dropped from the GraphQL payload
 *   is a deliberate decision. Decision-relevant metadata such as the
 *   published-version count and download refresh date is retained;
 *   unrelated schema metadata and duplicate GitHub identifiers remain
 *   omitted.
 * - **Null-omitted.** Scalars go missing when null; blocks go missing
 *   when every leaf is null; arrays go missing when empty. Agent
 *   callers receive present data only, not a skeleton.
 * - **Stable.** Two identical queries produce byte-identical output
 *   (no clock-dependent fields, no iteration-order tricks), so the
 *   parity test can deep-equal across surfaces.
 */

import type {
  ChangelogEntry,
  PackageSecurityOverview,
  PackageSummary,
  VulnerabilityOverview,
} from "@githits/core-internal";
import { toPkgseerRegistryLowercase } from "@githits/core-internal";
import { colorize, dim, highlight } from "./colors.js";
import { toIsoDate, toRelativeDate } from "./format-date.js";
import { formatCompactNumber } from "./format-number.js";

// --------------------------------------------------------------------
// Lean JSON envelope
// --------------------------------------------------------------------

export type SeverityLabel = "critical" | "high" | "medium" | "low";

export interface LeanDownloads {
  lastMonth?: number;
  total?: number;
  refreshedAt?: string;
}

export interface LeanGithub {
  stars?: number;
  forks?: number;
  openIssues?: number;
  archived?: boolean;
  language?: string;
  topics?: string[];
  lastPushedAt?: string;
}

export interface LeanVulnerability {
  id?: string;
  summary?: string;
  severity?: number;
  severityLabel?: SeverityLabel;
  publishedAt?: string;
}

export interface LeanVulnerabilities {
  total: number;
  affectsLatest: boolean;
  recent?: LeanVulnerability[];
}

export interface LeanAdvisoryHistory {
  total: number;
}

export interface LeanRecentChange {
  version: string;
  date?: string;
  summary?: string;
}

export interface LeanPackageSummary {
  registry: string;
  name: string;
  version: string;
  versionCount?: number;
  description?: string;
  license?: string;
  homepage?: string;
  repository?: string;
  publishedAt?: string;
  downloads?: LeanDownloads;
  github?: LeanGithub;
  vulnerabilities?: LeanVulnerabilities;
  advisoryHistory?: LeanAdvisoryHistory;
  recentChanges?: LeanRecentChange[];
}

/**
 * Build the lean envelope from a validated {@link PackageSummary}.
 * Pure, deterministic — no I/O, no clock, no env reads.
 */
export function buildPackageSummarySuccessPayload(
  summary: PackageSummary,
): LeanPackageSummary {
  const pkg = summary.package;

  const payload: LeanPackageSummary = {
    registry: lowerRegistry(pkg.registry),
    name: pkg.name,
    version: pkg.latestVersion,
  };

  assignIfDefined(payload, "versionCount", pkg.versionCount);
  assignIfDefined(payload, "description", pkg.description);
  assignIfDefined(payload, "license", pkg.license);
  assignIfDefined(payload, "homepage", pkg.homepage);
  assignIfDefined(payload, "repository", pkg.repositoryUrl);
  assignIfDefined(
    payload,
    "publishedAt",
    toIsoDate(pkg.latestVersionPublishedAt),
  );

  const downloads = buildDownloads(
    pkg.downloadsLastMonth,
    pkg.downloadsTotal,
    pkg.downloadsRefreshedAt,
  );
  if (downloads) payload.downloads = downloads;

  const github = buildGithub(pkg.githubRepository);
  if (github) payload.github = github;

  const vulns = buildVulnerabilities(summary.security);
  if (vulns) payload.vulnerabilities = vulns;

  const advisoryHistory = buildAdvisoryHistory(summary.security);
  if (advisoryHistory) payload.advisoryHistory = advisoryHistory;

  const recent = buildRecentChanges(summary.latestChangelogs);
  if (recent) payload.recentChanges = recent;

  return payload;
}

function lowerRegistry(value: string | undefined): string {
  if (!value) return "";
  const upper = value.toUpperCase();
  try {
    // Type assertion is safe when the backend echoes a known enum
    // value; fall through for unexpected strings (schema drift).
    // biome-ignore lint/suspicious/noExplicitAny: boundary guard
    return toPkgseerRegistryLowercase(upper as any);
  } catch {
    return value.toLowerCase();
  }
}

function assignIfDefined<T, K extends keyof T>(
  target: T,
  key: K,
  value: T[K] | null | undefined,
): void {
  if (value !== undefined && value !== null) {
    target[key] = value;
  }
}

function buildDownloads(
  lastMonth: number | undefined,
  total: number | undefined,
  refreshedAt: string | undefined,
): LeanDownloads | undefined {
  const result: LeanDownloads = {};
  if (typeof lastMonth === "number") result.lastMonth = lastMonth;
  if (typeof total === "number") result.total = total;
  const normalizedRefresh = toIsoDate(refreshedAt);
  if (normalizedRefresh) result.refreshedAt = normalizedRefresh;
  return Object.keys(result).length > 0 ? result : undefined;
}

function buildGithub(
  github: PackageSummary["package"]["githubRepository"],
): LeanGithub | undefined {
  if (!github) return undefined;
  const result: LeanGithub = {};
  if (typeof github.stargazersCount === "number") {
    result.stars = github.stargazersCount;
  }
  if (typeof github.forksCount === "number") {
    result.forks = github.forksCount;
  }
  if (typeof github.openIssuesCount === "number") {
    result.openIssues = github.openIssuesCount;
  }
  if (typeof github.archived === "boolean") {
    result.archived = github.archived;
  }
  if (github.language) {
    result.language = github.language;
  }
  if (github.topics && github.topics.length > 0) {
    result.topics = github.topics;
  }
  const lastPushedAt = toIsoDate(github.pushedAt);
  if (lastPushedAt) result.lastPushedAt = lastPushedAt;
  return Object.keys(result).length > 0 ? result : undefined;
}

function buildVulnerabilities(
  security: PackageSecurityOverview | undefined,
): LeanVulnerabilities | undefined {
  if (!security) return undefined;
  if (typeof security.vulnerabilityCount !== "number") return undefined;
  const total = security.vulnerabilityCount;

  const result: LeanVulnerabilities = {
    total,
    affectsLatest: security.hasCurrentVulnerabilities ?? false,
  };

  const recent = security.recentVulnerabilities
    ?.map(buildVulnerability)
    .filter((entry): entry is LeanVulnerability => entry !== undefined);
  if (recent && recent.length > 0) {
    result.recent = recent;
  }
  return result;
}

function buildAdvisoryHistory(
  security: PackageSecurityOverview | undefined,
): LeanAdvisoryHistory | undefined {
  if (!security) return undefined;
  return { total: security.allVulnerabilityCount };
}

function buildVulnerability(
  entry: VulnerabilityOverview,
): LeanVulnerability | undefined {
  const lean: LeanVulnerability = {};
  if (entry.osvId) lean.id = entry.osvId;
  if (entry.summary) lean.summary = entry.summary;
  if (typeof entry.severityScore === "number" && entry.severityScore > 0) {
    lean.severity = entry.severityScore;
    lean.severityLabel = severityLabel(entry.severityScore);
  }
  const publishedAt = toIsoDate(entry.publishedAt);
  if (publishedAt) lean.publishedAt = publishedAt;
  return Object.keys(lean).length > 0 ? lean : undefined;
}

export function severityLabel(score: number): SeverityLabel {
  if (score >= 9) return "critical";
  if (score >= 7) return "high";
  if (score >= 4) return "medium";
  return "low";
}

function buildRecentChanges(
  entries: ChangelogEntry[] | undefined,
): LeanRecentChange[] | undefined {
  if (!entries || entries.length === 0) return undefined;
  const filtered = entries
    .filter((entry): entry is ChangelogEntry => !!entry.version)
    .map((entry) => {
      const lean: LeanRecentChange = { version: entry.version as string };
      const date = toIsoDate(entry.publishedAt);
      if (date) lean.date = date;
      const summary = pickChangelogSummary(entry);
      if (summary) lean.summary = summary;
      return lean;
    });
  return filtered.length > 0 ? filtered : undefined;
}

function pickChangelogSummary(entry: ChangelogEntry): string | undefined {
  // ChangelogEntry has no dedicated summary field on the schema, so
  // we derive one from the first non-empty line of the body. Many
  // changelogs lead with markdown headers (`## What's Changed`,
  // `### Bug fixes`) — strip the `#` markers so the summary reads as
  // prose. Trimmed to 120 chars with trailing ASCII ellipsis.
  if (!entry.body) return undefined;
  const firstLine = entry.body
    .split(/\r?\n/)
    .map((line) => stripMarkdownHeading(line.trim()))
    .find((line) => line.length > 0);
  if (!firstLine) return undefined;
  return firstLine.length > 120
    ? `${firstLine.slice(0, 117).trimEnd()}...`
    : firstLine;
}

function stripMarkdownHeading(line: string): string {
  // Remove leading `#` markers (1-6) followed by whitespace.
  return line.replace(/^#{1,6}\s+/, "").trim();
}

// --------------------------------------------------------------------
// Terminal formatter
// --------------------------------------------------------------------

export interface FormatTerminalOptions {
  verbose?: boolean;
  useColors?: boolean;
  surface?: "cli" | "mcp";
  /** Column width for wrapping the description line. Defaults to 80. */
  terminalWidth?: number;
  /**
   * Clock injection for relative-date rendering. Tests pin this; in
   * production `new Date()` is used.
   */
  now?: Date;
}

/**
 * Render a {@link PackageSummary} for terminal display. Pure.
 */
export function formatPackageSummaryTerminal(
  summary: PackageSummary,
  options: FormatTerminalOptions = {},
): string {
  const lean = buildPackageSummarySuccessPayload(summary);
  const useColors = options.useColors ?? false;
  const width = resolveWidth(options.terminalWidth);
  const now = options.now ?? new Date();
  const surface = options.surface ?? "cli";

  const sections: string[] = [];

  // Header — `name @ version | license`
  const header = lean.license
    ? `${colorize(lean.name, "bold", useColors)} @ ${lean.version} | ${lean.license}`
    : `${colorize(lean.name, "bold", useColors)} @ ${lean.version}`;
  sections.push(header);

  // Description, wrapped.
  if (lean.description) {
    sections.push(wrapText(lean.description, width));
  }

  // Field list.
  const fields = buildFieldList(
    lean,
    summary,
    useColors,
    now,
    options.verbose ?? false,
    surface,
    width,
  );
  if (fields.length > 0) {
    sections.push(fields.join("\n"));
  }

  if (options.verbose) {
    const verbose = buildVerboseSections(lean, useColors);
    if (verbose.length > 0) sections.push(verbose);
  }

  return `${sections.join("\n\n")}\n`;
}

function resolveWidth(explicit: number | undefined): number {
  if (typeof explicit === "number" && explicit > 0) {
    return Math.min(explicit, 80);
  }
  const columns = process.stdout?.columns;
  if (typeof columns === "number" && columns > 0) {
    return Math.min(columns, 80);
  }
  return 80;
}

function wrapText(text: string, width: number): string {
  const safeWidth = Math.max(1, width);
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (word.length > safeWidth) {
      if (current.length > 0) {
        lines.push(current);
        current = "";
      }
      for (let offset = 0; offset < word.length; offset += safeWidth) {
        const chunk = word.slice(offset, offset + safeWidth);
        if (chunk.length === safeWidth || offset + safeWidth < word.length) {
          lines.push(chunk);
        } else {
          current = chunk;
        }
      }
      continue;
    }
    if (current.length === 0) {
      current = word;
      continue;
    }
    if (current.length + 1 + word.length > safeWidth) {
      lines.push(current);
      current = word;
    } else {
      current += ` ${word}`;
    }
  }
  if (current.length > 0) lines.push(current);
  return lines.join("\n");
}

interface LabelledField {
  label: string;
  value: string;
}

function buildFieldList(
  lean: LeanPackageSummary,
  summary: PackageSummary,
  useColors: boolean,
  now: Date,
  verbose: boolean,
  surface: "cli" | "mcp",
  width: number,
): string[] {
  const fields: LabelledField[] = [];

  if (lean.repository) {
    const repositoryParts = [dim(lean.repository, useColors)];
    const githubPopularity = formatGithubPopularity(lean.github);
    if (githubPopularity) repositoryParts.push(`(${githubPopularity})`);
    fields.push({
      label: "Repository",
      value: repositoryParts.join(" "),
    });
  } else {
    const githubPopularity = formatGithubPopularity(lean.github);
    if (githubPopularity) {
      fields.push({ label: "GitHub", value: githubPopularity });
    }
  }
  if (lean.homepage) {
    fields.push({ label: "Homepage", value: dim(lean.homepage, useColors) });
  }

  const publishedRelative = toRelativeDate(
    summary.package.latestVersionPublishedAt,
    now,
  );
  if (publishedRelative) {
    fields.push({ label: "Published", value: publishedRelative });
  }

  if (verbose && lean.versionCount !== undefined) {
    fields.push({
      label: "Versions",
      value: `${formatCompactNumber(lean.versionCount)} published`,
    });
  }

  if (lean.downloads?.lastMonth !== undefined) {
    const refreshed =
      verbose && lean.downloads.refreshedAt
        ? `; refreshed ${lean.downloads.refreshedAt}`
        : "";
    fields.push({
      label: "Downloads",
      value: `${formatCompactNumber(lean.downloads.lastMonth)} / month${refreshed}`,
    });
  } else if (lean.downloads?.total !== undefined) {
    const refreshed =
      verbose && lean.downloads.refreshedAt
        ? `; refreshed ${lean.downloads.refreshedAt}`
        : "";
    fields.push({
      label: "Downloads",
      value: `${formatCompactNumber(lean.downloads.total)} total${refreshed}`,
    });
  }

  if (lean.advisoryHistory) {
    fields.push({
      label: "Vulnerabilities",
      value: formatVulnerabilityStatus(
        lean.vulnerabilities,
        lean.advisoryHistory,
      ),
    });
  }

  // Label column sized to the widest *raw* label (no ANSI, matching
  // the locked padding rule). Minimum 10 cols for a readable gutter.
  const labelWidth = Math.max(10, ...fields.map((field) => field.label.length));

  const valueIndent = " ".repeat(labelWidth + 2);
  const valueWidth = Math.max(1, width - valueIndent.length);
  const lines = fields.flatMap((field) => {
    const valueLines =
      field.label === "Vulnerabilities"
        ? field.value
            .split("\n")
            .flatMap((value) => wrapText(value, valueWidth).split("\n"))
        : [field.value];
    return valueLines.map((value, index) =>
      index === 0
        ? `${field.label.padEnd(labelWidth)}  ${value}`
        : `${valueIndent}${value}`,
    );
  });

  const historyHint = formatHistoryHint(lean, surface);
  if (historyHint) {
    const wrappedHint = wrapText(historyHint, valueWidth).split("\n");
    lines.push(
      dim(
        wrappedHint.map((line) => `${valueIndent}${line}`).join("\n"),
        useColors,
      ),
    );
  }
  return lines;
}

function formatGithubPopularity(
  github: LeanGithub | undefined,
): string | undefined {
  if (!github) return undefined;
  const parts: string[] = [];
  if (github.archived) {
    parts.push("[ARCHIVED]");
  }
  if (github.stars !== undefined) {
    parts.push(`${formatCompactNumber(github.stars)} stars`);
  }
  if (github.forks !== undefined) {
    parts.push(`${formatCompactNumber(github.forks)} forks`);
  }
  if (github.openIssues !== undefined) {
    parts.push(`${formatCompactNumber(github.openIssues)} issues`);
  }
  return parts.length > 0 ? parts.join(", ") : undefined;
}

function formatVulnerabilityStatus(
  vulns: LeanVulnerabilities | undefined,
  history: LeanAdvisoryHistory,
): string {
  let latest: string;
  if (!vulns) {
    latest = "Latest: unavailable";
  } else if (vulns.total === 0) {
    latest = "Latest: none affected";
  } else {
    latest = `Latest: ${vulns.total} affected`;
  }

  const historyNoun = history.total === 1 ? "advisory" : "advisories";
  const inconsistent = vulns !== undefined && history.total < vulns.total;
  const historySuffix = inconsistent ? " (inconsistent backend evidence)" : "";
  const historyText =
    history.total === 0
      ? `History: none known across all versions${historySuffix}`
      : `History: ${history.total} known ${historyNoun} across all versions${historySuffix}`;
  return `${latest}\n${historyText}`;
}

function formatHistoryHint(
  lean: LeanPackageSummary,
  surface: "cli" | "mcp",
): string | undefined {
  if (!lean.advisoryHistory || lean.advisoryHistory.total <= 0) {
    return undefined;
  }
  if (
    lean.vulnerabilities &&
    lean.advisoryHistory.total <= lean.vulnerabilities.total
  ) {
    return undefined;
  }
  if (surface === "mcp") {
    return 'Inspect history: use pkg_vulns with advisory_scope="all".';
  }
  return `Inspect history: githits pkg vulns ${lean.registry}:${lean.name} --scope all`;
}

function buildVerboseSections(
  lean: LeanPackageSummary,
  useColors: boolean,
): string {
  const blocks: string[] = [];

  if (lean.github) {
    const github = formatVerboseGithub(lean.github, useColors);
    if (github) blocks.push(github);
  }

  if (lean.vulnerabilities?.recent && lean.vulnerabilities.recent.length > 0) {
    blocks.push(
      formatVerboseAdvisories(lean.vulnerabilities.recent, useColors),
    );
  }

  if (lean.recentChanges && lean.recentChanges.length > 0) {
    blocks.push(formatVerboseChanges(lean.recentChanges, useColors));
  }

  return blocks.join("\n\n");
}

function formatVerboseGithub(
  github: LeanGithub,
  useColors: boolean,
): string | undefined {
  const fields: LabelledField[] = [];
  if (github.language)
    fields.push({ label: "Language", value: github.language });
  if (github.lastPushedAt) {
    fields.push({ label: "Last pushed", value: github.lastPushedAt });
  }
  if (github.topics && github.topics.length > 0) {
    fields.push({ label: "Topics", value: github.topics.join(", ") });
  }
  const labelWidth = Math.max(10, ...fields.map((field) => field.label.length));
  return fields.length > 0
    ? [
        highlight("GitHub", useColors),
        ...fields.map(
          (field) => `  ${field.label.padEnd(labelWidth)}  ${field.value}`,
        ),
      ].join("\n")
    : undefined;
}

function formatVerboseAdvisories(
  advisories: LeanVulnerability[],
  useColors: boolean,
): string {
  const labelWidth = Math.max(
    ...advisories.map((a) => (a.severityLabel ?? "").length),
  );
  const lines = [highlight("Advisory history (all versions)", useColors)];
  for (const advisory of advisories) {
    const parts: string[] = [];
    const label = (advisory.severityLabel ?? "").padEnd(labelWidth);
    if (label.trim().length > 0) parts.push(label);
    if (advisory.id) parts.push(advisory.id);
    if (advisory.publishedAt) parts.push(advisory.publishedAt);
    if (advisory.summary) parts.push(advisory.summary);
    lines.push(`  ${parts.join("  ")}`);
  }
  return lines.join("\n");
}

function formatVerboseChanges(
  entries: LeanRecentChange[],
  useColors: boolean,
): string {
  const lines = [highlight("Recent changes", useColors)];
  for (const entry of entries) {
    const parts: string[] = [entry.version];
    if (entry.date) parts.push(entry.date);
    if (entry.summary) parts.push(entry.summary);
    lines.push(`  ${parts.join("  ")}`);
  }
  return lines.join("\n");
}
