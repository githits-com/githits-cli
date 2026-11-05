/**
 * Hand-crafted response envelope for the `package_vulnerabilities`
 * tool. Shared by CLI `--json`, CLI terminal output, and MCP
 * `content[0].text`.
 *
 * Key design commitments (locked in the plan):
 * - Backend is the single source of truth for counts. `minSeverity`
 *   and `includeWithdrawn` are passed through on the wire; the
 *   backend returns version-aware affected/non-affecting/unknown/all
 *   advisory counts. `summary.total` is the affected count for the inspected
 *   version, not historical package advisory volume.
 * - Alias-cluster dedup runs before bucketing. Some registries (most
 *   visibly Crates) return both the GHSA-prefixed and the
 *   RUSTSEC-prefixed entry for the same underlying vulnerability;
 *   `aliases[]` carries the cross-link. The builder unions clusters
 *   over `id ∪ aliases`, picks one canonical advisory per cluster
 *   (severity-bearing entries first, then GHSA over RUSTSEC, then
 *   lexicographic `id`), and merges the rest under the canonical's
 *   `aliases`. Both `summary.total` and `summary.bySeverity` are
 *   recomputed from the deduped list — the partition invariant
 *   (bucket sum equals total) is preserved post-dedup. This is a
 *   client-side mitigation for backend issue B3; remove once the
 *   backend dedups upstream.
 * - Malware bucket is disjoint from severity bands. `summary.bySeverity`
 *   carries a `malware` key counting `isMalicious === true` advisories;
 *   severity bands count non-malicious advisories only. Non-malicious
 *   advisories with no CVSS score fall into a disjoint `unrated`
 *   bucket so every returned advisory is accounted for. The buckets
 *   always partition `security.vulnerabilities[]` after dedup.
 * - `requestedVersion` surfaces whenever the backend-resolved
 *   `version` differs from the normalized request. Exact Go versions
 *   are canonicalized by the shared request boundary; Swift normalization
 *   remains backend-owned and should stay visible as `requestedVersion`
 *   when it differs from the resolved version.
 * - `modifiedAt` is included only when it differs from `publishedAt`.
 * - Sort order: malware bucket first; within a bucket, severity desc,
 *   then `publishedAt` desc, then `osvId` asc (deterministic
 *   tiebreaker). Withdrawn advisories bucket below all active.
 */

import type {
  RegistryRepository,
  TransitiveDependencyVulnerability,
  TransitiveVulnerabilityAuditCounts,
  VulnerabilityDetail,
  VulnerabilityReport,
  VulnerabilitySourceEntry,
} from "@githits/core-internal";
import { toPkgseerRegistryLowercase } from "@githits/core-internal";
import { colorize, dim } from "./colors.js";
import { toIsoDate } from "./format-date.js";
import {
  formatPackageSourceDetails,
  type PackageSourceDetailDisplay,
} from "./osv-source-details.js";
import type {
  AdvisoryScopeLabel,
  PackageVulnerabilitiesFilterEcho,
} from "./package-vulnerabilities-request.js";
import { shellQuoteExact } from "./shell-quote.js";
import { sanitizeTerminalText, wrapTerminalProse } from "./terminal-text.js";
import { terminalWidth as measureTerminalWidth } from "./terminal-width.js";
import {
  formatAdvisoryAssessment,
  formatAssessmentUncertainty,
  formatVulnerabilityAssessmentReason,
  isAssessmentStatusImplied,
} from "./vulnerability-assessment.js";

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
  affectedVersionRangesCount?: number;
  affectedVersionRangesTruncated?: boolean;
  affectsInspectedVersion?: boolean;
  assessmentStatus?: string;
  assessmentReasons?: string[];
  matchedAffectedVersionRanges?: string[];
  duplicateIds?: string[];
  fixedIn?: string[];
  publishedAt?: string;
  modifiedAt?: string;
  withdrawnAt?: string;
  isMalicious?: boolean;
}

export interface LeanTransitiveVulnerabilityAudit {
  scope: "resolved_dependencies";
  advisoryScope: AdvisoryScopeLabel;
  withdrawnAdvisoriesIncluded: false;
  summary: {
    totalPackagesAnalyzed: number;
    packageCount: number;
    occurrenceCount: number;
    affectedCount: number;
    nonAffectingCount: number;
    unknownCount: number;
    totalCount: number;
    bySeverity?: Partial<Record<VulnBucket, number>>;
  };
  calculatedAt?: string;
  packages: LeanTransitiveVulnerablePackage[];
}

export interface LeanTransitiveVulnerablePackage {
  affectedCount?: number;
  nonAffectingCount?: number;
  unknownCount?: number;
  registry: string;
  name: string;
  occurrenceCount: number;
  occurrences: LeanTransitiveVulnerabilityOccurrence[];
}

export interface LeanTransitiveVulnerabilityOccurrence {
  assessmentStatus?: string;
  assessmentReasons?: string[];
  resolvedVersion: string;
  affectsResolvedVersion: boolean;
  id?: string;
  aliases?: string[];
  summary?: string;
  severity?: number;
  severityLabel?: VulnSeverityLabel;
  affectedRanges?: string[];
  fixedIn?: string[];
  matchedAffectedVersionRanges: string[];
  fixVersionsAboveResolved: string[];
  nearestFixedVersion?: string;
  publishedAt?: string;
  modifiedAt?: string;
  isMalicious?: true;
}

export interface LeanVulnerabilitySummary {
  /** Affected advisories for the inspected version. Kept for compatibility. */
  total: number;
  unknownVulnerabilityCount?: number;
  assessmentStatus?: string;
  affectedVulnerabilityCount?: number;
  nonAffectingVulnerabilityCount?: number;
  allVulnerabilityCount?: number;
  affected?: boolean;
  bySeverity?: Partial<Record<VulnBucket, number>>;
}

export interface LeanVulnerabilityReport {
  sourceDetails?: VulnerabilitySourceEntry[];
  registry: string;
  name: string;
  version: string;
  registryRepository?: RegistryRepository;
  requestedVersion?: string;
  summary: LeanVulnerabilitySummary;
  filter?: PackageVulnerabilitiesFilterEcho;
  advisories?: LeanAdvisory[];
  upgradePaths?: string[];
  transitive?: LeanTransitiveVulnerabilityAudit;
}

export interface BuildVulnerabilitiesPayloadOptions {
  /** Canonical requested version sent to the backend. */
  requestedVersion?: string;
  /** Caller-supplied filters, echoed from shared request parsing. */
  filter?: PackageVulnerabilitiesFilterEcho;
}

export const DEFAULT_ADVISORY_CAP = 5;

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

  // Dedup before counting: alias-clustered duplicates (GHSA + RUSTSEC
  // pairs on Crates, mainly) collapse to one canonical advisory each.
  // `total` and `bySeverity` are derived from the deduped list so the
  // partition invariant holds.
  //
  const dedupedAdvisories = dedupAdvisoriesByAlias(
    security?.vulnerabilities ?? [],
  );
  const total =
    security?.affectedVulnerabilityCount ?? dedupedAdvisories.length;

  const payload: LeanVulnerabilityReport = {
    registry: lowerRegistry(pkg.registry),
    name: pkg.name,
    version: pkg.version,
    summary: buildSummary(total, security, dedupedAdvisories),
  };
  if (report.sourceDetails !== undefined)
    payload.sourceDetails = report.sourceDetails;
  if (pkg.registryRepository)
    payload.registryRepository = pkg.registryRepository;

  const requestedEcho = deriveRequestedVersion(
    options.requestedVersion,
    pkg.version,
  );
  if (requestedEcho !== undefined) {
    payload.requestedVersion = requestedEcho;
  }

  if (options.filter !== undefined) {
    payload.filter = options.filter;
  }

  const sortedAdvisories = sortAdvisories(dedupedAdvisories.map(buildAdvisory));
  if (sortedAdvisories.length > 0) {
    payload.advisories = sortedAdvisories;
  }

  const upgradePaths = security?.upgradePaths;
  if (upgradePaths && upgradePaths.length > 0) {
    // Ascending semver-ish order (pre-releases sort below their base
    // version) for predictable display of backend-filtered candidate fixes.
    // This ordering does not establish release existence or upgrade suitability.
    const unique = Array.from(new Set(upgradePaths));
    unique.sort(compareVersionsAscending);
    payload.upgradePaths = unique;
  }

  if (report.transitive !== undefined) {
    payload.transitive = buildTransitiveAudit(report.transitive);
  }

  return payload;
}

/**
 * Stable, locale-independent version compare used to sort upgrade
 * paths. Handles semver-ish `MAJOR.MINOR.PATCH[-pre]` shapes, including
 * Swift's common `vMAJOR.MINOR.PATCH` tag form, well enough for display
 * ordering. Unparseable segments fall back to lexicographic compare so
 * exotic strings never crash the pipeline.
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
  const [rawMainStr, ...preParts] = v.split("-");
  const pre = preParts.length > 0 ? preParts.join("-") : undefined;
  const mainStr = rawMainStr?.replace(/^v(?=\d)/i, "");
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
  dedupedAdvisories: readonly VulnerabilityDetail[],
): LeanVulnerabilitySummary {
  const summary: LeanVulnerabilitySummary = { total };
  if (security) {
    summary.affectedVulnerabilityCount = security.affectedVulnerabilityCount;
    summary.nonAffectingVulnerabilityCount =
      security.nonAffectingVulnerabilityCount;
    summary.allVulnerabilityCount = security.allVulnerabilityCount;
    summary.unknownVulnerabilityCount = security.unknownVulnerabilityCount;
    summary.assessmentStatus = security.assessmentStatus;
  }

  if (typeof security?.currentVersionAffected === "boolean") {
    summary.affected = security.currentVersionAffected;
  }

  if (dedupedAdvisories.length === 0) return summary;

  const bySeverity = computeBySeverity(dedupedAdvisories);
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

function buildTransitiveAudit(
  audit: NonNullable<VulnerabilityReport["transitive"]>,
): LeanTransitiveVulnerabilityAudit {
  const packages = audit.packages
    .map((pkg) => ({
      registry: lowerRegistry(pkg.registry),
      name: pkg.name,
      occurrenceCount: pkg.occurrenceCount,
      ...(audit.advisoryScope !== "ALL" &&
      audit.advisoryScope !== "AFFECTED" &&
      pkg.affectedCount > 0
        ? { affectedCount: pkg.affectedCount }
        : {}),
      ...(audit.advisoryScope !== "ALL" &&
      audit.advisoryScope !== "NON_AFFECTING" &&
      pkg.nonAffectingCount > 0
        ? { nonAffectingCount: pkg.nonAffectingCount }
        : {}),
      ...(audit.advisoryScope !== "ALL" &&
      audit.advisoryScope !== "UNKNOWN" &&
      pkg.unknownCount > 0
        ? { unknownCount: pkg.unknownCount }
        : {}),
      occurrences: pkg.occurrences
        .map(buildTransitiveOccurrence)
        .sort(compareTransitiveOccurrences),
    }))
    .sort(compareTransitivePackages);

  const occurrences = packages.flatMap((pkg) => pkg.occurrences);
  const bySeverity = computeTransitiveBySeverity(occurrences);
  const hasCountedSeverity = Object.values(bySeverity).some(
    (count) => count > 0,
  );

  return {
    scope: "resolved_dependencies",
    advisoryScope: toAdvisoryScopeLabel(audit.advisoryScope),
    withdrawnAdvisoriesIncluded: false,
    summary: {
      totalPackagesAnalyzed: audit.totalPackagesAnalyzed,
      packageCount: audit.packageCount,
      occurrenceCount: audit.occurrenceCount,
      affectedCount: audit.affectedCount,
      nonAffectingCount: audit.nonAffectingCount,
      unknownCount: audit.unknownCount,
      totalCount: audit.totalCount,
      ...(hasCountedSeverity
        ? { bySeverity: trimSeverityBuckets(bySeverity) }
        : {}),
    },
    ...(audit.calculatedAt !== undefined
      ? { calculatedAt: audit.calculatedAt }
      : {}),
    packages,
  };
}

function buildTransitiveOccurrence(
  occurrence: TransitiveDependencyVulnerability,
): LeanTransitiveVulnerabilityOccurrence {
  const advisory = occurrence.advisory;
  const publishedAt = toIsoDate(advisory.publishedAt);
  const modifiedAt = toIsoDate(advisory.modifiedAt);
  const lean: LeanTransitiveVulnerabilityOccurrence = {
    resolvedVersion: occurrence.version,
    affectsResolvedVersion: occurrence.affectsResolvedVersion,
    matchedAffectedVersionRanges:
      occurrence.matchedAffectedVersionRanges.slice(),
    fixVersionsAboveResolved: occurrence.fixVersionsAboveResolved.slice(),
  };

  if (
    !isAssessmentStatusImplied(
      occurrence.assessmentStatus,
      occurrence.affectsResolvedVersion,
    )
  )
    lean.assessmentStatus = occurrence.assessmentStatus;
  if (occurrence.assessmentReasons?.length)
    lean.assessmentReasons = occurrence.assessmentReasons.slice();

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
    const severityLabel = vulnSeverityLabel(advisory.severityScore);
    if (severityLabel !== undefined) lean.severityLabel = severityLabel;
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
  if (occurrence.nearestFixedVersion) {
    lean.nearestFixedVersion = occurrence.nearestFixedVersion;
  }
  if (publishedAt) lean.publishedAt = publishedAt;
  if (modifiedAt && modifiedAt !== publishedAt) lean.modifiedAt = modifiedAt;
  if (advisory.isMalicious === true) lean.isMalicious = true;

  return lean;
}

function toAdvisoryScopeLabel(
  scope: NonNullable<VulnerabilityReport["transitive"]>["advisoryScope"],
): AdvisoryScopeLabel {
  if (scope === "NON_AFFECTING") return "non_affecting";
  if (scope === "UNKNOWN") return "unknown";
  return scope === "ALL" ? "all" : "affected";
}

function computeTransitiveBySeverity(
  occurrences: readonly LeanTransitiveVulnerabilityOccurrence[],
): Record<VulnBucket, number> {
  const histogram: Record<VulnBucket, number> = {
    malware: 0,
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    unrated: 0,
  };
  for (const occurrence of occurrences) {
    if (occurrence.isMalicious === true) {
      histogram.malware += 1;
      continue;
    }
    if (occurrence.severityLabel !== undefined) {
      histogram[occurrence.severityLabel] += 1;
    } else {
      histogram.unrated += 1;
    }
  }
  return histogram;
}

function trimSeverityBuckets(
  histogram: Record<VulnBucket, number>,
): Partial<Record<VulnBucket, number>> {
  const trimmed: Partial<Record<VulnBucket, number>> = {};
  for (const key of BUCKET_ORDER) {
    if (histogram[key] > 0) trimmed[key] = histogram[key];
  }
  return trimmed;
}

function compareTransitivePackages(
  a: Pick<LeanTransitiveVulnerablePackage, "registry" | "name">,
  b: Pick<LeanTransitiveVulnerablePackage, "registry" | "name">,
): number {
  const registry = compareStrings(a.registry, b.registry);
  return registry !== 0 ? registry : compareStrings(a.name, b.name);
}

function compareTransitiveOccurrences(
  a: LeanTransitiveVulnerabilityOccurrence,
  b: LeanTransitiveVulnerabilityOccurrence,
): number {
  const risk = transitiveRiskRank(b) - transitiveRiskRank(a);
  if (risk !== 0) return risk;
  const version = compareStrings(a.resolvedVersion, b.resolvedVersion);
  if (version !== 0) return version;
  const identity = compareStrings(
    transitiveAdvisoryIdentity(a),
    transitiveAdvisoryIdentity(b),
  );
  if (identity !== 0) return identity;
  const aliases = compareStrings(
    (a.aliases ?? []).join("\u0000"),
    (b.aliases ?? []).join("\u0000"),
  );
  if (aliases !== 0) return aliases;
  return compareStrings(JSON.stringify(a), JSON.stringify(b));
}

function transitiveAdvisoryIdentity(
  occurrence: LeanTransitiveVulnerabilityOccurrence,
): string {
  return occurrence.id ?? occurrence.aliases?.[0] ?? occurrence.summary ?? "";
}

function transitiveRiskRank(
  occurrence: LeanTransitiveVulnerabilityOccurrence,
): number {
  const severityRank = occurrence.severityLabel
    ? SEVERITY_RANK[occurrence.severityLabel]
    : 0;
  return (occurrence.isMalicious === true ? 100 : 0) + severityRank;
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
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
// Alias-cluster dedup
// --------------------------------------------------------------------

/**
 * Collapse advisories that share an `id`/`aliases` identifier into one
 * canonical entry per cluster. The merged entry:
 *   - unions `aliases`, `affectedVersionRanges`, and `fixedInVersions`;
 *   - reports the **maximum** `severityScore` across the cluster
 *     (security tooling errs toward the more conservative band when
 *     OSV and RUSTSEC disagree);
 *   - tracks the latest `modifiedAt` actually present (no fallback to
 *     `publishedAt` — a sibling without a real modification timestamp
 *     does not advance the merged record);
 *   - inherits the malware flag from any member that carries it;
 *   - keeps the withdrawn flag only when **every** cluster member is
 *     withdrawn (a single active member means the vulnerability is
 *     still tracked under at least one source).
 *
 * Canonical preference (deterministic, used to pick the entry whose
 * non-merged fields — `osvId`, `summary`, `publishedAt` — survive):
 *   1. Member with a positive CVSS score wins over a member without.
 *   2. Among severity-bearing members (or among score-less members),
 *      `GHSA-*` ids beat `RUSTSEC-*` and other prefixes.
 *   3. Tiebreak on lexicographic `osvId` ascending.
 *
 * Members without an `osvId` and without aliases are passed through as
 * singleton clusters — they cannot link to anything else. Empty input
 * returns an empty array.
 */
export function dedupAdvisoriesByAlias(
  advisories: readonly VulnerabilityDetail[],
): VulnerabilityDetail[] {
  if (advisories.length === 0) return [];

  // Union-find over identifier strings. Each advisory's `osvId` and
  // every alias becomes a node; sharing any node merges the clusters.
  // Every node passed to `union` is `ensure()`d first, so `parent.get`
  // never returns `undefined` for a known id.
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    let root = id;
    let next = parent.get(root);
    while (next !== undefined && next !== root) {
      root = next;
      next = parent.get(root);
    }
    // Path compression: walk again, pointing each node directly at root.
    let cursor = id;
    while (cursor !== root) {
      const parentOfCursor = parent.get(cursor);
      if (parentOfCursor === undefined) break;
      parent.set(cursor, root);
      cursor = parentOfCursor;
    }
    return root;
  };
  const union = (a: string, b: string): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  const ensure = (id: string): void => {
    if (!parent.has(id)) parent.set(id, id);
  };

  // Track the per-advisory primary identifier so we can group entries
  // back into their cluster after the union pass. Advisories with
  // neither id nor aliases get a synthetic key so they remain a
  // singleton cluster.
  const advisoryKeys: string[] = [];
  for (let i = 0; i < advisories.length; i++) {
    const advisory = advisories[i];
    if (!advisory) {
      advisoryKeys.push(`__synthetic_${i}`);
      continue;
    }
    const ids: string[] = [];
    if (advisory.osvId) ids.push(advisory.osvId);
    for (const alias of advisory.aliases ?? []) {
      if (alias) ids.push(alias);
    }
    if (ids.length === 0) {
      const synthetic = `__synthetic_${i}`;
      ensure(synthetic);
      advisoryKeys.push(synthetic);
      continue;
    }
    for (const id of ids) ensure(id);
    for (let j = 1; j < ids.length; j++) {
      const a = ids[j - 1];
      const b = ids[j];
      if (a !== undefined && b !== undefined) union(a, b);
    }
    advisoryKeys.push(ids[0] as string);
  }

  // Group advisories by cluster root, preserving the input order of
  // first appearance so the eventual sort step gets a stable seed.
  const clusters = new Map<string, VulnerabilityDetail[]>();
  for (let i = 0; i < advisories.length; i++) {
    const advisory = advisories[i];
    if (!advisory) continue;
    const key = advisoryKeys[i];
    if (key === undefined) continue;
    const root = find(key);
    const bucket = clusters.get(root);
    if (bucket) bucket.push(advisory);
    else clusters.set(root, [advisory]);
  }

  const merged: VulnerabilityDetail[] = [];
  for (const cluster of clusters.values()) {
    merged.push(mergeAdvisoryCluster(cluster));
  }
  return merged;
}

function mergeAdvisoryCluster(
  cluster: readonly VulnerabilityDetail[],
): VulnerabilityDetail {
  if (cluster.length === 1) {
    const only = cluster[0];
    if (!only) throw new Error("empty advisory cluster"); // unreachable
    return only;
  }

  const canonical = pickCanonical(cluster);

  // Union of all known identifiers across the cluster, with the
  // canonical's own `osvId` removed from the alias list (it lives on
  // `osvId` instead).
  const aliasSet = new Set<string>();
  for (const member of cluster) {
    if (member.osvId) aliasSet.add(member.osvId);
    for (const alias of member.aliases ?? []) {
      if (alias) aliasSet.add(alias);
    }
  }
  if (canonical.osvId) aliasSet.delete(canonical.osvId);
  const aliases = Array.from(aliasSet).sort();

  const affectedRangesSet = new Set<string>();
  const matchedAffectedRangesSet = new Set<string>();
  const fixedInSet = new Set<string>();
  const duplicateIdsSet = new Set<string>();
  const assessmentReasons = new Set<string>();
  let isMalicious = false;
  let affectsInspectedVersion = false;
  const assessmentPrecedence: Record<string, number> = {
    AFFECTED: 3,
    UNKNOWN: 2,
    NON_AFFECTING: 1,
  };
  let assessmentStatus = canonical.assessmentStatus;
  let affectedVersionRangesTruncated = false;
  let affectedVersionRangesCount = 0;
  // Latest `modifiedAt` wins, but only counts entries that explicitly
  // carry one — a sibling whose `modifiedAt` is absent should not
  // promote its `publishedAt` into the merged record.
  let latestModifiedAt: string | undefined = canonical.modifiedAt;
  let withdrawnAt: string | undefined;
  let allWithdrawn = true;
  // Take the maximum severity score across the cluster. OSV and
  // RUSTSEC occasionally disagree on the score for the same CVE; the
  // safer choice for security tooling is the higher band, not the
  // canonical's score (which may be lower because GHSA wins the
  // canonical-pick on a prefix tiebreaker).
  let maxSeverityScore =
    typeof canonical.severityScore === "number" ? canonical.severityScore : 0;

  for (const member of cluster) {
    if (
      member.assessmentStatus !== undefined &&
      (assessmentStatus === undefined ||
        (assessmentPrecedence[member.assessmentStatus] ?? 2) >
          (assessmentPrecedence[assessmentStatus] ?? 2))
    )
      assessmentStatus = member.assessmentStatus;
    for (const reason of member.assessmentReasons ?? [])
      assessmentReasons.add(reason);
    for (const range of member.affectedVersionRanges ?? []) {
      affectedRangesSet.add(range);
    }
    for (const range of member.matchedAffectedVersionRanges ?? []) {
      matchedAffectedRangesSet.add(range);
    }
    for (const fix of member.fixedInVersions ?? []) {
      fixedInSet.add(fix);
    }
    for (const duplicateId of member.duplicateIds ?? []) {
      duplicateIdsSet.add(duplicateId);
    }
    if (member.isMalicious === true) isMalicious = true;
    if (member.affectsInspectedVersion === true) affectsInspectedVersion = true;
    if (member.affectedVersionRangesTruncated === true) {
      affectedVersionRangesTruncated = true;
    }
    if (typeof member.affectedVersionRangesCount === "number") {
      affectedVersionRangesCount = Math.max(
        affectedVersionRangesCount,
        member.affectedVersionRangesCount,
      );
    }
    if (member.modifiedAt) {
      if (!latestModifiedAt || member.modifiedAt > latestModifiedAt) {
        latestModifiedAt = member.modifiedAt;
      }
    }
    if (member.withdrawnAt) {
      if (!withdrawnAt || member.withdrawnAt > withdrawnAt) {
        withdrawnAt = member.withdrawnAt;
      }
    } else {
      allWithdrawn = false;
    }
    // Withdrawn members don't contribute severity. The merged record
    // surfaces the highest *currently authoritative* score; promoting
    // a retracted advisory's score would mislead callers about an
    // active vulnerability that no longer claims that band.
    if (
      !member.withdrawnAt &&
      typeof member.severityScore === "number" &&
      member.severityScore > maxSeverityScore
    ) {
      maxSeverityScore = member.severityScore;
    }
  }

  const merged: VulnerabilityDetail = {
    ...canonical,
    aliases,
  };
  if (maxSeverityScore > 0) {
    merged.severityScore = maxSeverityScore;
  }
  if (affectedRangesSet.size > 0) {
    merged.affectedVersionRanges = Array.from(affectedRangesSet);
  }
  const exactOrLowerBoundCount = Math.max(
    affectedVersionRangesCount,
    affectedRangesSet.size,
  );
  if (exactOrLowerBoundCount > 0) {
    merged.affectedVersionRangesCount = exactOrLowerBoundCount;
  }
  if (affectedVersionRangesTruncated) {
    merged.affectedVersionRangesTruncated = true;
  }
  if (matchedAffectedRangesSet.size > 0) {
    merged.matchedAffectedVersionRanges = Array.from(matchedAffectedRangesSet);
  }
  if (affectsInspectedVersion) merged.affectsInspectedVersion = true;
  if (assessmentStatus !== undefined)
    merged.assessmentStatus = assessmentStatus;
  if (assessmentReasons.size > 0)
    merged.assessmentReasons = [...assessmentReasons];
  if (duplicateIdsSet.size > 0) {
    merged.duplicateIds = Array.from(duplicateIdsSet).sort();
  }
  if (fixedInSet.size > 0) {
    merged.fixedInVersions = Array.from(fixedInSet);
  }
  if (isMalicious) merged.isMalicious = true;
  // `buildAdvisory` later drops `modifiedAt` if it equals `publishedAt`,
  // so we only need to ensure the field reflects the latest real
  // modification timestamp here. The seed already filtered out the
  // "no modifiedAt anywhere in the cluster" case.
  if (latestModifiedAt) {
    merged.modifiedAt = latestModifiedAt;
  } else {
    delete merged.modifiedAt;
  }
  // Only mark the merged advisory as withdrawn when every cluster
  // member is withdrawn — a single non-withdrawn member means the
  // vulnerability is still active under at least one source.
  if (allWithdrawn && withdrawnAt) {
    merged.withdrawnAt = withdrawnAt;
  } else {
    delete merged.withdrawnAt;
  }
  return merged;
}

function pickCanonical(
  cluster: readonly VulnerabilityDetail[],
): VulnerabilityDetail {
  const ranked = cluster.slice().sort((a, b) => {
    const aHasScore =
      typeof a.severityScore === "number" && a.severityScore > 0 ? 1 : 0;
    const bHasScore =
      typeof b.severityScore === "number" && b.severityScore > 0 ? 1 : 0;
    if (aHasScore !== bHasScore) return bHasScore - aHasScore;

    const aRank = idPrefixRank(a.osvId);
    const bRank = idPrefixRank(b.osvId);
    if (aRank !== bRank) return aRank - bRank;

    const aId = a.osvId ?? "";
    const bId = b.osvId ?? "";
    if (aId !== bId) return aId < bId ? -1 : 1;
    return 0;
  });
  const winner = ranked[0];
  if (!winner) throw new Error("empty cluster passed to pickCanonical"); // unreachable
  return winner;
}

/**
 * Lower rank wins. GHSA carries severity reliably; RUSTSEC entries
 * round-tripped through OSV often lose it. Other prefixes fall back
 * to a generic bucket between the two known forms. A missing id is
 * the worst rank — it cannot be cited and rarely surfaces in
 * production (every backend-fed advisory carries an `osvId`).
 */
function idPrefixRank(id: string | undefined): number {
  if (!id) return 99; // fallback bucket — all real ids outrank this
  if (id.startsWith("GHSA-")) return 0;
  if (id.startsWith("RUSTSEC-")) return 2;
  return 1;
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
  if (typeof advisory.affectedVersionRangesCount === "number") {
    lean.affectedVersionRangesCount = advisory.affectedVersionRangesCount;
  }
  if (advisory.affectedVersionRangesTruncated === true) {
    lean.affectedVersionRangesTruncated = true;
  }
  if (
    !isAssessmentStatusImplied(
      advisory.assessmentStatus,
      advisory.affectsInspectedVersion,
    )
  )
    lean.assessmentStatus = advisory.assessmentStatus;
  if (advisory.assessmentReasons?.length)
    lean.assessmentReasons = advisory.assessmentReasons.slice();
  if (typeof advisory.affectsInspectedVersion === "boolean") {
    lean.affectsInspectedVersion = advisory.affectsInspectedVersion;
  }
  if (
    advisory.matchedAffectedVersionRanges &&
    advisory.matchedAffectedVersionRanges.length > 0
  ) {
    lean.matchedAffectedVersionRanges =
      advisory.matchedAffectedVersionRanges.slice();
  }
  if (advisory.duplicateIds && advisory.duplicateIds.length > 0) {
    lean.duplicateIds = advisory.duplicateIds.slice();
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
  // The request builder already canonicalized registry-specific syntax.
  // Any remaining divergence from the backend-resolved version is a real
  // signal the caller should see.
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
// Shared terminal/text formatter used by both CLI and MCP.
// --------------------------------------------------------------------

export type VulnerabilitiesTextSurface = "cli" | "mcp";

export interface FormatVulnerabilitiesTerminalOptions {
  verbose?: boolean;
  useColors?: boolean;
  requestedVersion?: string;
  filter?: PackageVulnerabilitiesFilterEcho;
  surface?: VulnerabilitiesTextSurface;
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
    filter: options.filter,
  });
  const useColors = options.useColors ?? false;
  const verbose = options.verbose ?? false;
  const surface = options.surface ?? "cli";

  const width = normaliseTerminalWidth(options.terminalWidth);
  const directId = payload.advisories?.find((advisory) => advisory.id)?.id;
  const dependencyId = payload.transitive
    ? flattenTransitiveRows(payload.transitive).find((row) => row.occurrence.id)
        ?.occurrence.id
    : undefined;
  const sourceBlock =
    payload.sourceDetails !== undefined
      ? formatPackageSourceDetails(sourceReportDisplay(report, payload), width)
      : payload.advisories?.length
        ? wrapTerminalProse(
            surface === "mcp"
              ? "Full advisory report: use details=true for all selected direct advisories (can be long)."
              : [
                  directId
                    ? `Full advisory report: ${advisoryReportCommand(directId)}`
                    : undefined,
                  "Full reports for all selected direct advisories: add --details (can be long).",
                ]
                  .filter(Boolean)
                  .join("\n"),
            width,
          ).join("\n")
        : undefined;
  const dependencySourceHint =
    (payload.transitive?.summary.occurrenceCount ?? 0) > 0 &&
    (payload.sourceDetails !== undefined || !payload.advisories?.length)
      ? wrapTerminalProse(
          surface === "mcp"
            ? `${payload.sourceDetails?.length ? "Source results cover selected direct advisories. " : ""}For dependency advisory reports, call pkg_vulns on the dependency registry:name@resolvedVersion with details=true.`
            : `${payload.sourceDetails?.length ? "Source results cover selected direct advisories. " : ""}${dependencyId ? `Full dependency advisory report: ${advisoryReportCommand(dependencyId)}` : ""}`,
          width,
        ).join("\n")
      : undefined;
  const headerLine = formatHeader(payload, useColors);
  const requestedLine = payload.requestedVersion
    ? dim(
        `(requested ${sanitizeIdentity(payload.requestedVersion)})`,
        useColors,
      )
    : undefined;
  const filterLines = formatFilterLines(payload.filter);
  const transitiveBlock =
    payload.transitive && report.transitive
      ? formatTransitiveAuditTerminal(payload.transitive, report.transitive, {
          verbose,
          useColors,
          surface,
          terminalWidth: options.terminalWidth,
          includeWithdrawn: payload.filter?.includeWithdrawn === true,
        })
      : undefined;

  if (payload.summary.total === 0) {
    const lines = [headerLine];
    if (requestedLine) lines.push(requestedLine);
    lines.push(...filterLines);
    lines.push(formatNoAffectedVulnerabilitiesLine(payload));
    lines.push(
      ...formatAssessmentLines(payload, surface, options.terminalWidth),
    );
    if (payload.advisories && payload.advisories.length > 0) {
      const rangeLimit = resolveAffectedRangesLimit(options.terminalWidth);
      lines.push(
        "",
        formatAdvisoryList(
          payload.advisories,
          verbose,
          useColors,
          rangeLimit,
          surface,
          options.terminalWidth,
        ),
      );
    }
    if (transitiveBlock) lines.push("", transitiveBlock);
    if (sourceBlock) lines.push("", sourceBlock);
    if (dependencySourceHint) lines.push("", dependencySourceHint);
    return `${lines.join("\n")}\n`;
  }

  const blocks: string[] = [];
  const headerBlock: string[] = [headerLine];
  if (requestedLine) headerBlock.push(requestedLine);
  headerBlock.push(...filterLines);
  headerBlock.push(formatSummaryLine(payload, useColors));
  const selectedAdvisoryCount = payload.advisories?.length ?? 0;
  const scope = payload.filter?.advisoryScope;
  const selectedCountLine = formatSelectedAdvisoryCountLine(
    selectedAdvisoryCount,
    scope,
  );
  if (selectedCountLine) headerBlock.push(selectedCountLine);
  const breakdown =
    scope === undefined
      ? formatBreakdownLine(payload.summary, useColors, options.terminalWidth)
      : undefined;
  if (breakdown) headerBlock.push(breakdown);
  headerBlock.push(
    ...formatAssessmentLines(payload, surface, options.terminalWidth),
  );
  blocks.push(headerBlock.join("\n"));

  if (payload.advisories && payload.advisories.length > 0) {
    const rangeLimit = resolveAffectedRangesLimit(options.terminalWidth);
    blocks.push(
      formatAdvisoryList(
        payload.advisories,
        verbose,
        useColors,
        rangeLimit,
        surface,
        options.terminalWidth,
      ),
    );
  }

  const upgradeFooter = formatUpgradeFooter(payload.upgradePaths);
  if (upgradeFooter) blocks.push(upgradeFooter);
  if (transitiveBlock) blocks.push(transitiveBlock);
  if (sourceBlock) blocks.push(sourceBlock);
  if (dependencySourceHint) blocks.push(dependencySourceHint);

  return `${blocks.join("\n\n")}\n`;
}

/** Package presentation owns group order; raw source JSON remains in backend order. */
function sourceReportDisplay(
  report: VulnerabilityReport,
  payload: LeanVulnerabilityReport,
): PackageSourceDetailDisplay[] {
  const positions = new Map<string, number>();
  payload.advisories?.forEach((advisory, index) => {
    for (const id of [advisory.id, ...(advisory.aliases ?? [])])
      if (id) positions.set(id, index);
  });
  return (report.sourceDetails ?? [])
    .map((entry, index) => {
      // The service derives both arrays from the same page entries, without filtering.
      const row = report.security?.vulnerabilities?.[index];
      const keys = [row?.osvId, ...(row?.aliases ?? [])];
      const position = keys
        .map((id) => (id ? positions.get(id) : undefined))
        .find((value) => value !== undefined);
      const advisory = row ? buildAdvisory(row) : undefined;
      const assessment = advisory
        ? formatAdvisoryAssessment(
            advisory.assessmentStatus,
            advisory.affectsInspectedVersion,
          )
        : undefined;
      return {
        index,
        position: position ?? Number.MAX_SAFE_INTEGER,
        display: {
          ...entry,
          unlinked: position === undefined,
          ...(advisory
            ? {
                assessmentLabel: [severityColumnLabel(advisory), assessment]
                  .filter(Boolean)
                  .join("; "),
              }
            : {}),
        },
      };
    })
    .sort((a, b) => a.position - b.position || a.index - b.index)
    .map((row) => row.display);
}

/** Quote source IDs as shell arguments and keep options outside the positional separator. */
function advisoryReportCommand(id: string): string {
  return `githits vulns --verbose -- ${shellQuoteExact(id)}`;
}

function formatHeader(
  payload: LeanVulnerabilityReport,
  useColors: boolean,
): string {
  const name = colorize(sanitizeIdentity(payload.name), "bold", useColors);
  return `${name} @ ${sanitizeIdentity(payload.version)} | ${sanitizeIdentity(payload.registry)}`;
}

function formatFilterLines(
  filter: PackageVulnerabilitiesFilterEcho | undefined,
): string[] {
  if (!filter) return [];
  const lines: string[] = [];
  if (filter.advisoryScope) {
    lines.push(
      `Scope   ${sanitizeIdentity(formatAdvisoryScope(filter.advisoryScope))}`,
    );
  }
  if (filter.minSeverity) {
    lines.push(`Filter  severity >= ${sanitizeIdentity(filter.minSeverity)}`);
  }
  if (filter.includeWithdrawn === true) {
    lines.push("Filter  include withdrawn");
  }
  return lines;
}

function formatAdvisoryScope(scope: string): string {
  if (scope === "non_affecting") return "non-affecting advisories only";
  if (scope === "all") return "all package advisories";
  return scope;
}

function formatSummaryLine(
  payload: LeanVulnerabilityReport,
  useColors: boolean,
): string {
  const n = payload.summary.total;
  const noun = n === 1 ? "vulnerability" : "vulnerabilities";
  const verb = n === 1 ? "affects" : "affect";
  const base = `${n} ${noun} ${verb} this version`;
  // Colour reflects caller risk: yellow/warn when the inspected version
  // is affected; plain text when clean.
  if (payload.summary.affected === true) {
    return colorize(base, "yellow", useColors);
  }
  if (payload.summary.affected === false) {
    return base;
  }
  return base;
}

/** Keep scope totals and uncertainty visible without repeating advisory detail. */
function formatAssessmentLines(
  payload: LeanVulnerabilityReport,
  surface: VulnerabilitiesTextSurface,
  terminalWidth: number | undefined,
): string[] {
  const summary = payload.summary;
  return formatAssessmentHintLines(
    {
      affectedCount: summary.total,
      nonAffectingCount: summary.nonAffectingVulnerabilityCount,
      unknownCount: summary.unknownVulnerabilityCount,
      totalCount: summary.allVulnerabilityCount,
      assessmentStatus: summary.assessmentStatus,
    },
    payload.filter?.advisoryScope ?? "affected",
    surface,
    normaliseTerminalWidth(terminalWidth),
  );
}

/** Shared scope totals and native unknown follow-up for direct and dependency reports. */
function formatAssessmentHintLines(
  counts: {
    affectedCount: number;
    nonAffectingCount?: number;
    unknownCount?: number;
    totalCount?: number;
    assessmentStatus?: string;
  },
  scope: AdvisoryScopeLabel,
  surface: VulnerabilitiesTextSurface,
  width: number,
): string[] {
  const unknown = counts.unknownCount ?? 0;
  const uncertainty = formatAssessmentUncertainty(
    counts.assessmentStatus,
    counts.affectedCount > 0,
  );
  if (unknown === 0 && uncertainty === undefined) return [];
  const parts: string[] = [];
  if (counts.nonAffectingCount !== undefined)
    parts.push(`${counts.nonAffectingCount} non-affecting`);
  if (counts.unknownCount !== undefined)
    parts.push(`${counts.unknownCount} unknown`);
  if (counts.totalCount !== undefined) parts.push(`${counts.totalCount} all`);
  const explanations: string[] = [];
  if (unknown > 0) {
    const action =
      surface === "mcp" ? 'advisory_scope="unknown"' : "--scope unknown";
    explanations.push(
      scope === "unknown"
        ? "unknown = not evaluable; reasons below"
        : `unknown = not evaluable, list with ${action}`,
    );
  }
  if (
    uncertainty !== undefined &&
    !(unknown > 0 && counts.assessmentStatus === "UNKNOWN")
  )
    explanations.push(sanitizeProse(uncertainty));
  return wrapFreeText(
    [parts.join(" | "), ...explanations].filter(Boolean).join("; "),
    width,
  );
}

function formatNoAffectedVulnerabilitiesLine(
  payload: LeanVulnerabilityReport,
): string {
  const selectedAdvisoryCount = payload.advisories?.length ?? 0;
  if (
    (payload.summary.unknownVulnerabilityCount ?? 0) > 0 ||
    !isAssessmentStatusImplied(payload.summary.assessmentStatus, false)
  ) {
    return "No confirmed vulnerabilities affect this version.";
  }
  if (payload.filter?.advisoryScope === "non_affecting") {
    if (selectedAdvisoryCount > 0) {
      return "No active vulnerabilities affect this version; non-affecting advisories are listed below.";
    }
    return "No active vulnerabilities affect this version; no non-affecting advisories match the current filter.";
  }
  if (payload.filter?.advisoryScope === "all") {
    if (selectedAdvisoryCount > 0) {
      return "No active vulnerabilities affect this version; package advisories are listed below.";
    }
    return "No active vulnerabilities affect this version; no package advisories match the current filter.";
  }
  if (payload.filter !== undefined) {
    return "No vulnerabilities matching the filter affect this version.";
  }
  const nonAffecting = payload.summary.nonAffectingVulnerabilityCount ?? 0;
  if (nonAffecting > 0) {
    const noun = nonAffecting === 1 ? "advisory" : "advisories";
    const verb = nonAffecting === 1 ? "does" : "do";
    return `No active vulnerabilities affect this version (${nonAffecting} ${noun} ${verb} not apply).`;
  }
  return "No active vulnerabilities affect this version.";
}

function formatSelectedAdvisoryCountLine(
  count: number,
  scope: string | undefined,
): string | undefined {
  if (scope === undefined) return undefined;
  const noun = count === 1 ? "advisory" : "advisories";
  if (scope === "non_affecting") {
    return `  showing ${count} non-affecting ${noun}`;
  }
  if (scope === "all") {
    return `  showing ${count} package ${noun} across affected, non-affecting and unknown scopes`;
  }
  return undefined;
}

function formatBreakdownLine(
  summary: LeanVulnerabilitySummary,
  useColors: boolean,
  terminalWidth: number | undefined,
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
  const parts: BreakdownPart[] = [];
  for (const key of BUCKET_ORDER) {
    const count = bucket[key];
    if (typeof count === "number" && count > 0) {
      const segment = `${count} ${labels[key]}`;
      parts.push({
        text: segment,
        color: key === "malware" ? "red" : undefined,
      });
    }
  }
  if (parts.length === 0) return undefined;
  return formatBreakdownParts(parts, useColors, terminalWidth);
}

interface BreakdownPart {
  text: string;
  color?: "red";
}

function formatBreakdownParts(
  parts: readonly BreakdownPart[],
  useColors: boolean,
  terminalWidth: number | undefined,
): string {
  const width = normaliseTerminalWidth(terminalWidth);
  const lines: BreakdownPart[][] = [];
  let current: BreakdownPart[] = [];
  for (const part of parts) {
    const candidate = [...current, part].map(({ text }) => text).join(" | ");
    if (
      current.length === 0 ||
      measureTerminalWidth(`  ${candidate}`) <= width
    ) {
      current.push(part);
    } else {
      lines.push(current);
      current = [part];
    }
  }
  if (current.length > 0) lines.push(current);
  return lines
    .map(
      (line) =>
        `  ${line
          .map(({ text, color }) =>
            color ? colorize(text, color, useColors) : text,
          )
          .join(" | ")}`,
    )
    .join("\n");
}

// --------------------------------------------------------------------
// Advisory rendering
// --------------------------------------------------------------------

function formatAdvisoryList(
  advisories: LeanAdvisory[],
  verbose: boolean,
  useColors: boolean,
  rangeLimit: number,
  surface: VulnerabilitiesTextSurface,
  terminalWidth: number | undefined,
): string {
  const renderedAdvisories =
    verbose || surface === "cli"
      ? advisories
      : advisories.slice(0, DEFAULT_ADVISORY_CAP);
  const labelWidth = Math.max(
    ...renderedAdvisories.map((a) => severityColumnLabel(a).length),
  );
  const lines: string[] = [];
  for (const advisory of renderedAdvisories) {
    lines.push(
      ...formatAdvisoryLines(
        advisory,
        labelWidth,
        verbose,
        useColors,
        rangeLimit,
        surface,
      ),
    );
    lines.push("");
  }
  const hidden = advisories.length - renderedAdvisories.length;
  if (hidden > 0) {
    lines.push(
      ...wrapFreeText(
        formatAdvisoryCapHint(hidden, surface),
        normaliseTerminalWidth(terminalWidth),
      ).map((line) => dim(line, useColors)),
    );
  }
  return lines.join("\n").trimEnd();
}

function formatAdvisoryCapHint(
  hidden: number,
  surface: VulnerabilitiesTextSurface,
): string {
  const hint = surface === "mcp" ? "use verbose=true or format=json" : "use -v";
  return `... (+${hidden} more; ${hint})`;
}

function severityColumnLabel(advisory: LeanAdvisory): string {
  if (advisory.isMalicious === true) {
    if (advisory.severityLabel) return `MALWARE | ${advisory.severityLabel}`;
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
export function isPlaceholderSummary(summary: string): boolean {
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
  surface: VulnerabilitiesTextSurface,
): string[] {
  const rawLabel = severityColumnLabel(advisory);
  const padded = rawLabel.padEnd(labelWidth);
  const colouredLabel = severityColumnColor(advisory, useColors, padded);

  const parts: string[] = [colouredLabel];
  if (advisory.id) parts.push(sanitizeIdentity(advisory.id));
  const assessment = formatAdvisoryAssessment(
    advisory.assessmentStatus,
    advisory.affectsInspectedVersion,
  );
  if (assessment !== undefined) parts.push(`[${sanitizeIdentity(assessment)}]`);
  if (advisory.publishedAt) parts.push(sanitizeIdentity(advisory.publishedAt));
  if (advisory.summary) parts.push(sanitizeProse(advisory.summary));

  const lines: string[] = [`  ${parts.join("  ")}`];

  // Compact detail rows — indented 4 spaces so they "hang" under the
  // advisory headline.
  const detailWidth = verbose ? 12 : 8;
  const pushRow = (label: string, value: string) => {
    lines.push(`    ${label.padEnd(detailWidth)} ${value}`);
  };
  if (
    advisory.assessmentReasons?.length &&
    formatAdvisoryAssessment(
      advisory.assessmentStatus,
      advisory.affectsInspectedVersion,
    ) !== "affects this version"
  ) {
    pushRow(
      "reason",
      advisory.assessmentReasons
        .map(formatVulnerabilityAssessmentReason)
        .map(sanitizeProse)
        .join("; "),
    );
  }
  if (advisory.affectedRanges && advisory.affectedRanges.length > 0) {
    pushRow(
      "affected",
      formatRangeList(
        advisory.affectedRanges.map((range) =>
          range.startsWith("osv-invalid:")
            ? "(unevaluable source range)"
            : range,
        ),
        verbose,
        useColors,
        rangeLimit,
        surface,
        advisory.affectedVersionRangesCount,
        advisory.affectedVersionRangesTruncated,
      ),
    );
  }
  const matched = advisory.matchedAffectedVersionRanges;
  if (
    formatAdvisoryAssessment(
      advisory.assessmentStatus,
      advisory.affectsInspectedVersion,
    ) === "affects this version" &&
    matched?.length &&
    (advisory.affectedVersionRangesTruncated ||
      matched.length !== advisory.affectedRanges?.length ||
      matched.some((range) => !advisory.affectedRanges?.includes(range)))
  ) {
    pushRow(
      "matched",
      formatRangeList(
        matched.map((range) =>
          range.startsWith("osv-invalid:")
            ? "(unevaluable source range)"
            : range,
        ),
        verbose,
        useColors,
        rangeLimit,
        surface,
        undefined,
        undefined,
      ),
    );
  }
  if (advisory.fixedIn && advisory.fixedIn.length > 0) {
    pushRow("fixed in", advisory.fixedIn.map(sanitizeIdentity).join(", "));
  }

  if (verbose) {
    if (advisory.aliases && advisory.aliases.length > 0) {
      pushRow("aliases", advisory.aliases.map(sanitizeIdentity).join(", "));
    }
    if (typeof advisory.severity === "number") {
      pushRow("severity", `${advisory.severity} (CVSS)`);
    }
    if (advisory.publishedAt) {
      pushRow("published", sanitizeIdentity(advisory.publishedAt));
    }
    if (advisory.modifiedAt) {
      pushRow("modified", sanitizeIdentity(advisory.modifiedAt));
    }
    if (advisory.withdrawnAt) {
      pushRow("withdrawn", sanitizeIdentity(advisory.withdrawnAt));
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
  surface: VulnerabilitiesTextSurface,
  totalCount: number | undefined,
  backendTruncated: boolean | undefined,
): string {
  const safeRanges = ranges.map(sanitizeIdentity);
  const actualTotal = Math.max(
    totalCount ?? safeRanges.length,
    safeRanges.length,
  );
  const backendHidden =
    backendTruncated === true ? actualTotal - safeRanges.length : 0;
  const appendBackendHint = (shown: string): string => {
    if (backendHidden > 0) {
      const hint = dim(
        `... (+${backendHidden} ranges omitted by service)`,
        useColors,
      );
      return shown.length > 0 ? `${shown}, ${hint}` : hint;
    }
    return shown;
  };

  if (verbose || safeRanges.length <= limit) {
    return appendBackendHint(safeRanges.join(", "));
  }
  const shown = safeRanges.slice(0, limit).join(", ");
  const localHidden = safeRanges.length - limit;
  const localHint = surface === "mcp" ? "use verbose=true" : "use -v";
  const hintText =
    backendHidden > 0
      ? `... (+${localHidden} more with ${localHint}; +${backendHidden} omitted by service)`
      : `... (+${localHidden} more; ${localHint})`;
  const hint = dim(hintText, useColors);
  return `${shown}, ${hint}`;
}

function sanitizeIdentity(value: string): string {
  return sanitizeTerminalText(value);
}

function sanitizeProse(value: string): string {
  return sanitizeTerminalText(value.replace(/\s+/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

interface FormatTransitiveAuditOptions {
  verbose: boolean;
  useColors: boolean;
  surface: VulnerabilitiesTextSurface;
  terminalWidth?: number;
  includeWithdrawn: boolean;
}

interface TransitiveTextRow {
  registry: string;
  name: string;
  occurrence: LeanTransitiveVulnerabilityOccurrence;
}

function formatTransitiveAuditTerminal(
  audit: LeanTransitiveVulnerabilityAudit,
  fullAudit: NonNullable<VulnerabilityReport["transitive"]>,
  options: FormatTransitiveAuditOptions,
): string {
  const width = normaliseTerminalWidth(options.terminalWidth);
  const lines = ["Resolved dependencies"];
  lines.push(...wrapFreeText(formatTransitiveSummaryLine(audit), width));

  const breakdown = formatTransitiveBreakdown(
    audit.summary,
    options.useColors,
    width,
  );
  if (breakdown) lines.push(breakdown);
  if (audit.advisoryScope !== "all")
    lines.push(
      ...formatAssessmentHintLines(
        audit.summary,
        audit.advisoryScope,
        options.surface,
        width,
      ),
    );
  if (
    audit.advisoryScope === "affected" ||
    audit.advisoryScope === "non_affecting"
  ) {
    const mixedRegistries =
      new Set(fullAudit.packages.map((pkg) => lowerRegistry(pkg.registry)))
        .size > 1;
    for (const pkg of [...fullAudit.packages].sort(compareTransitivePackages)) {
      if (pkg.unknownCount > 0) {
        const identity = mixedRegistries
          ? `${lowerRegistry(pkg.registry)}:${pkg.name}`
          : pkg.name;
        lines.push(
          ...wrapFreeText(
            `${sanitizeIdentity(identity)}: ${formatTransitiveCounts(pkg)}`,
            width - 2,
            "  ",
          ).map((line) => `  ${line}`),
        );
      }
    }
  }
  if (options.includeWithdrawn) {
    lines.push(
      ...wrapFreeText(
        "Dependency analysis excludes withdrawn advisories.",
        width,
        "  ",
      ),
    );
  }

  const rows = flattenTransitiveRows(audit);
  if (rows.length > 0) {
    lines.push("", ...formatTransitiveRows(rows, options));
  }

  return lines.join("\n");
}

function formatTransitiveSummaryLine(
  audit: LeanTransitiveVulnerabilityAudit,
): string {
  const summary = audit.summary;
  const scopeLabel =
    audit.advisoryScope === "unknown"
      ? "unknown"
      : audit.advisoryScope === "affected"
        ? "affected"
        : "non-affecting";
  const occurrenceNoun = `${scopeLabel} advisory ${summary.occurrenceCount === 1 ? "occurrence" : "occurrences"}`;
  const packageNoun =
    summary.packageCount === 1 ? "dependency package" : "dependency packages";
  const versionNoun =
    summary.totalPackagesAnalyzed === 1
      ? "resolved package version"
      : "resolved package versions";
  if (summary.occurrenceCount === 0) {
    if (audit.advisoryScope === "all")
      return `No advisory occurrences found. ${summary.totalPackagesAnalyzed} ${versionNoun} checked.`;
    return `No ${scopeLabel} advisory occurrences found; ${summary.totalPackagesAnalyzed} ${versionNoun} checked.`;
  }
  if (audit.advisoryScope === "all") {
    const unknownText =
      summary.unknownCount > 0 ? `, ${summary.unknownCount} unknown` : "";
    const noun = summary.occurrenceCount === 1 ? "occurrence" : "occurrences";
    return `${summary.occurrenceCount} advisory ${noun} (${summary.affectedCount} affected, ${summary.nonAffectingCount} non-affecting${unknownText}) in ${summary.packageCount} ${packageNoun}; ${summary.totalPackagesAnalyzed} ${versionNoun} checked.`;
  }
  return `${summary.occurrenceCount} ${occurrenceNoun} in ${summary.packageCount} ${packageNoun}; ${summary.totalPackagesAnalyzed} ${versionNoun} checked.`;
}

/** Complete backend totals, independent of the selected occurrence list. */
function formatTransitiveCounts(
  counts: TransitiveVulnerabilityAuditCounts,
): string {
  return `${counts.affectedCount} affected | ${counts.nonAffectingCount} non-affecting | ${counts.unknownCount} unknown | ${counts.totalCount} all`;
}

const TRANSITIVE_ROW_MARGIN = "  ";
const TRANSITIVE_COLUMN_SEPARATOR = "  ";
const TRANSITIVE_SEVERITY_LABEL_WIDTH = "critical".length;
const TRANSITIVE_COORDINATE_INDENT =
  TRANSITIVE_ROW_MARGIN.length +
  TRANSITIVE_SEVERITY_LABEL_WIDTH +
  TRANSITIVE_COLUMN_SEPARATOR.length;
const TRANSITIVE_DETAIL_LABEL_WIDTH = "advisory ranges".length;
const TRANSITIVE_COORDINATE_PREFIX = " ".repeat(TRANSITIVE_COORDINATE_INDENT);

function formatTransitiveBreakdown(
  summary: LeanTransitiveVulnerabilityAudit["summary"],
  useColors: boolean,
  terminalWidth: number,
): string | undefined {
  if (!summary.bySeverity) return undefined;
  const labels: Record<VulnBucket, string> = {
    malware: "MALWARE",
    critical: "critical",
    high: "high",
    medium: "medium",
    low: "low",
    unrated: "unrated",
  };
  const parts: BreakdownPart[] = [];
  for (const key of BUCKET_ORDER) {
    const count = summary.bySeverity[key];
    if (typeof count === "number" && count > 0) {
      const part = `${count} ${labels[key]}`;
      parts.push({
        text: part,
        color: key === "malware" ? "red" : undefined,
      });
    }
  }
  return parts.length > 0
    ? formatBreakdownParts(parts, useColors, terminalWidth)
    : undefined;
}

function flattenTransitiveRows(
  audit: LeanTransitiveVulnerabilityAudit,
): TransitiveTextRow[] {
  return audit.packages
    .flatMap((pkg) =>
      pkg.occurrences.map((occurrence) => ({
        registry: pkg.registry,
        name: pkg.name,
        occurrence,
      })),
    )
    .sort(compareTransitiveTextRows);
}

function compareTransitiveTextRows(
  a: TransitiveTextRow,
  b: TransitiveTextRow,
): number {
  const risk =
    transitiveRiskRank(b.occurrence) - transitiveRiskRank(a.occurrence);
  if (risk !== 0) return risk;
  const registry = compareStrings(a.registry, b.registry);
  if (registry !== 0) return registry;
  const name = compareStrings(a.name, b.name);
  if (name !== 0) return name;
  const version = compareStrings(
    a.occurrence.resolvedVersion,
    b.occurrence.resolvedVersion,
  );
  if (version !== 0) return version;
  const identity = compareStrings(
    transitiveAdvisoryIdentity(a.occurrence),
    transitiveAdvisoryIdentity(b.occurrence),
  );
  if (identity !== 0) return identity;
  return compareStrings(
    JSON.stringify(a.occurrence),
    JSON.stringify(b.occurrence),
  );
}

function formatTransitiveRows(
  rows: TransitiveTextRow[],
  options: FormatTransitiveAuditOptions,
): string[] {
  const shownRows =
    options.verbose || options.surface === "cli"
      ? rows
      : rows.slice(0, DEFAULT_ADVISORY_CAP);
  const lines: string[] = [];
  for (const row of shownRows) {
    lines.push(...formatTransitiveOccurrence(row, options));
  }

  const hidden = rows.length - shownRows.length;
  if (hidden > 0) {
    const hint =
      options.surface === "mcp" ? "use verbose=true or format=json" : "use -v";
    lines.push(
      ...wrapFreeText(
        `... (+${hidden} more; ${hint})`,
        normaliseTerminalWidth(options.terminalWidth),
      ).map((line) => dim(line, options.useColors)),
    );
  }
  return lines;
}

function formatTransitiveOccurrence(
  row: TransitiveTextRow,
  options: FormatTransitiveAuditOptions,
): string[] {
  const occurrence = row.occurrence;
  const label = transitiveSeverityColumnLabel(occurrence);
  const paddedLabel = label.padEnd(TRANSITIVE_SEVERITY_LABEL_WIDTH);
  const coordinate = `${sanitizeIdentity(row.name)}@${sanitizeIdentity(occurrence.resolvedVersion)}`;
  const identity = occurrence.id ? sanitizeIdentity(occurrence.id) : undefined;
  const headlineParts = [paddedLabel, coordinate];
  const assessment = formatAdvisoryAssessment(
    occurrence.assessmentStatus,
    occurrence.affectsResolvedVersion,
  );
  if (assessment !== undefined && assessment !== "affects this version")
    headlineParts.push(`[${sanitizeIdentity(assessment)}]`);
  if (identity) headlineParts.push(identity);
  const headline = `${TRANSITIVE_ROW_MARGIN}${headlineParts.join(TRANSITIVE_COLUMN_SEPARATOR)}`;
  const lines = formatTransitiveHeadline(
    headline,
    occurrence.summary,
    options.terminalWidth,
  );
  const coloredLabel = colorize(
    label,
    transitiveLabelColor(label),
    options.useColors,
  );
  const labelStart = lines[0]?.indexOf(paddedLabel) ?? 0;
  lines[0] = `${lines[0]?.slice(0, labelStart) ?? ""}${coloredLabel}${" ".repeat(paddedLabel.length - label.length)}${lines[0]?.slice(labelStart + paddedLabel.length) ?? ""}`;

  if (
    !occurrence.affectsResolvedVersion &&
    occurrence.assessmentReasons?.length
  ) {
    for (const reason of occurrence.assessmentReasons)
      lines.push(
        ...formatFreeDetail(
          "reason",
          formatVulnerabilityAssessmentReason(reason),
          options.terminalWidth,
        ),
      );
  }
  if (occurrence.affectsResolvedVersion) {
    lines.push(
      ...formatAtomicDetail(
        "matched",
        occurrence.matchedAffectedVersionRanges,
        options.terminalWidth,
      ),
    );
    const nearest = occurrence.nearestFixedVersion
      ? sanitizeIdentity(occurrence.nearestFixedVersion)
      : "no higher fixed version known";
    lines.push(
      ...formatFreeDetail("nearest fix", nearest, options.terminalWidth),
    );
    const higherFixesRepeatNearest =
      occurrence.fixVersionsAboveResolved.length === 1 &&
      occurrence.nearestFixedVersion !== undefined &&
      occurrence.fixVersionsAboveResolved[0] === occurrence.nearestFixedVersion;
    if (
      options.verbose &&
      occurrence.fixVersionsAboveResolved.length > 0 &&
      !higherFixesRepeatNearest
    ) {
      lines.push(
        ...formatAtomicDetail(
          "higher fixes",
          occurrence.fixVersionsAboveResolved,
          options.terminalWidth,
        ),
      );
    }
    if (
      options.verbose &&
      occurrence.aliases &&
      occurrence.aliases.length > 0
    ) {
      lines.push(
        ...formatAtomicDetail(
          "aliases",
          occurrence.aliases,
          options.terminalWidth,
        ),
      );
    }
  } else if (options.verbose) {
    if (occurrence.affectedRanges && occurrence.affectedRanges.length > 0) {
      lines.push(
        ...formatAtomicDetail(
          "advisory ranges",
          occurrence.affectedRanges,
          options.terminalWidth,
        ),
      );
    }
    if (occurrence.fixedIn && occurrence.fixedIn.length > 0) {
      lines.push(
        ...formatAtomicDetail(
          "advisory fixes",
          occurrence.fixedIn,
          options.terminalWidth,
        ),
      );
    }
    if (occurrence.aliases && occurrence.aliases.length > 0) {
      lines.push(
        ...formatAtomicDetail(
          "aliases",
          occurrence.aliases,
          options.terminalWidth,
        ),
      );
    }
  }
  return lines;
}

function formatTransitiveHeadline(
  headline: string,
  summary: string | undefined,
  terminalWidth: number | undefined,
): string[] {
  const cleanSummary = summary ? sanitizeProse(summary) : "";
  if (!cleanSummary) return [headline];
  const words = cleanSummary.split(" ").filter(Boolean);
  const width = normaliseTerminalWidth(terminalWidth);
  const lines: string[] = [];
  let current = headline;
  for (const word of words) {
    const separator = current === headline ? "  " : " ";
    const candidate = `${current}${separator}${word}`;
    if (measureTerminalWidth(candidate) <= width) {
      current = candidate;
      continue;
    }
    lines.push(current.trimEnd());
    current = `${TRANSITIVE_COORDINATE_PREFIX}${word}`;
  }
  lines.push(current.trimEnd());
  return lines;
}

function formatAtomicDetail(
  label: string,
  values: readonly string[],
  terminalWidth: number | undefined,
): string[] {
  const width = normaliseTerminalWidth(terminalWidth);
  const prefix = `${TRANSITIVE_COORDINATE_PREFIX}${label.padEnd(TRANSITIVE_DETAIL_LABEL_WIDTH)} `;
  const continuation = " ".repeat(prefix.length);
  const lines: string[] = [];
  let current = prefix;
  for (const [index, rawValue] of values.entries()) {
    const value = sanitizeIdentity(rawValue);
    const addition = index === 0 ? value : `, ${value}`;
    if (index === 0 || measureTerminalWidth(`${current}${addition}`) <= width) {
      current += addition;
      continue;
    }
    lines.push(current.trimEnd());
    current = `${continuation}${value}`;
  }
  if (current !== prefix) lines.push(current.trimEnd());
  return lines;
}

function formatFreeDetail(
  label: string,
  value: string,
  terminalWidth: number | undefined,
): string[] {
  const prefix = `${TRANSITIVE_COORDINATE_PREFIX}${label.padEnd(TRANSITIVE_DETAIL_LABEL_WIDTH)} `;
  const width = normaliseTerminalWidth(terminalWidth);
  const words = sanitizeProse(value).split(" ").filter(Boolean);
  if (words.length === 0) return [prefix.trimEnd()];
  const continuation = " ".repeat(prefix.length);
  const lines: string[] = [];
  let current = prefix;
  for (const word of words) {
    if (
      current === prefix ||
      measureTerminalWidth(
        `${current}${current === prefix ? "" : " "}${word}`,
      ) <= width
    ) {
      current += `${current === prefix ? "" : " "}${word}`;
      continue;
    }
    lines.push(current.trimEnd());
    current = `${continuation}${word}`;
  }
  lines.push(current.trimEnd());
  return lines;
}

function wrapFreeText(
  value: string,
  width: number,
  continuationPrefix = "  ",
): string[] {
  // Keep the native follow-up flag and its value on one line.
  const words = value.match(/--scope unknown|\S+/g) ?? [];
  if (words.length === 0) return [];
  const lines: string[] = [];
  let current = words[0] ?? "";
  for (const word of words.slice(1)) {
    const candidate = `${current} ${word}`;
    if (measureTerminalWidth(candidate) <= width) {
      current = candidate;
    } else {
      lines.push(current);
      current = `${continuationPrefix}${word}`;
    }
  }
  lines.push(current);
  return lines;
}

function transitiveSeverityColumnLabel(
  occurrence: LeanTransitiveVulnerabilityOccurrence,
): string {
  if (occurrence.isMalicious === true) return "MALWARE";
  return occurrence.severityLabel ?? "unrated";
}

function transitiveLabelColor(label: string): "red" | "yellow" | "dim" {
  if (label === "MALWARE" || label === "critical") return "red";
  if (label === "high" || label === "medium") return "yellow";
  return "dim";
}

function normaliseTerminalWidth(width: number | undefined): number {
  if (width === undefined || !Number.isFinite(width)) return 80;
  return Math.max(20, Math.floor(width));
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
  const safePaths = paths.map(sanitizeIdentity);
  if (safePaths.length === 1) return `Candidate fix version: ${safePaths[0]}.`;
  return `Candidate fix versions: ${safePaths.join(", ")}.`;
}
