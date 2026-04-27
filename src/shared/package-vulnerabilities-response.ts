/**
 * Hand-crafted response envelope for the `package_vulnerabilities`
 * tool. Shared by CLI `--json` output and MCP `content[0].text`. The
 * terminal formatter is CLI-only.
 *
 * Key design commitments (locked in the plan):
 * - Backend is the single source of truth for counts. `minSeverity`
 *   and `includeWithdrawn` are passed through on the wire; the
 *   backend returns a filter-aware `vulnerabilityCount`. The builder
 *   does no filtering of its own.
 * - Malware bucket is disjoint from severity bands. `summary.bySeverity`
 *   carries a `malware` key counting `isMalicious === true` advisories;
 *   severity bands count non-malicious advisories only. Non-malicious
 *   advisories with no CVSS score fall into a disjoint `unrated`
 *   bucket so every returned advisory is accounted for. The buckets
 *   always partition `security.vulnerabilities[]`; their sum equals
 *   `summary.total` whenever the backend keeps its `vulnerabilityCount`
 *   and `vulnerabilities[]` in sync (the expected case on all shipped
 *   registries). The builder does not re-derive `total` from the array
 *   length because `vulnerabilityCount` is filter-aware and may
 *   legitimately exceed the returned list in paginated futures.
 * - `requestedVersion` surfaces whenever the backend-resolved
 *   `version` differs from the caller's (trimmed) input. `v`-prefix
 *   normalisation is intentionally *not* applied here: the `v4.17.0`
 *   form is a git-tag convention, not a version-string convention —
 *   no supported registry (npm, PyPI, Hex, Crates) accepts it as a
 *   canonical version, so the backend will reject it rather than
 *   resolve it to `4.17.0`. Masking that error would hide a real
 *   caller mistake.
 * - `modifiedAt` is included only when it differs from `publishedAt`.
 * - Sort order: malware bucket first; within a bucket, severity desc,
 *   then `publishedAt` desc, then `osvId` asc (deterministic
 *   tiebreaker). Withdrawn advisories bucket below all active.
 */

import type {
  VulnerabilityDetail,
  VulnerabilityReport,
} from "../services/index.js";
import { colorize, dim } from "./colors.js";
import { toIsoDate } from "./format-date.js";
import { toPkgseerRegistryLowercase } from "./pkgseer-registry.js";

export type VulnSeverityLabel = "critical" | "high" | "medium" | "low";

/**
 * Buckets that partition {@link LeanVulnerabilitySummary.total}. Malware
 * is disjoint from CVSS bands; `unrated` holds non-malicious advisories
 * with no CVSS score so the breakdown reconciles with the total.
 */
export type VulnBucket = "malware" | VulnSeverityLabel | "unrated";

export interface LeanAdvisory {
  id?: string;
  aliases?: string[];
  summary?: string;
  severity?: number;
  severityLabel?: VulnSeverityLabel;
  affectedRanges?: string[];
  fixedIn?: string[];
  publishedAt?: string;
  modifiedAt?: string;
  withdrawnAt?: string;
  isMalicious?: boolean;
}

export interface LeanVulnerabilitySummary {
  total: number;
  affected?: boolean;
  bySeverity?: Partial<Record<VulnBucket, number>>;
}

export interface LeanVulnerabilityReport {
  registry: string;
  name: string;
  version: string;
  requestedVersion?: string;
  summary: LeanVulnerabilitySummary;
  advisories?: LeanAdvisory[];
  upgradePaths?: string[];
}

export interface BuildVulnerabilitiesPayloadOptions {
  /** Raw caller-supplied version string (pre-normalisation). */
  requestedVersion?: string;
}

/**
 * Build the lean envelope from a validated {@link VulnerabilityReport}.
 * Pure, deterministic — no clock, no env reads.
 */
export function buildPackageVulnerabilitiesSuccessPayload(
  report: VulnerabilityReport,
  options: BuildVulnerabilitiesPayloadOptions = {},
): LeanVulnerabilityReport {
  const pkg = report.package;
  const security = report.security;
  const total = security?.vulnerabilityCount ?? 0;

  const payload: LeanVulnerabilityReport = {
    registry: lowerRegistry(pkg.registry),
    name: pkg.name,
    version: pkg.version,
    summary: buildSummary(total, security),
  };

  const requestedEcho = deriveRequestedVersion(
    options.requestedVersion,
    pkg.version,
  );
  if (requestedEcho !== undefined) {
    payload.requestedVersion = requestedEcho;
  }

  if (total > 0) {
    const sortedAdvisories = sortAdvisories(
      (security?.vulnerabilities ?? []).map(buildAdvisory),
    );
    if (sortedAdvisories.length > 0) {
      payload.advisories = sortedAdvisories;
    }
  }

  const upgradePaths = security?.upgradePaths;
  if (upgradePaths && upgradePaths.length > 0) {
    // Ascending semver-ish order (pre-releases sort below their base
    // version) so the CLI footer reads `Upgrade options: 3.11.0, 4.5.0,
    // 4.19.2, …` — presenting the minimum-churn upgrade first. Without
    // this sort the backend's advisory-iteration order produced
    // jarring mixes like `3.11.0, 4.5.0, 4.20.0, 5.0.0, 4.0.0-rc1`.
    const unique = Array.from(new Set(upgradePaths));
    unique.sort(compareVersionsAscending);
    payload.upgradePaths = unique;
  }

  return payload;
}

/**
 * Stable, locale-independent version compare used to sort upgrade
 * paths. Handles semver-ish `MAJOR.MINOR.PATCH[-pre]` shapes which
 * covers every vulnerability-capable registry (npm, PyPI, Hex,
 * Crates) well enough for display ordering. Unparseable segments
 * fall back to lexicographic compare so exotic strings never crash
 * the pipeline.
 */
export function compareVersionsAscending(a: string, b: string): number {
  const pa = parseVersionForSort(a);
  const pb = parseVersionForSort(b);
  const len = Math.max(pa.main.length, pb.main.length);
  for (let i = 0; i < len; i++) {
    const diff = (pa.main[i] ?? 0) - (pb.main[i] ?? 0);
    if (diff !== 0) return diff;
  }
  // Base versions equal. Pre-release sorts below the clean release
  // (matches semver: 4.0.0-rc1 < 4.0.0).
  if (pa.pre === undefined && pb.pre === undefined) return 0;
  if (pa.pre === undefined) return 1;
  if (pb.pre === undefined) return -1;
  return pa.pre < pb.pre ? -1 : pa.pre > pb.pre ? 1 : 0;
}

function parseVersionForSort(v: string): { main: number[]; pre?: string } {
  const [mainStr, ...preParts] = v.split("-");
  const pre = preParts.length > 0 ? preParts.join("-") : undefined;
  const main = (mainStr ?? "").split(".").map((segment) => {
    const n = Number.parseInt(segment, 10);
    return Number.isFinite(n) ? n : 0;
  });
  return { main, pre };
}

// --------------------------------------------------------------------
// Summary
// --------------------------------------------------------------------

function buildSummary(
  total: number,
  security: VulnerabilityReport["security"],
): LeanVulnerabilitySummary {
  const summary: LeanVulnerabilitySummary = { total };
  if (total === 0) return summary;

  if (typeof security?.currentVersionAffected === "boolean") {
    summary.affected = security.currentVersionAffected;
  }

  const bySeverity = computeBySeverity(security?.vulnerabilities ?? []);
  const anyCounted = Object.values(bySeverity).some((n) => n > 0);
  if (anyCounted) {
    const trimmed: Partial<Record<VulnBucket, number>> = {};
    // Preserve insertion order so JSON output is deterministic and
    // matches the terminal breakdown line order.
    for (const key of BUCKET_ORDER) {
      const n = bySeverity[key];
      if (n > 0) trimmed[key] = n;
    }
    summary.bySeverity = trimmed;
  }

  return summary;
}

/**
 * Partitioning histogram: every advisory lands in exactly one bucket.
 * Malicious advisories count under `malware`; non-malicious advisories
 * with a positive CVSS score count under their band; non-malicious
 * advisories with no score count under `unrated`.
 */
export function computeBySeverity(
  advisories: readonly VulnerabilityDetail[],
): Record<VulnBucket, number> {
  const histogram: Record<VulnBucket, number> = {
    malware: 0,
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    unrated: 0,
  };
  for (const advisory of advisories) {
    if (advisory.isMalicious === true) {
      histogram.malware += 1;
      continue;
    }
    const label = vulnSeverityLabel(advisory.severityScore);
    if (label !== undefined) {
      histogram[label] += 1;
    } else {
      histogram.unrated += 1;
    }
  }
  return histogram;
}

const BUCKET_ORDER: readonly VulnBucket[] = [
  "malware",
  "critical",
  "high",
  "medium",
  "low",
  "unrated",
];

export function vulnSeverityLabel(
  score: number | null | undefined,
): VulnSeverityLabel | undefined {
  if (typeof score !== "number" || score <= 0) return undefined;
  if (score >= 9) return "critical";
  if (score >= 7) return "high";
  if (score >= 4) return "medium";
  return "low";
}

// --------------------------------------------------------------------
// Advisory shaping
// --------------------------------------------------------------------

function buildAdvisory(advisory: VulnerabilityDetail): LeanAdvisory {
  const lean: LeanAdvisory = {};
  if (advisory.osvId) lean.id = advisory.osvId;
  if (advisory.aliases && advisory.aliases.length > 0) {
    lean.aliases = advisory.aliases.slice();
  }
  if (advisory.summary && !isPlaceholderSummary(advisory.summary)) {
    lean.summary = advisory.summary;
  }

  if (
    typeof advisory.severityScore === "number" &&
    advisory.severityScore > 0
  ) {
    lean.severity = advisory.severityScore;
    const label = vulnSeverityLabel(advisory.severityScore);
    if (label !== undefined) lean.severityLabel = label;
  }

  if (
    advisory.affectedVersionRanges &&
    advisory.affectedVersionRanges.length > 0
  ) {
    lean.affectedRanges = advisory.affectedVersionRanges.slice();
  }
  if (advisory.fixedInVersions && advisory.fixedInVersions.length > 0) {
    lean.fixedIn = advisory.fixedInVersions.slice();
  }

  const publishedAt = toIsoDate(advisory.publishedAt);
  if (publishedAt) lean.publishedAt = publishedAt;

  const modifiedAt = toIsoDate(advisory.modifiedAt);
  if (modifiedAt && modifiedAt !== publishedAt) {
    lean.modifiedAt = modifiedAt;
  }

  const withdrawnAt = toIsoDate(advisory.withdrawnAt);
  if (withdrawnAt) lean.withdrawnAt = withdrawnAt;

  if (advisory.isMalicious === true) {
    lean.isMalicious = true;
  }

  return lean;
}

// --------------------------------------------------------------------
// Sort
// --------------------------------------------------------------------

const SEVERITY_RANK: Readonly<Record<VulnSeverityLabel, number>> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

function sortAdvisories(advisories: LeanAdvisory[]): LeanAdvisory[] {
  return advisories.slice().sort(compareAdvisories);
}

function compareAdvisories(a: LeanAdvisory, b: LeanAdvisory): number {
  // 1. Active advisories come before withdrawn.
  const aWithdrawn = a.withdrawnAt !== undefined;
  const bWithdrawn = b.withdrawnAt !== undefined;
  if (aWithdrawn !== bWithdrawn) return aWithdrawn ? 1 : -1;

  // 2. Malicious advisories float to the top of their bucket.
  const aMalware = a.isMalicious === true;
  const bMalware = b.isMalicious === true;
  if (aMalware !== bMalware) return aMalware ? -1 : 1;

  // 3. Severity descending.
  const aRank = a.severityLabel ? SEVERITY_RANK[a.severityLabel] : 0;
  const bRank = b.severityLabel ? SEVERITY_RANK[b.severityLabel] : 0;
  if (aRank !== bRank) return bRank - aRank;

  // 4. publishedAt descending (most recent first).
  const aDate = a.publishedAt ?? "";
  const bDate = b.publishedAt ?? "";
  if (aDate !== bDate) return aDate < bDate ? 1 : -1;

  // 5. Final deterministic tiebreaker: osvId ascending.
  const aId = a.id ?? "";
  const bId = b.id ?? "";
  if (aId !== bId) return aId < bId ? -1 : 1;
  return 0;
}

// --------------------------------------------------------------------
// Version-echo derivation
// --------------------------------------------------------------------

function deriveRequestedVersion(
  requested: string | undefined,
  resolved: string,
): string | undefined {
  if (requested === undefined) return undefined;
  const trimmed = requested.trim();
  if (trimmed.length === 0) return undefined;
  // Any non-empty divergence from the resolved version surfaces as
  // `requestedVersion`. No `v`-prefix suppression: a registry that
  // accepts a version-only input never treats `v4.17.0` as a valid
  // canonical version — the `v` prefix is a git-tag convention, not
  // a semver/PEP 440/Cargo version. If the backend resolved to
  // something different, that divergence is a real signal the caller
  // should see.
  if (trimmed === resolved) return undefined;
  return trimmed;
}

// --------------------------------------------------------------------
// Registry lowering
// --------------------------------------------------------------------

function lowerRegistry(value: string | undefined): string {
  if (!value) return "";
  const upper = value.toUpperCase();
  try {
    // biome-ignore lint/suspicious/noExplicitAny: boundary guard
    return toPkgseerRegistryLowercase(upper as any);
  } catch {
    return value.toLowerCase();
  }
}

// --------------------------------------------------------------------
// Terminal formatter (CLI-only; MCP never invokes this)
// --------------------------------------------------------------------

export interface FormatVulnerabilitiesTerminalOptions {
  verbose?: boolean;
  useColors?: boolean;
  requestedVersion?: string;
  /**
   * Terminal width in columns. Used to decide how many
   * affected-version ranges to show before collapsing into a
   * `(+N more)` hint. Defaults to a conservative 80 when the caller
   * doesn't know (tests, piped output).
   */
  terminalWidth?: number;
}

export function formatPackageVulnerabilitiesTerminal(
  report: VulnerabilityReport,
  options: FormatVulnerabilitiesTerminalOptions = {},
): string {
  const payload = buildPackageVulnerabilitiesSuccessPayload(report, {
    requestedVersion: options.requestedVersion,
  });
  const useColors = options.useColors ?? false;
  const verbose = options.verbose ?? false;

  const headerLine = formatHeader(payload, useColors);
  const requestedLine = payload.requestedVersion
    ? dim(`(requested ${payload.requestedVersion})`, useColors)
    : undefined;

  if (payload.summary.total === 0) {
    const lines = [headerLine];
    if (requestedLine) lines.push(requestedLine);
    lines.push("No known vulnerabilities.");
    return `${lines.join("\n")}\n`;
  }

  const blocks: string[] = [];
  const headerBlock: string[] = [headerLine];
  if (requestedLine) headerBlock.push(requestedLine);
  headerBlock.push(formatSummaryLine(payload, useColors));
  const breakdown = formatBreakdownLine(payload.summary, useColors);
  if (breakdown) headerBlock.push(breakdown);
  blocks.push(headerBlock.join("\n"));

  if (payload.advisories && payload.advisories.length > 0) {
    const rangeLimit = resolveAffectedRangesLimit(options.terminalWidth);
    blocks.push(
      formatAdvisoryList(payload.advisories, verbose, useColors, rangeLimit),
    );
  }

  const upgradeFooter = formatUpgradeFooter(payload.upgradePaths);
  if (upgradeFooter) blocks.push(upgradeFooter);

  return `${blocks.join("\n\n")}\n`;
}

function formatHeader(
  payload: LeanVulnerabilityReport,
  useColors: boolean,
): string {
  const name = colorize(payload.name, "bold", useColors);
  return `${name} @ ${payload.version} · ${payload.registry}`;
}

function formatSummaryLine(
  payload: LeanVulnerabilityReport,
  useColors: boolean,
): string {
  const n = payload.summary.total;
  const noun = n === 1 ? "vulnerability" : "vulnerabilities";
  const base = `${n} known ${noun}`;
  // Colour reflects caller risk: yellow/warn when the latest version
  // is affected; plain text when clean (so "latest clean" doesn't
  // read as a caution signal).
  if (payload.summary.affected === true) {
    return colorize(`${base} · latest affected`, "yellow", useColors);
  }
  if (payload.summary.affected === false) {
    return `${base} · latest clean`;
  }
  return base;
}

function formatBreakdownLine(
  summary: LeanVulnerabilitySummary,
  useColors: boolean,
): string | undefined {
  // One-advisory case doesn't need a breakdown.
  if (summary.total <= 1) return undefined;
  const bucket = summary.bySeverity;
  if (!bucket) return undefined;
  const labels: Record<VulnBucket, string> = {
    malware: "MALWARE",
    critical: "crit",
    high: "high",
    medium: "medium",
    low: "low",
    unrated: "unrated",
  };
  const parts: string[] = [];
  for (const key of BUCKET_ORDER) {
    const count = bucket[key];
    if (typeof count === "number" && count > 0) {
      const segment = `${count} ${labels[key]}`;
      parts.push(
        key === "malware" ? colorize(segment, "red", useColors) : segment,
      );
    }
  }
  if (parts.length === 0) return undefined;
  return `  ${parts.join(" · ")}`;
}

// --------------------------------------------------------------------
// Advisory rendering
// --------------------------------------------------------------------

function formatAdvisoryList(
  advisories: LeanAdvisory[],
  verbose: boolean,
  useColors: boolean,
  rangeLimit: number,
): string {
  const labelWidth = Math.max(
    ...advisories.map((a) => severityColumnLabel(a).length),
  );
  const lines: string[] = [];
  for (const advisory of advisories) {
    lines.push(
      ...formatAdvisoryLines(
        advisory,
        labelWidth,
        verbose,
        useColors,
        rangeLimit,
      ),
    );
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}

function severityColumnLabel(advisory: LeanAdvisory): string {
  if (advisory.isMalicious === true) {
    if (advisory.severityLabel) return `MALWARE · ${advisory.severityLabel}`;
    return "MALWARE";
  }
  // Filling the column with "unrated" (dim) when the advisory has no
  // CVSS score beats an empty gutter — users immediately see the
  // advisory is present, just unbanded, rather than wondering why
  // the severity column is blank. Matches the header breakdown
  // label so the two surfaces share vocabulary.
  return advisory.severityLabel ?? "unrated";
}

/**
 * Backend (OSV upstream, in particular) occasionally ships a literal
 * "No summary available" string where a real summary would go. Strip
 * it so the terminal row doesn't render a non-informative sentence
 * and the JSON envelope doesn't leak a placeholder string to
 * agents. Absence of the field is the signal.
 */
function isPlaceholderSummary(summary: string): boolean {
  return /^\s*no summary available\s*$/i.test(summary);
}

function severityColumnColor(
  advisory: LeanAdvisory,
  useColors: boolean,
  padded: string,
): string {
  if (!useColors) return padded;
  if (advisory.withdrawnAt !== undefined) return dim(padded, useColors);
  if (advisory.isMalicious === true) {
    return `${colorize(padded, "red", useColors)}`;
  }
  switch (advisory.severityLabel) {
    case "critical":
      return colorize(padded, "red", useColors);
    case "high":
      return colorize(padded, "yellow", useColors);
    case "medium":
      return colorize(padded, "yellow", useColors);
    case "low":
      return dim(padded, useColors);
    default:
      // Unrated advisories (no CVSS score) — the label was filled in
      // by severityColumnLabel; render it dim so it visually ranks
      // below banded rows.
      return dim(padded, useColors);
  }
}

function formatAdvisoryLines(
  advisory: LeanAdvisory,
  labelWidth: number,
  verbose: boolean,
  useColors: boolean,
  rangeLimit: number,
): string[] {
  const rawLabel = severityColumnLabel(advisory);
  const padded = rawLabel.padEnd(labelWidth);
  const colouredLabel = severityColumnColor(advisory, useColors, padded);

  const parts: string[] = [colouredLabel];
  if (advisory.id) parts.push(advisory.id);
  if (advisory.publishedAt) parts.push(advisory.publishedAt);
  if (advisory.summary) parts.push(advisory.summary);

  const lines: string[] = [`  ${parts.join("  ")}`];

  // Compact detail rows — indented 4 spaces so they "hang" under the
  // advisory headline.
  const detailWidth = verbose ? 12 : 8;
  const pushRow = (label: string, value: string) => {
    lines.push(`    ${label.padEnd(detailWidth)} ${value}`);
  };
  if (advisory.affectedRanges && advisory.affectedRanges.length > 0) {
    pushRow(
      "affected",
      formatRangeList(advisory.affectedRanges, verbose, useColors, rangeLimit),
    );
  }
  if (advisory.fixedIn && advisory.fixedIn.length > 0) {
    pushRow("fixed in", advisory.fixedIn.join(", "));
  }

  if (verbose) {
    if (advisory.aliases && advisory.aliases.length > 0) {
      pushRow("aliases", advisory.aliases.join(", "));
    }
    if (typeof advisory.severity === "number") {
      pushRow("severity", `${advisory.severity} (CVSS)`);
    }
    if (advisory.publishedAt) {
      pushRow("published", advisory.publishedAt);
    }
    if (advisory.modifiedAt) {
      pushRow("modified", advisory.modifiedAt);
    }
    if (advisory.withdrawnAt) {
      pushRow("withdrawn", advisory.withdrawnAt);
    }
    if (advisory.isMalicious === true) {
      pushRow("malicious", "yes");
    }
  }

  return lines;
}

/**
 * Cap the displayed affected-range list in compact mode so long-history
 * packages (e.g. `requests`) don't drown the advisory headline. Verbose
 * mode shows the full list — operators auditing a specific CVE still
 * get it with `-v`. JSON output is never truncated (machine consumers
 * need the full list).
 */
function formatRangeList(
  ranges: string[],
  verbose: boolean,
  useColors: boolean,
  limit: number,
): string {
  if (verbose || ranges.length <= limit) {
    return ranges.join(", ");
  }
  const shown = ranges.slice(0, limit).join(", ");
  const hiddenCount = ranges.length - limit;
  const hint = dim(`… (+${hiddenCount} more; use -v)`, useColors);
  return `${shown}, ${hint}`;
}

/**
 * Adaptive cap: wider terminals accommodate more ranges before the
 * row wraps awkwardly. These thresholds are empirical — 80 cols is
 * the lowest common default; ≥120 is a typical modern terminal; a
 * few ultrawide rigs justify more. Chosen to keep most rows on a
 * single visual line without truncating the advisory ID column.
 */
function resolveAffectedRangesLimit(terminalWidth: number | undefined): number {
  const cols = typeof terminalWidth === "number" ? terminalWidth : 80;
  if (cols >= 160) return 8;
  if (cols >= 120) return 6;
  return 4;
}

// --------------------------------------------------------------------
// Upgrade footer
// --------------------------------------------------------------------

function formatUpgradeFooter(paths: string[] | undefined): string | undefined {
  if (!paths || paths.length === 0) return undefined;
  if (paths.length === 1) return `Upgrade to ${paths[0]}.`;
  return `Upgrade options: ${paths.join(", ")}.`;
}
