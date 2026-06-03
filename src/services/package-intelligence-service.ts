/**
 * Package intelligence service — reads registry metadata, vulnerability
 * reports, dependency reports, and changelogs from the upstream
 * GraphQL endpoint.
 *
 * Wire-level plumbing (URL, headers, POST, transport-error wrapping)
 * lives in `src/shared/pkgseer-graphql.ts`. This service owns:
 * - Domain error classes (`PackageIntelligence*Error`) including the
 *   typed `PackageIntelligenceVersionNotFoundError` for structured
 *   VERSION_NOT_FOUND responses.
 * - GraphQL-error classification on structured responses.
 * - Zod schemas for each query's response shape (packageSummary,
 *   packageVulnerabilities).
 * - Outer `executeWithTokenRefresh` wrapper so GraphQL-level
 *   `UNAUTHORIZED` errors — classified after the POST — continue to
 *   trigger token refresh.
 */

import { z } from "zod";
import { debugLog, isDebugAreaEnabled } from "../shared/debug-log.js";
import { isFetchTimeoutError } from "../shared/fetch-timeout.js";
import {
  type PkgseerGraphqlResponse,
  PkgseerTransportError,
  postPkgseerGraphql,
} from "../shared/pkgseer-graphql.js";
import type { PkgseerRegistry } from "../shared/pkgseer-registry.js";
import type { ClientHeaderBuilder } from "../shared/request-headers.js";
import { withTelemetrySpan } from "../shared/telemetry.js";
import {
  ClientUpdateRequiredError,
  isClientUpdateRequiredGraphQLError,
  isGraphQLSchemaMismatchError,
} from "./client-update-required-error.js";
import { executeWithTokenRefresh } from "./execute-with-token-refresh.js";
import { AuthenticationError } from "./githits-service.js";
import { promoteGenericVersionNotFound } from "./promote-version-not-found.js";
import type { TokenProvider } from "./token-manager.js";

export interface PackageSummaryParams {
  registry: PkgseerRegistry;
  packageName: string;
}

export interface PackageIdentity {
  name: string;
  registry?: string;
  description?: string;
  latestVersion: string;
  latestVersionPublishedAt?: string;
  homepage?: string;
  repositoryUrl?: string;
  license?: string;
  downloadsLastMonth?: number;
  downloadsTotal?: number;
  githubRepository?: GithubRepository;
}

export interface GithubRepository {
  stargazersCount?: number;
  forksCount?: number;
  openIssuesCount?: number;
  archived?: boolean;
  language?: string;
  topics?: string[];
  pushedAt?: string;
}

export interface VulnerabilityOverview {
  osvId?: string;
  summary?: string;
  severityScore?: number;
  publishedAt?: string;
}

export interface PackageSecurityOverview {
  vulnerabilityCount?: number;
  hasCurrentVulnerabilities?: boolean;
  recentVulnerabilities?: VulnerabilityOverview[];
}

export interface ChangelogEntry {
  version?: string;
  publishedAt?: string;
  body?: string;
}

export interface PackageSummary {
  package: PackageIdentity;
  security?: PackageSecurityOverview;
  latestChangelogs?: ChangelogEntry[];
}

export interface PackageVulnerabilitiesParams {
  registry: PkgseerRegistry;
  packageName: string;
  /** Optional — backend defaults to latest when omitted. */
  version?: string;
  /** Optional CVSS float; backend filters advisories below this score. */
  minSeverity?: number;
  /** Optional — backend defaults to false when omitted. */
  includeWithdrawn?: boolean;
  /** Advisory rows to return; counts always include all scopes. */
  advisoryScope?: VulnerabilityScope;
}

export type VulnerabilityScope = "AFFECTED" | "NON_AFFECTING" | "ALL";

export interface PackageVersionIdentity {
  name: string;
  registry?: string;
  version: string;
  publishedAt?: string;
  deprecated?: boolean;
  deprecationReason?: string;
}

export interface VulnerabilityDetail {
  osvId?: string;
  summary?: string;
  severityScore?: number;
  severityType?: string;
  affectedVersionRanges?: string[];
  affectedVersionRangesCount?: number;
  affectedVersionRangesTruncated?: boolean;
  fixedInVersions?: string[];
  publishedAt?: string;
  modifiedAt?: string;
  withdrawnAt?: string;
  aliases?: string[];
  isMalicious?: boolean;
  affectsInspectedVersion?: boolean;
  matchedAffectedVersionRanges?: string[];
  duplicateIds?: string[];
}

export interface VulnerabilitySecurityDetails {
  affectedVulnerabilityCount: number;
  nonAffectingVulnerabilityCount: number;
  allVulnerabilityCount: number;
  currentVersionAffected?: boolean;
  vulnerabilities?: VulnerabilityDetail[];
  upgradePaths?: string[];
}

export interface VulnerabilityReport {
  package: PackageVersionIdentity;
  security?: VulnerabilitySecurityDetails;
}

export interface PackageDependenciesParams {
  registry: PkgseerRegistry;
  packageName: string;
  /** Optional — backend defaults to latest when omitted. */
  version?: string;
  /** Optional. Backend returns a full transitive graph when true. */
  includeTransitive?: boolean;
  /**
   * Optional transitive-traversal depth (1–10). Omit for the backend
   * default (full graph) — note the CLI applies a 3-deep guardrail but
   * the MCP surface deliberately does not.
   */
  maxDepth?: number;
  /**
   * Optional server-side lifecycle filter. Only affects
   * `dependencyGroups`; `direct` and `transitive` are unaffected.
   * Canonical lowercase strings — `runtime`, `development`, `build`,
   * `peer`, `optional`.
   */
  lifecycle?: string[];
}

export interface PackageUpgradeDependencyProbeParams {
  registry: PkgseerRegistry;
  packageName: string;
  version: string;
  minSeverity?: number;
  includeTransitiveSecurity?: boolean;
  includeDependencyIssues?: boolean;
  includeDependencyChanges?: boolean;
  includeGroups?: boolean;
}

export interface DirectDependency {
  name: string;
  versionConstraint?: string;
  type?: string;
}

/**
 * Opaque GenericJSON passthrough. The `package_dependencies` tool
 * migrated to typed fields (`dependencyGraph`, `dependencyConflicts`,
 * `circularDependencyCycles`, `environmentMarkers`); this type is
 * retained for the one remaining passthrough — `ChangelogEntryDetail.metadata`.
 */
export type UntypedGenericJSON = unknown;

/**
 * Node in a typed dependency graph. Mirrors `DependencyGraphNode`.
 * `registry` is a lowercase string: `"npm"`, `"pypi"`, …, or
 * `"synthetic"` for manifest / project root nodes. `version` is null
 * for synthetic roots.
 */
export interface DependencyGraphNode {
  registry: string;
  name: string;
  version?: string;
}

/**
 * Edge in a typed dependency graph. `fromIndex` / `toIndex` index
 * into the companion `nodes` list. `fromIndex` is null for
 * synthetic-root edges emitted by the resolver.
 */
export interface DependencyGraphEdge {
  fromIndex?: number;
  toIndex: number;
  /** Caller's declared constraint (e.g. `^4.2.3`). Null for implicit edges. */
  constraint?: string;
  /** `runtime` / `dev` / `peer` / `optional` / `circular` or registry-specific. */
  dependencyType?: string;
}

export interface DependencyGraph {
  formatVersion: number;
  nodes: DependencyGraphNode[];
  edges: DependencyGraphEdge[];
}

export interface DependencyConflictEdge {
  /** Index into `DependencyGraph.nodes`. Null for synthetic-root edges. */
  fromIndex?: number;
  /** Index into `DependencyGraph.nodes`. Never null. */
  toIndex: number;
  versionConstraint: string;
  dependencyType: string;
}

export interface DependencyConflict {
  packageName: string;
  requiredVersions: string[];
  conflictingEdges: DependencyConflictEdge[];
}

export interface CircularDependencyCycle {
  cycleStart: string;
  /** Ordered node names, with the starting node repeated at the end. */
  circularPath: string[];
  /** Pre-joined human-readable display, e.g. `"a → b → c → a"`. */
  displayChain: string;
}

export interface EnvironmentMarker {
  /** `extra` / `python_version` / `sys_platform` / `cfg` / …; null when unclassified. */
  type?: string;
  /** Marker value (e.g. `async`, `>= 3.8`). Null when raw-only. */
  value?: string;
  /** Original unparsed marker text as it appeared in the package manifest. */
  raw?: string;
}

export interface TransitiveDependencySummary {
  totalEdges?: number;
  uniquePackagesCount?: number;
  uniqueDependencies?: string[];
  /**
   * Typed conflict list. Each `conflictingEdges[].fromIndex` /
   * `toIndex` indexes into `dependencyGraph.nodes`.
   */
  dependencyConflicts?: DependencyConflict[];
  /** Typed circular-dependency cycles. */
  circularDependencyCycles?: CircularDependencyCycle[];
  /**
   * Typed directed-acyclic-graph of transitive dependencies. Kept on
   * the service-level result so the future `pkg deps-dag` command can
   * consume it without re-querying; deliberately not surfaced on the
   * `package_dependencies` envelope.
   */
  dependencyGraph?: DependencyGraph;
  vulnerabilitySummary?: TransitiveVulnerabilitySummary;
  dependencyIssues?: DependencyIssuesSummary;
}

export interface VulnerabilityCountSummary {
  totalVulnerabilities: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  unknown: number;
}

export interface VulnerabilitySummaryDetail {
  osvId?: string;
  registry?: string;
  packageName?: string;
  summary?: string;
  severityScore?: number;
  severityType?: string;
  affectedVersionRanges?: string[];
  fixedInVersions?: string[];
  publishedAt?: string;
  modifiedAt?: string;
  withdrawnAt?: string;
  aliases?: string[];
  isMalicious?: boolean;
}

export interface TransitiveDependencyVulnerability {
  version: string;
  affectsResolvedVersion: boolean;
  matchedAffectedVersionRanges: string[];
  fixVersionsAboveResolved: string[];
  nearestFixedVersion?: string;
  advisory: VulnerabilitySummaryDetail;
}

export interface TransitiveVulnerablePackage {
  registry: string;
  name: string;
  versions: string[];
  affectedCount: number;
  nonAffectingCount: number;
  totalCount: number;
  maxSeverityScore?: number;
  maxSeverityLabel?: string;
  advisoryIds: string[];
  mostCritical?: VulnerabilitySummaryDetail;
  advisoryOccurrences?: TransitiveDependencyVulnerability[];
}

export interface TransitiveVulnerabilitySummary {
  affected: VulnerabilityCountSummary;
  nonAffecting: VulnerabilityCountSummary;
  combined: VulnerabilityCountSummary;
  totalPackagesAnalyzed: number;
  affectedPackageCount: number;
  packages: TransitiveVulnerablePackage[];
  calculatedAt?: string;
}

export interface DependencyDeprecationReason {
  version: string;
  reason?: string;
}

export interface DeprecatedDependency {
  registry: string;
  name: string;
  versions: string[];
  reasons: DependencyDeprecationReason[];
}

export interface OutdatedDependencyVersion {
  version: string;
  severity: string;
}

export interface OutdatedDependency {
  registry: string;
  name: string;
  latestVersion?: string;
  severity: string;
  versions: OutdatedDependencyVersion[];
  repositoryUrl?: string;
}

export interface DuplicateDependency {
  registry?: string;
  name: string;
  versions: string[];
}

export interface DependencyIssueConflict {
  registry?: string;
  name: string;
  versions: string[];
  requiredVersions: string[];
  conflictingEdges: DependencyConflictEdge[];
}

export interface DependencyIssuesSummary {
  totalCount: number;
  deprecatedCount: number;
  outdatedCount: number;
  duplicateCount: number;
  conflictCount: number;
  deprecatedPackages: DeprecatedDependency[];
  outdatedPackages: OutdatedDependency[];
  duplicatePackages: DuplicateDependency[];
  conflicts: DependencyIssueConflict[];
}

export interface DependencyBundle {
  direct?: DirectDependency[];
  transitive?: TransitiveDependencySummary;
}

export interface GroupDependency {
  name: string;
  constraint?: string;
}

export interface DependencyGroup {
  name: string;
  lifecycle: string;
  conditionType: string;
  conditionValue?: string;
  selectionMode: string;
  exclusiveGroup?: string;
  fallbackPriority?: number;
  compatibleWith?: string[];
  defaultEnabled?: boolean;
  dependencies: GroupDependency[];
}

export interface DependencyGroupsInfo {
  primaryGroup?: string;
  environmentMarkers?: EnvironmentMarker[];
  groups: DependencyGroup[];
}

export interface DependencyReport {
  package: PackageVersionIdentity;
  dependencies?: DependencyBundle;
  dependencyGroups?: DependencyGroupsInfo;
}

/**
 * Inputs to `packageChangelog`. Addressing is "spec XOR repo-URL":
 * either both `registry` and `packageName`, or `repoUrl` alone.
 * The shared request builder enforces the XOR before reaching the
 * service; the service layer trusts the contract.
 */
export interface PackageChangelogParams {
  /** Uppercase GraphQL registry enum value. Required with `packageName`. */
  registry?: PkgseerRegistry;
  /** Package name. Required with `registry`. */
  packageName?: string;
  /** GitHub repo URL. Mutually exclusive with `registry` + `packageName`. */
  repoUrl?: string;
  /** Branch or tag for CHANGELOG.md fetching. Ignored for GH Releases. */
  gitRef?: string;
  /**
   * Start of version range. When set, the backend returns every entry
   * between `fromVersion` and `toVersion` (or latest); `limit` is
   * rejected client-side in this mode.
   */
  fromVersion?: string;
  /** End of range / latest-mode cap. Defaults to latest on the wire. */
  toVersion?: string;
  /** Latest-mode cap (1–50). Rejected client-side when `fromVersion` is set. */
  limit?: number;
}

/**
 * Package-info echo from the changelog response. Mirrors
 * `ChangelogPackageInfo` in the schema — all fields nullable at the
 * wire level.
 */
export interface ChangelogPackageInfo {
  name?: string;
  registry?: string;
  repoUrl?: string;
  fromVersion?: string;
  toVersion?: string;
  limit?: number;
}

/**
 * Full changelog entry as observed on the wire. The envelope builder
 * projects this into the lean response shape; `metadata` is dropped
 * from the envelope because its source-specific opaque structure
 * isn't worth the token cost today. Revisit via agent feedback.
 */
export interface ChangelogEntryDetail {
  version?: string;
  normalizedVersion?: string;
  body?: string;
  htmlUrl?: string;
  publishedAt?: string;
  /** TODO(backend): surface when shape is documented. */
  metadata?: UntypedGenericJSON;
}

export interface ChangelogReport {
  /** Echo of addressing + filter as the backend saw it. */
  package?: ChangelogPackageInfo;
  /** `"releases"` | `"changelog_file"` | `"hexdocs"` when resolved; absent for package versions with no changelog entry. */
  source?: string;
  /** Entries, newest-first. Empty array = resolved source but nothing in range. */
  entries: ChangelogEntryDetail[];
}

export type PackageDocSourceKind = "CRAWLED" | "REPOSITORY";

export interface ListPackageDocsParams {
  registry: PkgseerRegistry;
  packageName: string;
  version?: string;
  limit?: number;
  after?: string;
}

export interface ReadPackageDocParams {
  pageId: string;
}

export interface PackageDocPageSummary {
  id?: string;
  title?: string;
  slug?: string;
  order?: number;
  linkName?: string;
  lastUpdatedAt?: string;
  sourceKind?: PackageDocSourceKind;
  sourceUrl?: string;
  repoUrl?: string;
  gitRef?: string;
  requestedRef?: string;
  filePath?: string;
}

export interface PackageDocsPageInfo {
  hasNextPage: boolean;
  endCursor?: string;
  totalCount?: number;
}

export interface PackageDocsList {
  registry?: string;
  packageName?: string;
  version?: string;
  stale?: boolean;
  pages: PackageDocPageSummary[];
  pageInfo?: PackageDocsPageInfo;
}

export interface PackageDocSource {
  url?: string;
  label?: string;
}

export interface PackageDocPage {
  id?: string;
  title?: string;
  content?: string;
  contentFormat?: string;
  breadcrumbs?: string[];
  linkName?: string;
  lastUpdatedAt?: string;
  sourceKind?: PackageDocSourceKind;
  source?: PackageDocSource;
  repoUrl?: string;
  gitRef?: string;
  requestedRef?: string;
  filePath?: string;
  baseUrl?: string;
}

export interface PackageDocResult {
  registry?: string;
  packageName?: string;
  version?: string;
  sourceKind?: PackageDocSourceKind;
  page?: PackageDocPage;
}

export interface PackageIntelligenceService {
  packageSummary(params: PackageSummaryParams): Promise<PackageSummary>;
  packageVulnerabilities(
    params: PackageVulnerabilitiesParams,
  ): Promise<VulnerabilityReport>;
  packageDependencies(
    params: PackageDependenciesParams,
  ): Promise<DependencyReport>;
  packageUpgradeDependencyProbe(
    params: PackageUpgradeDependencyProbeParams,
  ): Promise<DependencyReport>;
  packageChangelog(params: PackageChangelogParams): Promise<ChangelogReport>;
  listPackageDocs(params: ListPackageDocsParams): Promise<PackageDocsList>;
  readPackageDoc(params: ReadPackageDocParams): Promise<PackageDocResult>;
}

// --------------------------------------------------------------------
// Error classes
// --------------------------------------------------------------------

export class PackageIntelligenceAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PackageIntelligenceAccessError";
  }
}

export class PackageIntelligenceFeatureFlagRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PackageIntelligenceFeatureFlagRequiredError";
  }
}

export class PackageIntelligenceNetworkError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "PackageIntelligenceNetworkError";
  }
}

export class PackageIntelligenceBackendError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly graphqlCode?: string,
    public readonly retryable?: boolean,
  ) {
    super(message);
    this.name = "PackageIntelligenceBackendError";
  }
}

/**
 * Legacy fallback for GraphQL errors without a recognised
 * `extensions.code`. New backend builds should hit
 * `PackageIntelligenceBackendError` via `createGraphQLError`; this
 * exists for rollover-window compatibility.
 */
export class PackageIntelligenceGraphQLError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "PackageIntelligenceGraphQLError";
  }
}

export class PackageIntelligenceTargetNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PackageIntelligenceTargetNotFoundError";
  }
}

export class PackageIntelligenceValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PackageIntelligenceValidationError";
  }
}

/**
 * Raised when the caller asked for a version that the backend has no
 * record of. Mirrors the code-navigation precedent but narrower:
 * vulnerability data has no indexing lifecycle, so there is no
 * `latestIndexed` field. Backend may populate `availableVersions` in
 * `extensions` for "did you mean" hints — shape is `string[]` because
 * vulns registries expose plain version strings (no ref / commit
 * concept).
 */
export class PackageIntelligenceVersionNotFoundError extends Error {
  constructor(
    message: string,
    public readonly packageName: string | undefined,
    public readonly requestedVersion: string | undefined,
    public readonly availableVersions: string[] | undefined,
  ) {
    super(message);
    this.name = "PackageIntelligenceVersionNotFoundError";
  }
}

export class MalformedPackageIntelligenceResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MalformedPackageIntelligenceResponseError";
  }
}

/**
 * Raised when the backend confirmed the package / repo exists but
 * could not resolve a changelog source for it (no GitHub Releases,
 * no CHANGELOG.md, no HexDocs). Distinct from
 * {@link PackageIntelligenceTargetNotFoundError} which signals the
 * package itself is missing. The error-map routes this to the shared
 * `NOT_FOUND` code so MCP / CLI error envelopes are consistent, but
 * the distinct class lets the changelog executor attach a message
 * naming the sources that were tried.
 */
export class PackageIntelligenceChangelogSourceNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PackageIntelligenceChangelogSourceNotFoundError";
  }
}

// --------------------------------------------------------------------
// Zod schema for the packageSummary response shape
// --------------------------------------------------------------------

const githubRepositorySchema = z
  .object({
    stargazersCount: z.number().int().nullable().optional(),
    forksCount: z.number().int().nullable().optional(),
    openIssuesCount: z.number().int().nullable().optional(),
    archived: z.boolean().nullable().optional(),
    language: z.string().nullable().optional(),
    topics: z.array(z.string()).nullable().optional(),
    pushedAt: z.string().nullable().optional(),
  })
  .nullable()
  .optional();

const packageIdentitySchema = z.object({
  name: z.string().nullable().optional(),
  registry: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  latestVersion: z.string().nullable().optional(),
  latestVersionPublishedAt: z.string().nullable().optional(),
  homepage: z.string().nullable().optional(),
  repositoryUrl: z.string().nullable().optional(),
  license: z.string().nullable().optional(),
  downloadsLastMonth: z.number().int().nullable().optional(),
  downloadsTotal: z.number().int().nullable().optional(),
  githubRepository: githubRepositorySchema,
});

const vulnerabilityOverviewSchema = z.object({
  osvId: z.string().nullable().optional(),
  summary: z.string().nullable().optional(),
  severityScore: z.number().nullable().optional(),
  publishedAt: z.string().nullable().optional(),
});

const packageSecurityOverviewSchema = z
  .object({
    vulnerabilityCount: z.number().int().nullable().optional(),
    hasCurrentVulnerabilities: z.boolean().nullable().optional(),
    recentVulnerabilities: z
      .array(vulnerabilityOverviewSchema)
      .nullable()
      .optional(),
  })
  .nullable()
  .optional();

const changelogEntrySchema = z.object({
  version: z.string().nullable().optional(),
  publishedAt: z.string().nullable().optional(),
  body: z.string().nullable().optional(),
});

const packageSummaryResponseSchema = z.object({
  package: packageIdentitySchema.nullable().optional(),
  security: packageSecurityOverviewSchema,
  latestChangelogs: z.array(changelogEntrySchema).nullable().optional(),
});

const graphQLErrorSchema = z.object({
  message: z.string(),
  extensions: z.record(z.string(), z.unknown()).optional(),
});

const graphQLResponseSchema = z.object({
  data: z
    .object({
      packageSummary: packageSummaryResponseSchema.nullable().optional(),
    })
    .nullable()
    .optional(),
  errors: z.array(graphQLErrorSchema).optional(),
});

const PACKAGE_SUMMARY_QUERY = `
query PackageSummary($registry: Registry!, $name: String!) {
  packageSummary(registry: $registry, name: $name) {
    package {
      name
      registry
      description
      latestVersion
      latestVersionPublishedAt
      homepage
      repositoryUrl
      license
      downloadsLastMonth
      downloadsTotal
      githubRepository {
        stargazersCount
        forksCount
        openIssuesCount
        archived
        language
        topics
        pushedAt
      }
    }
    security {
      vulnerabilityCount
      hasCurrentVulnerabilities
      recentVulnerabilities {
        osvId
        summary
        severityScore
        publishedAt
      }
    }
    latestChangelogs(limit: 3) {
      version
      publishedAt
      body
    }
  }
}`;

// --------------------------------------------------------------------
// Zod schema + query for packageVulnerabilities
// --------------------------------------------------------------------

const packageVersionIdentitySchema = z.object({
  name: z.string().nullable().optional(),
  registry: z.string().nullable().optional(),
  version: z.string().nullable().optional(),
  publishedAt: z.string().nullable().optional(),
  deprecated: z.boolean().nullable().optional(),
  deprecationReason: z.string().nullable().optional(),
});

const vulnerabilityDetailSchema = z.object({
  osvId: z.string().nullable().optional(),
  summary: z.string().nullable().optional(),
  severityScore: z.number().nullable().optional(),
  severityType: z.string().nullable().optional(),
  affectedVersionRanges: z.array(z.string()).nullable().optional(),
  affectedVersionRangesCount: z.number().int(),
  affectedVersionRangesTruncated: z.boolean(),
  fixedInVersions: z.array(z.string()).nullable().optional(),
  publishedAt: z.string().nullable().optional(),
  modifiedAt: z.string().nullable().optional(),
  withdrawnAt: z.string().nullable().optional(),
  aliases: z.array(z.string()).nullable().optional(),
  isMalicious: z.boolean().nullable().optional(),
  affectsInspectedVersion: z.boolean(),
  matchedAffectedVersionRanges: z.array(z.string()),
  duplicateIds: z.array(z.string()),
});

const pageInfoSchema = z.object({
  hasNextPage: z.boolean(),
  endCursor: z.string().nullable().optional(),
  totalCount: z.number().int(),
});

const vulnerabilityAdvisoryPageSchema = z.object({
  entries: z.array(vulnerabilityDetailSchema),
  pageInfo: pageInfoSchema,
});

const vulnerabilitySecurityDetailsSchema = z
  .object({
    affectedVulnerabilityCount: z.number().int(),
    nonAffectingVulnerabilityCount: z.number().int(),
    allVulnerabilityCount: z.number().int(),
    currentVersionAffected: z.boolean().nullable().optional(),
    advisories: vulnerabilityAdvisoryPageSchema,
    upgradePaths: z.array(z.string()).nullable().optional(),
  })
  .nullable()
  .optional();

const vulnerabilityReportResponseSchema = z.object({
  package: packageVersionIdentitySchema.nullable().optional(),
  security: vulnerabilitySecurityDetailsSchema,
});

const vulnerabilitiesGraphQLResponseSchema = z.object({
  data: z
    .object({
      packageVulnerabilities: vulnerabilityReportResponseSchema
        .nullable()
        .optional(),
    })
    .nullable()
    .optional(),
  errors: z.array(graphQLErrorSchema).optional(),
});

const PACKAGE_VULNERABILITIES_QUERY = `
query PackageVulnerabilities(
  $registry: Registry!
  $name: String!
  $version: String
  $minSeverity: Float
  $includeWithdrawn: Boolean
  $scope: VulnerabilityScope = AFFECTED
  $after: String
) {
  packageVulnerabilities(
    registry: $registry
    name: $name
    version: $version
    minSeverity: $minSeverity
    includeWithdrawn: $includeWithdrawn
  ) {
    package {
      name
      registry
      version
    }
    security {
      affectedVulnerabilityCount
      nonAffectingVulnerabilityCount
      allVulnerabilityCount
      currentVersionAffected
      upgradePaths
      advisories(scope: $scope, first: 100, after: $after) {
        entries {
          osvId
          summary
          severityScore
          severityType
          affectedVersionRanges
          affectedVersionRangesCount
          affectedVersionRangesTruncated
          fixedInVersions
          publishedAt
          modifiedAt
          withdrawnAt
          aliases
          isMalicious
          affectsInspectedVersion
          matchedAffectedVersionRanges
          duplicateIds
        }
        pageInfo {
          hasNextPage
          endCursor
          totalCount
        }
      }
    }
  }
}`;

// --------------------------------------------------------------------
// Zod schema + query for packageDependencies
// --------------------------------------------------------------------

const directDependencySchema = z.object({
  name: z.string().nullable().optional(),
  versionConstraint: z.string().nullable().optional(),
  type: z.string().nullable().optional(),
});

const dependencyGraphNodeSchema = z.object({
  registry: z.string(),
  name: z.string(),
  version: z.string().nullable().optional(),
});

const dependencyGraphEdgeSchema = z.object({
  fromIndex: z.number().int().nullable().optional(),
  toIndex: z.number().int(),
  constraint: z.string().nullable().optional(),
  dependencyType: z.string().nullable().optional(),
});

const dependencyGraphSchema = z.object({
  formatVersion: z.number().int(),
  nodes: z.array(dependencyGraphNodeSchema),
  edges: z.array(dependencyGraphEdgeSchema),
});

const vulnerabilityCountSummarySchema = z.object({
  totalVulnerabilities: z.number().int(),
  critical: z.number().int(),
  high: z.number().int(),
  medium: z.number().int(),
  low: z.number().int(),
  unknown: z.number().int(),
});

const vulnerabilitySummaryDetailSchema = z.object({
  osvId: z.string().nullable().optional(),
  registry: z.string().nullable().optional(),
  packageName: z.string().nullable().optional(),
  summary: z.string().nullable().optional(),
  severityScore: z.number().nullable().optional(),
  severityType: z.string().nullable().optional(),
  affectedVersionRanges: z.array(z.string()).nullable().optional(),
  fixedInVersions: z.array(z.string()).nullable().optional(),
  publishedAt: z.string().nullable().optional(),
  modifiedAt: z.string().nullable().optional(),
  withdrawnAt: z.string().nullable().optional(),
  aliases: z.array(z.string()).nullable().optional(),
  isMalicious: z.boolean().nullable().optional(),
});

const transitiveDependencyVulnerabilitySchema = z.object({
  version: z.string(),
  affectsResolvedVersion: z.boolean(),
  matchedAffectedVersionRanges: z.array(z.string()),
  fixVersionsAboveResolved: z.array(z.string()),
  nearestFixedVersion: z.string().nullable().optional(),
  advisory: vulnerabilitySummaryDetailSchema,
});

const transitiveVulnerablePackageSchema = z.object({
  registry: z.string(),
  name: z.string(),
  versions: z.array(z.string()),
  affectedCount: z.number().int(),
  nonAffectingCount: z.number().int(),
  totalCount: z.number().int(),
  maxSeverityScore: z.number().nullable().optional(),
  maxSeverityLabel: z.string().nullable().optional(),
  advisoryIds: z.array(z.string()),
  mostCritical: vulnerabilitySummaryDetailSchema.nullable().optional(),
  advisoryOccurrences: z
    .array(transitiveDependencyVulnerabilitySchema)
    .nullable()
    .optional(),
});

const transitiveVulnerabilitySummarySchema = z
  .object({
    affected: vulnerabilityCountSummarySchema,
    nonAffecting: vulnerabilityCountSummarySchema,
    combined: vulnerabilityCountSummarySchema,
    totalPackagesAnalyzed: z.number().int(),
    affectedPackageCount: z.number().int(),
    packages: z.array(transitiveVulnerablePackageSchema),
    calculatedAt: z.string().nullable().optional(),
  })
  .nullable()
  .optional();

const dependencyDeprecationReasonSchema = z.object({
  version: z.string(),
  reason: z.string().nullable().optional(),
});

const deprecatedDependencySchema = z.object({
  registry: z.string(),
  name: z.string(),
  versions: z.array(z.string()),
  reasons: z.array(dependencyDeprecationReasonSchema),
});

const outdatedDependencyVersionSchema = z.object({
  version: z.string(),
  severity: z.string(),
});

const outdatedDependencySchema = z.object({
  registry: z.string(),
  name: z.string(),
  latestVersion: z.string().nullable().optional(),
  severity: z.string(),
  versions: z.array(outdatedDependencyVersionSchema),
  repositoryUrl: z.string().nullable().optional(),
});

const duplicateDependencySchema = z.object({
  registry: z.string().nullable().optional(),
  name: z.string(),
  versions: z.array(z.string()),
});

const dependencyConflictEdgeSchema = z.object({
  fromIndex: z.number().int().nullable().optional(),
  toIndex: z.number().int(),
  versionConstraint: z.string(),
  dependencyType: z.string(),
});

const dependencyConflictSchema = z.object({
  packageName: z.string(),
  requiredVersions: z.array(z.string()),
  conflictingEdges: z.array(dependencyConflictEdgeSchema),
});

const dependencyIssueConflictSchema = z.object({
  registry: z.string().nullable().optional(),
  name: z.string(),
  versions: z.array(z.string()),
  requiredVersions: z.array(z.string()),
  conflictingEdges: z.array(dependencyConflictEdgeSchema),
});

const dependencyIssuesSummarySchema = z
  .object({
    totalCount: z.number().int(),
    deprecatedCount: z.number().int(),
    outdatedCount: z.number().int(),
    duplicateCount: z.number().int(),
    conflictCount: z.number().int(),
    deprecatedPackages: z.array(deprecatedDependencySchema),
    outdatedPackages: z.array(outdatedDependencySchema),
    duplicatePackages: z.array(duplicateDependencySchema),
    conflicts: z.array(dependencyIssueConflictSchema),
  })
  .nullable()
  .optional();

const circularDependencyCycleSchema = z.object({
  cycleStart: z.string(),
  circularPath: z.array(z.string()),
  displayChain: z.string(),
});

const environmentMarkerSchema = z.object({
  type: z.string().nullable().optional(),
  value: z.string().nullable().optional(),
  raw: z.string().nullable().optional(),
});

const transitiveDependencySchema = z
  .object({
    totalEdges: z.number().int().nullable().optional(),
    uniquePackagesCount: z.number().int().nullable().optional(),
    uniqueDependencies: z.array(z.string()).nullable().optional(),
    dependencyConflicts: z
      .array(dependencyConflictSchema)
      .nullable()
      .optional(),
    circularDependencyCycles: z
      .array(circularDependencyCycleSchema)
      .nullable()
      .optional(),
    dependencyGraph: dependencyGraphSchema.nullable().optional(),
    vulnerabilitySummary: transitiveVulnerabilitySummarySchema,
    dependencyIssues: dependencyIssuesSummarySchema,
  })
  .nullable()
  .optional();

const dependencyBundleSchema = z
  .object({
    direct: z.array(directDependencySchema).nullable().optional(),
    transitive: transitiveDependencySchema,
  })
  .nullable()
  .optional();

const groupDependencySchema = z.object({
  name: z.string(),
  constraint: z.string().nullable().optional(),
});

const dependencyGroupSchema = z.object({
  name: z.string(),
  lifecycle: z.string(),
  conditionType: z.string(),
  conditionValue: z.string().nullable().optional(),
  selectionMode: z.string(),
  exclusiveGroup: z.string().nullable().optional(),
  fallbackPriority: z.number().int().nullable().optional(),
  compatibleWith: z.array(z.string()).nullable().optional(),
  defaultEnabled: z.boolean().nullable().optional(),
  dependencies: z.array(groupDependencySchema),
});

const dependencyGroupsInfoSchema = z
  .object({
    primaryGroup: z.string().nullable().optional(),
    environmentMarkers: z.array(environmentMarkerSchema).nullable().optional(),
    groups: z.array(dependencyGroupSchema),
  })
  .nullable()
  .optional();

const dependencyReportResponseSchema = z.object({
  package: packageVersionIdentitySchema.nullable().optional(),
  dependencies: dependencyBundleSchema,
  dependencyGroups: dependencyGroupsInfoSchema,
});

const dependenciesGraphQLResponseSchema = z.object({
  data: z
    .object({
      packageDependencies: dependencyReportResponseSchema.nullable().optional(),
    })
    .nullable()
    .optional(),
  errors: z.array(graphQLErrorSchema).optional(),
});

const PACKAGE_DEPENDENCIES_QUERY = `
query PackageDependencies(
  $registry: Registry!
  $name: String!
  $version: String
  $includeTransitive: Boolean
  $maxDepth: Int
  $lifecycle: [String!]
) {
  packageDependencies(
    registry: $registry
    name: $name
    version: $version
    includeTransitive: $includeTransitive
    maxDepth: $maxDepth
    lifecycle: $lifecycle
  ) {
    package {
      name
      registry
      version
    }
    dependencies {
      # Backend-side summary block intentionally not selected — our
      # envelope computes runtime.count client-side from direct[].length
      # so the invariant runtime.count === runtime.items.length always
      # holds regardless of backend-side drift.
      direct {
        name
        versionConstraint
        type
      }
      transitive {
        totalEdges
        uniquePackagesCount
        uniqueDependencies
        dependencyConflicts {
          packageName
          requiredVersions
          conflictingEdges {
            fromIndex
            toIndex
            versionConstraint
            dependencyType
          }
        }
        circularDependencyCycles {
          cycleStart
          circularPath
          displayChain
        }
        dependencyGraph {
          formatVersion
          nodes {
            registry
            name
            version
          }
          edges {
            fromIndex
            toIndex
            constraint
            dependencyType
          }
        }
      }
    }
    dependencyGroups {
      primaryGroup
      environmentMarkers {
        type
        value
        raw
      }
      groups {
        name
        lifecycle
        conditionType
        conditionValue
        selectionMode
        exclusiveGroup
        fallbackPriority
        compatibleWith
        defaultEnabled
        dependencies {
          name
          constraint
        }
      }
    }
  }
}`;

const PACKAGE_UPGRADE_DEPENDENCY_PROBE_QUERY = `
query PackageUpgradeDependencyProbe(
  $registry: Registry!
  $name: String!
  $version: String!
  $includeTransitiveRisk: Boolean!
  $includeTransitiveSecurity: Boolean!
  $includeDependencyIssues: Boolean!
  $includeDependencyChanges: Boolean!
  $includeGroups: Boolean!
  $lifecycle: [String!]
  $minSeverity: Float
) {
  packageDependencies(
    registry: $registry
    name: $name
    version: $version
    includeTransitive: $includeTransitiveRisk
    lifecycle: $lifecycle
  ) {
    package {
      name
      registry
      version
      publishedAt
      deprecated
      deprecationReason
    }
    dependencies {
      direct {
        name
        versionConstraint
        type
      }
      transitive @include(if: $includeTransitiveRisk) {
        dependencyGraph @include(if: $includeDependencyChanges) {
          formatVersion
          nodes {
            registry
            name
            version
          }
          edges {
            fromIndex
            toIndex
            constraint
            dependencyType
          }
        }
        vulnerabilitySummary(minSeverity: $minSeverity) @include(if: $includeTransitiveSecurity) {
          affected {
            totalVulnerabilities
            critical
            high
            medium
            low
            unknown
          }
          nonAffecting {
            totalVulnerabilities
            critical
            high
            medium
            low
            unknown
          }
          combined {
            totalVulnerabilities
            critical
            high
            medium
            low
            unknown
          }
          totalPackagesAnalyzed
          affectedPackageCount
          calculatedAt
          packages {
            registry
            name
            versions
            affectedCount
            nonAffectingCount
            totalCount
            maxSeverityScore
            maxSeverityLabel
            advisoryIds(scope: AFFECTED)
            mostCritical {
              osvId
              registry
              packageName
              summary
              severityScore
              severityType
              affectedVersionRanges
              fixedInVersions
              publishedAt
              modifiedAt
              withdrawnAt
              aliases
              isMalicious
            }
            advisoryOccurrences(scope: AFFECTED, minSeverity: $minSeverity, limit: 5) {
              version
              affectsResolvedVersion
              matchedAffectedVersionRanges
              fixVersionsAboveResolved
              nearestFixedVersion
              advisory {
                osvId
                registry
                packageName
                summary
                severityScore
                severityType
                affectedVersionRanges
                fixedInVersions
                publishedAt
                modifiedAt
                withdrawnAt
                aliases
                isMalicious
              }
            }
          }
        }
        dependencyIssues @include(if: $includeDependencyIssues) {
          totalCount
          deprecatedCount
          outdatedCount
          duplicateCount
          conflictCount
          deprecatedPackages {
            registry
            name
            versions
            reasons {
              version
              reason
            }
          }
          outdatedPackages {
            registry
            name
            latestVersion
            severity
            versions {
              version
              severity
            }
            repositoryUrl
          }
          duplicatePackages {
            registry
            name
            versions
          }
          conflicts {
            registry
            name
            versions
            requiredVersions
            conflictingEdges {
              fromIndex
              toIndex
              versionConstraint
              dependencyType
            }
          }
        }
      }
    }
    dependencyGroups @include(if: $includeGroups) {
      primaryGroup
      environmentMarkers {
        type
        value
        raw
      }
      groups {
        name
        lifecycle
        conditionType
        conditionValue
        selectionMode
        exclusiveGroup
        fallbackPriority
        compatibleWith
        defaultEnabled
        dependencies {
          name
          constraint
        }
      }
    }
  }
}`;

// --------------------------------------------------------------------
// Zod schema + query for packageChangelog
// --------------------------------------------------------------------

const changelogPackageInfoSchema = z
  .object({
    name: z.string().nullable().optional(),
    registry: z.string().nullable().optional(),
    repoUrl: z.string().nullable().optional(),
    fromVersion: z.string().nullable().optional(),
    toVersion: z.string().nullable().optional(),
    limit: z.number().int().nullable().optional(),
  })
  .nullable()
  .optional();

const changelogEntryDetailSchema = z.object({
  version: z.string().nullable().optional(),
  normalizedVersion: z.string().nullable().optional(),
  body: z.string().nullable().optional(),
  htmlUrl: z.string().nullable().optional(),
  publishedAt: z.string().nullable().optional(),
  // `metadata` is schema-level GenericJSON and we drop it from the
  // service-returned shape today (envelope doesn't surface it). We
  // still request-select it on the wire so live smoke can observe
  // real shapes for a future typed surface.
  metadata: z.unknown().nullable().optional(),
});

const changelogReportResponseSchema = z.object({
  package: changelogPackageInfoSchema,
  source: z.string().nullable().optional(),
  entries: z.array(changelogEntryDetailSchema).nullable().optional(),
});

const changelogGraphQLResponseSchema = z.object({
  data: z
    .object({
      packageChangelog: changelogReportResponseSchema.nullable().optional(),
    })
    .nullable()
    .optional(),
  errors: z.array(graphQLErrorSchema).optional(),
});

const PACKAGE_CHANGELOG_QUERY = `
query PackageChangelog(
  $registry: Registry
  $name: String
  $repoUrl: String
  $gitRef: String
  $fromVersion: String
  $toVersion: String
  $limit: Int
) {
  packageChangelog(
    registry: $registry
    name: $name
    repoUrl: $repoUrl
    gitRef: $gitRef
    fromVersion: $fromVersion
    toVersion: $toVersion
    limit: $limit
  ) {
    package {
      name
      registry
      repoUrl
      fromVersion
      toVersion
      limit
    }
    source
    entries {
      version
      normalizedVersion
      body
      htmlUrl
      publishedAt
      metadata
    }
  }
}`;

// --------------------------------------------------------------------
// Zod schema + queries for package docs
// --------------------------------------------------------------------

const packageDocSourceKindSchema = z.enum(["CRAWLED", "REPOSITORY"]);

const packageDocPageSummarySchema = z.object({
  id: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  slug: z.string().nullable().optional(),
  order: z.number().int().nullable().optional(),
  linkName: z.string().nullable().optional(),
  lastUpdatedAt: z.string().nullable().optional(),
  sourceKind: packageDocSourceKindSchema.nullable().optional(),
  sourceUrl: z.string().nullable().optional(),
  repoUrl: z.string().nullable().optional(),
  gitRef: z.string().nullable().optional(),
  requestedRef: z.string().nullable().optional(),
  filePath: z.string().nullable().optional(),
});

const packageDocsPageInfoSchema = z
  .object({
    hasNextPage: z.boolean(),
    endCursor: z.string().nullable().optional(),
    totalCount: z.number().int().nullable().optional(),
  })
  .nullable()
  .optional();

const packageDocsListResponseSchema = z.object({
  registry: z.string().nullable().optional(),
  packageName: z.string().nullable().optional(),
  version: z.string().nullable().optional(),
  stale: z.boolean().nullable().optional(),
  pages: z.array(packageDocPageSummarySchema).nullable().optional(),
  pageInfo: packageDocsPageInfoSchema,
});

const packageDocSourceSchema = z
  .object({
    url: z.string().nullable().optional(),
    label: z.string().nullable().optional(),
  })
  .nullable()
  .optional();

const packageDocPageSchema = z
  .object({
    id: z.string().nullable().optional(),
    title: z.string().nullable().optional(),
    content: z.string().nullable().optional(),
    contentFormat: z.string().nullable().optional(),
    breadcrumbs: z.array(z.string()).nullable().optional(),
    linkName: z.string().nullable().optional(),
    lastUpdatedAt: z.string().nullable().optional(),
    sourceKind: packageDocSourceKindSchema.nullable().optional(),
    source: packageDocSourceSchema,
    repoUrl: z.string().nullable().optional(),
    gitRef: z.string().nullable().optional(),
    requestedRef: z.string().nullable().optional(),
    filePath: z.string().nullable().optional(),
    baseUrl: z.string().nullable().optional(),
  })
  .nullable()
  .optional();

const packageDocResultResponseSchema = z.object({
  registry: z.string().nullable().optional(),
  packageName: z.string().nullable().optional(),
  version: z.string().nullable().optional(),
  sourceKind: packageDocSourceKindSchema.nullable().optional(),
  page: packageDocPageSchema,
});

const packageDocsListGraphQLResponseSchema = z.object({
  data: z
    .object({
      listPackageDocs: packageDocsListResponseSchema.nullable().optional(),
    })
    .nullable()
    .optional(),
  errors: z.array(graphQLErrorSchema).optional(),
});

const packageDocReadGraphQLResponseSchema = z.object({
  data: z
    .object({
      getDocPage: packageDocResultResponseSchema.nullable().optional(),
    })
    .nullable()
    .optional(),
  errors: z.array(graphQLErrorSchema).optional(),
});

const LIST_PACKAGE_DOCS_QUERY = `
query ListPackageDocs(
  $registry: Registry!
  $packageName: String!
  $version: String
  $limit: Int
  $after: String
) {
  listPackageDocs(
    registry: $registry
    packageName: $packageName
    version: $version
    limit: $limit
    after: $after
  ) {
    registry
    packageName
    version
    stale
    pages {
      id
      title
      slug
      order
      linkName
      lastUpdatedAt
      sourceKind
      sourceUrl
      repoUrl
      gitRef
      requestedRef
      filePath
    }
    pageInfo {
      hasNextPage
      endCursor
      totalCount
    }
  }
}`;

const READ_PACKAGE_DOC_QUERY = `
query ReadPackageDoc($pageId: String!) {
  getDocPage(pageId: $pageId) {
    registry
    packageName
    version
    sourceKind
    page {
      id
      title
      content
      contentFormat
      breadcrumbs
      linkName
      lastUpdatedAt
      sourceKind
      source {
        url
        label
      }
      repoUrl
      gitRef
      requestedRef
      filePath
      baseUrl
    }
  }
}`;

// --------------------------------------------------------------------
// Service implementation
// --------------------------------------------------------------------

export class PackageIntelligenceServiceImpl
  implements PackageIntelligenceService
{
  constructor(
    private readonly endpointUrl: string,
    private readonly tokenProvider: TokenProvider,
    private readonly fetchFn: typeof fetch = globalThis.fetch,
    private readonly runtime: {
      clientHeaders?: ClientHeaderBuilder;
      userAgent?: string;
      clientVersion?: string;
    } = {},
  ) {}

  async packageSummary(params: PackageSummaryParams): Promise<PackageSummary> {
    return withTelemetrySpan("pkg-intel.summary.request", () =>
      executeWithTokenRefresh({
        getToken: () => this.tokenProvider.getToken(),
        forceRefresh: () => this.tokenProvider.forceRefresh(),
        shouldRefresh: (error) => error instanceof AuthenticationError,
        executeWithToken: (token) => this.executePackageSummary(token, params),
      }),
    );
  }

  private async executePackageSummary(
    token: string,
    params: PackageSummaryParams,
  ): Promise<PackageSummary> {
    let response: PkgseerGraphqlResponse;
    try {
      response = await postPkgseerGraphql({
        endpointUrl: this.endpointUrl,
        token,
        query: PACKAGE_SUMMARY_QUERY,
        variables: {
          registry: params.registry,
          name: params.packageName,
        },
        fetchFn: this.fetchFn,
        clientHeaders: this.runtime.clientHeaders,
        userAgent: this.runtime.userAgent,
      });
    } catch (cause) {
      if (cause instanceof PkgseerTransportError) {
        throw this.createTransportError(cause);
      }
      throw cause;
    }

    if (response.status < 200 || response.status >= 300) {
      throw this.createHttpError(response);
    }

    const parsed = graphQLResponseSchema.safeParse(response.parsedBody);
    if (!parsed.success) {
      throw new MalformedPackageIntelligenceResponseError(
        "Malformed response from the package-intelligence service.",
      );
    }

    if (parsed.data.errors && parsed.data.errors.length > 0) {
      throw this.createGraphQLError(parsed.data.errors);
    }

    const data = parsed.data.data?.packageSummary;
    if (!data) {
      throw new MalformedPackageIntelligenceResponseError(
        "Empty response from the package-intelligence service.",
      );
    }

    return this.normalise(data);
  }

  private createHttpError(response: PkgseerGraphqlResponse): Error {
    const status = response.status;
    const detail = parseDetail(response.responseBody);

    if (status === 401) {
      return new AuthenticationError();
    }

    if (status === 403) {
      return new PackageIntelligenceAccessError(detail ?? "Access denied.");
    }

    if (status >= 500) {
      return new PackageIntelligenceBackendError(
        detail
          ? `Server error (${status}): ${detail}`
          : `Server error (${status})`,
        status,
      );
    }

    return new PackageIntelligenceBackendError(
      detail ?? `Request failed with status ${status}`,
      status,
    );
  }

  private createTransportError(error: PkgseerTransportError): Error {
    if (isFetchTimeoutError(error.cause)) {
      return new PackageIntelligenceBackendError(
        "Package intelligence request timed out.",
        undefined,
        "TIMEOUT",
        true,
      );
    }
    return new PackageIntelligenceNetworkError(
      "Could not reach the package intelligence service. Check your connection or set GITHITS_CODE_NAV_URL.",
      { cause: error },
    );
  }

  private createGraphQLError(
    errors: Array<z.infer<typeof graphQLErrorSchema>>,
  ): Error {
    const message = errors.map((error) => error.message).join(", ");
    const extensions = getPrimaryExtensions(errors);
    const code =
      typeof extensions?.code === "string" ? extensions.code : undefined;
    const retryable =
      typeof extensions?.retryable === "boolean"
        ? extensions.retryable
        : undefined;

    if (isClientUpdateRequiredGraphQLError({ message, code })) {
      return new ClientUpdateRequiredError(
        undefined,
        undefined,
        this.runtime.clientVersion,
      );
    }

    if (isGraphQLSchemaMismatchError({ message, code })) {
      const sanitized =
        "Backend protocol mismatch. Your CLI may be newer than the server, or the server may require a newer CLI. Run `githits update-check` to verify your installed version. Set GITHITS_DEBUG=pkg-graphql to inspect GraphQL details during local development.";
      debugLog("pkg-graphql", {
        event: "graphql-schema-mismatch",
        code: code ?? "omitted",
        message,
      });
      return new PackageIntelligenceBackendError(
        isDebugAreaEnabled("pkg-graphql") ? message : sanitized,
        undefined,
        code,
        retryable,
      );
    }

    switch (code) {
      case "NOT_FOUND":
      case "PACKAGE_NOT_FOUND":
        return new PackageIntelligenceTargetNotFoundError(message);

      case "VERSION_NOT_FOUND":
        return new PackageIntelligenceVersionNotFoundError(
          message,
          typeof extensions?.package === "string"
            ? extensions.package
            : undefined,
          typeof extensions?.requested_version === "string"
            ? extensions.requested_version
            : undefined,
          parseVersionList(
            extensions?.available_versions ?? extensions?.availableVersions,
          ),
        );

      case "UNSUPPORTED_REGISTRY":
      case "VALIDATION_ERROR":
        return new PackageIntelligenceValidationError(message);

      case "FEATURE_FLAG_REQUIRED":
        return new PackageIntelligenceFeatureFlagRequiredError(message);

      case "UNAUTHORIZED":
        return new AuthenticationError();

      case "FORBIDDEN":
        return new PackageIntelligenceAccessError(
          "Access denied. This feature may not be enabled for your account.",
        );

      case "UPSTREAM_ERROR":
      case "TIMEOUT":
      case "RATE_LIMITED":
      case "INTERNAL_ERROR":
      case "UNKNOWN_ERROR":
        return new PackageIntelligenceBackendError(
          message,
          undefined,
          code,
          retryable,
        );

      default:
        break;
    }

    return new PackageIntelligenceBackendError(
      message,
      undefined,
      code,
      retryable,
    );
  }

  private normalise(
    data: z.infer<typeof packageSummaryResponseSchema>,
  ): PackageSummary {
    const name = data.package?.name ?? undefined;
    const latestVersion = data.package?.latestVersion ?? undefined;
    if (!name || !latestVersion) {
      throw new MalformedPackageIntelligenceResponseError(
        "Package summary response missing required name/latestVersion.",
      );
    }

    const pkg = data.package;
    const github = pkg?.githubRepository;

    const identity: PackageIdentity = {
      name,
      latestVersion,
      registry: pkg?.registry ?? undefined,
      description: pkg?.description ?? undefined,
      latestVersionPublishedAt: pkg?.latestVersionPublishedAt ?? undefined,
      homepage: pkg?.homepage ?? undefined,
      repositoryUrl: pkg?.repositoryUrl ?? undefined,
      license: pkg?.license ?? undefined,
      downloadsLastMonth: pkg?.downloadsLastMonth ?? undefined,
      downloadsTotal: pkg?.downloadsTotal ?? undefined,
      githubRepository: github
        ? {
            stargazersCount: github.stargazersCount ?? undefined,
            forksCount: github.forksCount ?? undefined,
            openIssuesCount: github.openIssuesCount ?? undefined,
            archived: github.archived ?? undefined,
            language: github.language ?? undefined,
            topics: github.topics ?? undefined,
            pushedAt: github.pushedAt ?? undefined,
          }
        : undefined,
    };

    const security: PackageSecurityOverview | undefined = data.security
      ? {
          vulnerabilityCount: data.security.vulnerabilityCount ?? undefined,
          hasCurrentVulnerabilities:
            data.security.hasCurrentVulnerabilities ?? undefined,
          recentVulnerabilities:
            data.security.recentVulnerabilities?.map((vuln) => ({
              osvId: vuln.osvId ?? undefined,
              summary: vuln.summary ?? undefined,
              severityScore: vuln.severityScore ?? undefined,
              publishedAt: vuln.publishedAt ?? undefined,
            })) ?? undefined,
        }
      : undefined;

    const latestChangelogs: ChangelogEntry[] | undefined =
      data.latestChangelogs?.map((entry) => ({
        version: entry.version ?? undefined,
        publishedAt: entry.publishedAt ?? undefined,
        body: entry.body ?? undefined,
      })) ?? undefined;

    return {
      package: identity,
      security,
      latestChangelogs,
    };
  }

  async packageVulnerabilities(
    params: PackageVulnerabilitiesParams,
  ): Promise<VulnerabilityReport> {
    return withTelemetrySpan("pkg-intel.vulnerabilities.request", () =>
      executeWithTokenRefresh({
        getToken: () => this.tokenProvider.getToken(),
        forceRefresh: () => this.tokenProvider.forceRefresh(),
        shouldRefresh: (error) => error instanceof AuthenticationError,
        executeWithToken: (token) =>
          this.executePackageVulnerabilities(token, params),
      }),
    );
  }

  private async executePackageVulnerabilities(
    token: string,
    params: PackageVulnerabilitiesParams,
  ): Promise<VulnerabilityReport> {
    let after: string | null = null;
    let firstPage:
      | z.infer<typeof vulnerabilityReportResponseSchema>
      | undefined;
    const entries: z.infer<typeof vulnerabilityDetailSchema>[] = [];
    const seenCursors = new Set<string>();

    do {
      const page = await this.fetchPackageVulnerabilitiesPage(
        token,
        params,
        after,
      );
      if (!firstPage) firstPage = page;

      const advisoryPage = page.security?.advisories;
      if (!advisoryPage) {
        after = null;
        break;
      }

      entries.push(...advisoryPage.entries);
      if (advisoryPage.pageInfo.hasNextPage) {
        const nextCursor = advisoryPage.pageInfo.endCursor;
        if (!nextCursor) {
          throw new MalformedPackageIntelligenceResponseError(
            "Vulnerability response pagination omitted next cursor.",
          );
        }
        if (seenCursors.has(nextCursor)) {
          throw new MalformedPackageIntelligenceResponseError(
            "Vulnerability response pagination repeated a cursor.",
          );
        }
        seenCursors.add(nextCursor);
        after = nextCursor;
      } else {
        after = null;
      }
    } while (after !== null);

    if (!firstPage) {
      throw new MalformedPackageIntelligenceResponseError(
        "Empty response from the package-intelligence service.",
      );
    }

    if (firstPage.security) {
      const expectedCount = firstPage.security.advisories.pageInfo.totalCount;
      if (entries.length !== expectedCount) {
        throw new MalformedPackageIntelligenceResponseError(
          "Vulnerability response pagination returned an incomplete advisory set.",
        );
      }
    }

    const data = firstPage.security
      ? {
          ...firstPage,
          security: {
            ...firstPage.security,
            advisories: {
              ...firstPage.security.advisories,
              entries,
            },
          },
        }
      : firstPage;

    return this.normaliseVulnerabilityReport(data);
  }

  private async fetchPackageVulnerabilitiesPage(
    token: string,
    params: PackageVulnerabilitiesParams,
    after: string | null,
  ): Promise<z.infer<typeof vulnerabilityReportResponseSchema>> {
    let response: PkgseerGraphqlResponse;
    try {
      response = await postPkgseerGraphql({
        endpointUrl: this.endpointUrl,
        token,
        query: PACKAGE_VULNERABILITIES_QUERY,
        variables: {
          registry: params.registry,
          name: params.packageName,
          version: params.version,
          minSeverity: params.minSeverity,
          includeWithdrawn: params.includeWithdrawn,
          scope: params.advisoryScope,
          after,
        },
        fetchFn: this.fetchFn,
        clientHeaders: this.runtime.clientHeaders,
        userAgent: this.runtime.userAgent,
      });
    } catch (cause) {
      if (cause instanceof PkgseerTransportError) {
        throw this.createTransportError(cause);
      }
      throw cause;
    }

    if (response.status < 200 || response.status >= 300) {
      throw this.createHttpError(response);
    }

    const parsed = vulnerabilitiesGraphQLResponseSchema.safeParse(
      response.parsedBody,
    );
    if (!parsed.success) {
      throw new MalformedPackageIntelligenceResponseError(
        "Malformed response from the package-intelligence service.",
      );
    }

    if (parsed.data.errors && parsed.data.errors.length > 0) {
      throw promoteGenericVersionNotFound(
        this.createGraphQLError(parsed.data.errors),
        params,
      );
    }

    const data = parsed.data.data?.packageVulnerabilities;
    if (!data) {
      throw new MalformedPackageIntelligenceResponseError(
        "Empty response from the package-intelligence service.",
      );
    }

    return data;
  }

  private normaliseVulnerabilityReport(
    data: z.infer<typeof vulnerabilityReportResponseSchema>,
  ): VulnerabilityReport {
    const name = data.package?.name ?? undefined;
    const version = data.package?.version ?? undefined;
    if (!name || !version) {
      throw new MalformedPackageIntelligenceResponseError(
        "Vulnerability report response missing required name/version.",
      );
    }

    const identity: PackageVersionIdentity = {
      name,
      version,
      registry: data.package?.registry ?? undefined,
      publishedAt: data.package?.publishedAt ?? undefined,
      deprecated: data.package?.deprecated ?? undefined,
      deprecationReason: data.package?.deprecationReason ?? undefined,
    };

    const security: VulnerabilitySecurityDetails | undefined = data.security
      ? {
          affectedVulnerabilityCount: data.security.affectedVulnerabilityCount,
          nonAffectingVulnerabilityCount:
            data.security.nonAffectingVulnerabilityCount,
          allVulnerabilityCount: data.security.allVulnerabilityCount,
          currentVersionAffected:
            data.security.currentVersionAffected ?? undefined,
          vulnerabilities: data.security.advisories.entries.map((vuln) => ({
            osvId: vuln.osvId ?? undefined,
            summary: vuln.summary ?? undefined,
            severityScore: vuln.severityScore ?? undefined,
            severityType: vuln.severityType ?? undefined,
            affectedVersionRanges: vuln.affectedVersionRanges ?? undefined,
            affectedVersionRangesCount: vuln.affectedVersionRangesCount,
            affectedVersionRangesTruncated: vuln.affectedVersionRangesTruncated,
            fixedInVersions: vuln.fixedInVersions ?? undefined,
            publishedAt: vuln.publishedAt ?? undefined,
            modifiedAt: vuln.modifiedAt ?? undefined,
            withdrawnAt: vuln.withdrawnAt ?? undefined,
            aliases: vuln.aliases ?? undefined,
            isMalicious: vuln.isMalicious ?? undefined,
            affectsInspectedVersion: vuln.affectsInspectedVersion,
            matchedAffectedVersionRanges: vuln.matchedAffectedVersionRanges,
            duplicateIds: vuln.duplicateIds,
          })),
          upgradePaths: data.security.upgradePaths ?? undefined,
        }
      : undefined;

    return {
      package: identity,
      security,
    };
  }

  async packageDependencies(
    params: PackageDependenciesParams,
  ): Promise<DependencyReport> {
    return withTelemetrySpan("pkg-intel.dependencies.request", () =>
      executeWithTokenRefresh({
        getToken: () => this.tokenProvider.getToken(),
        forceRefresh: () => this.tokenProvider.forceRefresh(),
        shouldRefresh: (error) => error instanceof AuthenticationError,
        executeWithToken: (token) =>
          this.executePackageDependencies(token, params),
      }),
    );
  }

  async packageUpgradeDependencyProbe(
    params: PackageUpgradeDependencyProbeParams,
  ): Promise<DependencyReport> {
    return withTelemetrySpan("pkg-intel.upgrade-dependency-probe.request", () =>
      executeWithTokenRefresh({
        getToken: () => this.tokenProvider.getToken(),
        forceRefresh: () => this.tokenProvider.forceRefresh(),
        shouldRefresh: (error) => error instanceof AuthenticationError,
        executeWithToken: (token) =>
          this.executePackageUpgradeDependencyProbe(token, params),
      }),
    );
  }

  private async executePackageUpgradeDependencyProbe(
    token: string,
    params: PackageUpgradeDependencyProbeParams,
  ): Promise<DependencyReport> {
    const includeTransitiveRisk =
      params.includeTransitiveSecurity === true ||
      params.includeDependencyIssues === true ||
      params.includeDependencyChanges === true;
    let response: PkgseerGraphqlResponse;
    try {
      response = await postPkgseerGraphql({
        endpointUrl: this.endpointUrl,
        token,
        query: PACKAGE_UPGRADE_DEPENDENCY_PROBE_QUERY,
        variables: {
          registry: params.registry,
          name: params.packageName,
          version: params.version,
          includeTransitiveRisk,
          includeTransitiveSecurity: params.includeTransitiveSecurity === true,
          includeDependencyIssues: params.includeDependencyIssues === true,
          includeDependencyChanges: params.includeDependencyChanges === true,
          includeGroups: params.includeGroups === true,
          lifecycle: params.includeGroups === true ? ["peer"] : undefined,
          minSeverity: params.minSeverity,
        },
        fetchFn: this.fetchFn,
        clientHeaders: this.runtime.clientHeaders,
        userAgent: this.runtime.userAgent,
      });
    } catch (cause) {
      if (cause instanceof PkgseerTransportError) {
        throw this.createTransportError(cause);
      }
      throw cause;
    }

    if (response.status < 200 || response.status >= 300) {
      throw this.createHttpError(response);
    }

    const parsed = dependenciesGraphQLResponseSchema.safeParse(
      response.parsedBody,
    );
    if (!parsed.success) {
      throw new MalformedPackageIntelligenceResponseError(
        "Malformed response from the package-intelligence service.",
      );
    }

    if (parsed.data.errors && parsed.data.errors.length > 0) {
      throw promoteGenericVersionNotFound(
        this.createGraphQLError(parsed.data.errors),
        params,
      );
    }

    const data = parsed.data.data?.packageDependencies;
    if (!data) {
      throw new MalformedPackageIntelligenceResponseError(
        "Empty response from the package-intelligence service.",
      );
    }

    return this.normaliseDependencyReport(data);
  }

  private async executePackageDependencies(
    token: string,
    params: PackageDependenciesParams,
  ): Promise<DependencyReport> {
    let response: PkgseerGraphqlResponse;
    try {
      response = await postPkgseerGraphql({
        endpointUrl: this.endpointUrl,
        token,
        query: PACKAGE_DEPENDENCIES_QUERY,
        variables: {
          registry: params.registry,
          name: params.packageName,
          version: params.version,
          includeTransitive: params.includeTransitive,
          maxDepth: params.maxDepth,
          lifecycle:
            params.lifecycle && params.lifecycle.length > 0
              ? params.lifecycle
              : undefined,
        },
        fetchFn: this.fetchFn,
        clientHeaders: this.runtime.clientHeaders,
        userAgent: this.runtime.userAgent,
      });
    } catch (cause) {
      if (cause instanceof PkgseerTransportError) {
        throw this.createTransportError(cause);
      }
      throw cause;
    }

    if (response.status < 200 || response.status >= 300) {
      throw this.createHttpError(response);
    }

    const parsed = dependenciesGraphQLResponseSchema.safeParse(
      response.parsedBody,
    );
    if (!parsed.success) {
      throw new MalformedPackageIntelligenceResponseError(
        "Malformed response from the package-intelligence service.",
      );
    }

    if (parsed.data.errors && parsed.data.errors.length > 0) {
      throw promoteGenericVersionNotFound(
        this.createGraphQLError(parsed.data.errors),
        params,
      );
    }

    const data = parsed.data.data?.packageDependencies;
    if (!data) {
      throw new MalformedPackageIntelligenceResponseError(
        "Empty response from the package-intelligence service.",
      );
    }

    return this.normaliseDependencyReport(data);
  }

  private normaliseDependencyReport(
    data: z.infer<typeof dependencyReportResponseSchema>,
  ): DependencyReport {
    const name = data.package?.name ?? undefined;
    const version = data.package?.version ?? undefined;
    if (!name || !version) {
      throw new MalformedPackageIntelligenceResponseError(
        "Package dependencies response missing required name/version.",
      );
    }

    const identity: PackageVersionIdentity = {
      name,
      version,
      registry: data.package?.registry ?? undefined,
      publishedAt: data.package?.publishedAt ?? undefined,
      deprecated: data.package?.deprecated ?? undefined,
      deprecationReason: data.package?.deprecationReason ?? undefined,
    };

    const bundle = data.dependencies;
    const dependencies: DependencyBundle | undefined = bundle
      ? {
          direct:
            bundle.direct?.map((entry) => {
              // `name` is schema-level nullable but semantically
              // required — a dep entry with no name is meaningless
              // and silently collapsing to `""` would hide backend
              // bugs. Throw Malformed instead, matching how we
              // handle package.name/version upstream.
              if (!entry.name) {
                throw new MalformedPackageIntelligenceResponseError(
                  "Dependency entry missing required name.",
                );
              }
              return {
                name: entry.name,
                versionConstraint: entry.versionConstraint ?? undefined,
                type: entry.type ?? undefined,
              };
            }) ?? undefined,
          transitive: bundle.transitive
            ? {
                totalEdges: bundle.transitive.totalEdges ?? undefined,
                uniquePackagesCount:
                  bundle.transitive.uniquePackagesCount ?? undefined,
                uniqueDependencies:
                  bundle.transitive.uniqueDependencies ?? undefined,
                dependencyConflicts:
                  bundle.transitive.dependencyConflicts?.map((c) => ({
                    packageName: c.packageName,
                    requiredVersions: c.requiredVersions,
                    conflictingEdges: c.conflictingEdges.map((edge) => ({
                      fromIndex: edge.fromIndex ?? undefined,
                      toIndex: edge.toIndex,
                      versionConstraint: edge.versionConstraint,
                      dependencyType: edge.dependencyType,
                    })),
                  })) ?? undefined,
                circularDependencyCycles:
                  bundle.transitive.circularDependencyCycles?.map((cycle) => ({
                    cycleStart: cycle.cycleStart,
                    circularPath: cycle.circularPath,
                    displayChain: cycle.displayChain,
                  })) ?? undefined,
                dependencyGraph: bundle.transitive.dependencyGraph
                  ? {
                      formatVersion:
                        bundle.transitive.dependencyGraph.formatVersion,
                      nodes: bundle.transitive.dependencyGraph.nodes.map(
                        (n) => ({
                          registry: n.registry,
                          name: n.name,
                          version: n.version ?? undefined,
                        }),
                      ),
                      edges: bundle.transitive.dependencyGraph.edges.map(
                        (e) => ({
                          fromIndex: e.fromIndex ?? undefined,
                          toIndex: e.toIndex,
                          constraint: e.constraint ?? undefined,
                          dependencyType: e.dependencyType ?? undefined,
                        }),
                      ),
                    }
                  : undefined,
                vulnerabilitySummary:
                  this.normaliseTransitiveVulnerabilitySummary(
                    bundle.transitive.vulnerabilitySummary,
                  ),
                dependencyIssues: this.normaliseDependencyIssuesSummary(
                  bundle.transitive.dependencyIssues,
                ),
              }
            : undefined,
        }
      : undefined;

    const dependencyGroups: DependencyGroupsInfo | undefined =
      data.dependencyGroups
        ? {
            primaryGroup: data.dependencyGroups.primaryGroup ?? undefined,
            environmentMarkers:
              data.dependencyGroups.environmentMarkers?.map((m) => ({
                type: m.type ?? undefined,
                value: m.value ?? undefined,
                raw: m.raw ?? undefined,
              })) ?? undefined,
            groups: data.dependencyGroups.groups.map((group) => ({
              name: group.name,
              lifecycle: group.lifecycle,
              conditionType: group.conditionType,
              conditionValue: group.conditionValue ?? undefined,
              selectionMode: group.selectionMode,
              exclusiveGroup: group.exclusiveGroup ?? undefined,
              fallbackPriority: group.fallbackPriority ?? undefined,
              compatibleWith: group.compatibleWith ?? undefined,
              defaultEnabled: group.defaultEnabled ?? undefined,
              dependencies: group.dependencies.map((entry) => ({
                name: entry.name,
                constraint: entry.constraint ?? undefined,
              })),
            })),
          }
        : undefined;

    return {
      package: identity,
      dependencies,
      dependencyGroups,
    };
  }

  private normaliseTransitiveVulnerabilitySummary(
    summary: z.infer<typeof transitiveVulnerabilitySummarySchema>,
  ): TransitiveVulnerabilitySummary | undefined {
    if (!summary) return undefined;
    return {
      affected: summary.affected,
      nonAffecting: summary.nonAffecting,
      combined: summary.combined,
      totalPackagesAnalyzed: summary.totalPackagesAnalyzed,
      affectedPackageCount: summary.affectedPackageCount,
      calculatedAt: summary.calculatedAt ?? undefined,
      packages: summary.packages.map((pkg) => ({
        registry: pkg.registry,
        name: pkg.name,
        versions: pkg.versions,
        affectedCount: pkg.affectedCount,
        nonAffectingCount: pkg.nonAffectingCount,
        totalCount: pkg.totalCount,
        maxSeverityScore: pkg.maxSeverityScore ?? undefined,
        maxSeverityLabel: pkg.maxSeverityLabel ?? undefined,
        advisoryIds: pkg.advisoryIds,
        mostCritical: pkg.mostCritical
          ? this.normaliseVulnerabilitySummaryDetail(pkg.mostCritical)
          : undefined,
        advisoryOccurrences:
          pkg.advisoryOccurrences?.map((occurrence) => ({
            version: occurrence.version,
            affectsResolvedVersion: occurrence.affectsResolvedVersion,
            matchedAffectedVersionRanges:
              occurrence.matchedAffectedVersionRanges,
            fixVersionsAboveResolved: occurrence.fixVersionsAboveResolved,
            nearestFixedVersion: occurrence.nearestFixedVersion ?? undefined,
            advisory: this.normaliseVulnerabilitySummaryDetail(
              occurrence.advisory,
            ),
          })) ?? undefined,
      })),
    };
  }

  private normaliseVulnerabilitySummaryDetail(
    advisory: z.infer<typeof vulnerabilitySummaryDetailSchema>,
  ): VulnerabilitySummaryDetail {
    return {
      osvId: advisory.osvId ?? undefined,
      registry: advisory.registry ?? undefined,
      packageName: advisory.packageName ?? undefined,
      summary: advisory.summary ?? undefined,
      severityScore: advisory.severityScore ?? undefined,
      severityType: advisory.severityType ?? undefined,
      affectedVersionRanges: advisory.affectedVersionRanges ?? undefined,
      fixedInVersions: advisory.fixedInVersions ?? undefined,
      publishedAt: advisory.publishedAt ?? undefined,
      modifiedAt: advisory.modifiedAt ?? undefined,
      withdrawnAt: advisory.withdrawnAt ?? undefined,
      aliases: advisory.aliases ?? undefined,
      isMalicious: advisory.isMalicious ?? undefined,
    };
  }

  private normaliseDependencyIssuesSummary(
    issues: z.infer<typeof dependencyIssuesSummarySchema>,
  ): DependencyIssuesSummary | undefined {
    if (!issues) return undefined;
    return {
      totalCount: issues.totalCount,
      deprecatedCount: issues.deprecatedCount,
      outdatedCount: issues.outdatedCount,
      duplicateCount: issues.duplicateCount,
      conflictCount: issues.conflictCount,
      deprecatedPackages: issues.deprecatedPackages.map((pkg) => ({
        registry: pkg.registry,
        name: pkg.name,
        versions: pkg.versions,
        reasons: pkg.reasons.map((reason) => ({
          version: reason.version,
          reason: reason.reason ?? undefined,
        })),
      })),
      outdatedPackages: issues.outdatedPackages.map((pkg) => ({
        registry: pkg.registry,
        name: pkg.name,
        latestVersion: pkg.latestVersion ?? undefined,
        severity: pkg.severity,
        versions: pkg.versions.map((version) => ({
          version: version.version,
          severity: version.severity,
        })),
        repositoryUrl: pkg.repositoryUrl ?? undefined,
      })),
      duplicatePackages: issues.duplicatePackages.map((pkg) => ({
        registry: pkg.registry ?? undefined,
        name: pkg.name,
        versions: pkg.versions,
      })),
      conflicts: issues.conflicts.map((conflict) => ({
        registry: conflict.registry ?? undefined,
        name: conflict.name,
        versions: conflict.versions,
        requiredVersions: conflict.requiredVersions,
        conflictingEdges: conflict.conflictingEdges.map((edge) => ({
          fromIndex: edge.fromIndex ?? undefined,
          toIndex: edge.toIndex,
          versionConstraint: edge.versionConstraint,
          dependencyType: edge.dependencyType,
        })),
      })),
    };
  }

  async packageChangelog(
    params: PackageChangelogParams,
  ): Promise<ChangelogReport> {
    return withTelemetrySpan("pkg-intel.changelog.request", () =>
      executeWithTokenRefresh({
        getToken: () => this.tokenProvider.getToken(),
        forceRefresh: () => this.tokenProvider.forceRefresh(),
        shouldRefresh: (error) => error instanceof AuthenticationError,
        executeWithToken: (token) =>
          this.executePackageChangelog(token, params),
      }),
    );
  }

  private async executePackageChangelog(
    token: string,
    params: PackageChangelogParams,
  ): Promise<ChangelogReport> {
    let response: PkgseerGraphqlResponse;
    try {
      response = await postPkgseerGraphql({
        endpointUrl: this.endpointUrl,
        token,
        query: PACKAGE_CHANGELOG_QUERY,
        variables: {
          registry: params.registry,
          name: params.packageName,
          repoUrl: params.repoUrl,
          gitRef: params.gitRef,
          fromVersion: params.fromVersion,
          toVersion: params.toVersion,
          limit: params.limit,
        },
        fetchFn: this.fetchFn,
        clientHeaders: this.runtime.clientHeaders,
        userAgent: this.runtime.userAgent,
      });
    } catch (cause) {
      if (cause instanceof PkgseerTransportError) {
        throw this.createTransportError(cause);
      }
      throw cause;
    }

    if (response.status < 200 || response.status >= 300) {
      throw this.createHttpError(response);
    }

    const parsed = changelogGraphQLResponseSchema.safeParse(
      response.parsedBody,
    );
    if (!parsed.success) {
      throw new MalformedPackageIntelligenceResponseError(
        "Malformed response from the package-intelligence service.",
      );
    }

    if (parsed.data.errors && parsed.data.errors.length > 0) {
      throw promoteGenericVersionNotFound(
        this.createGraphQLError(parsed.data.errors),
        params,
      );
    }

    const data = parsed.data.data?.packageChangelog;
    if (!data) {
      throw new MalformedPackageIntelligenceResponseError(
        "Empty response from the package-intelligence service.",
      );
    }

    return this.normaliseChangelogReport(data, params);
  }

  private normaliseChangelogReport(
    data: z.infer<typeof changelogReportResponseSchema>,
    params: PackageChangelogParams,
  ): ChangelogReport {
    // Backend returns source=null for package version entries that have no
    // changelog entry. Treat no-source as NOT_FOUND only when no entries
    // came back at all.
    const source = data.source?.trim() ? data.source : undefined;
    const rawEntries = data.entries ?? [];
    if (!source && rawEntries.length === 0) {
      const target =
        params.repoUrl ??
        (params.registry && params.packageName
          ? `${params.registry.toLowerCase()}:${params.packageName}`
          : "package");
      throw new PackageIntelligenceChangelogSourceNotFoundError(
        `No changelog source available for ${target} (tried GitHub Releases, CHANGELOG.md, and HexDocs).`,
      );
    }

    const entries: ChangelogEntryDetail[] = rawEntries.map((entry) => ({
      version: entry.version ?? undefined,
      normalizedVersion: entry.normalizedVersion ?? undefined,
      body: entry.body ?? undefined,
      htmlUrl: entry.htmlUrl ?? undefined,
      publishedAt: entry.publishedAt ?? undefined,
      metadata: entry.metadata ?? undefined,
    }));

    const packageInfo: ChangelogPackageInfo | undefined = data.package
      ? {
          name: data.package.name ?? undefined,
          registry: data.package.registry ?? undefined,
          repoUrl: data.package.repoUrl ?? undefined,
          fromVersion: data.package.fromVersion ?? undefined,
          toVersion: data.package.toVersion ?? undefined,
          limit: data.package.limit ?? undefined,
        }
      : undefined;

    return {
      package: packageInfo,
      source,
      entries,
    };
  }

  async listPackageDocs(
    params: ListPackageDocsParams,
  ): Promise<PackageDocsList> {
    return withTelemetrySpan("pkg-intel.docs.list", () =>
      executeWithTokenRefresh({
        getToken: () => this.tokenProvider.getToken(),
        forceRefresh: () => this.tokenProvider.forceRefresh(),
        shouldRefresh: (error) => error instanceof AuthenticationError,
        executeWithToken: (token) => this.executeListPackageDocs(token, params),
      }),
    );
  }

  private async executeListPackageDocs(
    token: string,
    params: ListPackageDocsParams,
  ): Promise<PackageDocsList> {
    let response: PkgseerGraphqlResponse;
    try {
      response = await postPkgseerGraphql({
        endpointUrl: this.endpointUrl,
        token,
        query: LIST_PACKAGE_DOCS_QUERY,
        variables: {
          registry: params.registry,
          packageName: params.packageName,
          version: params.version,
          limit: params.limit,
          after: params.after,
        },
        fetchFn: this.fetchFn,
        clientHeaders: this.runtime.clientHeaders,
        userAgent: this.runtime.userAgent,
      });
    } catch (cause) {
      if (cause instanceof PkgseerTransportError) {
        throw this.createTransportError(cause);
      }
      throw cause;
    }

    if (response.status < 200 || response.status >= 300) {
      throw this.createHttpError(response);
    }

    const parsed = packageDocsListGraphQLResponseSchema.safeParse(
      response.parsedBody,
    );
    if (!parsed.success) {
      throw new MalformedPackageIntelligenceResponseError(
        "Malformed response from the package-intelligence service.",
      );
    }

    if (parsed.data.errors && parsed.data.errors.length > 0) {
      throw promoteGenericVersionNotFound(
        this.createGraphQLError(parsed.data.errors),
        params,
      );
    }

    const data = parsed.data.data?.listPackageDocs;
    if (!data) {
      throw new MalformedPackageIntelligenceResponseError(
        "Empty response from the package-intelligence service.",
      );
    }

    return this.normalisePackageDocsList(data);
  }

  private normalisePackageDocsList(
    data: z.infer<typeof packageDocsListResponseSchema>,
  ): PackageDocsList {
    return {
      registry: data.registry ?? undefined,
      packageName: data.packageName ?? undefined,
      version: data.version ?? undefined,
      stale: data.stale ?? undefined,
      pages:
        data.pages?.map((page) => ({
          id: page.id ?? undefined,
          title: page.title ?? undefined,
          slug: page.slug ?? undefined,
          order: page.order ?? undefined,
          linkName: page.linkName ?? undefined,
          lastUpdatedAt: page.lastUpdatedAt ?? undefined,
          sourceKind: page.sourceKind ?? undefined,
          sourceUrl: page.sourceUrl ?? undefined,
          repoUrl: page.repoUrl ?? undefined,
          gitRef: page.gitRef ?? undefined,
          requestedRef: page.requestedRef ?? undefined,
          filePath: page.filePath ?? undefined,
        })) ?? [],
      pageInfo: data.pageInfo
        ? {
            hasNextPage: data.pageInfo.hasNextPage,
            endCursor: data.pageInfo.endCursor ?? undefined,
            totalCount: data.pageInfo.totalCount ?? undefined,
          }
        : undefined,
    };
  }

  async readPackageDoc(
    params: ReadPackageDocParams,
  ): Promise<PackageDocResult> {
    return withTelemetrySpan("pkg-intel.docs.read", () =>
      executeWithTokenRefresh({
        getToken: () => this.tokenProvider.getToken(),
        forceRefresh: () => this.tokenProvider.forceRefresh(),
        shouldRefresh: (error) => error instanceof AuthenticationError,
        executeWithToken: (token) => this.executeReadPackageDoc(token, params),
      }),
    );
  }

  private async executeReadPackageDoc(
    token: string,
    params: ReadPackageDocParams,
  ): Promise<PackageDocResult> {
    let response: PkgseerGraphqlResponse;
    try {
      response = await postPkgseerGraphql({
        endpointUrl: this.endpointUrl,
        token,
        query: READ_PACKAGE_DOC_QUERY,
        variables: {
          pageId: params.pageId,
        },
        fetchFn: this.fetchFn,
        clientHeaders: this.runtime.clientHeaders,
        userAgent: this.runtime.userAgent,
      });
    } catch (cause) {
      if (cause instanceof PkgseerTransportError) {
        throw this.createTransportError(cause);
      }
      throw cause;
    }

    if (response.status < 200 || response.status >= 300) {
      throw this.createHttpError(response);
    }

    const parsed = packageDocReadGraphQLResponseSchema.safeParse(
      response.parsedBody,
    );
    if (!parsed.success) {
      throw new MalformedPackageIntelligenceResponseError(
        "Malformed response from the package-intelligence service.",
      );
    }

    if (parsed.data.errors && parsed.data.errors.length > 0) {
      throw this.createGraphQLError(parsed.data.errors);
    }

    const data = parsed.data.data?.getDocPage;
    if (!data) {
      throw new MalformedPackageIntelligenceResponseError(
        "Empty response from the package-intelligence service.",
      );
    }

    return this.normalisePackageDocResult(data);
  }

  private normalisePackageDocResult(
    data: z.infer<typeof packageDocResultResponseSchema>,
  ): PackageDocResult {
    return {
      registry: data.registry ?? undefined,
      packageName: data.packageName ?? undefined,
      version: data.version ?? undefined,
      sourceKind: data.sourceKind ?? undefined,
      page: data.page
        ? {
            id: data.page.id ?? undefined,
            title: data.page.title ?? undefined,
            content: data.page.content ?? undefined,
            contentFormat: data.page.contentFormat ?? undefined,
            breadcrumbs: data.page.breadcrumbs ?? undefined,
            linkName: data.page.linkName ?? undefined,
            lastUpdatedAt: data.page.lastUpdatedAt ?? undefined,
            sourceKind: data.page.sourceKind ?? undefined,
            source: data.page.source
              ? {
                  url: data.page.source.url ?? undefined,
                  label: data.page.source.label ?? undefined,
                }
              : undefined,
            repoUrl: data.page.repoUrl ?? undefined,
            gitRef: data.page.gitRef ?? undefined,
            requestedRef: data.page.requestedRef ?? undefined,
            filePath: data.page.filePath ?? undefined,
            baseUrl: data.page.baseUrl ?? undefined,
          }
        : undefined,
    };
  }
}

function parseDetail(body: string): string | undefined {
  if (!body) return undefined;
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    if (typeof parsed.detail === "string") return parsed.detail;
    if (typeof parsed.error === "string") return parsed.error;
  } catch {
    return body;
  }
  return undefined;
}

function getPrimaryExtensions(
  errors: Array<z.infer<typeof graphQLErrorSchema>>,
): Record<string, unknown> | undefined {
  for (const error of errors) {
    if (error.extensions && Object.keys(error.extensions).length > 0) {
      return error.extensions;
    }
  }
  return undefined;
}

/**
 * Parse a possibly-present list of version strings from an `extensions`
 * value. Accepts a raw array of strings or returns undefined for
 * missing/malformed data. Narrower than the code-nav
 * `availableVersions` parser because vulnerability data has no ref
 * concept — plain version strings suffice.
 */
function parseVersionList(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const versions: string[] = [];
  for (const item of raw) {
    if (typeof item === "string" && item.length > 0) {
      versions.push(item);
    }
  }
  return versions.length > 0 ? versions : undefined;
}
