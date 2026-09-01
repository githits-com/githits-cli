import { z } from "zod";
import { isFetchTimeoutError } from "../shared/fetch-timeout.js";
import {
  type PkgseerGraphqlResponse,
  PkgseerTransportError,
  postPkgseerGraphql,
} from "../shared/pkgseer-graphql.js";
import {
  PKGSEER_REGISTRY_VALUES,
  type PkgseerRegistry,
} from "../shared/pkgseer-registry.js";
import type { ClientHeaderBuilder } from "../shared/request-headers.js";
import {
  ClientUpdateRequiredError,
  isClientUpdateRequiredGraphQLError,
  isGraphQLSchemaMismatchError,
} from "./client-update-required-error.js";
import { executeWithTokenRefresh } from "./execute-with-token-refresh.js";
import {
  AuthenticationError,
  isTokenRefreshableError,
  SERVER_AUTHENTICATION_REJECTED_MESSAGE,
} from "./githits-service.js";
import type { ServiceDiagnostics } from "./runtime-diagnostics.js";
import type { TokenProvider } from "./token-provider.js";

const INDEXING_WAIT_HINT =
  "Wait until ready with CLI `--wait 60000` or MCP `wait_timeout_ms: 60000`.";

/**
 * Back-compat alias — the canonical registry union now lives in
 * `src/shared/pkgseer-registry.ts`. Re-exported here so existing
 * consumers of `CodeNavigationRegistry` compile unchanged.
 */
export type CodeNavigationRegistry = PkgseerRegistry;

/**
 * Precise symbol kind from the backend's unified symbol taxonomy.
 * Prefer `SymbolCategory` for broad filtering; use `SymbolKind`
 * only when the caller knows the exact construct.
 *
 * Taxonomy notes:
 * - `method` excludes constructor/getter/setter/operator
 * - `field` excludes property/event
 * - `module` excludes namespace/package/object
 * - `class` excludes record/mixin/actor
 * - `interface` excludes protocol/annotation
 */
export type SymbolKind =
  | "FUNCTION"
  | "METHOD"
  | "CONSTRUCTOR"
  | "GETTER"
  | "SETTER"
  | "OPERATOR"
  | "CLASS"
  | "INTERFACE"
  | "TRAIT"
  | "STRUCT"
  | "ENUM"
  | "RECORD"
  | "PROTOCOL"
  | "EXTENSION"
  | "DELEGATE"
  | "MIXIN"
  | "ACTOR"
  | "ANNOTATION"
  | "TYPE"
  | "MODULE"
  | "NAMESPACE"
  | "PACKAGE"
  | "OBJECT"
  | "FIELD"
  | "PROPERTY"
  | "EVENT"
  | "CONSTANT"
  | "DOC_SECTION";

/**
 * Broad symbol category — the preferred filtering surface. Computed
 * by the backend from the precise `kind`, so it works across the
 * full kind taxonomy without enumerating individual kinds.
 */
export type SymbolCategory =
  | "CALLABLE"
  | "TYPE"
  | "MODULE"
  | "DATA"
  | "DOCUMENTATION";

export type FileIntent =
  | "PRODUCTION"
  | "TEST"
  | "BENCHMARK"
  | "EXAMPLE"
  | "GENERATED"
  | "FIXTURE"
  | "BUILD"
  | "VENDOR";

export interface CodeNavigationTarget {
  registry?: CodeNavigationRegistry;
  packageName?: string;
  version?: string;
  repoUrl?: string;
  gitRef?: string;
}

export interface UnifiedSearchTarget extends CodeNavigationTarget {
  /** Standalone documentation site target, canonicalized as `site:<host[/path]>`. */
  site?: string;
}

export interface IndexResolution {
  requestedVersion?: string;
  requestedRef?: string;
  resolvedRef?: string;
  commitSha?: string;
}

export interface TargetResolutionIdentity {
  kind?: string;
  registry?: string;
  packageName?: string;
  version?: string;
  repoUrl?: string;
  gitRef?: string;
  commitSha?: string;
  site?: string;
}

export type AvailableRef = AvailableVersion;
export type SuggestedRef = AvailableVersion;

export interface TargetResolution {
  requested?: TargetResolutionIdentity;
  resolvedRequested?: TargetResolutionIdentity;
  served?: TargetResolutionIdentity;
  freshness?: string;
  freshnessReason?: string;
  indexingRef?: string;
  availableVersions: AvailableVersion[];
  availableRefs: AvailableRef[];
  suggestedRefs?: SuggestedRef[];
}

export type UnifiedSearchSource = "AUTO" | "DOCS" | "CODE" | "SYMBOL";

export type UnifiedSearchResultType =
  | "DOCUMENTATION_PAGE"
  | "REPOSITORY_SYMBOL"
  | "REPOSITORY_CODE"
  | "REPOSITORY_DOC";

export type KnownUnifiedSearchSessionStatus =
  | "PENDING"
  | "INDEXING"
  | "SEARCHING"
  | "COMPLETED"
  | "DEFERRED"
  | "TIMEOUT"
  | "FAILED";

/**
 * Backend-owned search-session status. Known values have explicit client
 * behavior; future values remain readable instead of invalidating the whole
 * response.
 */
export type UnifiedSearchSessionStatus =
  | KnownUnifiedSearchSessionStatus
  | (string & {});

export type CodeIndexState =
  | "CURRENT"
  | "INDEXED"
  | "INDEXING"
  | "PROVISIONAL"
  | "STALE"
  | "FAILED"
  | "MISSING"
  | string;

/** Coverage state of the selected published documentation corpus. */
export type DocCoverageState =
  | "NONE"
  | "PARTIAL"
  | "CAPPED"
  | "COMPLETE"
  | string;

/**
 * Coverage metadata for crawled documentation site data. Present on docs
 * source status and progress targets when the backend has crawl metadata.
 */
export interface DocCoverage {
  coverageState: DocCoverageState;
  coverageReason?: string;
  pagesCrawled?: number;
  frontierRemaining?: number | null;
  artifactOverflowPageCount?: number;
  estimatedTotalPages?: number;
  /** Backend-owned coverage note retained for structured callers. */
  note?: string;
}

export type DiscoveryRequestedRefKind =
  | "OMITTED_VERSION"
  | "LATEST_VERSION"
  | "EXACT_VERSION"
  | "DEFAULT_BRANCH"
  | "HEAD"
  | "BRANCH"
  | "SHA";

export type DiscoveryTargetMode =
  | "PACKAGES"
  | "REPO"
  | "MIXED"
  | "SITES"
  | "SITE";

export interface UnifiedSearchFilters {
  fileIntent?: FileIntent;
  kind?: SymbolKind;
  category?: SymbolCategory;
  publicOnly?: boolean;
  pathPrefix?: string;
}

export interface UnifiedSearchParams {
  targets: UnifiedSearchTarget[];
  query: string;
  sources?: UnifiedSearchSource[];
  filters?: UnifiedSearchFilters;
  allowPartialResults?: boolean;
  limit?: number;
  offset?: number;
  waitTimeoutMs?: number;
}

export interface UnifiedSearchEvidenceRange {
  startLine: number;
  endLine: number;
  matchLine?: number;
  rangeKind?: string;
  matchSpansTruncated: boolean;
}

export interface UnifiedSearchIndexedRange {
  startLine: number;
  endLine: number;
}

export interface UnifiedSearchDefinitionRange {
  filePath: string;
  repositoryFilePath: string;
  startLine: number;
  endLine: number;
}

interface UnifiedSearchSymbolContextBase {
  name: string;
  qualifiedPath?: string;
  kind?: string;
}

export interface UnifiedSearchEnclosingSymbolContext
  extends UnifiedSearchSymbolContextBase {
  relation: "encloses_match";
  definitionRange: UnifiedSearchDefinitionRange;
}

export interface UnifiedSearchAssociatedSymbolContext
  extends UnifiedSearchSymbolContextBase {
  relation: "associated_with_indexed_chunk";
  definitionRange?: UnifiedSearchDefinitionRange;
}

export type UnifiedSearchSymbolContext =
  | UnifiedSearchEnclosingSymbolContext
  | UnifiedSearchAssociatedSymbolContext;

export interface UnifiedSearchLocator {
  registry?: string;
  packageName?: string;
  version?: string;
  pageId?: string;
  sourceKind?: string;
  sourceUrl?: string;
  repoUrl?: string;
  gitRef?: string;
  commitSha?: string;
  requestedRef?: string;
  filePath?: string;
  repositoryFilePath?: string;
  startLine?: number;
  endLine?: number;
  evidenceRange?: UnifiedSearchEvidenceRange;
  indexedRange?: UnifiedSearchIndexedRange;
  symbolContext?: UnifiedSearchSymbolContext;
  fileContentHash?: string;
  symbolRef?: string;
  qualifiedPath?: string;
  kind?: string;
  category?: string;
  language?: string;
}

export interface UnifiedSearchHit {
  id: string;
  resultType: UnifiedSearchResultType;
  targetLabel: string;
  title?: string;
  summary?: string;
  score?: number;
  highlights?: {
    title?: Array<readonly [number, number]>;
    summary?: Array<readonly [number, number]>;
  };
  locator: UnifiedSearchLocator;
  requestedTargetLabel?: string;
  freshTargetLabel?: string;
  servedTargetLabel?: string;
  freshness?: CodeIndexState;
}

export interface UnifiedSearchPageInfo {
  offset: number;
  limit: number;
  returned: number;
  hasMore: boolean;
}

export interface UnifiedSearchSourceStatus {
  source: UnifiedSearchSource;
  targetLabel: string;
  requestedTargetLabel?: string;
  freshTargetLabel?: string;
  servedTargetLabel?: string;
  targetResolution?: TargetResolution;
  indexingStatus?: string;
  codeIndexState?: CodeIndexState;
  resultCount?: number;
  appliedFilters: string[];
  ignoredFilters: string[];
  incompatibleFilters: string[];
  appliedQueryFeatures: string[];
  ignoredQueryFeatures: string[];
  incompatibleQueryFeatures: string[];
  suggestedSiteTargets: string[];
  suggestedSiteTargetsTruncated: boolean;
  note?: string;
  coverage?: DocCoverage;
  contributors?: UnifiedSearchDocumentationContributor[];
}

export type UnifiedSearchDocumentationContributorKind =
  | "REPOSITORY_DOCS"
  | "DOCPACK";

export type UnifiedSearchDocumentationContributorState =
  | "SEARCHED"
  | "READY"
  | "PENDING"
  | "UNAVAILABLE";

// Closed GraphQL producer contract: roll out new freshness values to consumers first;
// unlike backend-owned session status, unknown freshness values must fail validation.
export type UnifiedSearchDocumentationFreshness =
  | "CURRENT"
  | "PROVISIONAL"
  | "STALE";

/** One physical documentation corpus disclosed for a DOCS source row. */
export interface UnifiedSearchDocumentationContributor {
  kind: UnifiedSearchDocumentationContributorKind;
  state: UnifiedSearchDocumentationContributorState;
  freshness?: UnifiedSearchDocumentationFreshness;
  resultCount: number;
  repositoryUrl?: string;
  commitSha?: string;
  siteKey?: string;
  siteUrl?: string;
  coverage?: DocCoverage;
}

export interface UnifiedSearchProgressTarget {
  requested?: string;
  resolvedRequested?: string;
  served?: string;
  freshness?: CodeIndexState;
  indexingRef?: string;
  requestedRefKind?: DiscoveryRequestedRefKind;
  targetResolution?: TargetResolution;
  availableVersions?: AvailableVersion[];
  availableRefs?: AvailableRef[];
  suggestedRefs?: SuggestedRef[];
  coverage?: DocCoverage;
}

export interface UnifiedSearchRequestedTarget {
  registry?: CodeNavigationRegistry;
  name?: string;
  version?: string;
  repoUrl?: string;
  gitRef?: string;
  site?: string;
}

export interface UnifiedSearchResult {
  query: string;
  queryWarnings: string[];
  sources: UnifiedSearchSource[];
  results: UnifiedSearchHit[];
  page: UnifiedSearchPageInfo;
  partialResults: boolean;
  sourceStatus: UnifiedSearchSourceStatus[];
  evidenceNotice?: string;
}

export interface UnifiedSearchProgress {
  searchRef: string;
  status: UnifiedSearchSessionStatus;
  targetsTotal: number;
  targetsReady: number;
  elapsedMs: number;
  query: string;
  queryWarnings: string[];
  sources: UnifiedSearchSource[];
  requestedSources?: UnifiedSearchSource[];
  targetMode?: DiscoveryTargetMode;
  requestedTargets?: UnifiedSearchRequestedTarget[];
  filters?: UnifiedSearchFilters;
  limit?: number;
  offset?: number;
  targets?: UnifiedSearchProgressTarget[];
  expiresAt?: string;
}

export interface UnifiedSearchCompleted {
  state: "completed";
  completed: true;
  searchRef?: string;
  result: UnifiedSearchResult;
  progress?: UnifiedSearchProgress;
}

export interface UnifiedSearchIncomplete {
  state: "incomplete";
  completed: false;
  searchRef: string;
  result?: UnifiedSearchResult;
  progress?: UnifiedSearchProgress;
}

export type UnifiedSearchOutcome =
  | UnifiedSearchCompleted
  | UnifiedSearchIncomplete;

export interface AvailableVersion {
  version?: string;
  ref: string;
}

export interface IndexingDurationEstimate {
  lowerSeconds?: number;
  upperSeconds?: number;
  elapsedSeconds?: number;
  sampleCount?: number;
  source?: string;
}

/**
 * Input for {@link CodeNavigationService.listFiles}.
 */
export interface ListFilesParams {
  target: CodeNavigationTarget;
  pathSelectors?: GrepRepoPathSelector[];
  pathPrefix?: string;
  extensions?: string[];
  fileTypes?: string[];
  languages?: string[];
  fileIntent?: FileIntent;
  fileIntents?: FileIntent[];
  excludeFileIntents?: FileIntent[];
  excludeDocFiles?: boolean;
  excludeTestFiles?: boolean;
  includeHidden?: boolean;
  limit?: number;
  waitTimeoutMs?: number;
}

export interface RepoFileEntry {
  path: string;
  name?: string;
  language?: string;
  fileType?: string;
  byteSize?: number;
}

export interface ListFilesResult {
  files: RepoFileEntry[];
  total: number;
  hasMore: boolean;
  indexedVersion?: string;
  resolution?: IndexResolution;
  targetResolution?: TargetResolution;
  hint?: string;
}

/**
 * Input for {@link CodeNavigationService.readFile}.
 */
export interface ReadFileParams {
  target: CodeNavigationTarget;
  filePath: string;
  startLine?: number;
  endLine?: number;
  waitTimeoutMs?: number;
}

export interface ReadFileResult {
  filePath?: string;
  language?: string;
  totalLines?: number;
  startLine?: number;
  endLine?: number;
  content?: string;
  isBinary?: boolean;
  targetResolution?: TargetResolution;
  availableVersions?: AvailableVersion[];
}

/**
 * A package-addressing target for a repository-wide CodeDiff. Version
 * resolution belongs to the comparison endpoints, so this target
 * intentionally has no version field. Package addressing resolves repository
 * identity and commits; it does not narrow raw file results to a package path.
 * Target selection uses own-key presence; a `repoUrl` key rejects this shape
 * even when its value is `undefined`.
 */
export interface CodeDiffPackageTarget {
  registry: CodeNavigationRegistry;
  packageName: string;
}

/**
 * A public repository target for CodeDiff. Ref resolution belongs to the
 * comparison endpoints, so this target intentionally has no gitRef field.
 * Target selection uses own-key presence; a `registry` or `packageName` key
 * rejects this shape even when its value is `undefined`.
 */
export interface CodeDiffRepositoryTarget {
  repoUrl: string;
}

export type CodeDiffTarget = CodeDiffPackageTarget | CodeDiffRepositoryTarget;

export type CodeDiffMode = "inventory" | "stats" | "patches";

export interface CodeDiffOptions {
  maxFiles?: number;
  maxPatchBytes?: number;
  pathPrefix?: string;
  pathGlob?: string;
}

export interface CodeDiffParams {
  target: CodeDiffTarget;
  from: string;
  to: string;
  mode: CodeDiffMode;
  options?: CodeDiffOptions;
}

export type CodeDiffRefKind = "SHA" | "TAG" | "BRANCH" | "HEAD" | "UNKNOWN";

export type CodeDiffVersionSource = "REGISTRY" | "GIT_HEAD" | "TAG" | "RELEASE";

/**
 * Effective raw inventory scope. Current successful backends return
 * `REPOSITORY`; `PACKAGE` and `UNKNOWN` remain accepted for compatibility with
 * legacy responses.
 */
export type RawCodeDiffScopeStatus = "PACKAGE" | "REPOSITORY" | "UNKNOWN";

export type RawCodeDiffFileStatus = "ADDED" | "DELETED" | "MODIFIED";

export type RawCodeDiffPathEncoding = "UTF8" | "BYTE_ESCAPED";

export type RawCodeDiffFileContentStatus =
  | "NOT_REQUESTED"
  | "STATS"
  | "PATCH"
  | "BINARY"
  | "METADATA_ONLY"
  | "OMITTED"
  | "UNAVAILABLE";

export type RawCodeDiffContentCoverage =
  | "NOT_REQUESTED"
  | "COMPLETE"
  | "PARTIAL"
  | "FAILED";

export type ContentModification =
  | "INVISIBLE_CONTROLS_STRIPPED"
  | "HTML_COMMENTS_STRIPPED"
  | "IMAGES_REPLACED"
  | "UNSAFE_LINKS_NEUTRALIZED";

export interface CodeDiffPackageInfo {
  registry: CodeNavigationRegistry;
  name: string;
  repoUrl: string;
}

export interface CodeDiffRefResolution {
  requested: string;
  resolvedVersion?: string;
  ref: string;
  commitSha: string;
  refKind: CodeDiffRefKind;
  versionSource?: CodeDiffVersionSource;
}

export interface RawCodeDiffSummary {
  filesChanged: number;
  added: number;
  deleted: number;
  modified: number;
  modeChanged: number;
  typeChanged: number;
  inventoryComplete: boolean;
  unprojectableFiles: number;
}

export interface RawCodeDiffScope {
  /** Scope of returned paths and counts, independent of addressing form. */
  status: RawCodeDiffScopeStatus;
  /** Legacy package-scope metadata; absent from current repository results. */
  fromSubpath?: string;
  /** Legacy package-scope metadata; absent from current repository results. */
  toSubpath?: string;
  /** Caller-supplied repository-relative filter, not verified package scope. */
  pathPrefix?: string;
  /** Caller-supplied repository-relative filter, not verified package scope. */
  pathGlob?: string;
}

export interface RawCodeDiffContentFailure {
  code: string;
  retryable: boolean;
  retryAfterMs?: number;
  stage?: string;
  limitKind?: string;
}

export interface ContentSafety {
  filtered: boolean;
  modifications: ContentModification[];
}

export interface RawCodeDiffFile {
  path: string;
  pathEncoding: RawCodeDiffPathEncoding;
  status: RawCodeDiffFileStatus;
  modeChanged: boolean;
  typeChanged: boolean;
  additions?: number;
  deletions?: number;
  patch?: string;
  contentStatus: RawCodeDiffFileContentStatus;
  contentOmissionReason?: string;
  contentSafety: ContentSafety;
}

export interface RawCodeDiff {
  summary: RawCodeDiffSummary;
  scope: RawCodeDiffScope;
  contentCoverage: RawCodeDiffContentCoverage;
  contentFailure?: RawCodeDiffContentFailure;
  files: RawCodeDiffFile[];
  hasMoreFiles: boolean;
}

export interface CodeDiffResult {
  package?: CodeDiffPackageInfo;
  fromResolution: CodeDiffRefResolution;
  toResolution: CodeDiffRefResolution;
  raw: RawCodeDiff;
}

export interface CodeDiffErrorRef {
  ref: string;
  version?: string;
}

/**
 * Bounded metadata retained from PkgSeer CodeDiff GraphQL errors. Do not add
 * arbitrary extension values here: this object is safe to pass to public
 * error envelopes and telemetry.
 */
export interface CodeDiffErrorDetails {
  code?: string;
  retryable?: boolean;
  side?: string;
  publishedVersions?: string[];
  publishedVersionsTruncated?: boolean;
  availableVersions?: AvailableVersion[];
  registry?: string;
  retryAfterMs?: number;
  stage?: string;
  limitKind?: string;
  repoUrl?: string;
  gitRef?: string;
  availableRefs?: CodeDiffErrorRef[];
  suggestedRefs?: CodeDiffErrorRef[];
  refKinds?: string[];
}

export interface CodeDiffPartialResult {
  package?: CodeDiffPackageInfo;
  fromResolution: CodeDiffRefResolution;
  toResolution: CodeDiffRefResolution;
  raw?: RawCodeDiff;
}

export type GrepRepoPatternType = "LITERAL" | "REGEX";

export type GrepPathSelectorKind = "EXACT" | "PREFIX" | "GLOB";

export interface GrepRepoPathSelector {
  kind: GrepPathSelectorKind;
  value: string;
}

export interface GrepRepoParams {
  target: CodeNavigationTarget;
  pattern: string;
  patternType?: GrepRepoPatternType;
  caseSensitive?: boolean;
  pathSelectors?: GrepRepoPathSelector[];
  extensions?: string[];
  excludeDocFiles?: boolean;
  excludeTestFiles?: boolean;
  allowUnscoped?: boolean;
  contextLinesBefore?: number;
  contextLinesAfter?: number;
  maxMatches?: number;
  maxMatchesPerFile?: number;
  cursor?: string;
  symbolFields?: string[];
  waitTimeoutMs?: number;
}

export interface NavigationSymbol {
  symbolRef?: string;
  name?: string;
  qualifiedPath?: string;
  kind?: string;
  category?: string;
  arity?: number;
  isPublic?: boolean;
  filePath?: string;
  startLine?: number;
  endLine?: number;
  code?: string;
  callerCount?: number;
  contentHash?: string;
  parentSymbolRef?: string;
  parentPath?: string;
}

export interface GrepRepoMatch {
  filePath: string;
  line: number;
  matchStartByte: number;
  matchEndByte: number;
  lineContent: string;
  contextBefore?: string[];
  contextAfter?: string[];
  fileContentHash?: string;
  fileIntent?: string;
  symbolRowId?: string;
  symbol?: NavigationSymbol;
}

export type GrepRouteTaken = "SINGLE_FILE" | "CONTENT_INDEX";

export type GrepTruncatedReason =
  | "NONE"
  | "MAX_MATCHES"
  | "MAX_MATCHES_PER_FILE"
  | "DEADLINE";

export interface GrepRepoResult {
  matches: GrepRepoMatch[];
  nextCursor?: string;
  hasMore: boolean;
  truncatedReason: GrepTruncatedReason;
  routeTaken?: GrepRouteTaken;
  filesScanned: number;
  filesInScope: number;
  binaryFilesSkipped: number;
  filesTooLargeSkipped: number;
  totalMatches: number;
  uniqueFilesMatched: number;
  indexedVersion?: string;
  resolution?: IndexResolution;
  targetResolution?: TargetResolution;
}

export interface CodeNavigationService {
  search(params: UnifiedSearchParams): Promise<UnifiedSearchOutcome>;
  searchStatus(
    searchRef: string,
    waitTimeoutMs?: number,
  ): Promise<UnifiedSearchOutcome>;
  listFiles(params: ListFilesParams): Promise<ListFilesResult>;
  readFile(params: ReadFileParams): Promise<ReadFileResult>;
  grepRepo(params: GrepRepoParams): Promise<GrepRepoResult>;
}

/** Additive client capability for the unpromoted CodeDiff surface. */
export interface CodeDiffService {
  codeDiff(params: CodeDiffParams): Promise<CodeDiffResult>;
}

export class CodeNavigationAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CodeNavigationAccessError";
  }
}

export class CodeNavigationGraphQLError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "CodeNavigationGraphQLError";
  }
}

export class CodeNavigationIndexingError extends Error {
  constructor(
    message: string,
    public readonly indexingRef?: string,
    public readonly availableVersions?: AvailableVersion[],
    public readonly availableRefs?: AvailableRef[],
    public readonly targetResolution: TargetResolution | undefined = undefined,
    public readonly indexingEstimate:
      | IndexingDurationEstimate
      | undefined = undefined,
    public readonly hint: string | undefined = undefined,
  ) {
    super(message);
    this.name = "CodeNavigationIndexingError";
  }
}

export interface CodeNavigationErrorMetadata {
  hint?: string;
  filePath?: string;
  exclusionReason?: string;
  availableVersions?: AvailableVersion[];
  availableRefs?: AvailableRef[];
  suggestedRefs?: SuggestedRef[];
  targetResolution?: TargetResolution;
  indexingEstimate?: IndexingDurationEstimate;
}

export class CodeNavigationUnresolvableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CodeNavigationUnresolvableError";
  }
}

export class MalformedCodeNavigationResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MalformedCodeNavigationResponseError";
  }
}

/**
 * GraphQL resolver error for CodeDiff. `partial` is present only when the
 * backend returned a valid root resolution alongside a field-local error.
 */
export class CodeDiffError extends Error {
  constructor(
    message: string,
    public readonly details: CodeDiffErrorDetails | undefined = undefined,
    public readonly partial: CodeDiffPartialResult | undefined = undefined,
  ) {
    super(message);
    this.name = "CodeDiffError";
  }
}

export class CodeNavigationTargetNotFoundError extends Error {
  constructor(
    message: string,
    public readonly availableVersions?: AvailableVersion[],
    public readonly repoUrl?: string,
    public readonly requestedRef?: string,
    public readonly metadata:
      | CodeNavigationErrorMetadata
      | undefined = undefined,
  ) {
    super(message);
    this.name = "CodeNavigationTargetNotFoundError";
  }
}

/**
 * Raised when the backend confirmed the package / repo exists but
 * the requested file path could not be found within it. Distinct
 * from `CodeNavigationTargetNotFoundError` (package itself missing)
 * because the recovery path differs — callers should re-check the
 * path against `list_files` rather than re-check the package name.
 */
export class CodeNavigationFileNotFoundError extends Error {
  constructor(
    message: string,
    public readonly filePath: string | undefined,
  ) {
    super(message);
    this.name = "CodeNavigationFileNotFoundError";
  }
}

/**
 * Raised when the target package exists in the index but the
 * requested version has no matching indexed ref. Distinct from
 * `CodeNavigationTargetNotFoundError` because the recovery path
 * differs (switch to a supported version rather than check the
 * package name). Carries the structured fields backend populates
 * on `VERSION_NOT_FOUND`.
 */
export class CodeNavigationVersionNotFoundError extends Error {
  constructor(
    message: string,
    public readonly packageName: string | undefined,
    public readonly requestedVersion: string | undefined,
    public readonly latestIndexed: string | undefined,
    public readonly availableVersions: AvailableVersion[] | undefined,
    public readonly metadata:
      | CodeNavigationErrorMetadata
      | undefined = undefined,
  ) {
    super(message);
    this.name = "CodeNavigationVersionNotFoundError";
  }
}

/**
 * Raised when a repository target exists but the requested git ref does
 * not resolve. Carries backend-provided ref suggestions for callers to
 * surface as "did you mean" recovery hints.
 */
export class CodeNavigationRefNotFoundError extends Error {
  constructor(
    message: string,
    public readonly repoUrl: string | undefined,
    public readonly requestedRef: string | undefined,
    public readonly availableRefs: AvailableRef[] | undefined,
    public readonly suggestedRefs: SuggestedRef[] | undefined,
    public readonly metadata:
      | CodeNavigationErrorMetadata
      | undefined = undefined,
  ) {
    super(message);
    this.name = "CodeNavigationRefNotFoundError";
  }
}

/**
 * Raised when the caller submitted invalid input that the backend
 * rejected with `VALIDATION_ERROR` (e.g. query too long). Treated as
 * a client error (non-retryable, INVALID_ARGUMENT on the mapped
 * envelope).
 */
export class CodeNavigationValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CodeNavigationValidationError";
  }
}

/**
 * Raised when the backend reports an authorization feature check failure.
 * Same user-facing handling as ACCESS_DENIED.
 */
export class CodeNavigationFeatureFlagRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CodeNavigationFeatureFlagRequiredError";
  }
}

export class CodeNavigationNetworkError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "CodeNavigationNetworkError";
  }
}

export class CodeNavigationBackendError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly graphqlCode?: string,
    /**
     * Backend-provided retryability hint. When present, callers
     * should trust it over per-code defaults. Populated by the
     * April 2026 `extensions.retryable` contract on GraphQL errors.
     */
    public readonly retryable?: boolean,
    public readonly metadata:
      | CodeNavigationErrorMetadata
      | undefined = undefined,
  ) {
    super(message);
    this.name = "CodeNavigationBackendError";
  }
}

const TARGET_RESOLUTION_AVAILABLE_REFS_SELECTION = `
availableRefs {
  version
  ref
}`;

const TARGET_RESOLUTION_SUGGESTED_REFS_SELECTION = `
suggestedRefs {
  version
  ref
}`;

const DISCOVERY_TARGET_PROGRESS_SUGGESTED_REFS_SELECTION = `
suggestedRefs {
  version
  ref
}`;

/**
 * Crawl coverage for documentation site data. Selected on both docs source
 * status and progress targets so callers can distinguish "no matches" from
 * "evidence withheld or incomplete because the crawl is partial or capped".
 */
const DOC_COVERAGE_SELECTION = `
coverage {
  coverageState
  coverageReason
  pagesCrawled
  frontierRemaining
  artifactOverflowPageCount
  estimatedTotalPages
  note
}`;

const DOCUMENTATION_CONTRIBUTORS_SELECTION = `
contributors {
  kind
  state
  freshness
  resultCount
  repositoryUrl
  commitSha
  siteKey
  siteUrl
  ${DOC_COVERAGE_SELECTION}
}`;

const TARGET_RESOLUTION_SELECTION = `
targetResolution {
  requested {
    kind
    registry
    packageName
    version
    repoUrl
    gitRef
    commitSha
  }
  resolvedRequested {
    kind
    registry
    packageName
    version
    repoUrl
    gitRef
    commitSha
  }
  served {
    kind
    registry
    packageName
    version
    repoUrl
    gitRef
    commitSha
  }
  freshness
  freshnessReason
  indexingRef
  availableVersions {
    version
    ref
  }
  ${TARGET_RESOLUTION_AVAILABLE_REFS_SELECTION}
  ${TARGET_RESOLUTION_SUGGESTED_REFS_SELECTION}
}`;

const CODE_CONTEXT_AVAILABLE_VERSIONS_SELECTION = `
availableVersions {
  version
  ref
}`;

const DISCOVERY_TARGET_PROGRESS_RETRY_SELECTION = `
availableVersions {
  version
  ref
}
availableRefs {
  version
  ref
}
${DISCOVERY_TARGET_PROGRESS_SUGGESTED_REFS_SELECTION}`;

const INDEXING_DURATION_ESTIMATE_SELECTION = `
indexingEstimate {
  lowerSeconds
  upperSeconds
  elapsedSeconds
  sampleCount
  source
}`;

const UNIFIED_SEARCH_LOCATOR_SELECTION = `
registry
packageName
version
pageId
sourceKind
sourceUrl
repoUrl
gitRef
commitSha
requestedRef
filePath
repositoryFilePath
startLine
endLine
evidenceRange {
  startLine
  endLine
  matchLine
  rangeKind
  matchSpansTruncated
}
indexedRange {
  startLine
  endLine
}
symbolContext {
  name
  qualifiedPath
  kind
  relation
  definitionRange {
    filePath
    repositoryFilePath
    startLine
    endLine
  }
}
fileContentHash
symbolRef
qualifiedPath
kind
category
language`;

const UNIFIED_SEARCH_QUERY = `
query UnifiedSearch(
  $targets: [SearchPackageInput!]!
  $query: String!
  $sources: [DiscoverySearchSource!]
  $filters: DiscoverySearchFiltersInput
  $allowPartialResults: Boolean
  $limit: Int
  $offset: Int
  $waitTimeoutMs: Int
) {
  search(
    targets: $targets
    query: $query
    sources: $sources
    filters: $filters
    allowPartialResults: $allowPartialResults
    limit: $limit
    offset: $offset
    waitTimeoutMs: $waitTimeoutMs
  ) {
    completed
    searchRef
    result {
      query
      queryWarnings
      sources
      results {
        id
        resultType
        targetLabel
        requestedTargetLabel
        freshTargetLabel
        servedTargetLabel
        freshness
        title
        summary
        score
        highlights {
          title
          summary
        }
        locator {
          ${UNIFIED_SEARCH_LOCATOR_SELECTION}
        }
      }
      page {
        offset
        limit
        returned
        hasMore
      }
      partialResults
      evidenceNotice
      sourceStatus {
        source
        targetLabel
        requestedTargetLabel
        freshTargetLabel
        servedTargetLabel
        ${TARGET_RESOLUTION_SELECTION}
        indexingStatus
        codeIndexState
        resultCount
        appliedFilters
        ignoredFilters
        incompatibleFilters
        appliedQueryFeatures
        ignoredQueryFeatures
        incompatibleQueryFeatures
        suggestedSiteTargets
        suggestedSiteTargetsTruncated
        note
        ${DOC_COVERAGE_SELECTION}
        ${DOCUMENTATION_CONTRIBUTORS_SELECTION}
      }
    }
    progress {
      searchRef
      status
      targetsTotal
      targetsReady
      elapsedMs
      query
      queryWarnings
      sources
      requestedSources
      targetMode
      requestedTargets {
        registry
        name
        version
        repoUrl
        gitRef
        site
      }
      filters {
        fileIntent
        kind
        category
        publicOnly
        pathPrefix
      }
      limit
      offset
      targets {
        requested
        resolvedRequested
        served
        freshness
        indexingRef
        requestedRefKind
        ${TARGET_RESOLUTION_SELECTION}
        ${DISCOVERY_TARGET_PROGRESS_RETRY_SELECTION}
        ${DOC_COVERAGE_SELECTION}
      }
      expiresAt
    }
  }
}`;

const UNIFIED_SEARCH_STATUS_QUERY = `
query UnifiedSearchStatus($searchRef: String!, $includeResults: Boolean!, $waitTimeoutMs: Int) {
  discoverySearchProgress(searchRef: $searchRef, includeResults: $includeResults, waitTimeoutMs: $waitTimeoutMs) {
    searchRef
    status
    targetsTotal
    targetsReady
    elapsedMs
    query
    queryWarnings
    sources
    requestedSources
    targetMode
    requestedTargets {
      registry
      name
      version
      repoUrl
      gitRef
      site
    }
    filters {
      fileIntent
      kind
      category
      publicOnly
      pathPrefix
    }
    limit
    offset
    targets {
      requested
      resolvedRequested
      served
      freshness
      indexingRef
      requestedRefKind
      ${TARGET_RESOLUTION_SELECTION}
      ${DISCOVERY_TARGET_PROGRESS_RETRY_SELECTION}
      ${DOC_COVERAGE_SELECTION}
    }
    expiresAt
    results {
      query
      queryWarnings
      sources
      results {
        id
        resultType
        targetLabel
        requestedTargetLabel
        freshTargetLabel
        servedTargetLabel
        freshness
        title
        summary
        score
        highlights {
          title
          summary
        }
        locator {
          ${UNIFIED_SEARCH_LOCATOR_SELECTION}
        }
      }
      page {
        offset
        limit
        returned
        hasMore
      }
      partialResults
      evidenceNotice
      sourceStatus {
        source
        targetLabel
        requestedTargetLabel
        freshTargetLabel
        servedTargetLabel
        ${TARGET_RESOLUTION_SELECTION}
        indexingStatus
        codeIndexState
        resultCount
        appliedFilters
        ignoredFilters
        incompatibleFilters
        appliedQueryFeatures
        ignoredQueryFeatures
        incompatibleQueryFeatures
        suggestedSiteTargets
        suggestedSiteTargetsTruncated
        note
        ${DOC_COVERAGE_SELECTION}
        ${DOCUMENTATION_CONTRIBUTORS_SELECTION}
      }
    }
  }
}`;

function debugUnifiedSearchRequest(
  variables: {
    targets: Array<Record<string, unknown>>;
    query: string;
    sources?: UnifiedSearchSource[];
    filters?: UnifiedSearchFilters;
    allowPartialResults: boolean;
    limit?: number;
    offset?: number;
    waitTimeoutMs?: number;
  },
  diagnostics?: ServiceDiagnostics,
): void {
  if (!diagnostics?.isEnabled("code-nav")) return;
  const serialised = serialiseForDebug(variables);
  const filters = asRecord(serialised.filters);

  diagnostics.debug("code-nav", {
    event: "request",
    operation: "search",
    targetCount: Array.isArray(serialised.targets)
      ? serialised.targets.length
      : 0,
    sources: Array.isArray(serialised.sources) ? serialised.sources : [],
    hasFilters: filters !== undefined,
    filterKeys: filters ? Object.keys(filters).sort() : [],
    fileIntent:
      filters && typeof filters.fileIntent === "string"
        ? filters.fileIntent
        : "omitted",
    allowPartialResults: serialised.allowPartialResults === true,
    presentVariableKeys: Object.keys(serialised).sort(),
    hasLimit: typeof serialised.limit === "number",
    hasOffset: typeof serialised.offset === "number",
    waitTimeoutMs:
      typeof serialised.waitTimeoutMs === "number"
        ? serialised.waitTimeoutMs
        : undefined,
  });
}

function debugGraphqlWireRequest(
  operation: "search" | "codeDiff",
  graphqlQuery: string,
  variables: Record<string, unknown>,
  diagnostics?: ServiceDiagnostics,
): void {
  if (!diagnostics?.isEnabled("code-nav-wire")) return;
  diagnostics.debug("code-nav-wire", {
    event: "wire-request",
    operation,
    graphqlQuery,
    variables: serialiseForDebug(variables),
  });
}

function serialiseForDebug(
  value: Record<string, unknown>,
): Record<string, unknown> {
  try {
    const text = JSON.stringify(value);
    if (!text) return {};
    const parsed = JSON.parse(text);
    return asRecord(parsed) ?? {};
  } catch {
    return {};
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

const availableVersionSchema = z.object({
  version: z.string().nullable().optional(),
  ref: z.string(),
});

const indexingDurationEstimateSchema = z
  .object({
    lowerSeconds: z.number().int().nullable().optional(),
    upperSeconds: z.number().int().nullable().optional(),
    elapsedSeconds: z.number().int().nullable().optional(),
    sampleCount: z.number().int().nullable().optional(),
    source: z.string().nullable().optional(),
  })
  .nullable()
  .optional();

const targetResolutionIdentitySchema = z
  .object({
    kind: z.string().nullable().optional(),
    registry: z.string().nullable().optional(),
    packageName: z.string().nullable().optional(),
    version: z.string().nullable().optional(),
    repoUrl: z.string().nullable().optional(),
    gitRef: z.string().nullable().optional(),
    commitSha: z.string().nullable().optional(),
    site: z.string().nullable().optional(),
  })
  .nullable()
  .optional();

const targetResolutionSchema = z
  .object({
    requested: targetResolutionIdentitySchema,
    resolvedRequested: targetResolutionIdentitySchema,
    served: targetResolutionIdentitySchema,
    freshness: z.string().nullable().optional(),
    freshnessReason: z.string().nullable().optional(),
    indexingRef: z.string().nullable().optional(),
    availableVersions: z.array(availableVersionSchema).nullable().optional(),
    availableRefs: z.array(availableVersionSchema).nullable().optional(),
    suggestedRefs: z.array(availableVersionSchema).nullable().optional(),
  })
  .nullable()
  .optional();

const unifiedSearchSourceSchema = z.enum(["AUTO", "DOCS", "CODE", "SYMBOL"]);

const unifiedSearchResultTypeSchema = z.enum([
  "DOCUMENTATION_PAGE",
  "REPOSITORY_SYMBOL",
  "REPOSITORY_CODE",
  "REPOSITORY_DOC",
]);

const unifiedSearchLineRangeSchema = z
  .object({
    startLine: z.number().int().positive(),
    endLine: z.number().int().positive(),
  })
  .refine((range) => range.startLine <= range.endLine, {
    message: "startLine must be less than or equal to endLine",
  });

const unifiedSearchEvidenceRangeSchema = unifiedSearchLineRangeSchema.extend({
  matchLine: z.number().int().positive().nullable().optional(),
  rangeKind: z.string().nullable().optional(),
  matchSpansTruncated: z.boolean(),
});

const unifiedSearchDefinitionRangeSchema = unifiedSearchLineRangeSchema.extend({
  filePath: z.string(),
  repositoryFilePath: z.string(),
});

const unifiedSearchSymbolContextBaseSchema = z.object({
  name: z.string(),
  qualifiedPath: z.string().nullable().optional(),
  kind: z.string().nullable().optional(),
});

const unifiedSearchSymbolContextSchema = z.discriminatedUnion("relation", [
  unifiedSearchSymbolContextBaseSchema.extend({
    relation: z.literal("ENCLOSES_MATCH"),
    definitionRange: unifiedSearchDefinitionRangeSchema,
  }),
  unifiedSearchSymbolContextBaseSchema.extend({
    relation: z.literal("ASSOCIATED_WITH_INDEXED_CHUNK"),
    definitionRange: unifiedSearchDefinitionRangeSchema.nullable().optional(),
  }),
]);

const unifiedSearchLocatorSchema = z.object({
  registry: z.string().nullable().optional(),
  packageName: z.string().nullable().optional(),
  version: z.string().nullable().optional(),
  pageId: z.string().nullable().optional(),
  sourceKind: z.string().nullable().optional(),
  sourceUrl: z.string().nullable().optional(),
  repoUrl: z.string().nullable().optional(),
  gitRef: z.string().nullable().optional(),
  commitSha: z.string().nullable().optional(),
  requestedRef: z.string().nullable().optional(),
  filePath: z.string().nullable().optional(),
  repositoryFilePath: z.string().nullable().optional(),
  startLine: z.number().int().nullable().optional(),
  endLine: z.number().int().nullable().optional(),
  evidenceRange: unifiedSearchEvidenceRangeSchema.nullable().optional(),
  indexedRange: unifiedSearchLineRangeSchema.nullable().optional(),
  symbolContext: unifiedSearchSymbolContextSchema.nullable().optional(),
  fileContentHash: z.string().nullable().optional(),
  symbolRef: z.string().nullable().optional(),
  qualifiedPath: z.string().nullable().optional(),
  kind: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  language: z.string().nullable().optional(),
});

const unifiedSearchHitSchema = z.object({
  id: z.string(),
  resultType: unifiedSearchResultTypeSchema,
  targetLabel: z.string(),
  requestedTargetLabel: z.string().nullable().optional(),
  freshTargetLabel: z.string().nullable().optional(),
  servedTargetLabel: z.string().nullable().optional(),
  freshness: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  summary: z.string().nullable().optional(),
  score: z.number().nullable().optional(),
  highlights: z
    .object({
      title: z
        .array(z.tuple([z.number().int(), z.number().int()]))
        .nullable()
        .optional(),
      summary: z
        .array(z.tuple([z.number().int(), z.number().int()]))
        .nullable()
        .optional(),
    })
    .nullable()
    .optional(),
  locator: unifiedSearchLocatorSchema,
});

const unifiedSearchPageInfoSchema = z.object({
  offset: z.number().int(),
  limit: z.number().int(),
  returned: z.number().int(),
  hasMore: z.boolean(),
});

const docCoverageSchema = z
  .object({
    coverageState: z.string(),
    coverageReason: z.string().nullable().optional(),
    pagesCrawled: z.number().int().nullable().optional(),
    frontierRemaining: z.number().int().nullable().optional(),
    artifactOverflowPageCount: z.number().int().nullable().optional(),
    estimatedTotalPages: z.number().int().nullable().optional(),
    note: z.string().nullable().optional(),
  })
  .nullable()
  .optional();

const unifiedSearchDocumentationContributorSchema = z.object({
  kind: z.enum(["REPOSITORY_DOCS", "DOCPACK"]),
  state: z.enum(["SEARCHED", "READY", "PENDING", "UNAVAILABLE"]),
  // Keep this closed GraphQL enum in sync with UnifiedSearchDocumentationFreshness.
  freshness: z.enum(["CURRENT", "PROVISIONAL", "STALE"]).nullable().optional(),
  resultCount: z.number().int().nonnegative(),
  repositoryUrl: z.string().nullable().optional(),
  commitSha: z.string().nullable().optional(),
  siteKey: z.string().nullable().optional(),
  siteUrl: z.string().nullable().optional(),
  coverage: docCoverageSchema,
});

const unifiedSearchSourceStatusSchema = z.object({
  source: unifiedSearchSourceSchema,
  targetLabel: z.string(),
  requestedTargetLabel: z.string().nullable().optional(),
  freshTargetLabel: z.string().nullable().optional(),
  servedTargetLabel: z.string().nullable().optional(),
  targetResolution: targetResolutionSchema,
  indexingStatus: z.string().nullable().optional(),
  codeIndexState: z.string().nullable().optional(),
  resultCount: z.number().int().nullable().optional(),
  appliedFilters: z.array(z.string()),
  ignoredFilters: z.array(z.string()),
  incompatibleFilters: z.array(z.string()),
  appliedQueryFeatures: z.array(z.string()),
  ignoredQueryFeatures: z.array(z.string()),
  incompatibleQueryFeatures: z.array(z.string()),
  suggestedSiteTargets: z.array(z.string()),
  suggestedSiteTargetsTruncated: z.boolean(),
  note: z.string().nullable().optional(),
  coverage: docCoverageSchema,
  contributors: z.array(unifiedSearchDocumentationContributorSchema),
});

const unifiedSearchResultSchema = z.object({
  query: z.string(),
  queryWarnings: z.array(z.string()),
  sources: z.array(unifiedSearchSourceSchema),
  results: z.array(unifiedSearchHitSchema),
  page: unifiedSearchPageInfoSchema,
  partialResults: z.boolean(),
  sourceStatus: z.array(unifiedSearchSourceStatusSchema),
  evidenceNotice: z.string().nullable().optional(),
});

const unifiedSearchSessionStatusSchema = z.string().min(1);

const unifiedSearchFiltersSchema = z
  .object({
    fileIntent: z.string().nullable().optional(),
    kind: z.string().nullable().optional(),
    category: z.string().nullable().optional(),
    publicOnly: z.boolean().nullable().optional(),
    pathPrefix: z.string().nullable().optional(),
  })
  .nullable()
  .optional();

const unifiedSearchProgressTargetSchema = z.object({
  requested: z.string().nullable().optional(),
  resolvedRequested: z.string().nullable().optional(),
  served: z.string().nullable().optional(),
  freshness: z.string().nullable().optional(),
  indexingRef: z.string().nullable().optional(),
  requestedRefKind: z.string().nullable().optional(),
  targetResolution: targetResolutionSchema,
  availableVersions: z.array(availableVersionSchema).nullable().optional(),
  availableRefs: z.array(availableVersionSchema).nullable().optional(),
  suggestedRefs: z.array(availableVersionSchema).nullable().optional(),
  coverage: docCoverageSchema,
});

const unifiedSearchRequestedTargetSchema = z.object({
  registry: z.string().nullable().optional(),
  name: z.string().nullable().optional(),
  version: z.string().nullable().optional(),
  repoUrl: z.string().nullable().optional(),
  gitRef: z.string().nullable().optional(),
  site: z.string().nullable().optional(),
});

const unifiedSearchProgressSchema = z.object({
  searchRef: z.string(),
  status: unifiedSearchSessionStatusSchema,
  targetsTotal: z.number().int(),
  targetsReady: z.number().int(),
  elapsedMs: z.number().int(),
  query: z.string(),
  queryWarnings: z.array(z.string()),
  sources: z.array(unifiedSearchSourceSchema),
  requestedSources: z.array(unifiedSearchSourceSchema).nullable().optional(),
  targetMode: z.string().nullable().optional(),
  requestedTargets: z
    .array(unifiedSearchRequestedTargetSchema)
    .nullable()
    .optional(),
  filters: unifiedSearchFiltersSchema,
  limit: z.number().int().nullable().optional(),
  offset: z.number().int().nullable().optional(),
  targets: z.array(unifiedSearchProgressTargetSchema).nullable().optional(),
  expiresAt: z.string().nullable().optional(),
  results: unifiedSearchResultSchema.nullable().optional(),
});

const asyncUnifiedSearchResultSchema = z.object({
  completed: z.boolean(),
  searchRef: z.string().nullable().optional(),
  result: unifiedSearchResultSchema.nullable().optional(),
  progress: unifiedSearchProgressSchema.nullable().optional(),
});

const graphQLErrorSchema = z.object({
  message: z.string(),
  extensions: z.record(z.string(), z.unknown()).optional(),
});

const codeDiffGraphQLErrorSchema = z.object({
  message: z.string(),
  path: z
    .array(z.union([z.string(), z.number().int()]))
    .nullable()
    .optional(),
  extensions: z.record(z.string(), z.unknown()).optional(),
});

const codeDiffRegistrySchema = z.enum(PKGSEER_REGISTRY_VALUES);

const codeDiffPackageInfoSchema = z.object({
  registry: codeDiffRegistrySchema,
  name: z.string(),
  repoUrl: z.string(),
});

const codeDiffRefResolutionSchema = z.object({
  requested: z.string(),
  resolvedVersion: z.string().nullable().optional(),
  ref: z.string(),
  commitSha: z.string(),
  refKind: z.enum(["SHA", "TAG", "BRANCH", "HEAD", "UNKNOWN"]),
  versionSource: z
    .enum(["REGISTRY", "GIT_HEAD", "TAG", "RELEASE"])
    .nullable()
    .optional(),
});

const rawCodeDiffSummarySchema = z.object({
  filesChanged: z.number().int(),
  added: z.number().int(),
  deleted: z.number().int(),
  modified: z.number().int(),
  modeChanged: z.number().int(),
  typeChanged: z.number().int(),
  inventoryComplete: z.boolean(),
  unprojectableFiles: z.number().int(),
});

const rawCodeDiffScopeSchema = z.object({
  status: z.enum(["PACKAGE", "REPOSITORY", "UNKNOWN"]),
  fromSubpath: z.string().nullable().optional(),
  toSubpath: z.string().nullable().optional(),
  pathPrefix: z.string().nullable().optional(),
  pathGlob: z.string().nullable().optional(),
});

const rawCodeDiffContentFailureSchema = z.object({
  code: z.string(),
  retryable: z.boolean(),
  retryAfterMs: z.number().int().nullable().optional(),
  stage: z.string().nullable().optional(),
  limitKind: z.string().nullable().optional(),
});

const contentSafetySchema = z.object({
  filtered: z.boolean(),
  modifications: z.array(
    z.enum([
      "INVISIBLE_CONTROLS_STRIPPED",
      "HTML_COMMENTS_STRIPPED",
      "IMAGES_REPLACED",
      "UNSAFE_LINKS_NEUTRALIZED",
    ]),
  ),
});

const rawCodeDiffFileSchema = z.object({
  path: z.string(),
  pathEncoding: z.enum(["UTF8", "BYTE_ESCAPED"]),
  status: z.enum(["ADDED", "DELETED", "MODIFIED"]),
  modeChanged: z.boolean(),
  typeChanged: z.boolean(),
  additions: z.number().int().nullable().optional(),
  deletions: z.number().int().nullable().optional(),
  patch: z.string().nullable().optional(),
  contentStatus: z.enum([
    "NOT_REQUESTED",
    "STATS",
    "PATCH",
    "BINARY",
    "METADATA_ONLY",
    "OMITTED",
    "UNAVAILABLE",
  ]),
  contentOmissionReason: z.string().nullable().optional(),
  contentSafety: contentSafetySchema,
});

const rawCodeDiffSchema = z.object({
  summary: rawCodeDiffSummarySchema,
  scope: rawCodeDiffScopeSchema,
  contentCoverage: z.enum(["NOT_REQUESTED", "COMPLETE", "PARTIAL", "FAILED"]),
  contentFailure: rawCodeDiffContentFailureSchema.nullable().optional(),
  files: z.array(rawCodeDiffFileSchema),
  hasMoreFiles: z.boolean(),
});

const codeDiffResultSchema = z.object({
  package: codeDiffPackageInfoSchema.nullable().optional(),
  fromResolution: codeDiffRefResolutionSchema,
  toResolution: codeDiffRefResolutionSchema,
  raw: rawCodeDiffSchema.nullable().optional(),
});

const codeDiffGraphQLResponseSchema = z.object({
  data: z
    .object({
      codeDiff: codeDiffResultSchema.nullable().optional(),
    })
    .nullable()
    .optional(),
  errors: z.array(codeDiffGraphQLErrorSchema).optional(),
});

const CODE_DIFF_OPTION_KEYS: ReadonlySet<string> = new Set([
  "maxFiles",
  "maxPatchBytes",
  "pathPrefix",
  "pathGlob",
]);

const CODE_DIFF_COMMON_SELECTION = `    package {
      registry
      name
      repoUrl
    }
    fromResolution {
      requested
      resolvedVersion
      ref
      commitSha
      refKind
      versionSource
    }
    toResolution {
      requested
      resolvedVersion
      ref
      commitSha
      refKind
      versionSource
    }
    raw {
      summary {
        filesChanged
        added
        deleted
        modified
        modeChanged
        typeChanged
        inventoryComplete
        unprojectableFiles
      }
      scope {
        status
        fromSubpath
        toSubpath
        pathPrefix
        pathGlob
      }
      contentCoverage
      contentFailure {
        code
        retryable
        retryAfterMs
        stage
        limitKind
      }
      files {
        path
        pathEncoding
        status
        modeChanged
        typeChanged
        contentStatus
        contentSafety {
          filtered
          modifications
        }`;

function buildCodeDiffQuery(mode: CodeDiffMode): string {
  const contentFields =
    mode === "inventory"
      ? ""
      : mode === "stats"
        ? "\n        additions\n        deletions"
        : "\n        additions\n        deletions\n        patch\n        contentOmissionReason";

  return `
query CodeDiff(
  $registry: Registry
  $name: String
  $fromVersion: String
  $toVersion: String
  $repoUrl: String
  $fromRef: String
  $toRef: String
  $rawOptions: RawCodeDiffOptions
) {
  codeDiff(
    registry: $registry
    name: $name
    fromVersion: $fromVersion
    toVersion: $toVersion
    repoUrl: $repoUrl
    fromRef: $fromRef
    toRef: $toRef
    rawOptions: $rawOptions
  ) {
${CODE_DIFF_COMMON_SELECTION}${contentFields}
      }
      hasMoreFiles
    }
  }
}`;
}

// --------------------------------------------------------------------
// Zod schemas + queries for the file-exploration bundle.
// `listRepoFiles` / `fetchCodeContext` / `grepRepo` share the same
// indexing lifecycle (`codeIndexState` + `indexingRef` +
// `availableVersions`) but otherwise have distinct result shapes —
// normalise per tool rather than under one abstraction.
// --------------------------------------------------------------------

const navigationResolutionSchema = z
  .object({
    requestedVersion: z.string().nullable().optional(),
    requestedRef: z.string().nullable().optional(),
    resolvedRef: z.string().nullable().optional(),
    commitSha: z.string().nullable().optional(),
  })
  .nullable()
  .optional();

const navigationDiagnosticsSchema = z
  .object({
    hint: z.string().nullable().optional(),
  })
  .nullable()
  .optional();

// listRepoFiles ------------------------------------------------------

const repoFileEntrySchema = z.object({
  path: z.string(),
  name: z.string().nullable().optional(),
  language: z.string().nullable().optional(),
  fileType: z.string().nullable().optional(),
  byteSize: z.number().int().nullable().optional(),
});

const listRepoFilesResponseSchema = z.object({
  files: z.array(repoFileEntrySchema),
  total: z.number().int(),
  hasMore: z.boolean(),
  indexedVersion: z.string().nullable().optional(),
  resolution: navigationResolutionSchema,
  targetResolution: targetResolutionSchema,
  diagnostics: navigationDiagnosticsSchema,
  codeIndexState: z.string(),
  indexingRef: z.string().nullable().optional(),
  availableVersions: z.array(availableVersionSchema).nullable().optional(),
  indexingEstimate: indexingDurationEstimateSchema,
});

const listRepoFilesGraphQLResponseSchema = z.object({
  data: z
    .object({
      listRepoFiles: listRepoFilesResponseSchema.nullable().optional(),
    })
    .nullable()
    .optional(),
  errors: z.array(graphQLErrorSchema).optional(),
});

const LIST_REPO_FILES_QUERY = `
query ListRepoFiles(
  $registry: Registry
  $packageName: String
  $repoUrl: String
  $gitRef: String
  $version: String
  $pathPrefix: String
  $pathSelectors: [FilePathSelectorInput!]
  $extensions: [String!]
  $fileTypes: [String!]
  $languages: [String!]
  $fileIntent: FileIntent
  $fileIntents: [FileIntent!]
  $excludeFileIntents: [FileIntent!]
  $excludeDocFiles: Boolean
  $excludeTestFiles: Boolean
  $includeHidden: Boolean
  $limit: Int
  $waitTimeoutMs: Int
) {
  listRepoFiles(
    registry: $registry
    packageName: $packageName
    repoUrl: $repoUrl
    gitRef: $gitRef
    version: $version
    pathPrefix: $pathPrefix
    pathSelectors: $pathSelectors
    extensions: $extensions
    fileTypes: $fileTypes
    languages: $languages
    fileIntent: $fileIntent
    fileIntents: $fileIntents
    excludeFileIntents: $excludeFileIntents
    excludeDocFiles: $excludeDocFiles
    excludeTestFiles: $excludeTestFiles
    includeHidden: $includeHidden
    limit: $limit
    waitTimeoutMs: $waitTimeoutMs
  ) {
    files {
      path
      name
      language
      fileType
      byteSize
    }
    total
    hasMore
    indexedVersion
    resolution {
      requestedVersion
      requestedRef
      resolvedRef
      commitSha
    }
    ${TARGET_RESOLUTION_SELECTION}
    diagnostics {
      hint
    }
    codeIndexState
    indexingRef
    availableVersions {
      version
      ref
    }
    ${INDEXING_DURATION_ESTIMATE_SELECTION}
  }
}`;

// fetchCodeContext ---------------------------------------------------

// `CodeContextResult` is a separate family — no availableVersions,
// no resolution, no diagnostics. Only indexing fields are shared.
const codeContextResponseSchema = z.object({
  content: z.string().nullable().optional(),
  filePath: z.string().nullable().optional(),
  language: z.string().nullable().optional(),
  totalLines: z.number().int().nullable().optional(),
  startLine: z.number().int().nullable().optional(),
  endLine: z.number().int().nullable().optional(),
  repoUrl: z.string().nullable().optional(),
  gitRef: z.string().nullable().optional(),
  isBinary: z.boolean().nullable().optional(),
  codeIndexState: z.string(),
  indexingRef: z.string().nullable().optional(),
  availableVersions: z.array(availableVersionSchema).nullable().optional(),
  indexingEstimate: indexingDurationEstimateSchema,
  targetResolution: targetResolutionSchema,
});

const fetchCodeContextGraphQLResponseSchema = z.object({
  data: z
    .object({
      fetchCodeContext: codeContextResponseSchema.nullable().optional(),
    })
    .nullable()
    .optional(),
  errors: z.array(graphQLErrorSchema).optional(),
});

const FETCH_CODE_CONTEXT_QUERY = `
query FetchCodeContext(
  $registry: Registry
  $packageName: String
  $repoUrl: String
  $gitRef: String
  $version: String
  $filePath: String!
  $startLine: Int
  $endLine: Int
  $waitTimeoutMs: Int
) {
  fetchCodeContext(
    registry: $registry
    packageName: $packageName
    repoUrl: $repoUrl
    gitRef: $gitRef
    version: $version
    filePath: $filePath
    startLine: $startLine
    endLine: $endLine
    waitTimeoutMs: $waitTimeoutMs
  ) {
    content
    filePath
    language
    totalLines
    startLine
    endLine
    repoUrl
    gitRef
    isBinary
    codeIndexState
    indexingRef
    ${CODE_CONTEXT_AVAILABLE_VERSIONS_SELECTION}
    ${INDEXING_DURATION_ESTIMATE_SELECTION}
    ${TARGET_RESOLUTION_SELECTION}
  }
}`;

// grepRepo -----------------------------------------------------------

const grepRepoMatchSchema = z.object({
  filePath: z.string(),
  line: z.number().int(),
  matchStartByte: z.number().int(),
  matchEndByte: z.number().int(),
  lineContent: z.string(),
  contextBefore: z.array(z.string()).nullable().optional(),
  contextAfter: z.array(z.string()).nullable().optional(),
  fileContentHash: z.string().nullable().optional(),
  fileIntent: z.string().nullable().optional(),
  symbolRowId: z.string().nullable().optional(),
  symbol: z
    .object({
      symbolRef: z.string().optional(),
      name: z.string().optional(),
      qualifiedPath: z.string().nullable().optional(),
      kind: z.string().nullable().optional(),
      category: z.string().nullable().optional(),
      arity: z.number().int().nullable().optional(),
      isPublic: z.boolean().nullable().optional(),
      filePath: z.string().nullable().optional(),
      startLine: z.number().int().nullable().optional(),
      endLine: z.number().int().nullable().optional(),
      code: z.string().nullable().optional(),
      callerCount: z.number().int().nullable().optional(),
      contentHash: z.string().nullable().optional(),
      parentSymbolRef: z.string().nullable().optional(),
      parentPath: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
});

const grepRepoResponseSchema = z.object({
  matches: z.array(grepRepoMatchSchema),
  nextCursor: z.string().nullable().optional(),
  hasMore: z.boolean(),
  truncatedReason: z.enum([
    "NONE",
    "MAX_MATCHES",
    "MAX_MATCHES_PER_FILE",
    "DEADLINE",
  ]),
  routeTaken: z.enum(["SINGLE_FILE", "CONTENT_INDEX"]).nullable().optional(),
  filesScanned: z.number().int(),
  filesInScope: z.number().int(),
  binaryFilesSkipped: z.number().int(),
  filesTooLargeSkipped: z.number().int(),
  totalMatches: z.number().int(),
  uniqueFilesMatched: z.number().int(),
  indexedVersion: z.string().nullable().optional(),
  resolution: navigationResolutionSchema,
  targetResolution: targetResolutionSchema,
  codeIndexState: z.string(),
  indexingRef: z.string().nullable().optional(),
  availableVersions: z.array(availableVersionSchema).nullable().optional(),
  indexingEstimate: indexingDurationEstimateSchema,
});

const grepRepoGraphQLResponseSchema = z.object({
  data: z
    .object({
      grepRepo: grepRepoResponseSchema.nullable().optional(),
    })
    .nullable()
    .optional(),
  errors: z.array(graphQLErrorSchema).optional(),
});

const GREP_REPO_SYMBOL_SELECTIONS: Record<string, string> = {
  symbol_ref: "symbolRef",
  name: "name",
  qualified_path: "qualifiedPath",
  kind: "kind",
  category: "category",
  arity: "arity",
  is_public: "isPublic",
  file_path: "filePath",
  start_line: "startLine",
  end_line: "endLine",
  code: "code",
  caller_count: "callerCount",
  content_hash: "contentHash",
  parent_symbol_ref: "parentSymbolRef",
  parent_path: "parentPath",
};

function buildGrepRepoQuery(
  symbolFields: readonly string[] | undefined,
): string {
  const symbolSelection = (symbolFields ?? [])
    .map((field) => GREP_REPO_SYMBOL_SELECTIONS[field])
    .filter((field): field is string => Boolean(field))
    .filter((field, index, fields) => fields.indexOf(field) === index)
    .join("\n        ");
  const symbolBlock =
    symbolSelection.length > 0
      ? `\n      symbol {\n        ${symbolSelection}\n      }`
      : "";

  return `
query GrepRepo(
  $registry: Registry
  $packageName: String
  $repoUrl: String
  $gitRef: String
  $version: String
  $waitTimeoutMs: Int
  $pattern: String!
  $patternType: GrepPatternType
  $caseSensitive: Boolean
  $pathSelectors: [GrepPathSelectorInput!]
  $extensions: [String!]
  $excludeDocFiles: Boolean
  $excludeTestFiles: Boolean
  $allowUnscoped: Boolean
  $contextLinesBefore: Int
  $contextLinesAfter: Int
  $maxMatches: Int
  $maxMatchesPerFile: Int
  $cursor: String
  $symbolFields: [String!]
) {
  grepRepo(
    registry: $registry
    packageName: $packageName
    repoUrl: $repoUrl
    gitRef: $gitRef
    version: $version
    waitTimeoutMs: $waitTimeoutMs
    pattern: $pattern
    patternType: $patternType
    caseSensitive: $caseSensitive
    pathSelectors: $pathSelectors
    extensions: $extensions
    excludeDocFiles: $excludeDocFiles
    excludeTestFiles: $excludeTestFiles
    allowUnscoped: $allowUnscoped
    contextLinesBefore: $contextLinesBefore
    contextLinesAfter: $contextLinesAfter
    maxMatches: $maxMatches
    maxMatchesPerFile: $maxMatchesPerFile
    cursor: $cursor
    symbolFields: $symbolFields
  ) {
    matches {
      filePath
      line
      matchStartByte
      matchEndByte
      lineContent
      contextBefore
      contextAfter
      fileContentHash
      fileIntent
      symbolRowId${symbolBlock}
    }
    nextCursor
    totalMatches
    hasMore
    truncatedReason
    routeTaken
    filesScanned
    filesInScope
    binaryFilesSkipped
    filesTooLargeSkipped
    uniqueFilesMatched
    indexedVersion
    resolution {
      requestedVersion
      requestedRef
      resolvedRef
      commitSha
    }
    ${TARGET_RESOLUTION_SELECTION}
    codeIndexState
    indexingRef
    availableVersions {
      version
      ref
    }
    ${INDEXING_DURATION_ESTIMATE_SELECTION}
  }
}`;
}

const unifiedSearchGraphQLResponseSchema = z.object({
  data: z
    .object({
      search: asyncUnifiedSearchResultSchema.nullable().optional(),
    })
    .nullable()
    .optional(),
  errors: z.array(graphQLErrorSchema).optional(),
});

const unifiedSearchStatusGraphQLResponseSchema = z.object({
  data: z
    .object({
      discoverySearchProgress: unifiedSearchProgressSchema
        .nullable()
        .optional(),
    })
    .nullable()
    .optional(),
  errors: z.array(graphQLErrorSchema).optional(),
});

export class CodeNavigationServiceImpl
  implements CodeNavigationService, CodeDiffService
{
  constructor(
    private readonly codeNavigationUrl: string,
    private readonly tokenProvider: TokenProvider,
    private readonly fetchFn: typeof fetch = globalThis.fetch,
    private readonly runtime: {
      clientHeaders?: ClientHeaderBuilder;
      userAgent?: string;
      clientVersion?: string;
      diagnostics?: ServiceDiagnostics;
    } = {},
  ) {}

  private async postGraphqlWithTargetResolutionFallback(input: {
    token: string;
    query: string;
    variables: Record<string, unknown>;
  }): Promise<PkgseerGraphqlResponse> {
    const response = await postPkgseerGraphql({
      endpointUrl: this.codeNavigationUrl,
      token: input.token,
      query: input.query,
      variables: input.variables,
      fetchFn: this.fetchFn,
      clientHeaders: this.runtime.clientHeaders,
      userAgent: this.runtime.userAgent,
      diagnostics: this.runtime.diagnostics,
    });
    if (response.status < 200 || response.status >= 300) return response;
    if (!hasSchemaMismatchErrors(response.parsedBody)) return response;

    for (const fallbackQuery of buildTargetResolutionFallbackQueries(
      input.query,
    )) {
      if (this.runtime.diagnostics?.isEnabled("code-nav")) {
        this.runtime.diagnostics.debug("code-nav", {
          event: "target-resolution-query-fallback",
        });
      }
      const fallbackResponse = await postPkgseerGraphql({
        endpointUrl: this.codeNavigationUrl,
        token: input.token,
        query: fallbackQuery,
        variables: input.variables,
        fetchFn: this.fetchFn,
        clientHeaders: this.runtime.clientHeaders,
        userAgent: this.runtime.userAgent,
        diagnostics: this.runtime.diagnostics,
      });
      if (!hasSchemaMismatchErrors(fallbackResponse.parsedBody)) {
        return fallbackResponse;
      }
    }

    return response;
  }

  async search(params: UnifiedSearchParams): Promise<UnifiedSearchOutcome> {
    return executeWithTokenRefresh({
      getToken: () => this.tokenProvider.getToken(),
      forceRefresh: () => this.tokenProvider.forceRefresh(),
      shouldRefresh: isTokenRefreshableError,
      executeWithToken: (token) => this.executeUnifiedSearch(token, params),
    });
  }

  async searchStatus(
    searchRef: string,
    waitTimeoutMs = 0,
  ): Promise<UnifiedSearchOutcome> {
    return executeWithTokenRefresh({
      getToken: () => this.tokenProvider.getToken(),
      forceRefresh: () => this.tokenProvider.forceRefresh(),
      shouldRefresh: isTokenRefreshableError,
      executeWithToken: (token) =>
        this.executeUnifiedSearchStatus(token, searchRef, waitTimeoutMs),
    });
  }

  async codeDiff(params: CodeDiffParams): Promise<CodeDiffResult> {
    validateCodeDiffParams(params);
    return executeWithTokenRefresh({
      getToken: () => this.tokenProvider.getToken(),
      forceRefresh: () => this.tokenProvider.forceRefresh(),
      shouldRefresh: isTokenRefreshableError,
      executeWithToken: (token) => this.executeCodeDiff(token, params),
    });
  }

  private async executeCodeDiff(
    token: string,
    params: CodeDiffParams,
  ): Promise<CodeDiffResult> {
    const query = buildCodeDiffQuery(params.mode);
    const variables = buildCodeDiffVariables(params);
    debugGraphqlWireRequest(
      "codeDiff",
      query,
      variables,
      this.runtime.diagnostics,
    );

    let response: PkgseerGraphqlResponse;
    try {
      response = await this.postGraphqlWithTargetResolutionFallback({
        token,
        query,
        variables,
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

    const parsed = codeDiffGraphQLResponseSchema.safeParse(response.parsedBody);
    if (!parsed.success) {
      throw new MalformedCodeNavigationResponseError(
        "Malformed response from code navigation service.",
      );
    }

    const data = parsed.data.data?.codeDiff;
    const errors = parsed.data.errors ?? [];
    if (errors.length > 0) {
      const rawErrors = errors.filter(isCodeDiffRawError);
      if (rawErrors.length > 0) {
        throw new CodeDiffError(
          rawErrors.map((error) => error.message).join(", "),
          parseCodeDiffErrorDetails(rawErrors),
          data ? normaliseCodeDiffPartial(data) : undefined,
        );
      }

      throw this.createCodeDiffRootError(errors);
    }

    if (!data?.raw) {
      throw new MalformedCodeNavigationResponseError(
        "CodeDiff response missing non-null raw result.",
      );
    }

    return normaliseCodeDiffResult(data);
  }

  private createCodeDiffRootError(
    errors: Array<z.infer<typeof codeDiffGraphQLErrorSchema>>,
  ): Error {
    const graphQLErrors = errors.map(({ message, extensions }) => ({
      message,
      extensions,
    }));
    const message = errors.map((error) => error.message).join(", ");
    const extensions = getPrimaryExtensions(errors);
    const code =
      typeof extensions?.code === "string" ? extensions.code : undefined;

    if (code === "AUTHENTICATION_REQUIRED") {
      return new AuthenticationError(
        SERVER_AUTHENTICATION_REJECTED_MESSAGE,
        "server",
      );
    }

    if (
      code === "UNAUTHORIZED" ||
      code === "FORBIDDEN" ||
      code === "FEATURE_FLAG_REQUIRED" ||
      isClientUpdateRequiredGraphQLError({ message, code }) ||
      isGraphQLSchemaMismatchError({ message, code }) ||
      (code === undefined && isAuthMessage(message))
    ) {
      return this.createGraphQLError(graphQLErrors);
    }

    return new CodeDiffError(message, parseCodeDiffErrorDetails(errors));
  }

  private async executeUnifiedSearch(
    token: string,
    params: UnifiedSearchParams,
  ): Promise<UnifiedSearchOutcome> {
    if (params.targets.length === 0) {
      throw new CodeNavigationValidationError(
        "At least one search target is required.",
      );
    }

    let response: PkgseerGraphqlResponse;
    const variables = {
      targets: params.targets.map((target) => ({
        registry: target.registry,
        name: target.packageName,
        version: target.version,
        repoUrl: target.repoUrl,
        gitRef: target.gitRef,
        site: target.site,
      })),
      query: params.query,
      sources: params.sources,
      filters: params.filters,
      allowPartialResults: params.allowPartialResults ?? false,
      limit: params.limit,
      offset: params.offset,
      waitTimeoutMs: params.waitTimeoutMs,
    };
    debugUnifiedSearchRequest(variables, this.runtime.diagnostics);
    debugGraphqlWireRequest(
      "search",
      UNIFIED_SEARCH_QUERY,
      variables,
      this.runtime.diagnostics,
    );
    try {
      response = await this.postGraphqlWithTargetResolutionFallback({
        token,
        query: UNIFIED_SEARCH_QUERY,
        variables,
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

    const parsed = unifiedSearchGraphQLResponseSchema.safeParse(
      response.parsedBody,
    );
    if (!parsed.success) {
      throw new MalformedCodeNavigationResponseError(
        "Malformed response from code navigation service.",
      );
    }

    if (parsed.data.errors && parsed.data.errors.length > 0) {
      throw this.createGraphQLError(parsed.data.errors);
    }

    const data = parsed.data.data?.search;
    if (!data) {
      throw new MalformedCodeNavigationResponseError(
        "Malformed response from code navigation service.",
      );
    }

    return this.normaliseUnifiedSearchOutcome(data);
  }

  private async executeUnifiedSearchStatus(
    token: string,
    searchRef: string,
    waitTimeoutMs: number,
  ): Promise<UnifiedSearchOutcome> {
    let response: PkgseerGraphqlResponse;
    try {
      response = await this.postGraphqlWithTargetResolutionFallback({
        token,
        query: UNIFIED_SEARCH_STATUS_QUERY,
        variables: {
          searchRef,
          includeResults: true,
          waitTimeoutMs,
        },
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

    const parsed = unifiedSearchStatusGraphQLResponseSchema.safeParse(
      response.parsedBody,
    );
    if (!parsed.success) {
      throw new MalformedCodeNavigationResponseError(
        "Malformed response from code navigation service.",
      );
    }

    if (parsed.data.errors && parsed.data.errors.length > 0) {
      throw this.createGraphQLError(parsed.data.errors);
    }

    const data = parsed.data.data?.discoverySearchProgress;
    if (!data) {
      throw new MalformedCodeNavigationResponseError(
        "Malformed response from code navigation service.",
      );
    }

    const progress = this.normaliseUnifiedSearchProgress(data);
    const result = data.results
      ? this.normaliseUnifiedSearchResult(data.results)
      : undefined;

    if (result && progress.status === "COMPLETED") {
      return {
        state: "completed",
        completed: true,
        searchRef: progress.searchRef,
        result,
        progress,
      };
    }

    return {
      state: "incomplete",
      completed: false,
      searchRef: progress.searchRef,
      result,
      progress,
    };
  }

  private createHttpError(response: PkgseerGraphqlResponse): Error {
    const status = response.status;
    const detail = parseDetail(response.responseBody);

    if (status === 401) {
      return new AuthenticationError(
        SERVER_AUTHENTICATION_REJECTED_MESSAGE,
        "server",
      );
    }

    if (status === 403) {
      return new CodeNavigationAccessError(
        detail ?? "Code navigation access denied.",
      );
    }

    if (status >= 500) {
      return new CodeNavigationBackendError(
        detail
          ? `Server error (${status}): ${detail}`
          : `Server error (${status})`,
        status,
      );
    }

    return new CodeNavigationBackendError(
      detail ?? `Request failed with status ${status}`,
      status,
    );
  }

  private createTransportError(error: PkgseerTransportError): Error {
    if (isFetchTimeoutError(error.cause)) {
      return new CodeNavigationBackendError(
        "Code navigation request timed out.",
        undefined,
        "TIMEOUT",
        true,
      );
    }
    return new CodeNavigationNetworkError(
      "Could not reach the code navigation service. Check your connection or set GITHITS_CODE_NAV_URL.",
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
    const indexingRef = getGraphQLIndexingRef(errors);
    const indexingEstimate = parseIndexingDurationEstimate(extensions);
    const errorMetadata = parseGraphQLErrorMetadata(
      extensions,
      indexingEstimate,
    );

    if (isClientUpdateRequiredGraphQLError({ message, code })) {
      return new ClientUpdateRequiredError(
        undefined,
        undefined,
        this.runtime.clientVersion,
      );
    }

    if (isGraphQLSchemaMismatchError({ message, code })) {
      const sanitized =
        "Backend protocol mismatch. Your CLI may be newer than the server, or the server may require a newer CLI. Run `githits update-check` to verify your installed version. Set GITHITS_DEBUG=code-nav-wire to inspect GraphQL details during local development.";
      if (this.runtime.diagnostics?.isEnabled("code-nav")) {
        this.runtime.diagnostics.debug("code-nav", {
          event: "graphql-schema-mismatch",
          code: code ?? "omitted",
          message,
        });
      }
      return new CodeNavigationBackendError(
        this.runtime.diagnostics?.isEnabled("code-nav-wire")
          ? message
          : sanitized,
        undefined,
        code,
        retryable,
      );
    }

    // Direct dispatch on extensions.code — the April 2026 backend
    // contract populates this on every error. Fall back to message
    // heuristics below for older backend builds that haven't
    // deployed yet (safe to remove once rollout completes).
    switch (code) {
      case "PACKAGE_INDEXING":
        return new CodeNavigationIndexingError(
          message,
          indexingRef,
          parseAvailableVersions(extensions),
          parseAvailableRefs(extensions),
          parseTargetResolution(extensions),
          indexingEstimate,
          appendIndexingWaitHint(
            message,
            typeof extensions?.hint === "string" ? extensions.hint : undefined,
          ),
        );

      case "GREP_PATTERN_TOO_SHORT":
      case "GREP_PATTERN_TOO_LONG":
      case "GREP_PATTERN_INVALID":
      case "GREP_INVALID_REGEX":
      case "GREP_UNSUPPORTED_PATTERN":
      case "GREP_PATTERN_TOO_UNSELECTIVE":
      case "GREP_SCOPE_REQUIRED":
      case "GREP_SELECTOR_INVALID":
      case "GREP_CURSOR_INVALID":
      case "GREP_CONTEXT_TOO_LARGE":
      case "GREP_CONTEXT_NEGATIVE":
      case "GREP_MAX_MATCHES_TOO_LARGE":
      case "GREP_MAX_MATCHES_INVALID":
        return new CodeNavigationValidationError(message);

      case "VERSION_NOT_FOUND":
        return new CodeNavigationVersionNotFoundError(
          message,
          typeof extensions?.package === "string"
            ? extensions.package
            : undefined,
          typeof extensions?.requested_version === "string"
            ? extensions.requested_version
            : undefined,
          typeof extensions?.latest_indexed === "string"
            ? extensions.latest_indexed
            : undefined,
          parseAvailableVersions(extensions),
          errorMetadata,
        );

      case "REF_NOT_FOUND":
        return new CodeNavigationRefNotFoundError(
          message,
          parseGraphQLRepoUrl(extensions),
          parseGraphQLGitRef(extensions),
          parseAvailableRefs(extensions),
          parseSuggestedRefs(extensions),
          errorMetadata,
        );

      case "NOT_FOUND":
      case "PACKAGE_NOT_FOUND":
      case "NO_REPOSITORY_URL":
        return new CodeNavigationTargetNotFoundError(
          message,
          parseAvailableVersions(extensions),
          parseGraphQLRepoUrl(extensions),
          parseGraphQLGitRef(extensions),
          errorMetadata,
        );

      case "REPOSITORY_NOT_FOUND":
        return new CodeNavigationTargetNotFoundError(
          message,
          undefined,
          parseGraphQLRepoUrl(extensions),
          parseGraphQLGitRef(extensions),
          errorMetadata,
        );

      case "FILE_NOT_FOUND":
        return new CodeNavigationFileNotFoundError(
          message,
          typeof extensions?.file_path === "string"
            ? extensions.file_path
            : typeof extensions?.filePath === "string"
              ? extensions.filePath
              : undefined,
        );

      case "UNSUPPORTED_REGISTRY":
      case "VALIDATION_ERROR":
        return new CodeNavigationValidationError(message);

      case "FEATURE_FLAG_REQUIRED":
        return new CodeNavigationFeatureFlagRequiredError(message);

      case "UNAUTHORIZED":
        return new AuthenticationError(
          SERVER_AUTHENTICATION_REJECTED_MESSAGE,
          "server",
        );

      case "FORBIDDEN":
        return new CodeNavigationAccessError(
          "Code navigation access denied. This feature may not be enabled for your account.",
        );

      case "UPSTREAM_ERROR":
      case "TIMEOUT":
      case "RATE_LIMITED":
      case "GREP_FILE_TOO_LARGE":
      case "GREP_TIMEOUT":
      case "GREP_SERVICE_UNAVAILABLE":
      case "GREP_FAILED":
      case "GREP_INDEX_NOT_AVAILABLE":
      case "FILE_PATH_EXCLUDED":
      case "SOURCE_FILE_INVENTORY_UNKNOWN":
      case "INTERNAL_ERROR":
      case "UNKNOWN_ERROR":
        return new CodeNavigationBackendError(
          message,
          undefined,
          code,
          retryable,
          errorMetadata,
        );

      // `code` was present but not one of the recognised values —
      // forward it onward as BACKEND_ERROR, preserving the code so
      // the classifier can still surface it to callers.
      default:
        break;
    }

    // Legacy fallback: backend didn't populate `extensions.code`.
    // Retain the message-text heuristics so rollover works smoothly;
    // remove once all backend deploys are confirmed.
    if (code === undefined) {
      if (isAuthMessage(message)) {
        return new CodeNavigationAccessError(
          "Code navigation access denied. This feature may not be enabled for your account.",
        );
      }
      if (isUnresolvableMessage(message)) {
        return new CodeNavigationUnresolvableError(message);
      }
      if (isTargetNotFoundMessage(message)) {
        return new CodeNavigationTargetNotFoundError(
          message,
          parseAvailableVersions(extensions),
          parseGraphQLRepoUrl(extensions),
          parseGraphQLGitRef(extensions),
          errorMetadata,
        );
      }
    }

    return new CodeNavigationBackendError(
      message,
      undefined,
      code,
      retryable,
      errorMetadata,
    );
  }

  private normaliseUnifiedSearchOutcome(
    data: z.infer<typeof asyncUnifiedSearchResultSchema>,
  ): UnifiedSearchOutcome {
    const progress = data.progress
      ? this.normaliseUnifiedSearchProgress(data.progress)
      : undefined;

    if (data.completed) {
      if (!data.result) {
        throw new MalformedCodeNavigationResponseError(
          "Completed unified search response missing result payload.",
        );
      }

      return {
        state: "completed",
        completed: true,
        searchRef: data.searchRef ?? undefined,
        result: this.normaliseUnifiedSearchResult(data.result),
        progress,
      };
    }

    const searchRef = data.searchRef ?? progress?.searchRef;
    if (!searchRef) {
      throw new MalformedCodeNavigationResponseError(
        "Incomplete unified search response missing search reference.",
      );
    }

    const result = data.result
      ? this.normaliseUnifiedSearchResult(data.result)
      : undefined;

    return {
      state: "incomplete",
      completed: false,
      searchRef,
      result,
      progress,
    };
  }

  private normaliseUnifiedSearchResult(
    result: z.infer<typeof unifiedSearchResultSchema>,
  ): UnifiedSearchResult {
    return {
      query: result.query,
      queryWarnings: result.queryWarnings,
      sources: result.sources,
      results: result.results.map((entry) => ({
        id: entry.id,
        resultType: entry.resultType,
        targetLabel: entry.targetLabel,
        requestedTargetLabel: entry.requestedTargetLabel ?? undefined,
        freshTargetLabel: entry.freshTargetLabel ?? undefined,
        servedTargetLabel: entry.servedTargetLabel ?? undefined,
        freshness: entry.freshness ?? undefined,
        title: entry.title ?? undefined,
        summary: entry.summary ?? undefined,
        score: entry.score ?? undefined,
        highlights: entry.highlights
          ? {
              title: entry.highlights.title ?? undefined,
              summary: entry.highlights.summary ?? undefined,
            }
          : undefined,
        locator: normaliseUnifiedSearchLocator(entry.locator),
      })),
      page: {
        offset: result.page.offset,
        limit: result.page.limit,
        returned: result.page.returned,
        hasMore: result.page.hasMore,
      },
      partialResults: result.partialResults,
      sourceStatus: result.sourceStatus.map((entry) => ({
        source: entry.source,
        targetLabel: entry.targetLabel,
        requestedTargetLabel: entry.requestedTargetLabel ?? undefined,
        freshTargetLabel: entry.freshTargetLabel ?? undefined,
        servedTargetLabel: entry.servedTargetLabel ?? undefined,
        targetResolution: normaliseTargetResolution(entry.targetResolution),
        indexingStatus: entry.indexingStatus ?? undefined,
        codeIndexState: entry.codeIndexState ?? undefined,
        resultCount: entry.resultCount ?? undefined,
        appliedFilters: entry.appliedFilters,
        ignoredFilters: entry.ignoredFilters,
        incompatibleFilters: entry.incompatibleFilters,
        appliedQueryFeatures: entry.appliedQueryFeatures,
        ignoredQueryFeatures: entry.ignoredQueryFeatures,
        incompatibleQueryFeatures: entry.incompatibleQueryFeatures,
        suggestedSiteTargets: entry.suggestedSiteTargets,
        suggestedSiteTargetsTruncated: entry.suggestedSiteTargetsTruncated,
        note: entry.note ?? undefined,
        coverage: normaliseDocCoverage(entry.coverage),
        contributors: entry.contributors.map((contributor) => ({
          kind: contributor.kind,
          state: contributor.state,
          freshness: contributor.freshness ?? undefined,
          resultCount: contributor.resultCount,
          repositoryUrl: contributor.repositoryUrl ?? undefined,
          commitSha: contributor.commitSha ?? undefined,
          siteKey: contributor.siteKey ?? undefined,
          siteUrl: contributor.siteUrl ?? undefined,
          coverage: normaliseDocCoverage(contributor.coverage, {
            preserveNone: true,
          }),
        })),
      })),
      evidenceNotice: result.evidenceNotice ?? undefined,
    };
  }

  private normaliseUnifiedSearchProgress(
    progress: z.infer<typeof unifiedSearchProgressSchema>,
  ): UnifiedSearchProgress {
    return {
      searchRef: progress.searchRef,
      status: progress.status,
      targetsTotal: progress.targetsTotal,
      targetsReady: progress.targetsReady,
      elapsedMs: progress.elapsedMs,
      query: progress.query,
      queryWarnings: progress.queryWarnings,
      sources: progress.sources,
      requestedSources: progress.requestedSources ?? undefined,
      targetMode: normaliseTargetMode(progress.targetMode),
      requestedTargets: progress.requestedTargets?.map((target) => ({
        registry: target.registry
          ? (target.registry as CodeNavigationRegistry)
          : undefined,
        name: target.name ?? undefined,
        version: target.version ?? undefined,
        repoUrl: target.repoUrl ?? undefined,
        gitRef: target.gitRef ?? undefined,
        site: target.site ?? undefined,
      })),
      filters: normaliseProgressFilters(progress.filters),
      limit: progress.limit ?? undefined,
      offset: progress.offset ?? undefined,
      targets: progress.targets?.map((target) => ({
        requested: target.requested ?? undefined,
        resolvedRequested: target.resolvedRequested ?? undefined,
        served: target.served ?? undefined,
        freshness: target.freshness ?? undefined,
        indexingRef: target.indexingRef ?? undefined,
        requestedRefKind: normaliseRequestedRefKind(target.requestedRefKind),
        targetResolution: normaliseTargetResolution(target.targetResolution),
        availableVersions: normaliseAvailableVersions(target.availableVersions),
        availableRefs: normaliseAvailableVersions(target.availableRefs),
        suggestedRefs: normaliseAvailableVersions(target.suggestedRefs),
        coverage: normaliseDocCoverage(target.coverage),
      })),
      expiresAt: progress.expiresAt ?? undefined,
    };
  }

  /**
   * Shared sentinel-promotion for the file-exploration tools. When the backend
   * response carries `codeIndexState: "INDEXING"` (data-path variant),
   * throw the typed error so the envelope builder / caller never sees
   * the raw sentinel.
   */
  private throwIfIndexing(data: {
    codeIndexState: string;
    indexingRef?: string | null;
    availableVersions?: Array<{ version?: string | null; ref: string }> | null;
    targetResolution?: z.infer<typeof targetResolutionSchema>;
    indexingEstimate?: z.infer<typeof indexingDurationEstimateSchema>;
  }): void {
    if (data.codeIndexState === "INDEXING") {
      const targetResolution = normaliseTargetResolution(data.targetResolution);
      const indexingEstimate = normaliseIndexingDurationEstimate(
        data.indexingEstimate,
      );
      throw new CodeNavigationIndexingError(
        `Target is indexing. ${INDEXING_WAIT_HINT}`,
        data.indexingRef ?? targetResolution?.indexingRef,
        normaliseAvailableVersions(data.availableVersions) ??
          targetResolution?.availableVersions,
        targetResolution?.availableRefs,
        targetResolution,
        indexingEstimate,
      );
    }
  }

  // ------------------------------------------------------------------
  // listFiles → listRepoFiles
  // ------------------------------------------------------------------

  async listFiles(params: ListFilesParams): Promise<ListFilesResult> {
    return executeWithTokenRefresh({
      getToken: () => this.tokenProvider.getToken(),
      forceRefresh: () => this.tokenProvider.forceRefresh(),
      shouldRefresh: isTokenRefreshableError,
      executeWithToken: (token) => this.executeListFiles(token, params),
    });
  }

  private async executeListFiles(
    token: string,
    params: ListFilesParams,
  ): Promise<ListFilesResult> {
    let response: PkgseerGraphqlResponse;
    try {
      response = await this.postGraphqlWithTargetResolutionFallback({
        token,
        query: LIST_REPO_FILES_QUERY,
        variables: {
          registry: params.target.registry,
          packageName: params.target.packageName,
          repoUrl: params.target.repoUrl,
          gitRef: params.target.gitRef,
          version: params.target.version,
          pathPrefix: params.pathPrefix,
          pathSelectors: params.pathSelectors?.map((entry) => ({
            kind: entry.kind,
            value: entry.value,
          })),
          extensions: params.extensions,
          fileTypes: params.fileTypes,
          languages: params.languages,
          fileIntent: params.fileIntent,
          fileIntents: params.fileIntents,
          excludeFileIntents: params.excludeFileIntents,
          excludeDocFiles: params.excludeDocFiles,
          excludeTestFiles: params.excludeTestFiles,
          includeHidden: params.includeHidden,
          limit: params.limit,
          waitTimeoutMs: params.waitTimeoutMs,
        },
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

    const parsed = listRepoFilesGraphQLResponseSchema.safeParse(
      response.parsedBody,
    );
    if (!parsed.success) {
      throw new MalformedCodeNavigationResponseError(
        "Malformed response from code navigation service.",
      );
    }

    if (parsed.data.errors && parsed.data.errors.length > 0) {
      throw this.createGraphQLError(parsed.data.errors);
    }

    const data = parsed.data.data?.listRepoFiles;
    if (!data) {
      throw new MalformedCodeNavigationResponseError(
        "Malformed response from code navigation service.",
      );
    }

    this.throwIfIndexing(data);

    return {
      files: data.files.map((entry) => ({
        path: entry.path,
        name: entry.name ?? undefined,
        language: entry.language ?? undefined,
        fileType: entry.fileType ?? undefined,
        byteSize: entry.byteSize ?? undefined,
      })),
      total: data.total,
      hasMore: data.hasMore,
      indexedVersion: data.indexedVersion ?? undefined,
      resolution: data.resolution
        ? {
            requestedVersion: data.resolution.requestedVersion ?? undefined,
            requestedRef: data.resolution.requestedRef ?? undefined,
            resolvedRef: data.resolution.resolvedRef ?? undefined,
            commitSha: data.resolution.commitSha ?? undefined,
          }
        : undefined,
      targetResolution: normaliseTargetResolution(data.targetResolution),
      hint: data.diagnostics?.hint ?? undefined,
    };
  }

  // ------------------------------------------------------------------
  // readFile → fetchCodeContext
  // ------------------------------------------------------------------

  async readFile(params: ReadFileParams): Promise<ReadFileResult> {
    return executeWithTokenRefresh({
      getToken: () => this.tokenProvider.getToken(),
      forceRefresh: () => this.tokenProvider.forceRefresh(),
      shouldRefresh: isTokenRefreshableError,
      executeWithToken: (token) => this.executeReadFile(token, params),
    });
  }

  private async executeReadFile(
    token: string,
    params: ReadFileParams,
  ): Promise<ReadFileResult> {
    let response: PkgseerGraphqlResponse;
    try {
      response = await this.postGraphqlWithTargetResolutionFallback({
        token,
        query: FETCH_CODE_CONTEXT_QUERY,
        variables: {
          registry: params.target.registry,
          packageName: params.target.packageName,
          repoUrl: params.target.repoUrl,
          gitRef: params.target.gitRef,
          version: params.target.version,
          filePath: params.filePath,
          startLine: params.startLine,
          endLine: params.endLine,
          waitTimeoutMs: params.waitTimeoutMs,
        },
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

    const parsed = fetchCodeContextGraphQLResponseSchema.safeParse(
      response.parsedBody,
    );
    if (!parsed.success) {
      throw new MalformedCodeNavigationResponseError(
        "Malformed response from code navigation service.",
      );
    }

    if (parsed.data.errors && parsed.data.errors.length > 0) {
      throw this.createGraphQLError(parsed.data.errors);
    }

    const data = parsed.data.data?.fetchCodeContext;
    if (!data) {
      throw new MalformedCodeNavigationResponseError(
        "Malformed response from code navigation service.",
      );
    }

    this.throwIfIndexing(data);

    return {
      filePath: data.filePath ?? undefined,
      language: data.language ?? undefined,
      totalLines: data.totalLines ?? undefined,
      startLine: data.startLine ?? undefined,
      endLine: data.endLine ?? undefined,
      content: data.content ?? undefined,
      isBinary: data.isBinary ?? undefined,
      targetResolution: normaliseTargetResolution(data.targetResolution),
      availableVersions: normaliseAvailableVersions(data.availableVersions),
    };
  }

  // ------------------------------------------------------------------
  // grepRepo
  // ------------------------------------------------------------------

  async grepRepo(params: GrepRepoParams): Promise<GrepRepoResult> {
    return executeWithTokenRefresh({
      getToken: () => this.tokenProvider.getToken(),
      forceRefresh: () => this.tokenProvider.forceRefresh(),
      shouldRefresh: isTokenRefreshableError,
      executeWithToken: (token) => this.executeGrepRepo(token, params),
    });
  }

  private async executeGrepRepo(
    token: string,
    params: GrepRepoParams,
  ): Promise<GrepRepoResult> {
    let response: PkgseerGraphqlResponse;
    try {
      response = await this.postGraphqlWithTargetResolutionFallback({
        token,
        query: buildGrepRepoQuery(params.symbolFields),
        variables: {
          registry: params.target.registry,
          packageName: params.target.packageName,
          repoUrl: params.target.repoUrl,
          gitRef: params.target.gitRef,
          version: params.target.version,
          waitTimeoutMs: params.waitTimeoutMs,
          pattern: params.pattern,
          patternType: params.patternType,
          caseSensitive: params.caseSensitive,
          pathSelectors: params.pathSelectors?.map((entry) => ({
            kind: entry.kind,
            value: entry.value,
          })),
          extensions: params.extensions,
          excludeDocFiles: params.excludeDocFiles,
          excludeTestFiles: params.excludeTestFiles,
          allowUnscoped: params.allowUnscoped,
          contextLinesBefore: params.contextLinesBefore,
          contextLinesAfter: params.contextLinesAfter,
          maxMatches: params.maxMatches,
          maxMatchesPerFile: params.maxMatchesPerFile,
          cursor: params.cursor,
          symbolFields: params.symbolFields,
        },
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

    const parsed = grepRepoGraphQLResponseSchema.safeParse(response.parsedBody);
    if (!parsed.success) {
      throw new MalformedCodeNavigationResponseError(
        "Malformed response from code navigation service.",
      );
    }

    if (parsed.data.errors && parsed.data.errors.length > 0) {
      throw this.createGraphQLError(parsed.data.errors);
    }

    const data = parsed.data.data?.grepRepo;
    if (!data) {
      throw new MalformedCodeNavigationResponseError(
        "Malformed response from code navigation service.",
      );
    }

    this.throwIfIndexing(data);

    return {
      matches: data.matches.map((entry) => ({
        filePath: entry.filePath,
        line: entry.line,
        matchStartByte: entry.matchStartByte,
        matchEndByte: entry.matchEndByte,
        lineContent: entry.lineContent,
        contextBefore: entry.contextBefore ?? undefined,
        contextAfter: entry.contextAfter ?? undefined,
        fileContentHash: entry.fileContentHash ?? undefined,
        fileIntent: entry.fileIntent ?? undefined,
        symbolRowId: entry.symbolRowId ?? undefined,
        symbol: entry.symbol
          ? {
              symbolRef: entry.symbol.symbolRef,
              name: entry.symbol.name,
              qualifiedPath: entry.symbol.qualifiedPath ?? undefined,
              kind: entry.symbol.kind ?? undefined,
              category: entry.symbol.category ?? undefined,
              arity: entry.symbol.arity ?? undefined,
              isPublic: entry.symbol.isPublic ?? undefined,
              filePath: entry.symbol.filePath ?? undefined,
              startLine: entry.symbol.startLine ?? undefined,
              endLine: entry.symbol.endLine ?? undefined,
              code: entry.symbol.code ?? undefined,
              callerCount: entry.symbol.callerCount ?? undefined,
              contentHash: entry.symbol.contentHash ?? undefined,
              parentSymbolRef: entry.symbol.parentSymbolRef ?? undefined,
              parentPath: entry.symbol.parentPath ?? undefined,
            }
          : undefined,
      })),
      nextCursor: data.nextCursor ?? undefined,
      hasMore: data.hasMore,
      truncatedReason: data.truncatedReason,
      routeTaken: data.routeTaken ?? undefined,
      filesScanned: data.filesScanned,
      filesInScope: data.filesInScope,
      binaryFilesSkipped: data.binaryFilesSkipped,
      filesTooLargeSkipped: data.filesTooLargeSkipped,
      totalMatches: data.totalMatches,
      uniqueFilesMatched: data.uniqueFilesMatched,
      indexedVersion: data.indexedVersion ?? undefined,
      resolution: data.resolution
        ? {
            requestedVersion: data.resolution.requestedVersion ?? undefined,
            requestedRef: data.resolution.requestedRef ?? undefined,
            resolvedRef: data.resolution.resolvedRef ?? undefined,
            commitSha: data.resolution.commitSha ?? undefined,
          }
        : undefined,
      targetResolution: normaliseTargetResolution(data.targetResolution),
    };
  }
}

function normaliseUnifiedSearchLocator(
  value: z.infer<typeof unifiedSearchLocatorSchema>,
): UnifiedSearchLocator {
  return {
    registry: value.registry ?? undefined,
    packageName: value.packageName ?? undefined,
    version: value.version ?? undefined,
    pageId: value.pageId ?? undefined,
    sourceKind: value.sourceKind ?? undefined,
    sourceUrl: value.sourceUrl ?? undefined,
    repoUrl: value.repoUrl ?? undefined,
    gitRef: value.gitRef ?? undefined,
    commitSha: value.commitSha ?? undefined,
    requestedRef: value.requestedRef ?? undefined,
    filePath: value.filePath ?? undefined,
    repositoryFilePath: value.repositoryFilePath ?? undefined,
    startLine: value.startLine ?? undefined,
    endLine: value.endLine ?? undefined,
    evidenceRange: value.evidenceRange
      ? {
          startLine: value.evidenceRange.startLine,
          endLine: value.evidenceRange.endLine,
          matchLine: value.evidenceRange.matchLine ?? undefined,
          rangeKind: value.evidenceRange.rangeKind ?? undefined,
          matchSpansTruncated: value.evidenceRange.matchSpansTruncated,
        }
      : undefined,
    indexedRange: value.indexedRange
      ? {
          startLine: value.indexedRange.startLine,
          endLine: value.indexedRange.endLine,
        }
      : undefined,
    symbolContext: value.symbolContext
      ? normaliseUnifiedSearchSymbolContext(value.symbolContext)
      : undefined,
    fileContentHash: value.fileContentHash ?? undefined,
    symbolRef: value.symbolRef ?? undefined,
    qualifiedPath: value.qualifiedPath ?? undefined,
    kind: value.kind ?? undefined,
    category: value.category ?? undefined,
    language: value.language ?? undefined,
  };
}

function normaliseUnifiedSearchSymbolContext(
  value: z.infer<typeof unifiedSearchSymbolContextSchema>,
): UnifiedSearchSymbolContext {
  const identity = {
    name: value.name,
    qualifiedPath: value.qualifiedPath ?? undefined,
    kind: value.kind ?? undefined,
  };
  if (value.relation === "ENCLOSES_MATCH") {
    return {
      ...identity,
      relation: "encloses_match",
      definitionRange: normaliseUnifiedSearchDefinitionRange(
        value.definitionRange,
      ),
    };
  }
  return {
    ...identity,
    relation: "associated_with_indexed_chunk",
    definitionRange: value.definitionRange
      ? normaliseUnifiedSearchDefinitionRange(value.definitionRange)
      : undefined,
  };
}

function normaliseUnifiedSearchDefinitionRange(
  value: z.infer<typeof unifiedSearchDefinitionRangeSchema>,
): UnifiedSearchDefinitionRange {
  return {
    filePath: value.filePath,
    repositoryFilePath: value.repositoryFilePath,
    startLine: value.startLine,
    endLine: value.endLine,
  };
}

function validateCodeDiffParams(
  params: unknown,
): asserts params is CodeDiffParams {
  const paramsRecord = asRecord(params);
  if (!paramsRecord) {
    throw new CodeNavigationValidationError(
      "CodeDiff params must be an object.",
    );
  }

  if (
    paramsRecord.mode !== "inventory" &&
    paramsRecord.mode !== "stats" &&
    paramsRecord.mode !== "patches"
  ) {
    throw new CodeNavigationValidationError(
      "CodeDiff mode must be inventory, stats, or patches.",
    );
  }

  if (typeof paramsRecord.from !== "string" || paramsRecord.from.length === 0) {
    throw new CodeNavigationValidationError(
      "CodeDiff from ref or version must not be empty.",
    );
  }
  if (typeof paramsRecord.to !== "string" || paramsRecord.to.length === 0) {
    throw new CodeNavigationValidationError(
      "CodeDiff to ref or version must not be empty.",
    );
  }

  const target = asRecord(paramsRecord.target);
  if (!target) {
    throw new CodeNavigationValidationError(
      "CodeDiff target must be a package or repository target.",
    );
  }

  if (
    Object.hasOwn(target, "registry") &&
    Object.hasOwn(target, "packageName") &&
    !Object.hasOwn(target, "repoUrl")
  ) {
    if (!codeDiffRegistrySchema.safeParse(target.registry).success) {
      throw new CodeNavigationValidationError(
        "CodeDiff package target has an unsupported registry.",
      );
    }
    if (
      typeof target.packageName !== "string" ||
      target.packageName.length === 0
    ) {
      throw new CodeNavigationValidationError(
        "CodeDiff package target name must not be empty.",
      );
    }
  } else if (
    Object.hasOwn(target, "repoUrl") &&
    !Object.hasOwn(target, "registry") &&
    !Object.hasOwn(target, "packageName")
  ) {
    if (typeof target.repoUrl !== "string" || target.repoUrl.length === 0) {
      throw new CodeNavigationValidationError(
        "CodeDiff repository target URL must not be empty.",
      );
    }
  } else if (
    (Object.hasOwn(target, "registry") ||
      Object.hasOwn(target, "packageName")) &&
    Object.hasOwn(target, "repoUrl")
  ) {
    const conflictingKeys = ["registry", "packageName", "repoUrl"]
      .filter((key) => Object.hasOwn(target, key))
      .join(", ");
    throw new CodeNavigationValidationError(
      `CodeDiff target has conflicting present keys: ${conflictingKeys}. Target shape is determined by key presence, even when a value is undefined.`,
    );
  } else {
    throw new CodeNavigationValidationError(
      "CodeDiff target must be a package or repository target.",
    );
  }

  const optionsValue = paramsRecord.options;
  if (optionsValue === undefined) return;
  const options = asRecord(optionsValue);
  if (!options) {
    throw new CodeNavigationValidationError(
      "CodeDiff options must be an object when supplied.",
    );
  }

  for (const key of Object.keys(options)) {
    if (!CODE_DIFF_OPTION_KEYS.has(key)) {
      throw new CodeNavigationValidationError(
        `CodeDiff options contains unknown key '${key}'.`,
      );
    }
  }

  validateCodeDiffIntegerOption(options.maxFiles, "maxFiles", 1, 300);
  validateCodeDiffIntegerOption(
    options.maxPatchBytes,
    "maxPatchBytes",
    1024,
    2_097_152,
  );
  validateCodeDiffPathOption(options.pathPrefix, "pathPrefix");
  validateCodeDiffPathOption(options.pathGlob, "pathGlob");
}

function validateCodeDiffIntegerOption(
  value: unknown,
  name: string,
  minimum: number,
  maximum: number,
): void {
  if (value === undefined) return;
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new CodeNavigationValidationError(
      `CodeDiff ${name} must be an integer from ${minimum} through ${maximum}.`,
    );
  }
}

function validateCodeDiffPathOption(value: unknown, name: string): void {
  if (value === undefined) return;
  if (typeof value !== "string") {
    throw new CodeNavigationValidationError(
      `CodeDiff ${name} must be a string when supplied.`,
    );
  }
  if (value.length === 0) {
    throw new CodeNavigationValidationError(
      `CodeDiff ${name} must not be empty when supplied.`,
    );
  }
  if (new TextEncoder().encode(value).byteLength > 1024) {
    throw new CodeNavigationValidationError(
      `CodeDiff ${name} must be at most 1024 bytes.`,
    );
  }
}

function buildCodeDiffVariables(
  params: CodeDiffParams,
): Record<string, unknown> {
  const target = params.target;
  const variables: Record<string, unknown> = {};
  if ("registry" in target) {
    variables.registry = target.registry;
    variables.name = target.packageName;
    variables.fromVersion = params.from;
    variables.toVersion = params.to;
  } else {
    variables.repoUrl = target.repoUrl;
    variables.fromRef = params.from;
    variables.toRef = params.to;
  }

  const rawOptions = Object.fromEntries(
    Object.entries(params.options ?? {}).filter(
      ([, value]) => value !== undefined,
    ),
  );
  if (Object.keys(rawOptions).length > 0) variables.rawOptions = rawOptions;
  return variables;
}

function isCodeDiffRawError(
  error: z.infer<typeof codeDiffGraphQLErrorSchema>,
): boolean {
  return error.path?.some((part) => part === "raw") ?? false;
}

function normaliseCodeDiffResult(
  result: z.infer<typeof codeDiffResultSchema>,
): CodeDiffResult {
  if (!result.raw) {
    throw new MalformedCodeNavigationResponseError(
      "CodeDiff response missing non-null raw result.",
    );
  }
  return {
    package: normaliseCodeDiffPackage(result.package),
    fromResolution: normaliseCodeDiffResolution(result.fromResolution),
    toResolution: normaliseCodeDiffResolution(result.toResolution),
    raw: normaliseRawCodeDiff(result.raw),
  };
}

function normaliseCodeDiffPartial(
  result: z.infer<typeof codeDiffResultSchema>,
): CodeDiffPartialResult {
  return {
    package: normaliseCodeDiffPackage(result.package),
    fromResolution: normaliseCodeDiffResolution(result.fromResolution),
    toResolution: normaliseCodeDiffResolution(result.toResolution),
    raw: result.raw ? normaliseRawCodeDiff(result.raw) : undefined,
  };
}

function normaliseCodeDiffPackage(
  value: z.infer<typeof codeDiffPackageInfoSchema> | null | undefined,
): CodeDiffPackageInfo | undefined {
  if (!value) return undefined;
  return {
    registry: value.registry,
    name: value.name,
    repoUrl: value.repoUrl,
  };
}

function normaliseCodeDiffResolution(
  value: z.infer<typeof codeDiffRefResolutionSchema>,
): CodeDiffRefResolution {
  return {
    requested: value.requested,
    resolvedVersion: value.resolvedVersion ?? undefined,
    ref: value.ref,
    commitSha: value.commitSha,
    refKind: value.refKind,
    versionSource: value.versionSource ?? undefined,
  };
}

function normaliseRawCodeDiff(
  value: z.infer<typeof rawCodeDiffSchema>,
): RawCodeDiff {
  return {
    summary: value.summary,
    scope: {
      status: value.scope.status,
      fromSubpath: value.scope.fromSubpath ?? undefined,
      toSubpath: value.scope.toSubpath ?? undefined,
      pathPrefix: value.scope.pathPrefix ?? undefined,
      pathGlob: value.scope.pathGlob ?? undefined,
    },
    contentCoverage: value.contentCoverage,
    contentFailure: value.contentFailure
      ? {
          code: value.contentFailure.code,
          retryable: value.contentFailure.retryable,
          retryAfterMs: value.contentFailure.retryAfterMs ?? undefined,
          stage: value.contentFailure.stage ?? undefined,
          limitKind: value.contentFailure.limitKind ?? undefined,
        }
      : undefined,
    files: value.files.map((file) => ({
      path: file.path,
      pathEncoding: file.pathEncoding,
      status: file.status,
      modeChanged: file.modeChanged,
      typeChanged: file.typeChanged,
      additions: file.additions ?? undefined,
      deletions: file.deletions ?? undefined,
      patch: file.patch ?? undefined,
      contentStatus: file.contentStatus,
      contentOmissionReason: file.contentOmissionReason ?? undefined,
      contentSafety: {
        filtered: file.contentSafety.filtered,
        modifications: file.contentSafety.modifications,
      },
    })),
    hasMoreFiles: value.hasMoreFiles,
  };
}

function parseCodeDiffErrorDetails(
  errors: Array<z.infer<typeof codeDiffGraphQLErrorSchema>>,
): CodeDiffErrorDetails | undefined {
  const extensions = getPrimaryExtensions(errors);
  if (!extensions) return undefined;

  const details: CodeDiffErrorDetails = {};
  if (typeof extensions.code === "string") details.code = extensions.code;
  if (typeof extensions.retryable === "boolean") {
    details.retryable = extensions.retryable;
  }
  if (extensions.side === "from" || extensions.side === "to") {
    details.side = extensions.side;
  }
  const publishedVersions = parseCodeDiffStringArray(
    extensions.published_versions,
  );
  if (publishedVersions) details.publishedVersions = publishedVersions;
  if (typeof extensions.published_versions_truncated === "boolean") {
    details.publishedVersionsTruncated =
      extensions.published_versions_truncated;
  }
  const availableVersions = parseCodeDiffErrorRefs(
    extensions.available_versions,
  );
  if (availableVersions) details.availableVersions = availableVersions;
  if (typeof extensions.registry === "string") {
    details.registry = extensions.registry;
  }
  if (
    typeof extensions.retry_after_ms === "number" &&
    Number.isInteger(extensions.retry_after_ms) &&
    extensions.retry_after_ms >= 0
  ) {
    details.retryAfterMs = extensions.retry_after_ms;
  }
  if (typeof extensions.stage === "string") details.stage = extensions.stage;
  if (typeof extensions.limit_kind === "string") {
    details.limitKind = extensions.limit_kind;
  }
  if (typeof extensions.repo_url === "string") {
    details.repoUrl = extensions.repo_url;
  }
  if (typeof extensions.git_ref === "string")
    details.gitRef = extensions.git_ref;
  const availableRefs = parseCodeDiffErrorRefs(extensions.available_refs);
  if (availableRefs) details.availableRefs = availableRefs;
  const suggestedRefs = parseCodeDiffErrorRefs(extensions.suggested_refs);
  if (suggestedRefs) details.suggestedRefs = suggestedRefs;
  const refKinds = parseCodeDiffStringArray(extensions.ref_kinds);
  if (refKinds) details.refKinds = refKinds;
  return Object.keys(details).length > 0 ? details : undefined;
}

function parseCodeDiffStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  if (value.some((entry) => typeof entry !== "string")) return undefined;
  return value as string[];
}

function parseCodeDiffErrorRefs(
  value: unknown,
): CodeDiffErrorRef[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const refs: CodeDiffErrorRef[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return undefined;
    }
    const record = entry as Record<string, unknown>;
    if (
      typeof record.ref !== "string" ||
      (record.version !== undefined &&
        record.version !== null &&
        typeof record.version !== "string")
    ) {
      return undefined;
    }
    refs.push({
      ref: record.ref,
      version: typeof record.version === "string" ? record.version : undefined,
    });
  }
  return refs;
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

function buildTargetResolutionFallbackQueries(query: string): string[] {
  const withoutSuggestedRefs = query
    .replaceAll(TARGET_RESOLUTION_SUGGESTED_REFS_SELECTION, "")
    .replaceAll(DISCOVERY_TARGET_PROGRESS_SUGGESTED_REFS_SELECTION, "");
  const candidates = [
    withoutSuggestedRefs,
    withoutSuggestedRefs.replaceAll(
      TARGET_RESOLUTION_AVAILABLE_REFS_SELECTION,
      "",
    ),
    withoutSuggestedRefs.replaceAll(
      DISCOVERY_TARGET_PROGRESS_RETRY_SELECTION,
      "",
    ),
    withoutSuggestedRefs.replaceAll(
      CODE_CONTEXT_AVAILABLE_VERSIONS_SELECTION,
      "",
    ),
    withoutSuggestedRefs
      .replaceAll(TARGET_RESOLUTION_SELECTION, "")
      .replaceAll(DISCOVERY_TARGET_PROGRESS_RETRY_SELECTION, "")
      .replaceAll(CODE_CONTEXT_AVAILABLE_VERSIONS_SELECTION, ""),
  ];
  return candidates.filter(
    (candidate, index, all) =>
      candidate !== query && all.indexOf(candidate) === index,
  );
}

function hasSchemaMismatchErrors(parsedBody: unknown): boolean {
  if (!parsedBody || typeof parsedBody !== "object") return false;
  const errors = (parsedBody as { errors?: unknown }).errors;
  if (!Array.isArray(errors)) return false;
  return errors.some((entry) => {
    if (!entry || typeof entry !== "object") return false;
    const error = entry as {
      message?: unknown;
      extensions?: { code?: unknown };
    };
    if (typeof error.message !== "string") return false;
    const code =
      typeof error.extensions?.code === "string"
        ? error.extensions.code
        : undefined;
    return isGraphQLSchemaMismatchError({ message: error.message, code });
  });
}

/**
 * Pick the first GraphQL error entry that carries an `extensions`
 * block. Backends typically emit a single error per failure; when
 * multiple are present the primary one wins. Separate from the
 * joined message string so callers can reach structured fields
 * (package, latest_indexed, available_versions, retryable).
 */
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

function getGraphQLIndexingRef(
  errors: Array<z.infer<typeof graphQLErrorSchema>>,
): string | undefined {
  for (const error of errors) {
    const indexingRef =
      error.extensions?.indexing_ref ?? error.extensions?.indexingRef;
    if (typeof indexingRef === "string") return indexingRef;
  }

  return undefined;
}

/**
 * Parse `extensions.available_versions` (snake_case on the wire) into
 * the internal `AvailableVersion` shape. Silently drops malformed
 * entries so a partially-broken extensions block does not prevent
 * the user from seeing whatever good suggestions are available.
 */
function parseAvailableVersions(
  extensions: Record<string, unknown> | undefined,
): AvailableVersion[] | undefined {
  const raw = extensions?.available_versions ?? extensions?.availableVersions;
  return parseAvailableArtifacts(raw);
}

function parseAvailableRefs(
  extensions: Record<string, unknown> | undefined,
): AvailableRef[] | undefined {
  const raw = extensions?.available_refs ?? extensions?.availableRefs;
  return parseAvailableArtifacts(raw);
}

function parseSuggestedRefs(
  extensions: Record<string, unknown> | undefined,
): SuggestedRef[] | undefined {
  const raw = extensions?.suggested_refs ?? extensions?.suggestedRefs;
  return parseAvailableArtifacts(raw);
}

function parseGraphQLErrorMetadata(
  extensions: Record<string, unknown> | undefined,
  indexingEstimate: IndexingDurationEstimate | undefined,
): CodeNavigationErrorMetadata | undefined {
  const metadata: CodeNavigationErrorMetadata = {};
  if (typeof extensions?.hint === "string") metadata.hint = extensions.hint;
  const filePath = extensions?.file_path ?? extensions?.filePath;
  if (typeof filePath === "string") metadata.filePath = filePath;
  const exclusionReason =
    extensions?.exclusion_reason ?? extensions?.exclusionReason;
  if (typeof exclusionReason === "string") {
    metadata.exclusionReason = exclusionReason;
  }
  const availableVersions = parseAvailableVersions(extensions);
  if (availableVersions?.length) metadata.availableVersions = availableVersions;
  const availableRefs = parseAvailableRefs(extensions);
  if (availableRefs?.length) metadata.availableRefs = availableRefs;
  const suggestedRefs = parseSuggestedRefs(extensions);
  if (suggestedRefs?.length) metadata.suggestedRefs = suggestedRefs;
  const targetResolution = parseTargetResolution(extensions);
  if (targetResolution) metadata.targetResolution = targetResolution;
  if (indexingEstimate) metadata.indexingEstimate = indexingEstimate;
  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

function parseGraphQLRepoUrl(
  extensions: Record<string, unknown> | undefined,
): string | undefined {
  return typeof extensions?.repo_url === "string"
    ? extensions.repo_url
    : typeof extensions?.repoUrl === "string"
      ? extensions.repoUrl
      : undefined;
}

function parseGraphQLGitRef(
  extensions: Record<string, unknown> | undefined,
): string | undefined {
  return typeof extensions?.git_ref === "string"
    ? extensions.git_ref
    : typeof extensions?.gitRef === "string"
      ? extensions.gitRef
      : undefined;
}

function parseTargetResolution(
  extensions: Record<string, unknown> | undefined,
): TargetResolution | undefined {
  const raw = extensions?.target_resolution ?? extensions?.targetResolution;
  const parsed = targetResolutionSchema.safeParse(raw);
  if (!parsed.success) return undefined;
  return normaliseTargetResolution(parsed.data);
}

function parseIndexingDurationEstimate(
  extensions: Record<string, unknown> | undefined,
): IndexingDurationEstimate | undefined {
  const raw =
    extensions?.estimated_indexing_duration ??
    extensions?.estimatedIndexingDuration ??
    extensions?.indexing_estimate ??
    extensions?.indexingEstimate;
  const parsed = indexingDurationEstimateSchema.safeParse(
    normaliseRawIndexingDurationEstimate(raw),
  );
  if (!parsed.success) return undefined;
  return normaliseIndexingDurationEstimate(parsed.data);
}

function normaliseRawIndexingDurationEstimate(raw: unknown): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const record = raw as Record<string, unknown>;
  return {
    lowerSeconds: record.lowerSeconds ?? record.lower_seconds,
    upperSeconds: record.upperSeconds ?? record.upper_seconds,
    elapsedSeconds: record.elapsedSeconds ?? record.elapsed_seconds,
    sampleCount: record.sampleCount ?? record.sample_count,
    source: record.source,
  };
}

function normaliseIndexingDurationEstimate(
  estimate: z.infer<typeof indexingDurationEstimateSchema>,
): IndexingDurationEstimate | undefined {
  if (!estimate) return undefined;
  const out: IndexingDurationEstimate = {};
  if (typeof estimate.lowerSeconds === "number") {
    out.lowerSeconds = estimate.lowerSeconds;
  }
  if (typeof estimate.upperSeconds === "number") {
    out.upperSeconds = estimate.upperSeconds;
  }
  if (typeof estimate.elapsedSeconds === "number") {
    out.elapsedSeconds = estimate.elapsedSeconds;
  }
  if (typeof estimate.sampleCount === "number") {
    out.sampleCount = estimate.sampleCount;
  }
  if (typeof estimate.source === "string") out.source = estimate.source;
  return Object.keys(out).length > 0 ? out : undefined;
}

function appendIndexingWaitHint(
  message: string,
  backendHint: string | undefined,
): string | undefined {
  const hintAlreadyInMessage = Boolean(
    backendHint && message.includes(backendHint),
  );
  const existingGuidance = `${message} ${backendHint ?? ""}`;
  if (/(?:--wait\b|wait_timeout_ms|waitTimeoutMs)/i.test(existingGuidance)) {
    return hintAlreadyInMessage ? undefined : backendHint;
  }
  return backendHint && !hintAlreadyInMessage
    ? `${backendHint} ${INDEXING_WAIT_HINT}`
    : INDEXING_WAIT_HINT;
}

function parseAvailableArtifacts(raw: unknown): AvailableVersion[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const parsed: AvailableVersion[] = [];
  for (const item of raw) {
    if (item && typeof item === "object" && "ref" in item) {
      const entry = item as { ref?: unknown; version?: unknown };
      if (typeof entry.ref === "string") {
        parsed.push({
          ref: entry.ref,
          version:
            typeof entry.version === "string" ? entry.version : undefined,
        });
      }
    }
  }
  return parsed.length > 0 ? parsed : undefined;
}

function normaliseAvailableVersions(
  entries: Array<{ version?: string | null; ref: string }> | null | undefined,
): AvailableVersion[] | undefined {
  if (!entries || entries.length === 0) return undefined;
  return entries.map((entry) => ({
    version: entry.version ?? undefined,
    ref: entry.ref,
  }));
}

function normaliseTargetResolution(
  resolution: z.infer<typeof targetResolutionSchema>,
): TargetResolution | undefined {
  if (!resolution) return undefined;
  return {
    requested: normaliseTargetResolutionIdentity(resolution.requested),
    resolvedRequested: normaliseTargetResolutionIdentity(
      resolution.resolvedRequested,
    ),
    served: normaliseTargetResolutionIdentity(resolution.served),
    freshness: resolution.freshness ?? undefined,
    freshnessReason: resolution.freshnessReason ?? undefined,
    indexingRef: resolution.indexingRef ?? undefined,
    availableVersions:
      normaliseAvailableVersions(resolution.availableVersions) ?? [],
    availableRefs: normaliseAvailableVersions(resolution.availableRefs) ?? [],
    suggestedRefs: normaliseAvailableVersions(resolution.suggestedRefs) ?? [],
  };
}

/**
 * Normalise crawl coverage. Pair/progress coverage drops `NONE` because it has
 * no actionable signal; contributor coverage preserves it as part of the
 * selected published snapshot.
 */
function normaliseDocCoverage(
  coverage: z.infer<typeof docCoverageSchema>,
  options: { preserveNone?: boolean } = {},
): DocCoverage | undefined {
  if (!coverage) return undefined;
  if (coverage.coverageState === "NONE" && !options.preserveNone) {
    return undefined;
  }
  const out: DocCoverage = { coverageState: coverage.coverageState };
  if (coverage.coverageReason) out.coverageReason = coverage.coverageReason;
  if (typeof coverage.pagesCrawled === "number") {
    out.pagesCrawled = coverage.pagesCrawled;
  }
  if (
    typeof coverage.frontierRemaining === "number" ||
    coverage.frontierRemaining === null
  ) {
    out.frontierRemaining = coverage.frontierRemaining;
  }
  if (typeof coverage.artifactOverflowPageCount === "number") {
    out.artifactOverflowPageCount = coverage.artifactOverflowPageCount;
  }
  if (typeof coverage.estimatedTotalPages === "number") {
    out.estimatedTotalPages = coverage.estimatedTotalPages;
  }
  if (coverage.note) out.note = coverage.note;
  return out;
}

function normaliseTargetResolutionIdentity(
  identity: z.infer<typeof targetResolutionIdentitySchema>,
): TargetResolutionIdentity | undefined {
  if (!identity) return undefined;
  const out: TargetResolutionIdentity = {};
  if (identity.kind) out.kind = identity.kind;
  if (identity.registry) out.registry = identity.registry;
  if (identity.packageName) out.packageName = identity.packageName;
  if (identity.version) out.version = identity.version;
  if (identity.repoUrl) out.repoUrl = identity.repoUrl;
  if (identity.gitRef) out.gitRef = identity.gitRef;
  if (identity.commitSha) out.commitSha = identity.commitSha;
  if (identity.site) out.site = identity.site;
  return Object.keys(out).length > 0 ? out : undefined;
}

function isAuthMessage(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("unauthorized") ||
    lower.includes("forbidden") ||
    lower.includes("permission") ||
    lower.includes("authentication")
  );
}

function normaliseTargetMode(
  value: string | null | undefined,
): DiscoveryTargetMode | undefined {
  if (
    value === "PACKAGES" ||
    value === "REPO" ||
    value === "MIXED" ||
    value === "SITES" ||
    value === "SITE"
  ) {
    return value;
  }
  return undefined;
}

function normaliseRequestedRefKind(
  value: string | null | undefined,
): DiscoveryRequestedRefKind | undefined {
  switch (value) {
    case "OMITTED_VERSION":
    case "LATEST_VERSION":
    case "EXACT_VERSION":
    case "DEFAULT_BRANCH":
    case "HEAD":
    case "BRANCH":
    case "SHA":
      return value;
    default:
      return undefined;
  }
}

function normaliseProgressFilters(
  filters: z.infer<typeof unifiedSearchFiltersSchema>,
): UnifiedSearchFilters | undefined {
  if (!filters) return undefined;
  const out: UnifiedSearchFilters = {};
  if (filters.fileIntent) out.fileIntent = filters.fileIntent as FileIntent;
  if (filters.kind) out.kind = filters.kind as SymbolKind;
  if (filters.category) out.category = filters.category as SymbolCategory;
  if (typeof filters.publicOnly === "boolean") {
    out.publicOnly = filters.publicOnly;
  }
  if (filters.pathPrefix) out.pathPrefix = filters.pathPrefix;
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Heuristic fallback for NOT_FOUND detection when the backend does not
 * populate `extensions.code` on GraphQL errors. See backend request B8
 * — once backend adds structured codes, this heuristic becomes a
 * secondary fallback rather than the primary signal.
 *
 * Scope deliberately narrow: "not found" / "unknown package" are
 * lookup-failure signals. Phrases like "could not resolve" are avoided
 * here because they also appear in `UNRESOLVABLE` messages, which
 * have different semantics for the caller (version/ref resolution
 * failure rather than the target not existing).
 */
function isTargetNotFoundMessage(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("not found") ||
    lower.includes("unknown package") ||
    lower.includes("no such package") ||
    lower.includes("does not exist")
  );
}

/**
 * Heuristic for UNRESOLVABLE — used when the backend returns a
 * version/ref resolution failure (e.g. "Could not resolve version
 * X to a Git ref") without populating `extensions.code`. Semantically
 * distinct from NOT_FOUND: the target is known, but the requested
 * version/ref cannot be mapped to indexable source.
 */
function isUnresolvableMessage(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("could not resolve") || lower.includes("cannot resolve")
  );
}
