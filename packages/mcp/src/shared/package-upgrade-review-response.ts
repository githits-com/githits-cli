import type {
  PackageUpgradeReviewResponse as BackendPackageUpgradeReviewResponse,
  PackageIntelligenceService,
  PackageUpgradeChangelogRiskCoverage,
} from "@githits/core-internal";
import { colorize, colors, highlight } from "./colors.js";
import type {
  PackageUpgradeReviewOptions,
  UpgradeReviewPackageRequest,
} from "./package-upgrade-review-request.js";
import { sanitizeTerminalText } from "./terminal-text.js";

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
  detailSource?: string;
  version: string | null;
  publishedAt?: string;
  htmlUrl?: string;
  body?: string;
  bodyPreview?: string;
  headline?: string;
  signals?: string[];
}

export interface UpgradeChangelogRiskItem {
  version: string;
  tier: "must_act" | "should_know" | "unclassified";
  tierConfidence?: number;
  kind?: string;
  kindConfidence?: number;
  text: string;
  textTruncated: boolean;
  heading?: string;
  source?: string;
  model: string;
  formulation: string;
}

export interface UpgradeChangelog {
  riskItems: UpgradeChangelogRiskItem[];
  riskCoverage: PackageUpgradeChangelogRiskCoverage;
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
  terminalWidth?: number;
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
    riskItems: changelog.riskItems.map((item) => ({
      ...item,
      tier: item.tier.toLowerCase() as UpgradeChangelogRiskItem["tier"],
      kind: lowerEnum(item.kind),
      source: lowerEnum(item.source),
    })),
    riskCoverage: { ...changelog.riskCoverage },
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
    detailSource: lowerEnum(entry.detailSource),
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

export function formatPackageUpgradeReviewTerminal(
  response: UpgradeReviewResponse,
  options: FormatPackageUpgradeReviewTerminalOptions = {},
): string {
  const useColors = options.useColors === true;
  const width = normaliseTerminalWidth(options.terminalWidth);
  const lines = [
    sectionTitle(
      `Upgrade review - ${response.reviews.length} ${response.reviews.length === 1 ? "package" : "packages"}`,
      useColors,
    ),
  ];
  if (response.reviews.length > 1) {
    appendWrappedText(
      lines,
      "Across packages: ",
      aggregateSummary(response),
      width,
    );
  }
  const reviews =
    response.reviews.length > 1
      ? [...response.reviews].sort(
          (a, b) =>
            countRiskTier(b.changelog, "must_act") -
            countRiskTier(a.changelog, "must_act"),
        )
      : response.reviews;
  if (reviews.length > 1) {
    appendSection(lines, formatBatchTriage(reviews, options));
    if (!options.verbose) return `${lines.join("\n").trimEnd()}\n`;
  }
  for (const review of reviews) {
    lines.push("");
    lines.push(
      highlight(
        `${review.registry}:${review.name} ${review.currentVersion} -> ${review.targetVersion} (${review.versionDelta})`,
        useColors,
      ),
    );
    appendSection(lines, formatVulnerabilitySection(review.security, options));
    const deprecation = formatDeprecationLine(review, options);
    if (deprecation) appendSection(lines, deprecation);
    appendSection(lines, formatChangesSection(review.changelog, options));
    if (review.compatibility) {
      appendSection(
        lines,
        formatCompatibilitySection(review.compatibility, options),
      );
    }
    if (review.dependencyChanges) {
      appendSection(
        lines,
        formatDependencyChangesSection(review.dependencyChanges, options),
      );
    }
    if (review.dependencyIssues)
      appendSection(
        lines,
        formatDependencyIssuesSection(review.dependencyIssues, options),
      );
    if (review.unknowns.length > 0) {
      const unknownLines = [
        attentionSectionTitle("Unknown evidence", useColors),
      ];
      for (const unknown of review.unknowns) {
        appendWrappedText(unknownLines, "  - ", unknown, width, "    ");
      }
      appendSection(lines, unknownLines);
    }
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

function sectionTitle(text: string, useColors: boolean): string {
  return useColors ? `${colors.bold}${text}${colors.reset}` : text;
}

function attentionSectionTitle(text: string, useColors: boolean): string {
  return useColors
    ? `${colors.bold}${colors.yellow}${text}${colors.reset}`
    : text;
}

function normaliseTerminalWidth(width: number | undefined): number {
  if (width === undefined || !Number.isFinite(width)) return 80;
  return Math.max(20, Math.floor(width));
}

function appendSection(lines: string[], section: string[]): void {
  if (section.length === 0) return;
  lines.push("", ...section);
}

function appendWrappedText(
  lines: string[],
  prefix: string,
  text: string,
  width: number,
  continuationPrefix = " ".repeat(prefix.length),
  style?: (line: string) => string,
): void {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    lines.push(style ? style(prefix.trimEnd()) : prefix.trimEnd());
    return;
  }
  let current = prefix;
  for (const word of words) {
    const separator = current === prefix ? "" : " ";
    if (
      current.length + separator.length + word.length <= width ||
      (current === prefix && current.trimEnd().length >= width)
    ) {
      current += `${separator}${word}`;
      continue;
    }
    lines.push(style ? style(current.trimEnd()) : current.trimEnd());
    current = `${continuationPrefix}${word}`;
  }
  lines.push(style ? style(current.trimEnd()) : current.trimEnd());
}

function aggregateSummary(response: UpgradeReviewResponse): string {
  const reviewsWithTransitive = response.reviews.filter(
    (review) => review.security.transitive !== undefined,
  ).length;
  const omittedTransitive = response.reviews.length - reviewsWithTransitive;
  const clauses = [
    `${response.summary.withUnknowns} with reported unknowns`,
    `${response.summary.withAddedAdvisories} with added direct vulnerabilities`,
  ];
  const classificationGaps = response.reviews.filter(({ changelog }) => {
    const coverage = changelog.riskCoverage;
    return (
      coverage.versionsNotAssessed > 0 ||
      coverage.versionsWithoutNotes > 0 ||
      coverage.versionsUnparseable > 0
    );
  }).length;
  if (classificationGaps > 0)
    clauses.splice(
      1,
      0,
      `${classificationGaps} with classification coverage gaps`,
    );
  if (reviewsWithTransitive === 0) {
    clauses.push("transitive security not checked");
  } else {
    clauses.push(
      `${response.summary.withTransitiveVulnerabilityAdditions} with added transitive vulnerabilities`,
    );
    if (omittedTransitive > 0)
      clauses.push(`${omittedTransitive} without transitive security evidence`);
  }
  clauses.push(
    `${response.summary.withBreakingSignals} with heuristic change signals`,
    `${response.summary.withDirectDependencyChanges} with direct dependency changes`,
  );
  return clauses.join(" | ");
}

function formatDeprecationLine(
  review: UpgradeReview,
  options: FormatPackageUpgradeReviewTerminalOptions,
): string[] | undefined {
  const current = review.security.current;
  const target = review.security.target;
  const width = normaliseTerminalWidth(options.terminalWidth);
  const useColors = options.useColors === true;
  const hasCurrentDeprecation = current?.deprecated === true;
  const hasTargetDeprecation = target?.deprecated === true;
  const targetDeprecationUnknown =
    target === undefined || target.deprecated === undefined;
  if (
    !hasCurrentDeprecation &&
    !hasTargetDeprecation &&
    !targetDeprecationUnknown
  )
    return undefined;
  const lines = [sectionTitle("Deprecation", useColors)];
  if (current?.deprecated === true)
    lines.push(attentionLine("  Current: deprecated", useColors));
  if (target?.deprecated === true) {
    const reason = target.deprecationReason
      ? `deprecated: ${target.deprecationReason}`
      : "deprecated";
    appendWrappedText(
      lines,
      "  Target: ",
      reason,
      width,
      "          ",
      (line) => attentionLine(line, useColors),
    );
  }
  if (targetDeprecationUnknown)
    lines.push(attentionLine("  Target: deprecation unknown", useColors));
  return lines.length > 1 ? lines : undefined;
}

function formatVulnerabilitySection(
  security: UpgradeSecurity,
  options: FormatPackageUpgradeReviewTerminalOptions,
): string[] {
  const current = security.current?.affectedCount ?? "unknown";
  const target = security.target?.affectedCount ?? "unknown";
  const width = normaliseTerminalWidth(options.terminalWidth);
  const useColors = options.useColors === true;
  const lines = [sectionTitle("Security", useColors)];
  appendWrappedText(
    lines,
    "  Direct: ",
    `${current} affected -> ${target} affected | ${security.removed.length} fixed | ${security.added.length} added | ${security.notAddressed.length} still present`,
    width,
    "          ",
    security.added.length > 0 || security.notAddressed.length > 0
      ? (line) => attentionLine(line, useColors)
      : undefined,
  );
  lines.push(
    ...formatTransitiveVulnerabilitySummary(security.transitive, options),
  );
  const limit = options.verbose ? Number.POSITIVE_INFINITY : 5;
  appendAdvisoryLines(
    lines,
    "Added direct advisories",
    security.added,
    limit,
    width,
    useColors,
    true,
  );
  appendAdvisoryLines(
    lines,
    "Fixed direct advisories",
    security.removed,
    limit,
    width,
    useColors,
    false,
  );
  appendAdvisoryLines(
    lines,
    "Still present direct advisories",
    security.notAddressed,
    limit,
    width,
    useColors,
    true,
  );
  lines.push(
    ...formatTransitiveVulnerabilityDetails(security.transitive, options),
  );
  return lines;
}

function appendAdvisoryLines(
  lines: string[],
  label: string,
  advisories: UpgradeAdvisorySummary[],
  limit: number,
  width: number,
  useColors: boolean,
  attention: boolean,
): void {
  if (advisories.length === 0) return;
  lines.push(attention ? attentionLine(`  ${label}`, useColors) : `  ${label}`);
  for (const advisory of advisories.slice(0, limit)) {
    const prefix = `    - ${formatAdvisoryPrefix(advisory)}`;
    const prose = formatAdvisoryProse(advisory);
    if (prose) {
      appendWrappedText(lines, `${prefix}: `, prose, width, "      ");
    } else {
      lines.push(prefix);
    }
  }
  const remaining = advisories.length - limit;
  if (remaining > 0)
    lines.push(`    - ... +${remaining} more with verbose output`);
}

function formatAdvisoryPrefix(advisory: UpgradeAdvisorySummary): string {
  const id = advisory.id ?? advisory.aliases?.[0] ?? "unknown-id";
  const severity = advisory.severityLabel
    ? ` ${advisory.severityLabel}${typeof advisory.severity === "number" ? `(${advisory.severity})` : ""}`
    : "";
  const malicious = advisory.isMalicious ? " malicious" : "";
  return `${id}${severity}${malicious}`;
}

function formatAdvisoryProse(advisory: UpgradeAdvisorySummary): string {
  const parts: string[] = [];
  if (advisory.summary) parts.push(advisory.summary);
  if (advisory.fixedIn?.length)
    parts.push(`fixed in ${advisory.fixedIn.join(", ")}`);
  return parts.join(" | ");
}

function formatTransitiveVulnerabilitySummary(
  transitive: UpgradeTransitiveSecurity | undefined,
  options: FormatPackageUpgradeReviewTerminalOptions,
): string[] {
  const useColors = options.useColors === true;
  if (!transitive)
    return [attentionLine("  Transitive: not checked", useColors)];
  const lines: string[] = [];
  const width = normaliseTerminalWidth(options.terminalWidth);
  appendWrappedText(
    lines,
    "  Transitive: ",
    `${transitive.currentAffected} affected packages -> ${transitive.targetAffected} | ${transitive.fixedPackageDetailsTotalCount} fixed | ${transitive.introducedPackageDetailsTotalCount} added | ${transitive.stillAffectedPackageDetailsTotalCount} still affected`,
    width,
    "             ",
    transitive.introducedPackageDetailsTotalCount > 0 ||
      transitive.stillAffectedPackageDetailsTotalCount > 0
      ? (line) => attentionLine(line, useColors)
      : undefined,
  );
  return lines;
}

function formatTransitiveVulnerabilityDetails(
  transitive: UpgradeTransitiveSecurity | undefined,
  options: FormatPackageUpgradeReviewTerminalOptions,
): string[] {
  if (!transitive) return [];
  const useColors = options.useColors === true;
  const width = normaliseTerminalWidth(options.terminalWidth);
  const lines: string[] = [];
  const limit = options.verbose ? Number.POSITIVE_INFINITY : 5;
  appendTransitivePackageLines(
    lines,
    "Added transitive vulnerable packages",
    transitive.introducedPackageDetails,
    transitive.introducedPackageDetailsTotalCount,
    transitive.introducedPackageDetailsTruncated,
    limit,
    width,
    true,
    useColors,
  );
  appendTransitivePackageLines(
    lines,
    "Still affected transitive packages",
    transitive.stillAffectedPackageDetails,
    transitive.stillAffectedPackageDetailsTotalCount,
    transitive.stillAffectedPackageDetailsTruncated,
    limit,
    width,
    true,
    useColors,
  );
  appendTransitivePackageLines(
    lines,
    "Fixed transitive vulnerable packages",
    transitive.fixedPackageDetails,
    transitive.fixedPackageDetailsTotalCount,
    transitive.fixedPackageDetailsTruncated,
    limit,
    width,
    false,
    useColors,
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
  width: number,
  attention: boolean,
  useColors: boolean,
): void {
  if (totalCount === 0) return;
  lines.push(attention ? attentionLine(`  ${label}`, useColors) : `  ${label}`);
  const visible = packages.slice(0, limit);
  for (const pkg of visible)
    lines.push(...formatTransitivePackageLines(pkg, width));
  const verboseRemaining = Math.max(0, packages.length - visible.length);
  if (verboseRemaining > 0)
    lines.push(`    - ... +${verboseRemaining} more with verbose output`);
  const backendRemaining = Math.max(0, totalCount - packages.length);
  if (truncated || backendRemaining > 0)
    lines.push(
      `    - ... +${backendRemaining} more not returned by backend page`,
    );
}

function formatTransitivePackageLines(
  pkg: UpgradeTransitiveVulnerablePackage,
  width: number,
): string[] {
  const severity = pkg.maxSeverityLabel
    ? ` ${pkg.maxSeverityLabel}${typeof pkg.maxSeverityScore === "number" ? `(${pkg.maxSeverityScore})` : ""}`
    : "";
  const lines = [
    `    - ${pkg.registry}:${pkg.name}@${pkg.versions.join("|")} affected=${pkg.affectedCount}${severity}`,
  ];
  if (pkg.advisoryIds.length > 0) {
    const prefix = "      Advisories: ";
    appendWrappedText(
      lines,
      prefix,
      pkg.advisoryIds.join(", "),
      width,
      " ".repeat(prefix.length),
    );
  }
  return lines;
}

function formatChangesSection(
  changelog: UpgradeChangelog,
  options: FormatPackageUpgradeReviewTerminalOptions,
): string[] {
  const width = normaliseTerminalWidth(options.terminalWidth);
  const useColors = options.useColors === true;
  const source = formatChangelogSource(changelog);
  const entryWord = changelog.totalEntries === 1 ? "entry" : "entries";
  const lines = [sectionTitle("Changes", useColors)];
  let coverage = `${source} | ${changelog.totalEntries} ${entryWord} | ${changelog.totalEntriesWithBodies} with release notes`;
  if (changelog.truncated)
    coverage += ` | ${changelog.sampledEntries.length} release entries sampled`;
  appendWrappedText(lines, "  ", coverage, width, "  ");
  lines.push(...formatRiskStatements(changelog, options));
  const keywords = changelogKeywordSummary(changelog);
  if (keywords.length > 0 || changelog.totalKeywordEntries > 0) {
    const keywordWord =
      changelog.totalKeywordEntries === 1
        ? "matching entry"
        : "matching entries";
    appendWrappedText(
      lines,
      "  Heuristic signals: ",
      `${keywords.length > 0 ? keywords.join(", ") : "unspecified"} | ${changelog.totalKeywordEntries} ${keywordWord}`,
      width,
      "                    ",
      (line) => colorizeSignalKeywords(line, keywords, useColors),
    );
  }
  const renderedKeys = new Set<string>();
  const keywordEntries = changelog.keywordEntries.filter((entry) => {
    const key = changelogEntryKey(entry);
    if (renderedKeys.has(key)) return false;
    renderedKeys.add(key);
    return true;
  });
  if (keywordEntries.length > 0) {
    lines.push("  Heuristic release entries");
    for (const entry of keywordEntries) {
      lines.push(
        ...formatKeywordChangelogEntry(entry, options, width, useColors),
      );
    }
  }
  const sampledEntries = changelog.sampledEntries.filter((entry) => {
    const key = changelogEntryKey(entry);
    if (renderedKeys.has(key)) return false;
    renderedKeys.add(key);
    return true;
  });
  appendPlainChangelogEntries(
    lines,
    "Sampled release entries",
    sampledEntries,
    width,
  );
  if (options.verbose === true) {
    const otherEntries = changelog.entries.filter((entry) => {
      if (!entry.bodyPreview) return false;
      const key = changelogEntryKey(entry);
      if (renderedKeys.has(key)) return false;
      renderedKeys.add(key);
      return true;
    });
    appendPlainChangelogEntries(
      lines,
      "Other release entries",
      otherEntries,
      width,
    );
  }
  return lines;
}

const RISK_KIND_LABELS: Record<string, string> = {
  removes_or_renames_api: "removal",
  changes_behavior_or_default: "behavior",
  raises_runtime_or_platform_requirement: "runtime/platform",
  changes_packaging_or_module_format: "packaging/modules",
  deprecates_without_removal: "deprecation",
  security_fix: "security fix",
  notable_change: "notable change",
};

function countRiskTier(
  changelog: UpgradeChangelog,
  tier: UpgradeChangelogRiskItem["tier"],
): number {
  return changelog.riskItems.filter((item) => item.tier === tier).length;
}

function riskCoverageText(changelog: UpgradeChangelog): string {
  const c = changelog.riskCoverage;
  return `${c.versionsClassified} classified | ${c.versionsNotAssessed} not assessed | ${c.versionsWithoutNotes} without notes | ${c.versionsUnparseable} unparseable`;
}

function riskProvenance(item: UpgradeChangelogRiskItem): string {
  return safeRiskText(`${item.model} / ${item.formulation}`);
}

function safeRiskText(value: string): string {
  return sanitizeTerminalText(value.replace(/\s+/g, " ")).trim();
}

function formatRiskStatements(
  changelog: UpgradeChangelog,
  options: FormatPackageUpgradeReviewTerminalOptions,
): string[] {
  const width = normaliseTerminalWidth(options.terminalWidth);
  const lines: string[] = [];
  appendWrappedText(
    lines,
    "  Classification versions: ",
    riskCoverageText(changelog),
    width,
    "    ",
  );
  const omitted = changelog.riskCoverage.itemsOmitted;
  appendWrappedText(
    lines,
    "  Statements: ",
    `${changelog.riskItems.length} returned | ${changelog.riskCoverage.unitsNoImpact} labeled no impact${omitted > 0 ? ` | ${omitted} omitted by backend (lowest priority first)` : ""}`,
    width,
    "    ",
  );
  if (changelog.riskCoverage.versionsNotAssessed > 0) {
    appendWrappedText(
      lines,
      "  ",
      "Rerun to fill not-assessed versions; later requests fill stored labels.",
      width,
      "  ",
    );
  }
  appendWrappedText(
    lines,
    "  ",
    "Missing or unparseable notes are not evidence of no risk.",
    width,
    "  ",
  );
  const provenance = [...new Set(changelog.riskItems.map(riskProvenance))];
  const sourceLinks = new Set<string>();
  const groups: Array<{
    tier: UpgradeChangelogRiskItem["tier"];
    label: string;
    limit: number;
  }> = [
    { tier: "must_act", label: "Requires action", limit: Infinity },
    { tier: "should_know", label: "Should know", limit: 240 },
    {
      tier: "unclassified",
      label: "Unclassified - read if relevant",
      limit: 120,
    },
  ];
  for (const group of groups) {
    const items = changelog.riskItems.filter(
      (item) => item.tier === group.tier,
    );
    if (items.length === 0) continue;
    lines.push(`  ${group.label} (${items.length})`);
    for (const item of items) {
      const quote = safeRiskText(item.text);
      const characters = Array.from(quote);
      const excerpted = !options.verbose && characters.length > group.limit;
      const shown = excerpted
        ? `${characters.slice(0, group.limit).join("").trimEnd()}...`
        : quote;
      const kind = item.kind
        ? `${RISK_KIND_LABELS[item.kind] ?? safeRiskText(item.kind)} `
        : "";
      const source = item.source ? ` [${safeRiskText(item.source)}]` : "";
      const truncation = item.textTruncated
        ? " [statement truncated by backend]"
        : "";
      const excerpt = excerpted ? " [excerpt; expand with verbose]" : "";
      appendWrappedText(
        lines,
        "    ",
        `${kind}${safeRiskText(item.version)} "${shown}"${source}${truncation}${excerpt}`,
        width,
        "      ",
      );
      // A range may include statements from several sources for the same version.
      const entry = [
        ...changelog.entries,
        ...changelog.keywordEntries,
        ...changelog.sampledEntries,
      ].find(
        (entry) =>
          item.source !== undefined &&
          entry.version === item.version &&
          entry.detailSource === item.source &&
          entry.htmlUrl,
      );
      if (entry?.htmlUrl)
        sourceLinks.add(
          `${safeRiskText(item.version)} [${safeRiskText(item.source ?? "")}] ${safeRiskText(entry.htmlUrl)}`,
        );
      if (options.verbose) {
        const details = [
          item.heading ? `heading: ${safeRiskText(item.heading)}` : undefined,
          item.tierConfidence !== undefined
            ? `tier confidence: ${item.tierConfidence}`
            : undefined,
          item.kindConfidence !== undefined
            ? `kind confidence: ${item.kindConfidence}`
            : undefined,
        ]
          .filter(Boolean)
          .join(" | ");
        if (details)
          appendWrappedText(lines, "      ", details, width, "      ");
      }
      if (provenance.length > 1)
        appendWrappedText(
          lines,
          "      Model: ",
          riskProvenance(item),
          width,
          "        ",
        );
    }
  }
  if (sourceLinks.size > 0) {
    lines.push("  Statement sources");
    for (const link of sourceLinks) lines.push(`    ${link}`);
  }
  appendWrappedText(
    lines,
    "  ",
    provenance.length === 0
      ? "Statement labels are model classifications. Not a compatibility verdict."
      : `Classified by a model${provenance.length === 1 ? ` (${provenance[0]})` : ""}. Not a compatibility verdict.`,
    width,
    "  ",
  );
  return lines;
}

function formatBatchTriage(
  reviews: UpgradeReview[],
  options: FormatPackageUpgradeReviewTerminalOptions,
): string[] {
  const lines = [
    sectionTitle(
      "Batch triage - returned statement counts",
      options.useColors === true,
    ),
  ];
  for (const review of reviews) {
    const c = review.changelog;
    const target = review.security.target;
    const deprecation =
      target?.deprecated === true
        ? "deprecated"
        : target?.deprecated === false
          ? "not deprecated"
          : "deprecation unknown";
    const transitive = review.security.transitive;
    const security = `direct vulnerabilities: ${review.security.added.length} added / ${review.security.notAddressed.length} still present`;
    const transitiveText = transitive
      ? `transitive: ${transitive.introducedPackageDetailsTotalCount} added / ${transitive.stillAffectedPackageDetailsTotalCount} still affected`
      : "transitive: not checked";
    const dependencyCount = review.dependencyChanges
      ? [
          review.dependencyChanges.direct.added,
          review.dependencyChanges.direct.removed,
          review.dependencyChanges.direct.changed,
        ].reduce((n, rows) => n + rows.length, 0)
      : undefined;
    const issues = review.dependencyIssues;
    const issueCount = issues
      ? issues.introducedDeprecated.length +
        issues.introducedDuplicates.length +
        issues.introducedConflicts.length +
        issues.introducedOutdated.length
      : undefined;
    const provenance = [...new Set(c.riskItems.map(riskProvenance))].join(", ");
    // Rows stay intact as a table; prose footers use the caller's width.
    lines.push(
      `  ${safeRiskText(`${review.registry}:${review.name} ${review.currentVersion} -> ${review.targetVersion} (${review.versionDelta})`)} | ${countRiskTier(c, "must_act")} act | ${countRiskTier(c, "should_know")} know | ${countRiskTier(c, "unclassified")} unclassified | versions: ${riskCoverageText(c)} | ${c.riskCoverage.unitsNoImpact} labeled no impact | ${c.riskCoverage.itemsOmitted} omitted | ${deprecation} | ${security} | ${transitiveText} | ${c.totalKeywordEntries} keyword entries | ${dependencyCount ?? "not checked"} direct dependency changes | ${issueCount ?? "not checked"} dependency issues | ${review.unknowns.length} unknowns${provenance ? ` | model: ${provenance}` : ""}`,
    );
  }
  const width = normaliseTerminalWidth(options.terminalWidth);
  if (
    reviews.some(
      (review) => review.changelog.riskCoverage.versionsNotAssessed > 0,
    )
  )
    appendWrappedText(
      lines,
      "  ",
      "Rerun to fill not-assessed versions; later requests fill stored labels.",
      width,
      "  ",
    );
  appendWrappedText(
    lines,
    "  ",
    "Counts are returned statements (including unclassified), may include the same statement from multiple sources, and exclude omitted items. Not a compatibility verdict.",
    width,
    "  ",
  );
  appendWrappedText(
    lines,
    "  ",
    "Missing or unparseable notes are not evidence of no risk. Use verbose for full per-package quotes and evidence.",
    width,
    "  ",
  );
  return lines;
}

function formatChangelogSource(changelog: UpgradeChangelog): string {
  const source = changelog.source || changelog.fallback;
  const sourceKey = source?.toLowerCase();
  if (sourceKey === "releases") return "Repository releases";
  if (sourceKey === "package_versions")
    return "Package versions (no release notes)";
  return source ?? "Changelog source unavailable";
}

function appendPlainChangelogEntries(
  lines: string[],
  label: string,
  entries: UpgradeChangelogEntry[],
  width: number,
): void {
  if (entries.length === 0) return;
  lines.push(`  ${label}`);
  for (const entry of entries) {
    lines.push(...formatPlainChangelogEntry(entry, width));
  }
}

function changelogEntryKey(entry: UpgradeChangelogEntry): string {
  return `${entry.version ?? "unknown"}:${entry.publishedAt ?? ""}:${entry.htmlUrl ?? ""}`;
}

function formatCompatibilitySection(
  compatibility: UpgradeCompatibility,
  options: FormatPackageUpgradeReviewTerminalOptions,
): string[] {
  if (
    compatibility.peerDependencyChanges.length === 0 &&
    compatibility.notes.length === 0
  )
    return [];
  const width = normaliseTerminalWidth(options.terminalWidth);
  const lines = [sectionTitle("Compatibility", options.useColors === true)];
  if (compatibility.peerDependencyChanges.length > 0) {
    lines.push("  Peer dependency changes");
    const limit = options.verbose ? Number.POSITIVE_INFINITY : 10;
    for (const change of compatibility.peerDependencyChanges.slice(0, limit)) {
      appendWrappedText(lines, "    - ", change, width, "      ");
    }
    const remaining = compatibility.peerDependencyChanges.length - limit;
    if (remaining > 0)
      lines.push(`    - ... +${remaining} more with verbose output`);
  }
  for (const note of compatibility.notes) {
    appendWrappedText(lines, "  Note: ", note, width, "        ");
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
  width: number,
  useColors: boolean,
): string[] {
  const lines = formatChangelogEntryHeader(entry, width);
  const matched = formatMatchedExcerpts(entry, options.verbose === true);
  for (const excerpt of matched) {
    appendWrappedText(lines, "      ", excerpt, width, "      ", (line) =>
      colorizeSignalMarker(line, useColors),
    );
  }
  return lines;
}

function colorizeSignalMarker(line: string, useColors: boolean): string {
  if (!useColors) return line;
  return line.replace(/^(\s*\[[^\]]+\]:)/, `${colors.yellow}$1${colors.reset}`);
}

function colorizeSignalKeywords(
  line: string,
  keywords: string[],
  useColors: boolean,
): string {
  if (!useColors || keywords.length === 0) return line;
  let result = line;
  for (const keyword of keywords) {
    result = result.replace(
      keyword,
      `${colors.yellow}${keyword}${colors.reset}`,
    );
  }
  return result;
}

function formatPlainChangelogEntry(
  entry: UpgradeChangelogEntry,
  width: number,
): string[] {
  const lines = formatChangelogEntryHeader(entry, width);
  if (entry.headline) {
    appendWrappedText(
      lines,
      "      ",
      preview(entry.headline) ?? entry.headline,
      width,
      "      ",
    );
  }
  return lines;
}

function formatChangelogEntryHeader(
  entry: UpgradeChangelogEntry,
  width: number,
): string[] {
  const version = entry.version ?? "unknown-version";
  const header = `    - ${version}${entry.publishedAt ? ` (${entry.publishedAt})` : ""}`;
  if (!entry.htmlUrl) return [header];
  if (header.length + 1 + entry.htmlUrl.length <= width)
    return [`${header} ${entry.htmlUrl}`];
  return [header, `      ${entry.htmlUrl}`];
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
      excerpts.push(`[${signal}]: ${excerpt}`);
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
  const useColors = options.useColors === true;
  const lines = [sectionTitle("Dependencies", useColors)];
  lines.push(
    `  Direct: ${changes.direct.added.length} added | ${changes.direct.removed.length} removed | ${changes.direct.changed.length} changed`,
  );
  lines.push(...formatDependencyChangeGroup("Direct", changes.direct, options));
  lines.push(
    `  Transitive: ${changes.transitive.added.length} added | ${changes.transitive.removed.length} removed | ${changes.transitive.changed.length} changed`,
  );
  if (options.verbose) {
    lines.push(
      ...formatDependencyChangeGroup("Transitive", changes.transitive, options),
    );
  } else if (hasDependencyChangeGroupItems(changes.transitive)) {
    lines.push(
      "  More transitive dependency details are available with verbose output.",
    );
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
  scope: "Direct" | "Transitive",
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
  lines.push(`  ${label}${more ? `${more} with verbose output` : ""}`);
  for (const item of sample) lines.push(`    - ${item}`);
}

function formatDependencyIssuesSection(
  issues: UpgradeDependencyIssues,
  options: FormatPackageUpgradeReviewTerminalOptions,
): string[] {
  const introduced =
    issues.introducedDeprecated.length +
    issues.introducedDuplicates.length +
    issues.introducedConflicts.length +
    issues.introducedOutdated.length;
  const useColors = options.useColors === true;
  const limit = options.verbose ? Number.POSITIVE_INFINITY : 5;
  const lines = [sectionTitle("Dependency issues", useColors)];
  if (introduced === 0) {
    lines.push(
      `  none introduced | current total: ${issues.currentTotal} | target total: ${issues.targetTotal}`,
    );
    return lines;
  }
  lines.push(
    attentionLine(
      `  ${introduced} introduced | current total: ${issues.currentTotal} | target total: ${issues.targetTotal}`,
      useColors,
    ),
  );
  appendStringList(
    lines,
    "Introduced deprecated",
    issues.introducedDeprecated,
    limit,
    useColors,
  );
  appendStringList(
    lines,
    "Introduced duplicates",
    issues.introducedDuplicates,
    limit,
    useColors,
  );
  appendStringList(
    lines,
    "Introduced conflicts",
    issues.introducedConflicts,
    limit,
    useColors,
  );
  appendStringList(
    lines,
    "Introduced outdated",
    issues.introducedOutdated,
    limit,
    useColors,
  );
  return lines;
}

function appendStringList(
  lines: string[],
  label: string,
  items: string[],
  limit: number,
  useColors: boolean,
): void {
  if (items.length === 0) return;
  lines.push(attentionLine(`  ${label}`, useColors));
  for (const item of items.slice(0, limit)) lines.push(`    - ${item}`);
  const remaining = items.length - limit;
  if (remaining > 0)
    lines.push(`    - ... +${remaining} more with verbose output`);
}

function attentionLine(text: string, useColors: boolean): string {
  return colorize(text, "yellow", useColors);
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
