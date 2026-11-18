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
 * - **Null-omitted.** Summary data scalars go missing when null; blocks go missing
 *   when every leaf is null; empty history arrays go missing. Backend assessment
 *   reasons retain their array, including an empty array. Agent
 *   callers receive present data only, not a skeleton. Publisher/source details
 *   expand only when verbose output is explicitly requested. Failure facts retain
 *   an explicit null gitRef when source selection has not completed.
 * - **Stable.** Two identical queries produce byte-identical output
 *   (no clock-dependent fields, no iteration-order tricks), so the
 *   parity test can deep-equal across surfaces.
 */

import type {
  ChangelogEntry,
  PackageLifecycle,
  PackageSecurityOverview,
  PackageSummary,
  PackageSummaryMetadataError,
  RegistryLatestDifference,
  RegistryRepository,
  VulnerabilityOverview,
} from "@githits/core-internal";
import { toPkgseerRegistryLowercase } from "@githits/core-internal";
import { colorize, highlight } from "./colors.js";
import { toIsoDate, toRelativeDate } from "./format-date.js";
import { formatCompactNumber } from "./format-number.js";
import { formatMappedErrorText } from "./mapped-error-text.js";
import { shellQuoteExact } from "./shell-quote.js";
import { sanitizeTerminalText } from "./terminal-text.js";
import { terminalWidth } from "./terminal-width.js";

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
  /** Combined selected-release affectedness; compatibility name, not registry latest. */
  affectsLatest?: boolean;
  assessmentStatus?: string;
  assessmentComplete?: boolean;
  assessmentReasons?: string[];
  unknownVulnerabilityCount?: number;
  /** @deprecated Native history alias; use advisoryHistory.recent. */
  recent?: LeanVulnerability[];
}

export interface LeanAdvisoryHistory {
  total: number;
  recent?: LeanVulnerability[];
}

export interface LeanRecentChange {
  version: string;
  date?: string;
  summary?: string;
}

export interface LeanLifecycleFinding {
  kind: string;
  /** Release scope is implicit in the overview header. */
  scope?: string;
  reason?: string;
  reasonTruncated?: true;
  /** Publisher advice, not a verified upgrade recommendation. */
  replacement?: string;
  source?: string;
  sourceVersion?: string;
  observedAt?: string;
  reasonCodes?: string[];
}

export interface LeanLifecycleWarning {
  classification: string;
  reason?: string;
  reasonTruncated?: true;
}

export interface LeanPackageLifecycle {
  findings?: LeanLifecycleFinding[];
  retainedWarnings?: LeanLifecycleWarning[];
  contentSafety?: { filtered: true };
}

export interface LeanPackageSummary {
  registry: string;
  name: string;
  version?: string;
  latestVersion?: string;
  latestVersionPublishedAt?: string;
  registryLatestDifference?: RegistryLatestDifference;
  registryRepository?: RegistryRepository;
  versionCount?: number;
  description?: string;
  license?: string;
  homepage?: string;
  repository?: string;
  publishedAt?: string;
  downloads?: LeanDownloads;
  github?: LeanGithub;
  githubError?: PackageSummaryMetadataError;
  provenanceError?: PackageSummaryMetadataError;
  securityError?: PackageSummaryMetadataError;
  /** Omitted when combined security for the displayed release is unavailable. */
  vulnerabilities?: LeanVulnerabilities;
  advisoryHistory?: LeanAdvisoryHistory;
  recentChanges?: LeanRecentChange[];
  /** Verbose adds publisher/source evidence without repeating identity or empty fields. */
  lifecycle?: LeanPackageLifecycle;
}

/**
 * Build the lean envelope from a validated {@link PackageSummary}.
 * Pure, deterministic — no I/O, no clock, no env reads.
 */
export function buildPackageSummarySuccessPayload(
  summary: PackageSummary,
  options: { verbose?: boolean } = {},
): LeanPackageSummary {
  const pkg = summary.package;

  const payload: LeanPackageSummary = {
    registry: lowerRegistry(pkg.registry),
    name: pkg.name,
  };

  assignIfDefined(payload, "version", pkg.version);
  assignIfDefined(payload, "latestVersion", pkg.latestVersion);
  assignIfDefined(
    payload,
    "latestVersionPublishedAt",
    toIsoDate(pkg.latestVersionPublishedAt),
  );
  assignIfDefined(
    payload,
    "registryLatestDifference",
    pkg.registryLatestDifference,
  );
  assignIfDefined(payload, "versionCount", pkg.versionCount);
  assignIfDefined(payload, "description", pkg.description);
  assignIfDefined(payload, "license", pkg.license);
  assignIfDefined(payload, "homepage", pkg.homepage);
  assignIfDefined(payload, "repository", pkg.repositoryUrl);
  assignIfDefined(payload, "registryRepository", pkg.registryRepository);
  assignIfDefined(payload, "publishedAt", toIsoDate(pkg.publishedAt));

  const downloads = buildDownloads(
    pkg.downloadsLastMonth,
    pkg.downloadsTotal,
    pkg.downloadsRefreshedAt,
  );
  if (downloads) payload.downloads = downloads;

  const github = buildGithub(pkg.githubRepository);
  if (github) payload.github = github;
  if (pkg.githubRepositoryError)
    payload.githubError = pkg.githubRepositoryError;
  if (pkg.registryRepositoryError)
    payload.provenanceError = pkg.registryRepositoryError;
  if (summary.securityError) payload.securityError = summary.securityError;

  const advisoryHistory = buildAdvisoryHistory(summary.security);
  if (advisoryHistory) payload.advisoryHistory = advisoryHistory;
  const vulns = buildVulnerabilities(summary.security, advisoryHistory?.recent);
  if (vulns) payload.vulnerabilities = vulns;

  const lifecycle = buildLifecyclePayload(summary.lifecycle, options.verbose);
  if (lifecycle) payload.lifecycle = lifecycle;

  const recent = buildRecentChanges(summary.latestChangelogs);
  if (recent) payload.recentChanges = recent;

  return payload;
}

/** Keep the same user-facing warning shape, adding source evidence only when requested. */
function buildLifecyclePayload(
  lifecycle: PackageLifecycle | undefined,
  verbose = false,
): LeanPackageLifecycle | undefined {
  if (!lifecycle) return undefined;
  const findings = lifecycle.findings.map((finding): LeanLifecycleFinding => {
    const replacement = finding.replacement?.trim();
    const reasonFields = lifecycleReason(finding.reason, verbose);
    return {
      kind: finding.kind,
      ...(finding.scope !== "RELEASE" ? { scope: finding.scope } : {}),
      ...reasonFields,
      ...(replacement &&
      !reasonMentionsReplacement(reasonFields.reason, replacement)
        ? { replacement }
        : {}),
      ...(verbose
        ? {
            ...(finding.source ? { source: finding.source } : {}),
            ...(finding.sourceVersion
              ? { sourceVersion: finding.sourceVersion }
              : {}),
            ...(finding.observedAt ? { observedAt: finding.observedAt } : {}),
            ...(finding.reasonCodes.length > 0
              ? { reasonCodes: finding.reasonCodes }
              : {}),
          }
        : {}),
    };
  });
  const retainedWarnings = lifecycle.retainedWarnings.map(
    (warning): LeanLifecycleWarning => ({
      classification: warning.classification,
      ...lifecycleReason(warning.reason, verbose),
    }),
  );
  if (findings.length === 0 && retainedWarnings.length === 0) return undefined;
  return {
    ...(findings.length > 0 ? { findings } : {}),
    ...(retainedWarnings.length > 0 ? { retainedWarnings } : {}),
    ...(lifecycle.contentSafety.filtered
      ? { contentSafety: { filtered: true } }
      : {}),
  };
}

/** Avoid repeating a publisher package name without matching inside other words. */
function reasonMentionsReplacement(
  reason: string | undefined,
  replacement: string,
): boolean {
  if (!reason) return false;
  const escaped = replacement.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `(?:^|[^\\p{L}\\p{N}@._/~+-])${escaped}(?=$|[^\\p{L}\\p{N}@._/~+-]|\\.(?=\\s|$))`,
    "u",
  ).test(reason);
}

function lifecycleReason(
  reason: string | null | undefined,
  verbose: boolean,
): {
  reason?: string;
  reasonTruncated?: true;
} {
  if (!reason?.trim()) return {};
  if (verbose) return { reason };
  const normalized = reason.replace(/\s+/g, " ").trim();
  const characters = Array.from(normalized);
  return characters.length > 160
    ? {
        reason: `${characters.slice(0, 157).join("").trimEnd()}...`,
        reasonTruncated: true,
      }
    : { reason: normalized };
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
  recent: LeanVulnerability[] | undefined,
): LeanVulnerabilities | undefined {
  if (typeof security?.vulnerabilityCount !== "number") return undefined;
  return {
    total: security.vulnerabilityCount,
    ...(security.hasCurrentVulnerabilities !== undefined
      ? { affectsLatest: security.hasCurrentVulnerabilities }
      : {}),
    ...(security.assessmentStatus !== undefined
      ? { assessmentStatus: security.assessmentStatus }
      : {}),
    ...(security.assessmentComplete !== undefined
      ? { assessmentComplete: security.assessmentComplete }
      : {}),
    ...(security.assessmentReasons !== undefined
      ? { assessmentReasons: security.assessmentReasons }
      : {}),
    ...(security.unknownVulnerabilityCount !== undefined
      ? { unknownVulnerabilityCount: security.unknownVulnerabilityCount }
      : {}),
    ...(recent ? { recent } : {}),
  };
}

function buildAdvisoryHistory(
  security: PackageSecurityOverview | undefined,
): LeanAdvisoryHistory | undefined {
  if (typeof security?.allVulnerabilityCount !== "number") return undefined;
  const recent = security.recentVulnerabilities
    ?.map(buildVulnerability)
    .filter((entry): entry is LeanVulnerability => entry !== undefined);
  return {
    total: security.allVulnerabilityCount,
    ...(recent?.length ? { recent } : {}),
  };
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
  /** Column width for wrapping the description line. Defaults to 80. */
  terminalWidth?: number;
  /** Native syntax for a release-pinned vulnerability follow-up. */
  surface?: "cli" | "mcp";
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

  const sections: string[] = [];

  // Header — `name @ version | license`
  const identity = lean.version
    ? `${colorize(lean.name, "bold", useColors)} @ ${lean.version}`
    : `${colorize(lean.name, "bold", useColors)} (no selected version)`;
  sections.push(lean.license ? `${identity} | ${lean.license}` : identity);

  const difference = formatRegistryLatestDifference(lean);
  if (difference) sections.push(wrapText(difference, width));

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
    width,
  );
  if (fields.length > 0) {
    sections.push(fields.join("\n"));
  }
  const nextStep = formatVulnerabilityNextStep(
    lean,
    options.surface ?? "cli",
    width,
  );
  if (nextStep) sections.push(nextStep);

  const lifecycle = options.verbose
    ? formatLifecycle(summary.lifecycle, width, summary.package.version)
    : formatCompactLifecycle(buildLifecyclePayload(summary.lifecycle), width);
  if (lifecycle) sections.push(lifecycle);
  const metadataErrors = [
    lean.githubError,
    lean.provenanceError,
    lean.securityError,
  ].filter((error) => error !== undefined);
  const firstError = metadataErrors[0];
  if (firstError) {
    const delays = metadataErrors.flatMap((error) => {
      const seconds =
        error.retryAfterMs === undefined
          ? error.retryAfterSeconds
          : error.retryAfterMs / 1000;
      return seconds === undefined ? [] : [seconds];
    });
    sections.push(
      formatMappedErrorText(
        {
          code: firstError.code,
          message:
            metadataErrors.length > 1
              ? `${metadataErrors
                  .map((error, i) => {
                    const label = error.message.replace(
                      / temporarily unavailable \(RATE_LIMITED\)\.$/,
                      "",
                    );
                    return i === 0
                      ? label
                      : label.charAt(0).toLowerCase() + label.slice(1);
                  })
                  .join(", ")} temporarily unavailable (RATE_LIMITED).`
              : firstError.message,
          retryable: metadataErrors.every((error) => error.retryable),
          details: {
            rateLimitScope: metadataErrors.find(
              (error) => error.rateLimitScope === "repository_provider",
            )?.rateLimitScope,
            retryAfterSeconds: delays.length ? Math.max(...delays) : undefined,
          },
        },
        { width },
      ),
    );
  }

  if (options.verbose) {
    const verbose = buildVerboseSections(lean, useColors);
    if (verbose.length > 0) sections.push(verbose);
  }

  return `${sections.join("\n\n")}\n`;
}

/** Default text shows concise warnings; verbose expands publisher/source evidence. */
function formatCompactLifecycle(
  lifecycle: LeanPackageLifecycle | undefined,
  width: number,
): string {
  if (!lifecycle) return "";
  const lines: string[] = [];
  const append = (label: string, detail: string): void => {
    const text = detail ? `${label}: ${detail}` : `${label}.`;
    lines.push(
      wrapText(text, Math.max(1, width - 2))
        .split("\n")
        .map((line, index) => `${index === 0 ? "" : "  "}${line}`)
        .join("\n"),
    );
  };
  for (const finding of lifecycle.findings ?? []) {
    const details = [finding.reason];
    if (finding.replacement)
      details.push(`publisher suggests ${finding.replacement}`);
    append(
      lifecycleFindingLabel(finding.kind, finding.scope),
      details.filter(Boolean).join("; "),
    );
  }
  for (const warning of lifecycle.retainedWarnings ?? []) {
    const classification =
      warning.classification === "LEGACY_UNCLASSIFIED"
        ? "unclassified"
        : warning.classification;
    append(`Publisher warning (${classification})`, warning.reason ?? "");
  }
  if (lines.length > 0 && lifecycle.contentSafety?.filtered)
    lines.push(wrapText("Publisher text filtered.", width));
  if (
    [...(lifecycle.findings ?? []), ...(lifecycle.retainedWarnings ?? [])].some(
      (item) => item.reasonTruncated,
    )
  )
    lines.push(wrapText("Full publisher reason in verbose output.", width));
  return lines.join("\n");
}

/** Express the backend's native kind and scope without repeated identity. */
function lifecycleFindingLabel(kind: string, scope?: string): string {
  const labels: Record<string, string> = {
    DEPRECATED: "Deprecated",
    RETIRED: "Retired",
    ABANDONED: "Abandoned",
    DISCONTINUED: "Discontinued",
    YANKED: "Yanked",
    PARTIALLY_YANKED: "Partially yanked",
    RETRACTED: "Retracted",
    UNLISTED: "Unlisted",
  };
  const qualifier =
    scope === "PACKAGE"
      ? " (package-wide)"
      : scope === "FILES"
        ? " (files)"
        : scope === undefined || scope === "RELEASE"
          ? ""
          : ` (${scope})`;
  return `${labels[kind] ?? kind}${qualifier}`;
}

/** Explain publisher and source evidence without internal collection diagnostics. */
function formatLifecycle(
  lifecycle: PackageLifecycle | undefined,
  width: number,
  selectedVersion: string | undefined,
): string {
  if (
    !lifecycle ||
    (lifecycle.findings.length === 0 && lifecycle.retainedWarnings.length === 0)
  )
    return "";
  const lines: string[] = ["Lifecycle"];
  const append = (text: string, indent = 0): void => {
    const prefix = " ".repeat(Math.min(indent, width - 1));
    const continuation = " ".repeat(Math.min(indent + 2, width - 1));
    const wrapped = wrapText(text, width - continuation.length).split("\n");
    lines.push(
      wrapped
        .map((line, index) => `${index === 0 ? prefix : continuation}${line}`)
        .join("\n"),
    );
  };
  for (const finding of lifecycle.findings) {
    append(lifecycleFindingLabel(finding.kind, finding.scope));
    if (finding.reason) append(`Publisher reason: ${finding.reason}`, 2);
    if (
      finding.replacement &&
      !reasonMentionsReplacement(
        finding.reason ?? undefined,
        finding.replacement,
      )
    )
      append(`Replacement suggested by publisher: ${finding.replacement}`, 2);
    const authority =
      finding.sourceVersion == null
        ? ""
        : finding.sourceVersion === selectedVersion
          ? " (selected release)"
          : ` (version ${finding.sourceVersion})`;
    append(`Source: ${finding.source}${authority}`, 2);
    if (finding.observedAt && toIsoDate(finding.observedAt)) {
      const collected = new Date(finding.observedAt)
        .toISOString()
        .slice(0, 16)
        .replace("T", " ");
      append(`Collected: ${collected} UTC`, 2);
    }
    if (finding.reasonCodes.length > 0)
      append(`Publisher codes: ${finding.reasonCodes.join(", ")}`, 2);
  }
  for (const warning of lifecycle.retainedWarnings) {
    const classification =
      warning.classification === "LEGACY_UNCLASSIFIED"
        ? "unclassified"
        : warning.classification;
    append(`Publisher warning (${classification}): ${warning.reason}`);
  }
  if (lifecycle.contentSafety.filtered)
    append("Publisher text was filtered by the backend; it remains untrusted.");
  return lines.join("\n");
}

/** Explain API selection without choosing a different release in the client. */
function formatRegistryLatestDifference(
  lean: LeanPackageSummary,
): string | undefined {
  const difference = lean.registryLatestDifference;
  if (!difference) return undefined;
  const reasons: Record<RegistryLatestDifference["reason"], string> = {
    DEPRECATED: "is deprecated",
    YANKED: "is yanked",
    NO_FILES: "has no files",
    UNLISTED: "is unlisted",
    PRERELEASE_EXCLUDED: "is a prerelease",
  };
  const prefix = `latest ${difference.version} ${reasons[difference.reason]}`;
  if (
    difference.reason === "PRERELEASE_EXCLUDED" &&
    (!lean.version || lean.version === difference.version)
  ) {
    return `${prefix}; no default release; installing it requires an explicit version`;
  }
  if (!lean.version || lean.version === difference.version)
    return `${prefix}; no default release`;
  const installHint =
    lean.registry === "npm" && difference.reason === "DEPRECATED"
      ? " (what npm installs)"
      : "";
  return `${prefix}; showing ${lean.version}${installHint}`;
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
  const words = sanitizeTerminalText(text.replace(/\s+/g, " ")).split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (terminalWidth(word) > safeWidth) {
      if (current.length > 0) {
        lines.push(current);
        current = "";
      }
      for (const character of word) {
        if (current && terminalWidth(current + character) > safeWidth) {
          lines.push(current);
          current = "";
        }
        current += character;
        if (terminalWidth(current) >= safeWidth) {
          lines.push(current);
          current = "";
        }
      }
      continue;
    }
    if (current.length === 0) {
      current = word;
      continue;
    }
    if (terminalWidth(current) + 1 + terminalWidth(word) > safeWidth) {
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
  width: number,
): string[] {
  const fields: LabelledField[] = [];

  if (lean.repository) {
    const repositoryParts = [colorize(lean.repository, "cyan", useColors)];
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
  if (lean.registryRepository) {
    fields.push({
      label: "Package registry",
      value: `${lean.registryRepository.name} (${colorize(lean.registryRepository.url, "cyan", useColors)})`,
    });
  }
  if (lean.homepage) {
    fields.push({
      label: "Homepage",
      value: colorize(lean.homepage, "cyan", useColors),
    });
  }

  const publishedRelative = toRelativeDate(summary.package.publishedAt, now);
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
  fields.push({
    label: "Vulnerabilities",
    value: formatVulnerabilityStatus(
      lean.vulnerabilities,
      lean.advisoryHistory,
      lean.registryLatestDifference !== undefined,
    ),
  });

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
  history: LeanAdvisoryHistory | undefined,
  hasDifference: boolean,
): string {
  const label = hasDifference ? "Selected" : "Latest";
  let selected: string;
  const status = vulns?.assessmentStatus;
  if (!vulns) selected = `${label}: unavailable`;
  else if (vulns.total > 0) selected = `${label}: ${vulns.total} affected`;
  else if (status === "UNSUPPORTED")
    selected = `${label}: vulnerability data unavailable for this registry`;
  else if (status === "NOT_ASSESSED")
    selected = `${label}: no release assessed`;
  else if (
    status !== undefined &&
    status !== "NON_AFFECTING" &&
    status !== "AFFECTED" &&
    status !== "UNKNOWN"
  )
    selected = `${label}: ${status}`;
  else if (
    vulns.assessmentComplete === false ||
    status === "UNKNOWN" ||
    (vulns.unknownVulnerabilityCount ?? 0) > 0
  )
    selected = `${label}: 0 known to affect this release`;
  else selected = `${label}: none affected`;
  const lines = [selected];
  const unknown = vulns?.unknownVulnerabilityCount ?? 0;
  if (unknown > 0)
    lines.push(
      `${unknown} ${unknown === 1 ? "advisory needs" : "advisories need"} review; affectedness could not be determined.`,
    );
  if (history) {
    const noun = history.total === 1 ? "advisory" : "advisories";
    lines.push(
      history.total === 0
        ? "Native history: none known across all versions"
        : `Native history: ${history.total} known ${noun} across all versions`,
    );
  } else lines.push("Native history: unavailable");
  return lines.join("\n");
}

/** Overview owns the next useful action; backend processing reasons stay in JSON. */
function formatVulnerabilityNextStep(
  lean: LeanPackageSummary,
  surface: "cli" | "mcp",
  width: number,
): string {
  const vulns = lean.vulnerabilities;
  if (!vulns || vulns.assessmentStatus === "UNSUPPORTED") return "";
  const reasons = vulns.assessmentReasons ?? [];
  const related = reasons.includes("RELATED_APPLICABILITY_UNPROVED");
  const explanations: string[] = [];
  if (related)
    explanations.push(
      "Review related advisory evidence to determine whether it applies to this package.",
    );
  if (reasons.includes("SOURCE_NOT_ASSESSED"))
    explanations.push(
      "Start the remaining vulnerability checks with the report below.",
    );
  else if (reasons.includes("SOURCE_PREPARING"))
    explanations.push(
      "Vulnerability checks are running. View the available findings in the report below.",
    );
  else if (
    reasons.includes("SOURCE_INCOMPLETE") ||
    reasons.includes("SOURCE_UNAVAILABLE")
  )
    explanations.push(
      "Some vulnerability checks could not be completed. Inspect the report for the unresolved results.",
    );
  const unknown = (vulns.unknownVulnerabilityCount ?? 0) > 0;
  if (unknown)
    explanations.push("Inspect the unresolved advisories in the report below.");
  if (explanations.length === 0 && vulns.assessmentComplete === false)
    explanations.push(
      "Some vulnerability results are unresolved. Inspect the report before relying on the affected count.",
    );
  if (explanations.length === 0) return "";
  const target = `${lean.registry}:${lean.name}${lean.version ? `@${lean.version}` : ""}`;
  // Related evidence can be attached to a non-affecting PACKAGE row. ALL plus
  // verbose includes that row, its aliases and proof rather than just a row cap.
  const scope = related ? "all" : unknown ? "unknown" : undefined;
  const action =
    surface === "cli"
      ? `githits pkg vulns${scope ? ` --scope ${scope}` : ""}${related ? " --verbose" : ""} -- ${shellQuoteExact(target)}`
      : `pkg_vulns(${JSON.stringify({ target, ...(scope ? { advisory_scope: scope } : {}), ...(related ? { verbose: true } : {}) })})`;
  // Prose wraps; the exact command/locator stays copyable even at narrow widths.
  return `${wrapText(explanations.join(" "), width)}\n${action}`;
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

  if (lean.advisoryHistory?.recent?.length) {
    blocks.push(
      formatVerboseAdvisories(lean.advisoryHistory.recent, useColors),
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
  const lines = [
    highlight("Native advisory history (all versions)", useColors),
  ];
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
