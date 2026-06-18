import type {
  ChangelogReport,
  DependencyIssuesSummary,
  DependencyReport,
  PackageIntelligenceService,
  PackageVersionIdentity,
  TransitiveDependencyVulnerability,
  TransitiveVulnerabilitySummary,
  VulnerabilityDetail,
  VulnerabilityReport,
} from "@githits/core-internal";
import { colorize, highlight } from "./colors.js";
import { mapPackageIntelligenceError } from "./package-intelligence-error-map.js";
import {
  buildUpgradeDependencyProbeParams,
  type PackageUpgradeReviewOptions,
  type UpgradeReviewPackageRequest,
} from "./package-upgrade-review-request.js";
import {
  dedupAdvisoriesByAlias,
  vulnSeverityLabel,
} from "./package-vulnerabilities-response.js";

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
  fixedPackageDetails: UpgradeTransitiveVulnerablePackage[];
  stillAffectedPackageDetails: UpgradeTransitiveVulnerablePackage[];
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

interface TransitivePackageDiffEntry
  extends UpgradeTransitiveVulnerablePackage {
  advisoryKeys: string[];
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

export interface BuildPackageUpgradeReviewOptions {
  concurrency?: number;
}

export interface FormatPackageUpgradeReviewTerminalOptions {
  verbose?: boolean;
  useColors?: boolean;
}

const DEFAULT_CONCURRENCY = 3;
const BODY_PREVIEW_CHARS = 280;
const DEFAULT_CHANGELOG_SAMPLE_LIMIT = 5;
const SIGNAL_TERMS = [
  "breaking",
  "breaks",
  "removed",
  "drop support",
  "migration",
  "migrate",
  "deprecated",
  "renamed",
] as const;

export async function buildPackageUpgradeReview(
  service: PackageIntelligenceService,
  packages: readonly UpgradeReviewPackageRequest[],
  options: PackageUpgradeReviewOptions,
  buildOptions: BuildPackageUpgradeReviewOptions = {},
): Promise<UpgradeReviewResponse> {
  const concurrency = buildOptions.concurrency ?? DEFAULT_CONCURRENCY;
  const reviews = await runWithConcurrency(packages, concurrency, (pkg) =>
    buildSingleReview(service, pkg, options),
  );
  return {
    summary: {
      total: reviews.length,
      withUnknowns: reviews.filter((r) => r.unknowns.length > 0).length,
      withAddedAdvisories: reviews.filter((r) => r.security.added.length > 0)
        .length,
      withBreakingSignals: reviews.filter((r) =>
        hasBreakingSignals(r.changelog),
      ).length,
      withDirectDependencyChanges: reviews.filter((r) =>
        hasDirectDependencyChurn(r.dependencyChanges),
      ).length,
      withTransitiveVulnerabilityAdditions: reviews.filter(
        (r) => (r.security.transitive?.introducedPackages.length ?? 0) > 0,
      ).length,
    },
    reviews,
  };
}

async function buildSingleReview(
  service: PackageIntelligenceService,
  pkg: UpgradeReviewPackageRequest,
  options: PackageUpgradeReviewOptions,
): Promise<UpgradeReview> {
  const versionDelta = classifyVersionDelta(
    pkg.currentVersion,
    pkg.targetVersion,
  );
  const [
    summary,
    currentVulns,
    targetVulns,
    changelog,
    currentDeps,
    targetDeps,
  ] = await Promise.all([
    capture(() =>
      service.packageSummary({
        registry: pkg.registry,
        packageName: pkg.packageName,
      }),
    ),
    capture(() =>
      service.packageVulnerabilities({
        registry: pkg.registry,
        packageName: pkg.packageName,
        version: pkg.currentVersion,
        minSeverity: options.minSeverity,
        advisoryScope: "AFFECTED",
      }),
    ),
    capture(() =>
      service.packageVulnerabilities({
        registry: pkg.registry,
        packageName: pkg.packageName,
        version: pkg.targetVersion,
        minSeverity: options.minSeverity,
        advisoryScope: "AFFECTED",
      }),
    ),
    capture(() =>
      service.packageChangelog({
        registry: pkg.registry,
        packageName: pkg.packageName,
        fromVersion: pkg.currentVersion,
        toVersion: pkg.targetVersion,
      }),
    ),
    capture(() =>
      service.packageUpgradeDependencyProbe(
        buildUpgradeDependencyProbeParams(pkg, pkg.currentVersion, options),
      ),
    ),
    capture(() =>
      service.packageUpgradeDependencyProbe(
        buildUpgradeDependencyProbeParams(pkg, pkg.targetVersion, options),
      ),
    ),
  ]);

  const unknowns: string[] = [];
  if (!summary.ok)
    unknowns.push(
      `package summary unavailable: ${formatCapturedError(summary.error)}`,
    );
  if (!currentVulns.ok)
    unknowns.push(
      `current-version vulnerability check failed: ${formatCapturedError(currentVulns.error)}`,
    );
  if (!targetVulns.ok)
    unknowns.push(
      `target-version vulnerability check failed: ${formatCapturedError(targetVulns.error)}`,
    );
  if (!changelog.ok)
    unknowns.push(
      `changelog unavailable: ${formatCapturedError(changelog.error)}`,
    );
  if (
    options.includeTransitiveSecurity ||
    options.includeDependencyIssues ||
    options.includeDependencyChanges
  ) {
    if (!currentDeps.ok)
      unknowns.push(
        `current-version dependency probe failed: ${formatCapturedError(currentDeps.error)}`,
      );
    if (!targetDeps.ok)
      unknowns.push(
        `target-version dependency probe failed: ${formatCapturedError(targetDeps.error)}`,
      );
  }

  const currentSecurity = currentVulns.ok
    ? buildVersionVulnerabilitySummary(
        currentVulns.value,
        currentDeps.ok ? currentDeps.value.package : undefined,
      )
    : undefined;
  const targetSecurity = targetVulns.ok
    ? buildVersionVulnerabilitySummary(
        targetVulns.value,
        targetDeps.ok ? targetDeps.value.package : undefined,
      )
    : undefined;
  const advisoryDiff = diffAdvisories(
    currentVulns.ok ? (currentVulns.value.security?.vulnerabilities ?? []) : [],
    targetVulns.ok ? (targetVulns.value.security?.vulnerabilities ?? []) : [],
  );
  const changelogBlock = changelog.ok
    ? buildChangelogBlock(changelog.value, options.changelogLimit)
    : emptyChangelog();
  const transitive = buildTransitiveSecurity(
    currentDeps.ok
      ? currentDeps.value.dependencies?.transitive?.vulnerabilitySummary
      : undefined,
    targetDeps.ok
      ? targetDeps.value.dependencies?.transitive?.vulnerabilitySummary
      : undefined,
    options,
  );
  const dependencyIssues = buildDependencyIssues(
    currentDeps.ok
      ? currentDeps.value.dependencies?.transitive?.dependencyIssues
      : undefined,
    targetDeps.ok
      ? targetDeps.value.dependencies?.transitive?.dependencyIssues
      : undefined,
    options,
    pkg,
  );
  const dependencyChanges = buildDependencyChanges(
    currentDeps.ok ? currentDeps.value : undefined,
    targetDeps.ok ? targetDeps.value : undefined,
    pkg,
  );
  const compatibility = buildCompatibility(
    currentDeps.ok ? currentDeps.value : undefined,
    targetDeps.ok ? targetDeps.value : undefined,
  );

  if (
    changelogBlock.fallback === "package_versions" &&
    !changelogBlock.hasReleaseNoteBodies
  ) {
    unknowns.push(
      "changelog range only returned package-version fallback entries without release-note bodies",
    );
  }
  if (targetSecurity && targetSecurity.deprecated === undefined) {
    unknowns.push("target version deprecation metadata is unavailable");
  }

  if (
    options.minSeverityLabel !== undefined &&
    options.minSeverityLabel !== "low"
  ) {
    unknowns.push("direct vulnerability checks were filtered by min_severity");
  }

  return {
    registry: pkg.registryLabel,
    name: pkg.packageName,
    currentVersion: pkg.currentVersion,
    targetVersion: pkg.targetVersion,
    latestVersion: summary.ok ? summary.value.package.latestVersion : undefined,
    versionDelta,
    security: {
      current: currentSecurity,
      target: targetSecurity,
      added: advisoryDiff.introduced,
      removed: advisoryDiff.fixed,
      notAddressed: advisoryDiff.unchanged,
      fixed: advisoryDiff.fixed,
      introduced: advisoryDiff.introduced,
      unchanged: advisoryDiff.unchanged,
      transitive,
    },
    changelog: changelogBlock,
    compatibility,
    dependencyChanges,
    dependencyIssues,
    unknowns,
  };
}

function buildVersionVulnerabilitySummary(
  report: VulnerabilityReport,
  metadata: PackageVersionIdentity | undefined,
): VersionVulnerabilitySummary {
  const security = report.security;
  return {
    version: report.package.version,
    ...versionMetadata(metadata ?? report.package),
    affectedCount: security?.affectedVulnerabilityCount ?? 0,
    nonAffectingCount: security?.nonAffectingVulnerabilityCount ?? 0,
    allCount: security?.allVulnerabilityCount ?? 0,
    advisories: dedupAdvisoriesByAlias(security?.vulnerabilities ?? []).map(
      toAdvisorySummary,
    ),
  };
}

function versionMetadata(
  pkg: PackageVersionIdentity,
): Pick<
  VersionVulnerabilitySummary,
  "publishedAt" | "deprecated" | "deprecationReason"
> {
  return {
    publishedAt: pkg.publishedAt,
    deprecated: pkg.deprecated,
    deprecationReason: pkg.deprecationReason,
  };
}

function diffAdvisories(
  current: VulnerabilityDetail[],
  target: VulnerabilityDetail[],
): Pick<UpgradeSecurity, "fixed" | "introduced" | "unchanged"> {
  const currentMap = advisoryMap(current);
  const targetMap = advisoryMap(target);
  const fixed: UpgradeAdvisorySummary[] = [];
  const introduced: UpgradeAdvisorySummary[] = [];
  const unchanged: UpgradeAdvisorySummary[] = [];
  for (const [key, advisory] of currentMap) {
    if (targetMap.has(key))
      unchanged.push(toAdvisorySummary(targetMap.get(key) ?? advisory));
    else fixed.push(toAdvisorySummary(advisory));
  }
  for (const [key, advisory] of targetMap) {
    if (!currentMap.has(key)) introduced.push(toAdvisorySummary(advisory));
  }
  return { fixed, introduced, unchanged };
}

function advisoryMap(
  advisories: VulnerabilityDetail[],
): Map<string, VulnerabilityDetail> {
  const map = new Map<string, VulnerabilityDetail>();
  for (const advisory of dedupAdvisoriesByAlias(advisories)) {
    map.set(advisoryKey(advisory), advisory);
  }
  return map;
}

function advisoryKey(advisory: {
  osvId?: string;
  aliases?: string[];
  summary?: string;
}): string {
  const ids = [advisory.osvId, ...(advisory.aliases ?? [])].filter(
    (id): id is string => Boolean(id),
  );
  return ids.length > 0
    ? ids.sort().join("|")
    : `summary:${advisory.summary ?? "unknown"}`;
}

function toAdvisorySummary(
  advisory: VulnerabilityDetail,
): UpgradeAdvisorySummary {
  const severity = advisory.severityScore;
  return {
    id: advisory.osvId,
    aliases: advisory.aliases,
    summary: advisory.summary,
    severity,
    severityLabel:
      typeof severity === "number" ? vulnSeverityLabel(severity) : undefined,
    fixedIn: advisory.fixedInVersions,
    isMalicious: advisory.isMalicious,
  };
}

function buildChangelogBlock(
  report: ChangelogReport,
  limit: number,
): UpgradeChangelog {
  const boundedEntries = report.entries.slice(0, limit);
  const entries = boundedEntries.map((entry) => toUpgradeChangelogEntry(entry));
  const allEntries = report.entries.map((entry) =>
    toUpgradeChangelogEntry(entry),
  );
  const allKeywordEntries = allEntries.filter(
    (entry) => (entry.signals?.length ?? 0) > 0,
  );
  const bodies = report.entries
    .map((entry) => entry.body ?? "")
    .filter((body) => body.trim().length > 0);
  const signals = extractSignals(bodies.join("\n"));
  return {
    source: report.source,
    fallback: report.source ? undefined : "package_versions",
    entries,
    sampledEntries: sampleChangelogEntries(entries),
    keywordEntries: allKeywordEntries,
    totalKeywordEntries: allKeywordEntries.length,
    totalEntries: report.entries.length,
    totalEntriesWithBodies: bodies.length,
    truncated: report.entries.length > entries.length,
    hasReleaseNoteBodies: bodies.length > 0,
    breakingSignals: signals.filter(
      (signal) => signal !== "migration" && signal !== "migrate",
    ),
    migrationSignals: signals.filter(
      (signal) => signal === "migration" || signal === "migrate",
    ),
  };
}

function toUpgradeChangelogEntry(entry: {
  version?: string;
  publishedAt?: string;
  htmlUrl?: string;
  body?: string;
}): UpgradeChangelogEntry {
  const signals = extractSignals(changelogSignalText(entry.body));
  return {
    version: entry.version ?? null,
    publishedAt: entry.publishedAt,
    htmlUrl: entry.htmlUrl,
    body: entry.body,
    bodyPreview: preview(entry.body),
    headline: headlineParagraph(entry.body),
    signals: signals.length > 0 ? signals : undefined,
  };
}

function sampleChangelogEntries(
  entries: UpgradeChangelogEntry[],
): UpgradeChangelogEntry[] {
  const sample = new Map<string, UpgradeChangelogEntry>();
  for (const entry of entries.slice(0, 1)) {
    sample.set(changelogEntryKey(entry), entry);
  }
  for (const entry of entries.filter(hasUsefulHeadline)) {
    if (sample.size >= DEFAULT_CHANGELOG_SAMPLE_LIMIT) break;
    sample.set(changelogEntryKey(entry), entry);
  }
  return [...sample.values()].slice(0, DEFAULT_CHANGELOG_SAMPLE_LIMIT);
}

function hasUsefulHeadline(entry: UpgradeChangelogEntry): boolean {
  const headline = entry.headline?.trim().toLowerCase();
  if (!headline) return false;
  return headline !== "- no changes" && headline !== "no changes";
}

function changelogEntryKey(entry: UpgradeChangelogEntry): string {
  return `${entry.version ?? "unknown"}:${entry.publishedAt ?? ""}:${entry.htmlUrl ?? ""}`;
}

function emptyChangelog(): UpgradeChangelog {
  return {
    entries: [],
    sampledEntries: [],
    keywordEntries: [],
    totalKeywordEntries: 0,
    totalEntries: 0,
    totalEntriesWithBodies: 0,
    truncated: false,
    hasReleaseNoteBodies: false,
    breakingSignals: [],
    migrationSignals: [],
  };
}

function preview(body: string | undefined): string | undefined {
  if (body === undefined) return undefined;
  const compact = body.replace(/\s+/g, " ").trim();
  if (compact.length === 0) return "";
  return compact.length > BODY_PREVIEW_CHARS
    ? `${compact.slice(0, BODY_PREVIEW_CHARS)}...`
    : compact;
}

function headlineParagraph(body: string | undefined): string | undefined {
  if (!body) return undefined;
  const lines = changelogSignalText(body).replace(/\r\n/g, "\n").split("\n");
  const paragraph: string[] = [];
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.length === 0) {
      if (paragraph.length > 0) break;
      continue;
    }
    if (looksLikeCommitListLine(line) && paragraph.length === 0) continue;
    if (looksLikeLowValueHeading(line)) continue;
    if (looksLikeVersionOnlyHeading(line)) continue;
    const normalised = normaliseChangelogLine(line);
    if (isGenericChangelogHeading(normalised)) continue;
    paragraph.push(normalised);
    if (paragraph.join(" ").length >= BODY_PREVIEW_CHARS) break;
  }
  const text = paragraph.join(" ").trim();
  if (!text || looksLikePullRequestList(text)) return undefined;
  return preview(text);
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

function looksLikeLowValueHeading(line: string): boolean {
  return /^#{1,6}\s+(commits?|contributors?)\b/i.test(line);
}

function looksLikeVersionOnlyHeading(line: string): boolean {
  return /^#{1,6}\s*v?\d+\.\d+\.\d+(?:[-\w.]*)?\s*$/i.test(line);
}

function looksLikePullRequestList(text: string): boolean {
  const pullMentions = (text.match(/\/pull\/\d+/g) ?? []).length;
  const authorMentions = (text.match(/\sby\s@/g) ?? []).length;
  return pullMentions >= 2 || authorMentions >= 2;
}

function extractSignals(text: string): string[] {
  return SIGNAL_TERMS.filter((term) => matchesSignalTerm(text, term));
}

function matchesSignalTerm(text: string, term: string): boolean {
  const lower = text.toLowerCase();
  if (term === "breaking" || term === "breaks") {
    if (/\b(no|without|not)\s+breaking\s+changes?\b/i.test(text)) return false;
  }
  return lower.includes(term);
}

function buildTransitiveSecurity(
  current: TransitiveVulnerabilitySummary | undefined,
  target: TransitiveVulnerabilitySummary | undefined,
  options: PackageUpgradeReviewOptions,
): UpgradeTransitiveSecurity | undefined {
  if (!options.includeTransitiveSecurity || (!current && !target))
    return undefined;
  const currentMap = transitiveVulnerablePackageMap(current?.packages ?? []);
  const targetMap = transitiveVulnerablePackageMap(target?.packages ?? []);
  const introducedPackages = [...targetMap.keys()]
    .filter((key) =>
      hasAddedTransitiveAdvisory(currentMap.get(key), targetMap.get(key)),
    )
    .sort();
  const fixedPackages = [...currentMap.keys()]
    .filter((key) =>
      hasRemovedTransitiveAdvisory(currentMap.get(key), targetMap.get(key)),
    )
    .sort();
  const stillAffectedPackages = [...targetMap.keys()]
    .filter((key) =>
      hasSharedTransitiveAdvisory(currentMap.get(key), targetMap.get(key)),
    )
    .sort();
  return {
    currentAffected: current?.affectedPackageCount ?? 0,
    targetAffected: target?.affectedPackageCount ?? 0,
    introducedPackages,
    fixedPackages,
    introducedPackageDetails: introducedPackages
      .map((key) => targetMap.get(key))
      .map(toPublicTransitivePackage)
      .filter((pkg): pkg is UpgradeTransitiveVulnerablePackage => Boolean(pkg)),
    fixedPackageDetails: fixedPackages
      .map((key) => currentMap.get(key))
      .map(toPublicTransitivePackage)
      .filter((pkg): pkg is UpgradeTransitiveVulnerablePackage => Boolean(pkg)),
    stillAffectedPackageDetails: stillAffectedPackages
      .map((key) => targetMap.get(key))
      .map(toPublicTransitivePackage)
      .filter((pkg): pkg is UpgradeTransitiveVulnerablePackage => Boolean(pkg)),
  };
}

function hasAddedTransitiveAdvisory(
  current: TransitivePackageDiffEntry | undefined,
  target: TransitivePackageDiffEntry | undefined,
): boolean {
  if (!target) return false;
  if (!current) return true;
  const currentAdvisories = new Set(current.advisoryKeys);
  return target.advisoryKeys.some((id) => !currentAdvisories.has(id));
}

function hasRemovedTransitiveAdvisory(
  current: TransitivePackageDiffEntry | undefined,
  target: TransitivePackageDiffEntry | undefined,
): boolean {
  if (!current) return false;
  if (!target) return true;
  const targetAdvisories = new Set(target.advisoryKeys);
  return current.advisoryKeys.some((id) => !targetAdvisories.has(id));
}

function hasSharedTransitiveAdvisory(
  current: TransitivePackageDiffEntry | undefined,
  target: TransitivePackageDiffEntry | undefined,
): boolean {
  if (!current || !target) return false;
  if (current.advisoryKeys.length === 0 || target.advisoryKeys.length === 0) {
    return current.affectedCount > 0 && target.affectedCount > 0;
  }
  const currentAdvisories = new Set(current.advisoryKeys);
  return target.advisoryKeys.some((id) => currentAdvisories.has(id));
}

function transitiveVulnerablePackageMap(
  packages: readonly {
    registry: string;
    name: string;
    versions: string[];
    affectedCount: number;
    maxSeverityScore?: number;
    maxSeverityLabel?: string;
    advisoryIds: string[];
    advisoryOccurrences?: TransitiveDependencyVulnerability[];
  }[],
): Map<string, TransitivePackageDiffEntry> {
  const map = new Map<string, TransitivePackageDiffEntry>();
  for (const pkg of packages) {
    if (pkg.affectedCount <= 0) continue;
    const id = transitiveVulnerablePackageId(pkg);
    map.set(id, {
      id,
      registry: pkg.registry.toLowerCase(),
      name: pkg.name,
      versions: pkg.versions,
      affectedCount: pkg.affectedCount,
      maxSeverityScore: pkg.maxSeverityScore,
      maxSeverityLabel: pkg.maxSeverityLabel,
      advisoryIds: pkg.advisoryIds,
      advisoryKeys: transitiveAdvisoryKeys(pkg),
    });
  }
  return map;
}

function transitiveAdvisoryKeys(pkg: {
  advisoryIds: string[];
  advisoryOccurrences?: TransitiveDependencyVulnerability[];
}): string[] {
  const occurrenceKeys = (pkg.advisoryOccurrences ?? []).map((occurrence) =>
    advisoryKey(occurrence.advisory),
  );
  const occurrenceIds = new Set(
    (pkg.advisoryOccurrences ?? []).flatMap((occurrence) => [
      occurrence.advisory.osvId,
      ...(occurrence.advisory.aliases ?? []),
    ]),
  );
  const rawFallbackIds = pkg.advisoryIds.filter((id) => !occurrenceIds.has(id));
  return [...new Set([...occurrenceKeys, ...rawFallbackIds])].sort();
}

function toPublicTransitivePackage(
  pkg: TransitivePackageDiffEntry | undefined,
): UpgradeTransitiveVulnerablePackage | undefined {
  if (!pkg) return undefined;
  const { advisoryKeys: _advisoryKeys, ...publicPackage } = pkg;
  return publicPackage;
}

function transitiveVulnerablePackageId(pkg: {
  registry: string;
  name: string;
}): string {
  return `${pkg.registry.toLowerCase()}:${pkg.name}`;
}

function buildDependencyIssues(
  current: DependencyIssuesSummary | undefined,
  target: DependencyIssuesSummary | undefined,
  options: PackageUpgradeReviewOptions,
  rootPackage: UpgradeReviewPackageRequest,
): UpgradeDependencyIssues | undefined {
  if (!options.includeDependencyIssues || (!current && !target))
    return undefined;
  const currentDeprecated = issueSet(current?.deprecatedPackages ?? []);
  const targetDeprecated = issueSet(target?.deprecatedPackages ?? []);
  const currentDuplicates = issueSet(current?.duplicatePackages ?? []);
  const targetDuplicates = issueSet(target?.duplicatePackages ?? []);
  const currentConflicts = issueSet(current?.conflicts ?? []);
  const targetConflicts = issueSet(target?.conflicts ?? []);
  const currentOutdated = issueSet(
    (current?.outdatedPackages ?? []).filter(
      (pkg) => !isRootPackageIssue(pkg, rootPackage),
    ),
  );
  const targetOutdated = issueSet(
    (target?.outdatedPackages ?? []).filter(
      (pkg) => !isRootPackageIssue(pkg, rootPackage),
    ),
  );
  const introducedDeprecated = diffSet(targetDeprecated, currentDeprecated);
  const introducedDuplicates = diffSet(targetDuplicates, currentDuplicates);
  const introducedConflicts = diffSet(targetConflicts, currentConflicts);
  const introducedOutdated = diffSet(targetOutdated, currentOutdated);
  return {
    currentTotal: current?.totalCount ?? 0,
    targetTotal: target?.totalCount ?? 0,
    introducedDeprecated,
    introducedDuplicates,
    introducedConflicts,
    introducedOutdated,
  };
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

function buildDependencyChanges(
  current: DependencyReport | undefined,
  target: DependencyReport | undefined,
  rootPackage: UpgradeReviewPackageRequest,
): UpgradeDependencyChanges | undefined {
  if (!current && !target) return undefined;
  return {
    direct: diffDependencyMaps(
      directDependencyMap(current),
      directDependencyMap(target),
    ),
    transitive: diffDependencyMaps(
      transitiveDependencyMap(current, rootPackage),
      transitiveDependencyMap(target, rootPackage),
    ),
  };
}

function directDependencyMap(
  report: DependencyReport | undefined,
): Map<string, UpgradeDependencyChangeItem> {
  const entries = report?.dependencies?.direct ?? [];
  const map = new Map<string, UpgradeDependencyChangeItem>();
  for (const dep of entries) {
    const key = `direct:${dep.name}`;
    map.set(key, {
      name: dep.name,
      constraint: dep.versionConstraint,
      type: dep.type,
      version: dep.versionConstraint,
      fromVersions: dep.versionConstraint ? [dep.versionConstraint] : [],
      toVersions: dep.versionConstraint ? [dep.versionConstraint] : [],
    });
  }
  return map;
}

function transitiveDependencyMap(
  report: DependencyReport | undefined,
  rootPackage: UpgradeReviewPackageRequest,
): Map<string, UpgradeDependencyChangeItem> {
  const nodes = report?.dependencies?.transitive?.dependencyGraph?.nodes ?? [];
  const map = new Map<string, UpgradeDependencyChangeItem>();
  for (const node of nodes) {
    const registry = node.registry.toLowerCase();
    if (registry === "synthetic") continue;
    if (
      registry === rootPackage.registryLabel &&
      node.name === rootPackage.packageName
    )
      continue;
    const key = `${registry}:${node.name}`;
    const existing = map.get(key);
    const versions = new Set(existing?.toVersions ?? []);
    if (node.version) versions.add(node.version);
    map.set(key, {
      registry,
      name: node.name,
      version: node.version,
      fromVersions: existing?.fromVersions ?? [],
      toVersions: [...versions].sort(compareVersionStrings),
    });
  }
  return map;
}

function diffDependencyMaps(
  current: Map<string, UpgradeDependencyChangeItem>,
  target: Map<string, UpgradeDependencyChangeItem>,
): UpgradeDependencyChangeGroup {
  const added: UpgradeDependencyChangeItem[] = [];
  const removed: UpgradeDependencyChangeItem[] = [];
  const changed: UpgradeDependencyChangeItem[] = [];

  for (const [key, currentItem] of current) {
    const targetItem = target.get(key);
    if (!targetItem) {
      removed.push(withVersionDirection(currentItem, "from"));
      continue;
    }
    const fromVersions = itemVersions(currentItem);
    const toVersions = itemVersions(targetItem);
    if (!sameStringArray(fromVersions, toVersions)) {
      changed.push({
        name: targetItem.name,
        registry: targetItem.registry ?? currentItem.registry,
        type: targetItem.type ?? currentItem.type,
        constraint: targetItem.constraint,
        fromVersions,
        toVersions,
      });
    }
  }

  for (const [key, targetItem] of target) {
    if (!current.has(key)) added.push(withVersionDirection(targetItem, "to"));
  }

  return {
    added: sortDependencyItems(added),
    removed: sortDependencyItems(removed),
    changed: sortDependencyItems(changed),
  };
}

function withVersionDirection(
  item: UpgradeDependencyChangeItem,
  direction: "from" | "to",
): UpgradeDependencyChangeItem {
  const versions = itemVersions(item);
  return {
    ...item,
    fromVersions: direction === "from" ? versions : [],
    toVersions: direction === "to" ? versions : [],
  };
}

function itemVersions(item: UpgradeDependencyChangeItem): string[] {
  const versions = item.toVersions?.length
    ? item.toVersions
    : item.fromVersions?.length
      ? item.fromVersions
      : item.version
        ? [item.version]
        : item.constraint
          ? [item.constraint]
          : [];
  return [...new Set(versions)].sort(compareVersionStrings);
}

function sameStringArray(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((value, index) => value === b[index]);
}

function sortDependencyItems<T extends UpgradeDependencyChangeItem>(
  items: T[],
): T[] {
  return items
    .slice()
    .sort((a, b) => dependencyLabel(a).localeCompare(dependencyLabel(b)));
}

function dependencyLabel(item: UpgradeDependencyChangeItem): string {
  return `${item.registry ?? ""}:${item.name}`;
}

function compareVersionStrings(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

function isRootPackageIssue(
  pkg: { registry?: string; name: string },
  rootPackage: UpgradeReviewPackageRequest,
): boolean {
  return (
    pkg.name === rootPackage.packageName &&
    (pkg.registry === undefined ||
      pkg.registry.toLowerCase() === rootPackage.registryLabel.toLowerCase())
  );
}

function issueSet(
  packages: readonly {
    registry?: string;
    name: string;
    versions: Array<string | { version: string }>;
  }[],
): Set<string> {
  return new Set(
    packages.map(
      (pkg) =>
        `${pkg.registry ?? "unknown"}:${pkg.name}@${pkg.versions
          .map((version) =>
            typeof version === "string" ? version : version.version,
          )
          .join(",")}`,
    ),
  );
}

function diffSet(target: Set<string>, current: Set<string>): string[] {
  return [...target].filter((key) => !current.has(key)).sort();
}

function buildCompatibility(
  current: DependencyReport | undefined,
  target: DependencyReport | undefined,
): UpgradeCompatibility | undefined {
  const currentPeers = groupSignatureSet(current);
  const targetPeers = groupSignatureSet(target);
  const added = [...targetPeers]
    .filter((entry) => !currentPeers.has(entry))
    .map((entry) => `added ${entry}`);
  const removed = [...currentPeers]
    .filter((entry) => !targetPeers.has(entry))
    .map((entry) => `removed ${entry}`);
  const peerDependencyChanges = [...added, ...removed].sort();
  if (peerDependencyChanges.length === 0) return undefined;
  return {
    peerDependencyChanges,
    notes: [
      "Consumer-project compatibility cannot be determined from package metadata alone.",
    ],
  };
}

function groupSignatureSet(report: DependencyReport | undefined): Set<string> {
  const groups = report?.dependencyGroups?.groups ?? [];
  return new Set(
    groups
      .filter((group) => group.lifecycle === "peer")
      .flatMap((group) =>
        group.dependencies.map((dep) => `${dep.name}@${dep.constraint ?? "*"}`),
      ),
  );
}

function hasDirectDependencyChurn(
  changes: UpgradeDependencyChanges | undefined,
): boolean {
  if (!changes) return false;
  return (
    changes.direct.added.length > 0 ||
    changes.direct.removed.length > 0 ||
    changes.direct.changed.length > 0
  );
}

function hasBreakingSignals(changelog: UpgradeChangelog): boolean {
  return (
    changelog.breakingSignals.length > 0 ||
    changelog.migrationSignals.length > 0
  );
}

function classifyVersionDelta(current: string, target: string): VersionDelta {
  const a = parseVersion(current);
  const b = parseVersion(target);
  if (!a || !b) return "unknown";
  const cmp = compareParsedVersions(a, b);
  if (cmp > 0) return "downgrade";
  if (cmp === 0) return "same";
  if (b.prerelease && !a.prerelease) return "prerelease";
  if (a.major !== b.major) return "major";
  if (a.minor !== b.minor) return "minor";
  if (a.patch !== b.patch) return "patch";
  return "unknown";
}

function parseVersion(
  value: string,
):
  | { major: number; minor: number; patch: number; prerelease?: string }
  | undefined {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+]([^\s]+))?$/i.exec(value);
  if (!match) return undefined;
  return {
    major: Number.parseInt(match[1] ?? "0", 10),
    minor: Number.parseInt(match[2] ?? "0", 10),
    patch: Number.parseInt(match[3] ?? "0", 10),
    prerelease: match[4],
  };
}

function compareParsedVersions(
  a: { major: number; minor: number; patch: number },
  b: { major: number; minor: number; patch: number },
): number {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

async function runWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let next = 0;
  const workers = Array.from(
    { length: Math.max(1, Math.min(concurrency, items.length)) },
    async () => {
      while (next < items.length) {
        const index = next++;
        const item = items[index];
        if (item !== undefined) results[index] = await fn(item);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

type Captured<T> = { ok: true; value: T } | { ok: false; error: unknown };

async function capture<T>(fn: () => Promise<T>): Promise<Captured<T>> {
  try {
    return { ok: true, value: await fn() };
  } catch (error) {
    return { ok: false, error };
  }
}

function formatCapturedError(error: unknown): string {
  const mapped = mapPackageIntelligenceError(error);
  return `${mapped.code}: ${mapped.message}`;
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
    `  transitive package advisories: current affected packages=${transitive.currentAffected}, target affected packages=${transitive.targetAffected}, fixed packages=${transitive.fixedPackageDetails.length}, added packages=${transitive.introducedPackageDetails.length}`,
  ];
  const limit = options.verbose ? Number.POSITIVE_INFINITY : 5;
  appendTransitivePackageLines(
    lines,
    "added affected packages",
    transitive.introducedPackageDetails,
    limit,
  );
  appendTransitivePackageLines(
    lines,
    "still affected packages",
    transitive.stillAffectedPackageDetails,
    limit,
  );
  appendTransitivePackageLines(
    lines,
    "fixed affected packages",
    transitive.fixedPackageDetails,
    limit,
  );
  return lines;
}

function appendTransitivePackageLines(
  lines: string[],
  label: string,
  packages: UpgradeTransitiveVulnerablePackage[],
  limit: number,
): void {
  if (packages.length === 0) return;
  lines.push(`  ${label}:`);
  for (const pkg of packages.slice(0, limit)) {
    lines.push(`    - ${formatTransitivePackage(pkg)}`);
  }
  const remaining = packages.length - limit;
  if (remaining > 0)
    lines.push(`    - ... +${remaining} more with verbose output`);
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
