import type {
  PackageUpgradeReviewResponse as BackendPackageUpgradeReviewResponse,
  PackageIntelligenceService,
} from "@githits/core-internal";
import { colorize, highlight } from "./colors.js";
import type {
  PackageUpgradeReviewOptions,
  UpgradeReviewPackageRequest,
} from "./package-upgrade-review-request.js";

export type VersionDelta =
  | "patch"
  | "minor"
  | "major"
  | "prerelease"
  | "downgrade"
  | "same"
  | "unknown";

export interface UpgradeAdvisorySummary {
  id?: string;
  aliases?: string[];
  summary?: string;
  severity?: number;
  severityLabel?: string;
  fixedIn?: string[];
  isMalicious?: boolean;
}

export interface VersionVulnerabilitySummary {
  version: string;
  publishedAt?: string;
  deprecated?: boolean;
  deprecationReason?: string;
  affectedCount: number;
  nonAffectingCount: number;
  allCount: number;
  advisories: UpgradeAdvisorySummary[];
}

export interface UpgradeSecurity {
  current?: VersionVulnerabilitySummary;
  target?: VersionVulnerabilitySummary;
  added: UpgradeAdvisorySummary[];
  removed: UpgradeAdvisorySummary[];
  notAddressed: UpgradeAdvisorySummary[];
  fixed: UpgradeAdvisorySummary[];
  introduced: UpgradeAdvisorySummary[];
  unchanged: UpgradeAdvisorySummary[];
  transitive?: UpgradeTransitiveSecurity;
}

export interface UpgradeTransitiveSecurity {
  currentAffected: number;
  targetAffected: number;
  introducedPackages: string[];
  fixedPackages: string[];
  introducedPackageDetails: UpgradeTransitiveVulnerablePackage[];
  introducedPackageDetailsTotalCount: number;
  introducedPackageDetailsTruncated: boolean;
  fixedPackageDetails: UpgradeTransitiveVulnerablePackage[];
  fixedPackageDetailsTotalCount: number;
  fixedPackageDetailsTruncated: boolean;
  stillAffectedPackageDetails: UpgradeTransitiveVulnerablePackage[];
  stillAffectedPackageDetailsTotalCount: number;
  stillAffectedPackageDetailsTruncated: boolean;
}

export interface UpgradeTransitiveVulnerablePackage {
  id: string;
  registry: string;
  name: string;
  versions: string[];
  affectedCount: number;
  maxSeverityScore?: number;
  maxSeverityLabel?: string;
  advisoryIds: string[];
}

export interface UpgradeChangelogEntry {
  version: string | null;
  publishedAt?: string;
  htmlUrl?: string;
  body?: string;
  bodyPreview?: string;
  headline?: string;
  signals?: string[];
}

export interface UpgradeChangelog {
  source?: string;
  fallback?: "package_versions";
  entries: UpgradeChangelogEntry[];
  sampledEntries: UpgradeChangelogEntry[];
  keywordEntries: UpgradeChangelogEntry[];
  totalKeywordEntries: number;
  totalEntries: number;
  totalEntriesWithBodies: number;
  truncated: boolean;
  hasReleaseNoteBodies: boolean;
  breakingSignals: string[];
  migrationSignals: string[];
}

export interface UpgradeDependencyIssues {
  currentTotal: number;
  targetTotal: number;
  introducedDeprecated: string[];
  introducedDuplicates: string[];
  introducedConflicts: string[];
  introducedOutdated: string[];
}

export interface UpgradeDependencyChangeItem {
  name: string;
  registry?: string;
  version?: string;
  fromVersions?: string[];
  toVersions?: string[];
  constraint?: string;
  type?: string;
}

export interface UpgradeDependencyChangeGroup {
  added: UpgradeDependencyChangeItem[];
  removed: UpgradeDependencyChangeItem[];
  changed: UpgradeDependencyChangeItem[];
}

export interface UpgradeDependencyChanges {
  direct: UpgradeDependencyChangeGroup;
  transitive: UpgradeDependencyChangeGroup;
}

export interface UpgradeCompatibility {
  peerDependencyChanges: string[];
  notes: string[];
}

export interface UpgradeReview {
  registry: string;
  name: string;
  currentVersion: string;
  targetVersion: string;
  latestVersion?: string;
  versionDelta: VersionDelta;
  security: UpgradeSecurity;
  changelog: UpgradeChangelog;
  compatibility?: UpgradeCompatibility;
  dependencyChanges?: UpgradeDependencyChanges;
  dependencyIssues?: UpgradeDependencyIssues;
  unknowns: string[];
}

export interface UpgradeReviewResponse {
  summary: {
    total: number;
    withUnknowns: number;
    withAddedAdvisories: number;
    withBreakingSignals: number;
    withDirectDependencyChanges: number;
    withTransitiveVulnerabilityAdditions: number;
  };
  reviews: UpgradeReview[];
}

export interface FormatPackageUpgradeReviewTerminalOptions {
  verbose?: boolean;
  useColors?: boolean;
}

const BODY_PREVIEW_CHARS = 280;

export async function buildPackageUpgradeReview(
  service: PackageIntelligenceService,
  packages: readonly UpgradeReviewPackageRequest[],
  options: PackageUpgradeReviewOptions,
): Promise<UpgradeReviewResponse> {
  const response = await service.packageUpgradeReview({
    packages: packages.map((pkg) => ({
      registry: pkg.registry,
      name: pkg.packageName,
      currentVersion: pkg.currentVersion,
      targetVersion: pkg.targetVersion,
    })),
    includeTransitiveSecurity: options.includeTransitiveSecurity,
    includeDependencyIssues: options.includeDependencyIssues,
    changelogLimit: options.changelogLimit,
    minSeverity: options.minSeverity,
  });
  return normaliseBackendUpgradeReviewResponse(response);
}

function normaliseBackendUpgradeReviewResponse(
  response: BackendPackageUpgradeReviewResponse,
): UpgradeReviewResponse {
  return {
    summary: response.summary,
    reviews: response.reviews.map((review) => ({
      registry: lowerEnum(review.registry) ?? review.registry,
      name: review.name,
      currentVersion: review.currentVersion,
      targetVersion: review.targetVersion,
      latestVersion: review.latestVersion,
      versionDelta: lowerEnum(review.versionDelta) as VersionDelta,
      security: normaliseBackendSecurity(review.security),
      changelog: normaliseBackendChangelog(review.changelog),
      compatibility: review.compatibility,
      dependencyChanges: review.dependencyChanges
        ? normaliseBackendDependencyChanges(review.dependencyChanges)
        : undefined,
      dependencyIssues: review.dependencyIssues,
      unknowns: review.unknowns,
    })),
  };
}

function normaliseBackendSecurity(
  security: BackendPackageUpgradeReviewResponse["reviews"][number]["security"],
): UpgradeSecurity {
  return {
    current: security.current
      ? normaliseBackendVersionVulnerabilitySummary(security.current)
      : undefined,
    target: security.target
      ? normaliseBackendVersionVulnerabilitySummary(security.target)
      : undefined,
    added: security.added.map(normaliseBackendAdvisory),
    removed: security.removed.map(normaliseBackendAdvisory),
    notAddressed: security.notAddressed.map(normaliseBackendAdvisory),
    fixed: security.fixed.map(normaliseBackendAdvisory),
    introduced: security.introduced.map(normaliseBackendAdvisory),
    unchanged: security.unchanged.map(normaliseBackendAdvisory),
    transitive: security.transitive
      ? normaliseBackendTransitiveSecurity(security.transitive)
      : undefined,
  };
}

function normaliseBackendVersionVulnerabilitySummary(
  summary: NonNullable<
    BackendPackageUpgradeReviewResponse["reviews"][number]["security"]["current"]
  >,
): VersionVulnerabilitySummary {
  return {
    version: summary.version,
    publishedAt: summary.publishedAt,
    deprecated: summary.deprecated,
    deprecationReason: summary.deprecationReason,
    affectedCount: summary.affectedCount,
    nonAffectingCount: summary.nonAffectingCount,
    allCount: summary.allCount,
    advisories: summary.advisories.map(normaliseBackendAdvisory),
  };
}

function normaliseBackendAdvisory(
  advisory: BackendPackageUpgradeReviewResponse["reviews"][number]["security"]["added"][number],
): UpgradeAdvisorySummary {
  return {
    id: advisory.id,
    aliases: advisory.aliases,
    summary: advisory.summary,
    severity: advisory.severity,
    severityLabel: lowerEnum(advisory.severityLabel),
    fixedIn: advisory.fixedIn,
    isMalicious: advisory.isMalicious,
  };
}

function normaliseBackendTransitiveSecurity(
  transitive: NonNullable<
    BackendPackageUpgradeReviewResponse["reviews"][number]["security"]["transitive"]
  >,
): UpgradeTransitiveSecurity {
  return {
    currentAffected: transitive.currentAffected,
    targetAffected: transitive.targetAffected,
    introducedPackages: transitive.introducedPackages.map(
      normaliseRegistryPrefix,
    ),
    fixedPackages: transitive.fixedPackages.map(normaliseRegistryPrefix),
    introducedPackageDetails: transitive.introducedPackageDetails.entries.map(
      normaliseBackendTransitivePackage,
    ),
    introducedPackageDetailsTotalCount:
      transitive.introducedPackageDetails.totalCount,
    introducedPackageDetailsTruncated:
      transitive.introducedPackageDetails.truncated,
    fixedPackageDetails: transitive.fixedPackageDetails.entries.map(
      normaliseBackendTransitivePackage,
    ),
    fixedPackageDetailsTotalCount: transitive.fixedPackageDetails.totalCount,
    fixedPackageDetailsTruncated: transitive.fixedPackageDetails.truncated,
    stillAffectedPackageDetails:
      transitive.stillAffectedPackageDetails.entries.map(
        normaliseBackendTransitivePackage,
      ),
    stillAffectedPackageDetailsTotalCount:
      transitive.stillAffectedPackageDetails.totalCount,
    stillAffectedPackageDetailsTruncated:
      transitive.stillAffectedPackageDetails.truncated,
  };
}

function normaliseBackendDependencyChanges(
  changes: NonNullable<
    BackendPackageUpgradeReviewResponse["reviews"][number]["dependencyChanges"]
  >,
): UpgradeDependencyChanges {
  return {
    direct: normaliseBackendDependencyChangeGroup(changes.direct),
    transitive: normaliseBackendDependencyChangeGroup(changes.transitive),
  };
}

function normaliseBackendDependencyChangeGroup(
  group: BackendPackageUpgradeReviewResponse["reviews"][number]["dependencyChanges"] extends infer T
    ? T extends { direct: infer Group }
      ? Group
      : never
    : never,
): UpgradeDependencyChangeGroup {
  return {
    added: group.added.map(normaliseBackendDependencyChangeItem),
    removed: group.removed.map(normaliseBackendDependencyChangeItem),
    changed: group.changed.map(normaliseBackendDependencyChangeItem),
  };
}

function normaliseBackendDependencyChangeItem(
  item: BackendPackageUpgradeReviewResponse["reviews"][number]["dependencyChanges"] extends infer T
    ? T extends { direct: { added: Array<infer Item> } }
      ? Item
      : never
    : never,
): UpgradeDependencyChangeItem {
  return {
    name: item.name,
    registry: lowerEnum(item.registry),
    version: item.version,
    fromVersions: item.fromVersions,
    toVersions: item.toVersions,
    constraint: item.constraint,
    type: lowerEnum(item.type),
  };
}

function normaliseBackendTransitivePackage(
  pkg: BackendPackageUpgradeReviewResponse["reviews"][number]["security"]["transitive"] extends infer T
    ? T extends { introducedPackageDetails: { entries: Array<infer Entry> } }
      ? Entry
      : never
    : never,
): UpgradeTransitiveVulnerablePackage {
  return {
    id: pkg.id,
    registry: lowerEnum(pkg.registry) ?? pkg.registry,
    name: pkg.name,
    versions: pkg.versions,
    affectedCount: pkg.affectedCount,
    maxSeverityScore: pkg.maxSeverityScore,
    maxSeverityLabel: lowerEnum(pkg.maxSeverityLabel),
    advisoryIds: pkg.advisoryIds,
  };
}

function normaliseBackendChangelog(
  changelog: BackendPackageUpgradeReviewResponse["reviews"][number]["changelog"],
): UpgradeChangelog {
  return {
    source: lowerEnum(changelog.source),
    fallback: lowerEnum(changelog.fallback) as "package_versions" | undefined,
    entries: changelog.entries.map(normaliseBackendChangelogEntry),
    sampledEntries: changelog.sampledEntries.map(
      normaliseBackendChangelogEntry,
    ),
    keywordEntries: changelog.keywordEntries.map(
      normaliseBackendChangelogEntry,
    ),
    totalKeywordEntries: changelog.totalKeywordEntries,
    totalEntries: changelog.totalEntries,
    totalEntriesWithBodies: changelog.totalEntriesWithBodies,
    truncated: changelog.truncated,
    hasReleaseNoteBodies: changelog.hasReleaseNoteBodies,
    breakingSignals: changelog.breakingSignals,
    migrationSignals: changelog.migrationSignals,
  };
}

function normaliseBackendChangelogEntry(
  entry: BackendPackageUpgradeReviewResponse["reviews"][number]["changelog"]["entries"][number],
): UpgradeChangelogEntry {
  return {
    version: entry.version ?? null,
    publishedAt: entry.publishedAt,
    htmlUrl: entry.htmlUrl,
    body: entry.body,
    bodyPreview: entry.bodyPreview,
    headline: entry.headline,
    signals: entry.signals.length > 0 ? entry.signals : undefined,
  };
}

function lowerEnum(value: string | undefined): string | undefined {
  return value?.toLowerCase();
}

function normaliseRegistryPrefix(value: string): string {
  return value.replace(/^([A-Z_]+):/, (prefix) => prefix.toLowerCase());
}

function preview(body: string | undefined): string | undefined {
  if (body === undefined) return undefined;
  const compact = body.replace(/\s+/g, " ").trim();
  if (compact.length === 0) return "";
  return compact.length > BODY_PREVIEW_CHARS
    ? `${compact.slice(0, BODY_PREVIEW_CHARS)}...`
    : compact;
}

function changelogSignalText(body: string | undefined): string {
  if (!body) return "";
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  const kept: string[] = [];
  let inCommitSection = false;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (/^#{1,6}\s+commits?\b/i.test(line)) {
      inCommitSection = true;
      continue;
    }
    if (/^#{1,6}\s+/.test(line)) inCommitSection = false;
    if (inCommitSection) continue;
    if (looksLikeCommitListLine(line)) continue;
    kept.push(rawLine);
  }
  return kept.join("\n");
}

function looksLikeCommitListLine(line: string): boolean {
  return /^[-*]\s+[0-9a-f]{7,40}\b/i.test(line);
}

function matchesSignalTerm(text: string, term: string): boolean {
  const lower = text.toLowerCase();
  if (term === "breaking" || term === "breaks") {
    if (/\b(no|without|not)\s+breaking\s+changes?\b/i.test(text)) return false;
  }
  return lower.includes(term);
}

function hasIntroducedDependencyIssues(
  issues: UpgradeDependencyIssues | undefined,
): issues is UpgradeDependencyIssues {
  if (!issues) return false;
  return (
    issues.introducedDeprecated.length > 0 ||
    issues.introducedDuplicates.length > 0 ||
    issues.introducedConflicts.length > 0 ||
    issues.introducedOutdated.length > 0
  );
}

export function formatPackageUpgradeReviewTerminal(
  response: UpgradeReviewResponse,
  options: FormatPackageUpgradeReviewTerminalOptions = {},
): string {
  const useColors = options.useColors === true;
  const lines = [
    sectionTitle(
      `pkg_upgrade_review | ${response.summary.total} upgrades | unknowns=${response.summary.withUnknowns} added-vulns=${response.summary.withAddedAdvisories} keyword-sampled=${response.summary.withBreakingSignals} dependency-changes=${response.summary.withDirectDependencyChanges} transitive-vuln-additions=${response.summary.withTransitiveVulnerabilityAdditions}`,
      useColors,
    ),
    "",
  ];
  for (const review of response.reviews) {
    lines.push(
      highlight(
        `${review.registry}:${review.name} ${review.currentVersion} -> ${review.targetVersion} | ${review.versionDelta}`,
        useColors,
      ),
    );
    lines.push(...formatVulnerabilitySection(review.security, options));
    const deprecation = formatDeprecationLine(review);
    if (deprecation) lines.push(deprecation);
    lines.push(...formatChangesSection(review.changelog, options));
    if (review.compatibility) {
      lines.push(...formatCompatibilitySection(review.compatibility, options));
    }
    if (review.dependencyChanges) {
      lines.push(
        ...formatDependencyChangesSection(review.dependencyChanges, options),
      );
    }
    const dependencyIssues = review.dependencyIssues;
    if (hasIntroducedDependencyIssues(dependencyIssues))
      lines.push(...formatDependencyIssuesSection(dependencyIssues));
    if (review.unknowns.length > 0)
      lines.push(
        "unknowns:",
        ...review.unknowns.map((unknown) => `  - ${unknown}`),
      );
    lines.push("");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

function sectionTitle(text: string, useColors: boolean): string {
  return colorize(text, "cyan", useColors);
}

function formatDeprecationLine(review: UpgradeReview): string | undefined {
  const current = review.security.current;
  const target = review.security.target;
  if (!current && !target) return undefined;
  const parts: string[] = [];
  if (current?.deprecated === true) parts.push("current deprecated");
  if (target?.deprecated === true) {
    parts.push(
      `target deprecated${target.deprecationReason ? `: ${target.deprecationReason}` : ""}`,
    );
  }
  if (target?.deprecated === undefined)
    parts.push("target deprecation unknown");
  return parts.length > 0 ? `deprecation: ${parts.join("; ")}` : undefined;
}

function formatVulnerabilitySection(
  security: UpgradeSecurity,
  options: FormatPackageUpgradeReviewTerminalOptions,
): string[] {
  const current = security.current?.affectedCount ?? "unknown";
  const target = security.target?.affectedCount ?? "unknown";
  const lines = [
    sectionTitle("vulnerabilities", options.useColors === true),
    `  direct package advisories: current version affected=${current}, target version affected=${target}, fixed by target=${security.removed.length}, added in target=${security.added.length}, still affects target=${security.notAddressed.length}`,
  ];
  const limit = options.verbose ? Number.POSITIVE_INFINITY : 5;
  appendAdvisoryLines(lines, "added", security.added, limit);
  appendAdvisoryLines(lines, "fixed", security.removed, limit);
  appendAdvisoryLines(lines, "still present", security.notAddressed, limit);
  lines.push(
    ...formatTransitiveVulnerabilitySubsection(security.transitive, options),
  );
  return lines;
}

function appendAdvisoryLines(
  lines: string[],
  label: string,
  advisories: UpgradeAdvisorySummary[],
  limit: number,
): void {
  if (advisories.length === 0) return;
  lines.push(`  ${label}:`);
  for (const advisory of advisories.slice(0, limit)) {
    lines.push(`    - ${formatAdvisory(advisory)}`);
  }
  const remaining = advisories.length - limit;
  if (remaining > 0)
    lines.push(`    - ... +${remaining} more with verbose output`);
}

function formatAdvisory(advisory: UpgradeAdvisorySummary): string {
  const id = advisory.id ?? advisory.aliases?.[0] ?? "unknown-id";
  const severity = advisory.severityLabel
    ? ` ${advisory.severityLabel}${typeof advisory.severity === "number" ? `(${advisory.severity})` : ""}`
    : "";
  const malicious = advisory.isMalicious ? " malicious" : "";
  const summary = advisory.summary ? `: ${advisory.summary}` : "";
  const fixed = advisory.fixedIn?.length
    ? ` fixed in ${advisory.fixedIn.join(", ")}`
    : "";
  return `${id}${severity}${malicious}${summary}${fixed}`;
}

function formatTransitiveVulnerabilitySubsection(
  transitive: UpgradeTransitiveSecurity | undefined,
  options: FormatPackageUpgradeReviewTerminalOptions,
): string[] {
  if (!transitive) return ["  transitive package advisories: not checked"];
  const lines = [
    `  transitive package advisories: current affected packages=${transitive.currentAffected}, target affected packages=${transitive.targetAffected}, fixed packages=${transitive.fixedPackageDetailsTotalCount}, added packages=${transitive.introducedPackageDetailsTotalCount}, still affected package details=${transitive.stillAffectedPackageDetailsTotalCount}`,
  ];
  const limit = options.verbose ? Number.POSITIVE_INFINITY : 5;
  appendTransitivePackageLines(
    lines,
    "added affected packages",
    transitive.introducedPackageDetails,
    transitive.introducedPackageDetailsTotalCount,
    transitive.introducedPackageDetailsTruncated,
    limit,
  );
  appendTransitivePackageLines(
    lines,
    "still affected packages",
    transitive.stillAffectedPackageDetails,
    transitive.stillAffectedPackageDetailsTotalCount,
    transitive.stillAffectedPackageDetailsTruncated,
    limit,
  );
  appendTransitivePackageLines(
    lines,
    "fixed affected packages",
    transitive.fixedPackageDetails,
    transitive.fixedPackageDetailsTotalCount,
    transitive.fixedPackageDetailsTruncated,
    limit,
  );
  return lines;
}

function appendTransitivePackageLines(
  lines: string[],
  label: string,
  packages: UpgradeTransitiveVulnerablePackage[],
  totalCount: number,
  truncated: boolean,
  limit: number,
): void {
  if (totalCount === 0) return;
  lines.push(`  ${label}:`);
  const visible = packages.slice(0, limit);
  for (const pkg of visible) {
    lines.push(`    - ${formatTransitivePackage(pkg)}`);
  }
  const verboseRemaining = Math.max(0, packages.length - visible.length);
  if (verboseRemaining > 0)
    lines.push(`    - ... +${verboseRemaining} more with verbose output`);
  const backendRemaining = Math.max(0, totalCount - packages.length);
  if (truncated || backendRemaining > 0)
    lines.push(
      `    - ... +${backendRemaining} more not returned by backend page`,
    );
}

function formatTransitivePackage(
  pkg: UpgradeTransitiveVulnerablePackage,
): string {
  const severity = pkg.maxSeverityLabel
    ? ` ${pkg.maxSeverityLabel}${typeof pkg.maxSeverityScore === "number" ? `(${pkg.maxSeverityScore})` : ""}`
    : "";
  const advisories = pkg.advisoryIds.length
    ? ` advisories: ${pkg.advisoryIds.join(", ")}`
    : "";
  return `${pkg.registry}:${pkg.name}@${pkg.versions.join("|")} affected=${pkg.affectedCount}${severity}${advisories}`;
}

function formatChangesSection(
  changelog: UpgradeChangelog,
  options: FormatPackageUpgradeReviewTerminalOptions,
): string[] {
  const source = changelog.source ?? changelog.fallback ?? "unavailable";
  const lines = [
    sectionTitle("changes", options.useColors === true),
    `  source: ${source}`,
    `  release entries: ${changelog.totalEntries} total, ${changelog.totalEntriesWithBodies} with release-note bodies${changelog.truncated ? `; ${changelog.entries.length} ordinary entries sampled` : ""}`,
  ];
  const keywords = changelogKeywordSummary(changelog);
  if (keywords.length > 0) {
    lines.push(
      `  keyword hits: ${changelog.totalKeywordEntries} entries (${keywords.join(", ")}); heuristic text match`,
    );
  }
  if (changelog.keywordEntries.length > 0) {
    lines.push("  keyword hit entries:");
    for (const entry of changelog.keywordEntries) {
      lines.push(...formatKeywordChangelogEntry(entry, options));
    }
    if (options.verbose === true) {
      const keywordKeys = new Set(
        changelog.keywordEntries.map((entry) => changelogEntryKey(entry)),
      );
      const otherEntries = changelog.entries.filter(
        (entry) =>
          entry.bodyPreview && !keywordKeys.has(changelogEntryKey(entry)),
      );
      appendPlainChangelogEntries(lines, "other release entries", otherEntries);
    }
    return lines;
  }
  appendPlainChangelogEntries(
    lines,
    "sampled entries",
    changelog.sampledEntries,
  );
  return lines;
}

function appendPlainChangelogEntries(
  lines: string[],
  label: string,
  entries: UpgradeChangelogEntry[],
): void {
  const visibleEntries = entries.filter((entry) => entry.bodyPreview);
  if (visibleEntries.length === 0) return;
  lines.push(`  ${label}:`);
  for (const entry of visibleEntries) {
    lines.push(...formatPlainChangelogEntry(entry));
  }
}

function changelogEntryKey(entry: UpgradeChangelogEntry): string {
  return `${entry.version ?? "unknown"}:${entry.publishedAt ?? ""}:${entry.htmlUrl ?? ""}`;
}

function formatCompatibilitySection(
  compatibility: UpgradeCompatibility,
  options: FormatPackageUpgradeReviewTerminalOptions,
): string[] {
  const lines = [sectionTitle("compatibility", options.useColors === true)];
  if (compatibility.peerDependencyChanges.length > 0) {
    lines.push("  peer dependency metadata changes:");
    const limit = options.verbose ? Number.POSITIVE_INFINITY : 10;
    for (const change of compatibility.peerDependencyChanges.slice(0, limit)) {
      lines.push(`    - ${change}`);
    }
    const remaining = compatibility.peerDependencyChanges.length - limit;
    if (remaining > 0)
      lines.push(`    - ... +${remaining} more with verbose output`);
  }
  for (const note of compatibility.notes) {
    lines.push(`  note: ${note}`);
  }
  return lines;
}

function changelogKeywordSummary(changelog: UpgradeChangelog): string[] {
  return [
    ...new Set([...changelog.breakingSignals, ...changelog.migrationSignals]),
  ];
}

function formatKeywordChangelogEntry(
  entry: UpgradeChangelogEntry,
  options: FormatPackageUpgradeReviewTerminalOptions,
): string[] {
  const version = entry.version ?? "unknown-version";
  const link = entry.htmlUrl ? ` ${entry.htmlUrl}` : "";
  const lines = [
    `    - ${version}${entry.publishedAt ? ` (${entry.publishedAt})` : ""}${link}`,
  ];
  const matched = formatMatchedExcerpts(entry, options.verbose === true);
  if (matched.length > 0) lines.push(...matched);
  return lines;
}

function formatPlainChangelogEntry(entry: UpgradeChangelogEntry): string[] {
  const version = entry.version ?? "unknown-version";
  const link = entry.htmlUrl ? ` ${entry.htmlUrl}` : "";
  const lines = [
    `    - ${version}${entry.publishedAt ? ` (${entry.publishedAt})` : ""}${link}`,
  ];
  if (entry.headline) {
    lines.push(`      ${preview(entry.headline) ?? entry.headline}`);
  }
  return lines;
}

function formatMatchedExcerpts(
  entry: UpgradeChangelogEntry,
  verbose: boolean,
): string[] {
  if (!entry.body || !entry.signals?.length) return [];
  const excerpts: string[] = [];
  const chunks = changelogExcerptChunks(entry.body);
  const seen = new Set<string>();
  for (const signal of entry.signals) {
    for (const chunk of chunks) {
      if (!matchesSignalTerm(chunk, signal)) continue;
      const excerpt = excerptAroundSignal(chunk, signal, verbose);
      const key = `${signal}:${excerpt}`;
      if (seen.has(key)) continue;
      seen.add(key);
      excerpts.push(`      [${signal}]: ${excerpt}`);
      break;
    }
  }
  return excerpts;
}

function changelogExcerptChunks(body: string): string[] {
  return changelogSignalText(body)
    .split(/\r?\n+/)
    .map((line) => normaliseChangelogLine(line))
    .filter((line) => line.length > 0 && !isGenericChangelogHeading(line));
}

function excerptAroundSignal(
  text: string,
  signal: string,
  verbose: boolean,
): string {
  if (verbose) return text;
  const lower = text.toLowerCase();
  const index = lower.indexOf(signal.toLowerCase());
  if (index < 0) return preview(text) ?? text;
  const radius = 120;
  const start = Math.max(0, index - radius);
  const end = Math.min(text.length, index + signal.length + radius);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < text.length ? "..." : "";
  return `${prefix}${text.slice(start, end).trim()}${suffix}`;
}

function normaliseChangelogLine(line: string): string {
  return line.replace(/^#{1,6}\s+/, "").trim();
}

function isGenericChangelogHeading(line: string): boolean {
  return /^(what'?s changed|main changes|changes|commits?|contributors?|breaking changes?)$/i.test(
    line.trim(),
  );
}

function formatDependencyChangesSection(
  changes: UpgradeDependencyChanges,
  options: FormatPackageUpgradeReviewTerminalOptions,
): string[] {
  const lines = [
    sectionTitle("dependencies", options.useColors === true),
    `  direct dependencies: added=${changes.direct.added.length}, removed=${changes.direct.removed.length}, changed=${changes.direct.changed.length}`,
  ];
  lines.push(...formatDependencyChangeGroup("direct", changes.direct, options));
  lines.push(
    `  transitive dependencies: added=${changes.transitive.added.length}, removed=${changes.transitive.removed.length}, changed=${changes.transitive.changed.length}`,
  );
  if (options.verbose) {
    lines.push(
      ...formatDependencyChangeGroup("transitive", changes.transitive, options),
    );
  } else if (hasDependencyChangeGroupItems(changes.transitive)) {
    lines.push("  transitive details: use verbose output");
  }
  return lines;
}

function hasDependencyChangeGroupItems(
  group: UpgradeDependencyChangeGroup,
): boolean {
  return (
    group.added.length > 0 ||
    group.removed.length > 0 ||
    group.changed.length > 0
  );
}

function formatDependencyChangeGroup(
  scope: "direct" | "transitive",
  group: UpgradeDependencyChangeGroup,
  options: FormatPackageUpgradeReviewTerminalOptions,
): string[] {
  const lines: string[] = [];
  const limit = options.verbose ? Number.POSITIVE_INFINITY : 5;
  appendChangeLines(lines, `${scope} added`, group.added, limit);
  appendChangeLines(lines, `${scope} removed`, group.removed, limit);
  appendChangeLines(lines, `${scope} changed`, group.changed, limit);
  return lines;
}

function appendChangeLines(
  lines: string[],
  label: string,
  items: UpgradeDependencyChangeItem[],
  limit: number,
): void {
  if (items.length === 0) return;
  const sample = items.slice(0, limit).map(formatDependencyChangeItem);
  const more = items.length > limit ? ` (+${items.length - limit} more)` : "";
  lines.push(`  ${label}:${more ? `${more} with verbose output` : ""}`);
  for (const item of sample) lines.push(`    - ${item}`);
}

function formatDependencyIssuesSection(
  issues: UpgradeDependencyIssues,
): string[] {
  const introduced =
    issues.introducedDeprecated.length +
    issues.introducedDuplicates.length +
    issues.introducedConflicts.length +
    issues.introducedOutdated.length;
  const lines = [
    "dependency issues:",
    `  current ${issues.currentTotal}, target ${issues.targetTotal}, introduced ${introduced}`,
  ];
  appendStringList(lines, "introduced deprecated", issues.introducedDeprecated);
  appendStringList(lines, "introduced duplicates", issues.introducedDuplicates);
  appendStringList(lines, "introduced conflicts", issues.introducedConflicts);
  appendStringList(lines, "introduced outdated", issues.introducedOutdated);
  return lines;
}

function appendStringList(
  lines: string[],
  label: string,
  items: string[],
): void {
  if (items.length === 0) return;
  lines.push(`  ${label}: ${items.join(", ")}`);
}

function formatDependencyChangeItem(item: UpgradeDependencyChangeItem): string {
  const name = item.registry ? `${item.registry}:${item.name}` : item.name;
  const from = item.fromVersions?.join("|") ?? "";
  const to = item.toVersions?.join("|") ?? "";
  if (from && to && from !== to) return `${name} ${from} -> ${to}`;
  if (to) return `${name}@${to}`;
  if (from) return `${name}@${from}`;
  return name;
}
