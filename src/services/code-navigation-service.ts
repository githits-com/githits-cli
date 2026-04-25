import { z } from "zod";
import { debugLog, isDebugAreaEnabled } from "../shared/debug-log.js";
import {
  type PkgseerGraphqlResponse,
  PkgseerTransportError,
  postPkgseerGraphql,
} from "../shared/pkgseer-graphql.js";
import type { PkgseerRegistry } from "../shared/pkgseer-registry.js";
import { executeWithTokenRefresh } from "./execute-with-token-refresh.js";
import { AuthenticationError } from "./githits-service.js";
import type { TokenProvider } from "./token-manager.js";

/**
 * Back-compat alias — the canonical registry union now lives in
 * `src/shared/pkgseer-registry.ts`. Re-exported here so existing
 * consumers of `CodeNavigationRegistry` compile unchanged.
 */
export type CodeNavigationRegistry = PkgseerRegistry;

export type SearchSymbolsMatchMode = "OR" | "AND";

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
export type SearchSymbolsKind =
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

export type SearchSymbolsFileIntent =
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

export interface SearchSymbolsParams {
  target: CodeNavigationTarget;
  query?: string;
  keywords?: string[];
  matchMode?: SearchSymbolsMatchMode;
  /**
   * Precise symbol kind. Prefer `category` for broad filtering;
   * use `kind` only when the caller wants a specific construct.
   */
  kind?: SearchSymbolsKind;
  /**
   * Broad symbol category filter. Preferred surface for filtering
   * navigation queries — works across the 27-value kind taxonomy
   * without enumerating individual kinds.
   */
  category?: SymbolCategory;
  filePath?: string;
  limit?: number;
  fileIntent?: SearchSymbolsFileIntent;
  waitTimeoutMs?: number;
}

export interface SearchSymbolsResultEntry {
  name?: string;
  filePath?: string;
  startLine?: number;
  endLine?: number;
  preview?: string;
  code?: string;
  language?: string;
  symbolRef?: string;
  qualifiedPath?: string;
  /**
   * Precise symbol kind (lowercase string) from the backend's
   * unified symbol taxonomy. Populated for every chunk — the
   * backend handles the fallback from chunk-level classification
   * to enrichment-level kind internally, so callers can treat
   * this as the single source of truth for taxonomy.
   */
  kind?: string;
  /**
   * Broad category of the primary symbol — one of `callable`,
   * `type`, `module`, `data`, `documentation`. Computed by the
   * backend from `kind`. Null for kinds with no category
   * (e.g. CSS rules).
   */
  category?: string;
  arity?: number;
  isPublic?: boolean;
  /**
   * Number of symbols contained in this chunk (DETAILED mode only,
   * populated when > 1). Schema coerced to `Int` in the April 2026
   * backend update; earlier versions returned a string array.
   */
  containedSymbols?: number;
}

export interface SearchSymbolsResolution {
  requestedVersion?: string;
  requestedRef?: string;
  resolvedRef?: string;
  commitSha?: string;
}

export interface SearchSymbolsResult {
  results: SearchSymbolsResultEntry[];
  totalMatches: number;
  hasMore: boolean;
  version?: string;
  resolution?: SearchSymbolsResolution;
  hint?: string;
  warning?: string;
}

export type UnifiedSearchSource = "AUTO" | "DOCS" | "CODE" | "SYMBOL";

export type UnifiedSearchResultType =
  | "DOCUMENTATION_PAGE"
  | "REPOSITORY_SYMBOL"
  | "REPOSITORY_CODE"
  | "REPOSITORY_DOC";

export type UnifiedSearchSessionStatus =
  | "PENDING"
  | "INDEXING"
  | "SEARCHING"
  | "COMPLETED"
  | "TIMEOUT"
  | "FAILED";

export interface UnifiedSearchFilters {
  fileIntent?: SearchSymbolsFileIntent;
  kind?: SearchSymbolsKind;
  category?: SymbolCategory;
  publicOnly?: boolean;
  pathPrefix?: string;
}

export interface UnifiedSearchParams {
  targets: CodeNavigationTarget[];
  query: string;
  sources?: UnifiedSearchSource[];
  filters?: UnifiedSearchFilters;
  allowPartialResults?: boolean;
  limit?: number;
  offset?: number;
  waitTimeoutMs?: number;
}

export interface UnifiedSearchLocator {
  registry?: string;
  packageName?: string;
  version?: string;
  pageId?: string;
  sourceKind?: string;
  sourceUrl?: string;
  repoUrl?: string;
  gitRef?: string;
  requestedRef?: string;
  filePath?: string;
  startLine?: number;
  endLine?: number;
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
  indexingStatus?: string;
  codeIndexState?: string;
  resultCount?: number;
  appliedFilters: string[];
  ignoredFilters: string[];
  incompatibleFilters: string[];
  appliedQueryFeatures: string[];
  ignoredQueryFeatures: string[];
  incompatibleQueryFeatures: string[];
  note?: string;
}

export interface UnifiedSearchResult {
  query: string;
  queryWarnings: string[];
  sources: UnifiedSearchSource[];
  results: UnifiedSearchHit[];
  page: UnifiedSearchPageInfo;
  partialResults: boolean;
  sourceStatus: UnifiedSearchSourceStatus[];
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

/**
 * Input for {@link CodeNavigationService.listFiles}.
 */
export interface ListFilesParams {
  target: CodeNavigationTarget;
  pathPrefix?: string;
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
  resolution?: SearchSymbolsResolution;
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
  resolution?: SearchSymbolsResolution;
}

export interface CodeNavigationService {
  search(params: UnifiedSearchParams): Promise<UnifiedSearchOutcome>;
  searchStatus(searchRef: string): Promise<UnifiedSearchOutcome>;
  searchSymbols(params: SearchSymbolsParams): Promise<SearchSymbolsResult>;
  listFiles(params: ListFilesParams): Promise<ListFilesResult>;
  readFile(params: ReadFileParams): Promise<ReadFileResult>;
  grepRepo(params: GrepRepoParams): Promise<GrepRepoResult>;
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
  ) {
    super(message);
    this.name = "CodeNavigationIndexingError";
  }
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

export class CodeNavigationTargetNotFoundError extends Error {
  constructor(
    message: string,
    public readonly availableVersions?: AvailableVersion[],
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
  ) {
    super(message);
    this.name = "CodeNavigationVersionNotFoundError";
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
 * Raised when the caller hit a backend feature flag they don't have
 * access to. Same user-facing handling as ACCESS_DENIED.
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
  ) {
    super(message);
    this.name = "CodeNavigationBackendError";
  }
}

/**
 * Raised by the service when the caller supplied neither a query
 * nor any keywords. Name starts with `Invalid` so
 * `mapCodeNavigationError` classifies it as `INVALID_ARGUMENT`.
 */
export class InvalidSearchSymbolsRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidSearchSymbolsRequestError";
  }
}

// Always requests `mode: DETAILED` — the service makes this choice
// once so both CLI and MCP get the richest response (kind, category,
// endLine, language). Consumers derive a snippet from `code` when
// needed; `preview` is available in both modes but the formatter
// owns snippet rendering client-side for consistent truncation.
const SEARCH_SYMBOLS_QUERY = `
query SearchSymbols(
  $registry: Registry
  $packageName: String
  $repoUrl: String
  $gitRef: String
  $query: String
  $keywords: [String!]
  $matchMode: MatchMode
  $kind: SymbolKind
  $category: SymbolCategory
  $filePath: String
  $version: String
  $limit: Int
  $fileIntent: FileIntent
  $waitTimeoutMs: Int
) {
  searchSymbols(
    registry: $registry
    packageName: $packageName
    repoUrl: $repoUrl
    gitRef: $gitRef
    query: $query
    keywords: $keywords
    matchMode: $matchMode
    kind: $kind
    category: $category
    filePath: $filePath
    version: $version
    limit: $limit
    fileIntent: $fileIntent
    mode: DETAILED
    waitTimeoutMs: $waitTimeoutMs
  ) {
    results {
      name
      filePath
      startLine
      endLine
      preview
      code
      language
      symbolRef
      qualifiedPath
      kind
      category
      arity
      isPublic
      containedSymbols
    }
    totalMatches
    hasMore
    indexedVersion
    resolution {
      requestedVersion
      requestedRef
      resolvedRef
      commitSha
    }
    diagnostics {
      hint
    }
    warning
    codeIndexState
    indexingRef
    availableVersions {
      version
      ref
    }
  }
}`;

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
        title
        summary
        score
        highlights {
          title
          summary
        }
        locator {
          registry
          packageName
          version
          pageId
          sourceKind
          sourceUrl
          repoUrl
          gitRef
          requestedRef
          filePath
          startLine
          endLine
          fileContentHash
          symbolRef
          qualifiedPath
          kind
          category
          language
        }
      }
      page {
        offset
        limit
        returned
        hasMore
      }
      partialResults
      sourceStatus {
        source
        targetLabel
        indexingStatus
        codeIndexState
        resultCount
        appliedFilters
        ignoredFilters
        incompatibleFilters
        appliedQueryFeatures
        ignoredQueryFeatures
        incompatibleQueryFeatures
        note
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
      expiresAt
    }
  }
}`;

const UNIFIED_SEARCH_STATUS_QUERY = `
query UnifiedSearchStatus($searchRef: String!, $includeResults: Boolean!) {
  discoverySearchProgress(searchRef: $searchRef, includeResults: $includeResults) {
    searchRef
    status
    targetsTotal
    targetsReady
    elapsedMs
    query
    queryWarnings
    sources
    expiresAt
    results {
      query
      queryWarnings
      sources
      results {
        id
        resultType
        targetLabel
        title
        summary
        score
        highlights {
          title
          summary
        }
        locator {
          registry
          packageName
          version
          pageId
          sourceKind
          sourceUrl
          repoUrl
          gitRef
          requestedRef
          filePath
          startLine
          endLine
          fileContentHash
          symbolRef
          qualifiedPath
          kind
          category
          language
        }
      }
      page {
        offset
        limit
        returned
        hasMore
      }
      partialResults
      sourceStatus {
        source
        targetLabel
        indexingStatus
        codeIndexState
        resultCount
        appliedFilters
        ignoredFilters
        incompatibleFilters
        appliedQueryFeatures
        ignoredQueryFeatures
        incompatibleQueryFeatures
        note
      }
    }
  }
}`;

function debugUnifiedSearchRequest(variables: {
  targets: Array<Record<string, unknown>>;
  query: string;
  sources?: UnifiedSearchSource[];
  filters?: UnifiedSearchFilters;
  allowPartialResults: boolean;
  limit?: number;
  offset?: number;
  waitTimeoutMs?: number;
}): void {
  if (!isDebugAreaEnabled("code-nav")) return;
  const serialised = serialiseForDebug(variables);
  const filters = asRecord(serialised.filters);

  debugLog("code-nav", {
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
  operation: "search" | "searchSymbols",
  graphqlQuery: string,
  variables: Record<string, unknown>,
): void {
  if (!isDebugAreaEnabled("code-nav-wire")) return;
  debugLog("code-nav-wire", {
    event: "wire-request",
    operation,
    graphqlQuery,
    variables: serialiseForDebug(variables),
  });
}

function debugSearchSymbolsRequest(variables: {
  registry?: string;
  packageName?: string;
  repoUrl?: string;
  gitRef?: string;
  query?: string;
  keywords?: string[];
  matchMode?: SearchSymbolsMatchMode;
  kind?: SearchSymbolsKind;
  category?: SymbolCategory;
  filePath?: string;
  version?: string;
  limit?: number;
  fileIntent?: SearchSymbolsFileIntent;
  waitTimeoutMs?: number;
}): void {
  if (!isDebugAreaEnabled("code-nav")) return;
  const serialised = serialiseForDebug(variables);

  debugLog("code-nav", {
    event: "request",
    operation: "searchSymbols",
    targetType: typeof serialised.repoUrl === "string" ? "repo" : "package",
    queryMode: Array.isArray(serialised.keywords)
      ? typeof serialised.query === "string"
        ? "query+keywords"
        : "keywords"
      : typeof serialised.query === "string"
        ? "query"
        : "none",
    keywordsCount: Array.isArray(serialised.keywords)
      ? serialised.keywords.length
      : 0,
    kind: typeof serialised.kind === "string" ? serialised.kind : undefined,
    category:
      typeof serialised.category === "string" ? serialised.category : undefined,
    fileIntent:
      typeof serialised.fileIntent === "string"
        ? serialised.fileIntent
        : "omitted",
    presentVariableKeys: Object.keys(serialised).sort(),
    hasLimit: typeof serialised.limit === "number",
    waitTimeoutMs:
      typeof serialised.waitTimeoutMs === "number"
        ? serialised.waitTimeoutMs
        : undefined,
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

const searchSymbolsResultEntrySchema = z.object({
  name: z.string().nullable().optional(),
  filePath: z.string().nullable().optional(),
  startLine: z.number().int().nullable().optional(),
  endLine: z.number().int().nullable().optional(),
  preview: z.string().nullable().optional(),
  code: z.string().nullable().optional(),
  language: z.string().nullable().optional(),
  symbolRef: z.string().nullable().optional(),
  qualifiedPath: z.string().nullable().optional(),
  kind: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  arity: z.number().int().nullable().optional(),
  isPublic: z.boolean().nullable().optional(),
  containedSymbols: z.number().int().nullable().optional(),
});

const searchSymbolsResponseSchema = z.object({
  results: z.array(searchSymbolsResultEntrySchema),
  totalMatches: z.number().int(),
  hasMore: z.boolean(),
  indexedVersion: z.string().nullable().optional(),
  resolution: z
    .object({
      requestedVersion: z.string().nullable().optional(),
      requestedRef: z.string().nullable().optional(),
      resolvedRef: z.string().nullable().optional(),
      commitSha: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
  diagnostics: z
    .object({
      hint: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
  warning: z.string().nullable().optional(),
  codeIndexState: z.string(),
  indexingRef: z.string().nullable().optional(),
  availableVersions: z.array(availableVersionSchema).nullable().optional(),
});

const unifiedSearchSourceSchema = z.enum(["AUTO", "DOCS", "CODE", "SYMBOL"]);

const unifiedSearchResultTypeSchema = z.enum([
  "DOCUMENTATION_PAGE",
  "REPOSITORY_SYMBOL",
  "REPOSITORY_CODE",
  "REPOSITORY_DOC",
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
  requestedRef: z.string().nullable().optional(),
  filePath: z.string().nullable().optional(),
  startLine: z.number().int().nullable().optional(),
  endLine: z.number().int().nullable().optional(),
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

const unifiedSearchSourceStatusSchema = z.object({
  source: unifiedSearchSourceSchema,
  targetLabel: z.string(),
  indexingStatus: z.string().nullable().optional(),
  codeIndexState: z.string().nullable().optional(),
  resultCount: z.number().int().nullable().optional(),
  appliedFilters: z.array(z.string()),
  ignoredFilters: z.array(z.string()),
  incompatibleFilters: z.array(z.string()),
  appliedQueryFeatures: z.array(z.string()),
  ignoredQueryFeatures: z.array(z.string()),
  incompatibleQueryFeatures: z.array(z.string()),
  note: z.string().nullable().optional(),
});

const unifiedSearchResultSchema = z.object({
  query: z.string(),
  queryWarnings: z.array(z.string()),
  sources: z.array(unifiedSearchSourceSchema),
  results: z.array(unifiedSearchHitSchema),
  page: unifiedSearchPageInfoSchema,
  partialResults: z.boolean(),
  sourceStatus: z.array(unifiedSearchSourceStatusSchema),
});

const unifiedSearchSessionStatusSchema = z.enum([
  "PENDING",
  "INDEXING",
  "SEARCHING",
  "COMPLETED",
  "TIMEOUT",
  "FAILED",
]);

const unifiedSearchProgressSchema = z.object({
  searchRef: z.string(),
  status: unifiedSearchSessionStatusSchema,
  targetsTotal: z.number().int(),
  targetsReady: z.number().int(),
  elapsedMs: z.number().int(),
  query: z.string(),
  queryWarnings: z.array(z.string()),
  sources: z.array(unifiedSearchSourceSchema),
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
  diagnostics: navigationDiagnosticsSchema,
  codeIndexState: z.string(),
  indexingRef: z.string().nullable().optional(),
  availableVersions: z.array(availableVersionSchema).nullable().optional(),
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
    diagnostics {
      hint
    }
    codeIndexState
    indexingRef
    availableVersions {
      version
      ref
    }
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
  codeIndexState: z.string(),
  indexingRef: z.string().nullable().optional(),
  availableVersions: z.array(availableVersionSchema).nullable().optional(),
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
    codeIndexState
    indexingRef
    availableVersions {
      version
      ref
    }
  }
}`;
}

// `data` may be null (seen live for unknown packages that also carry
// `errors`), and `searchSymbols` may be null even when `data` is present.
// Both must parse successfully so the error-handling layer can classify.
const graphQLResponseSchema = z.object({
  data: z
    .object({
      searchSymbols: searchSymbolsResponseSchema.nullable().optional(),
    })
    .nullable()
    .optional(),
  errors: z.array(graphQLErrorSchema).optional(),
});

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

export class CodeNavigationServiceImpl implements CodeNavigationService {
  constructor(
    private readonly codeNavigationUrl: string,
    private readonly tokenProvider: TokenProvider,
    private readonly fetchFn: typeof fetch = globalThis.fetch,
  ) {}

  async search(params: UnifiedSearchParams): Promise<UnifiedSearchOutcome> {
    return executeWithTokenRefresh({
      getToken: () => this.tokenProvider.getToken(),
      forceRefresh: () => this.tokenProvider.forceRefresh(),
      shouldRefresh: (error) => error instanceof AuthenticationError,
      executeWithToken: (token) => this.executeUnifiedSearch(token, params),
    });
  }

  async searchStatus(searchRef: string): Promise<UnifiedSearchOutcome> {
    return executeWithTokenRefresh({
      getToken: () => this.tokenProvider.getToken(),
      forceRefresh: () => this.tokenProvider.forceRefresh(),
      shouldRefresh: (error) => error instanceof AuthenticationError,
      executeWithToken: (token) =>
        this.executeUnifiedSearchStatus(token, searchRef),
    });
  }

  async searchSymbols(
    params: SearchSymbolsParams,
  ): Promise<SearchSymbolsResult> {
    return executeWithTokenRefresh({
      getToken: () => this.tokenProvider.getToken(),
      forceRefresh: () => this.tokenProvider.forceRefresh(),
      shouldRefresh: (error) => error instanceof AuthenticationError,
      executeWithToken: (token) => this.executeSearchSymbols(token, params),
    });
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
      })),
      query: params.query,
      sources: params.sources,
      filters: params.filters,
      allowPartialResults: params.allowPartialResults ?? false,
      limit: params.limit,
      offset: params.offset,
      waitTimeoutMs: params.waitTimeoutMs,
    };
    debugUnifiedSearchRequest(variables);
    debugGraphqlWireRequest("search", UNIFIED_SEARCH_QUERY, variables);
    try {
      response = await postPkgseerGraphql({
        endpointUrl: this.codeNavigationUrl,
        token,
        query: UNIFIED_SEARCH_QUERY,
        variables,
        fetchFn: this.fetchFn,
      });
    } catch (cause) {
      if (cause instanceof PkgseerTransportError) {
        throw new CodeNavigationNetworkError(
          "Could not reach the code navigation service. Check your connection or set GITHITS_CODE_NAV_URL.",
          { cause },
        );
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
  ): Promise<UnifiedSearchOutcome> {
    let response: PkgseerGraphqlResponse;
    try {
      response = await postPkgseerGraphql({
        endpointUrl: this.codeNavigationUrl,
        token,
        query: UNIFIED_SEARCH_STATUS_QUERY,
        variables: {
          searchRef,
          includeResults: true,
        },
        fetchFn: this.fetchFn,
      });
    } catch (cause) {
      if (cause instanceof PkgseerTransportError) {
        throw new CodeNavigationNetworkError(
          "Could not reach the code navigation service. Check your connection or set GITHITS_CODE_NAV_URL.",
          { cause },
        );
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

  private async executeSearchSymbols(
    token: string,
    params: SearchSymbolsParams,
  ): Promise<SearchSymbolsResult> {
    if (!params.query && (!params.keywords || params.keywords.length === 0)) {
      throw new InvalidSearchSymbolsRequestError(
        "Either query or keywords must be provided.",
      );
    }

    let response: PkgseerGraphqlResponse;
    const variables = {
      registry: params.target.registry,
      packageName: params.target.packageName,
      repoUrl: params.target.repoUrl,
      gitRef: params.target.gitRef,
      query: params.query,
      keywords: params.keywords,
      matchMode: params.matchMode,
      kind: params.kind,
      category: params.category,
      filePath: params.filePath,
      version: params.target.version,
      limit: params.limit,
      fileIntent: params.fileIntent,
      waitTimeoutMs: params.waitTimeoutMs,
    };
    debugSearchSymbolsRequest(variables);
    debugGraphqlWireRequest("searchSymbols", SEARCH_SYMBOLS_QUERY, variables);
    try {
      response = await postPkgseerGraphql({
        endpointUrl: this.codeNavigationUrl,
        token,
        query: SEARCH_SYMBOLS_QUERY,
        variables,
        fetchFn: this.fetchFn,
      });
    } catch (cause) {
      // Helper owns transport-level error wrapping; re-map to the
      // domain error class so `mapCodeNavigationError` still routes
      // to `NETWORK`. Other error classes bubble unchanged.
      if (cause instanceof PkgseerTransportError) {
        throw new CodeNavigationNetworkError(
          "Could not reach the code navigation service. Check your connection or set GITHITS_CODE_NAV_URL.",
          { cause },
        );
      }
      throw cause;
    }

    if (response.status < 200 || response.status >= 300) {
      throw this.createHttpError(response);
    }

    const parsed = graphQLResponseSchema.safeParse(response.parsedBody);
    if (!parsed.success) {
      throw new MalformedCodeNavigationResponseError(
        "Malformed response from code navigation service.",
      );
    }

    if (parsed.data.errors && parsed.data.errors.length > 0) {
      throw this.createGraphQLError(parsed.data.errors);
    }

    const data = parsed.data.data?.searchSymbols;
    if (!data) {
      // `data: null` or `data.searchSymbols: null` with no `errors` entry.
      // Rare — the backend normally couples null payloads with errors.
      throw new MalformedCodeNavigationResponseError(
        "Malformed response from code navigation service.",
      );
    }

    if (data.codeIndexState === "INDEXING") {
      throw new CodeNavigationIndexingError(
        this.createIndexingMessage(data.indexingRef ?? undefined),
        data.indexingRef ?? undefined,
        data.availableVersions?.map((entry) => ({
          version: entry.version ?? undefined,
          ref: entry.ref,
        })),
      );
    }

    if (data.codeIndexState === "UNRESOLVABLE") {
      throw new CodeNavigationUnresolvableError(
        "The requested target or version could not be resolved.",
      );
    }

    return {
      results: data.results.map((entry) => ({
        name: entry.name ?? undefined,
        filePath: entry.filePath ?? undefined,
        startLine: entry.startLine ?? undefined,
        endLine: entry.endLine ?? undefined,
        preview: entry.preview ?? undefined,
        code: entry.code ?? undefined,
        language: entry.language ?? undefined,
        symbolRef: entry.symbolRef ?? undefined,
        qualifiedPath: entry.qualifiedPath ?? undefined,
        kind: entry.kind ?? undefined,
        category: entry.category ?? undefined,
        arity: entry.arity ?? undefined,
        isPublic: entry.isPublic ?? undefined,
        containedSymbols: entry.containedSymbols ?? undefined,
      })),
      totalMatches: data.totalMatches,
      hasMore: data.hasMore,
      version: data.indexedVersion ?? undefined,
      resolution: data.resolution
        ? {
            requestedVersion: data.resolution.requestedVersion ?? undefined,
            requestedRef: data.resolution.requestedRef ?? undefined,
            resolvedRef: data.resolution.resolvedRef ?? undefined,
            commitSha: data.resolution.commitSha ?? undefined,
          }
        : undefined,
      hint: data.diagnostics?.hint ?? undefined,
      warning: data.warning ?? undefined,
    };
  }

  private createHttpError(response: PkgseerGraphqlResponse): Error {
    const status = response.status;
    const detail = parseDetail(response.responseBody);

    if (status === 401) {
      return new AuthenticationError(
        "Authentication required. Run `githits login` to authenticate.",
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

    // Direct dispatch on extensions.code — the April 2026 backend
    // contract populates this on every error. Fall back to message
    // heuristics below for older backend builds that haven't
    // deployed yet (safe to remove once rollout completes).
    switch (code) {
      case "PACKAGE_INDEXING":
        return new CodeNavigationIndexingError(
          this.createIndexingMessage(indexingRef),
          indexingRef,
          parseAvailableVersions(extensions),
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
        );

      case "NOT_FOUND":
      case "PACKAGE_NOT_FOUND":
      case "NO_REPOSITORY_URL":
        return new CodeNavigationTargetNotFoundError(message);

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
          "Authentication required. Run `githits login` to authenticate.",
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
      case "INTERNAL_ERROR":
      case "UNKNOWN_ERROR":
        return new CodeNavigationBackendError(
          message,
          undefined,
          code,
          retryable,
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
        return new CodeNavigationTargetNotFoundError(message);
      }
    }

    return new CodeNavigationBackendError(message, undefined, code, retryable);
  }

  private createIndexingMessage(indexingRef?: string): string {
    // Backend p50 indexing time ~11 s, mean ~17 s, backend ceiling 60
    // s. Give callers both a concrete "retry shortly" expectation and
    // the option to block until ready via a longer wait timeout.
    const base =
      "Target is still indexing. Indexing usually completes within 30 seconds. Retry this request, or pass a longer wait timeout (CLI: `--wait 60000`, MCP: `wait_timeout_ms: 60000`) to block until ready.";
    if (indexingRef) {
      return `${base} Indexing reference: ${indexingRef}.`;
    }
    return base;
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
        title: entry.title ?? undefined,
        summary: entry.summary ?? undefined,
        score: entry.score ?? undefined,
        highlights: entry.highlights
          ? {
              title: entry.highlights.title ?? undefined,
              summary: entry.highlights.summary ?? undefined,
            }
          : undefined,
        locator: {
          registry: entry.locator.registry ?? undefined,
          packageName: entry.locator.packageName ?? undefined,
          version: entry.locator.version ?? undefined,
          pageId: entry.locator.pageId ?? undefined,
          sourceKind: entry.locator.sourceKind ?? undefined,
          sourceUrl: entry.locator.sourceUrl ?? undefined,
          repoUrl: entry.locator.repoUrl ?? undefined,
          gitRef: entry.locator.gitRef ?? undefined,
          requestedRef: entry.locator.requestedRef ?? undefined,
          filePath: entry.locator.filePath ?? undefined,
          startLine: entry.locator.startLine ?? undefined,
          endLine: entry.locator.endLine ?? undefined,
          fileContentHash: entry.locator.fileContentHash ?? undefined,
          symbolRef: entry.locator.symbolRef ?? undefined,
          qualifiedPath: entry.locator.qualifiedPath ?? undefined,
          kind: entry.locator.kind ?? undefined,
          category: entry.locator.category ?? undefined,
          language: entry.locator.language ?? undefined,
        },
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
        indexingStatus: entry.indexingStatus ?? undefined,
        codeIndexState: entry.codeIndexState ?? undefined,
        resultCount: entry.resultCount ?? undefined,
        appliedFilters: entry.appliedFilters,
        ignoredFilters: entry.ignoredFilters,
        incompatibleFilters: entry.incompatibleFilters,
        appliedQueryFeatures: entry.appliedQueryFeatures,
        ignoredQueryFeatures: entry.ignoredQueryFeatures,
        incompatibleQueryFeatures: entry.incompatibleQueryFeatures,
        note: entry.note ?? undefined,
      })),
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
      expiresAt: progress.expiresAt ?? undefined,
    };
  }

  /**
   * Shared sentinel-promotion for the file-exploration tools. When the backend
   * response carries `codeIndexState: "INDEXING"` (data-path variant),
   * throw the typed error so the envelope builder / caller never sees
   * the raw sentinel. Mirrors the inline check `searchSymbols` does
   * today.
   */
  private throwIfIndexing(data: {
    codeIndexState: string;
    indexingRef?: string | null;
    availableVersions?: Array<{ version?: string | null; ref: string }> | null;
  }): void {
    if (data.codeIndexState === "INDEXING") {
      throw new CodeNavigationIndexingError(
        this.createIndexingMessage(data.indexingRef ?? undefined),
        data.indexingRef ?? undefined,
        data.availableVersions?.map((entry) => ({
          version: entry.version ?? undefined,
          ref: entry.ref,
        })),
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
      shouldRefresh: (error) => error instanceof AuthenticationError,
      executeWithToken: (token) => this.executeListFiles(token, params),
    });
  }

  private async executeListFiles(
    token: string,
    params: ListFilesParams,
  ): Promise<ListFilesResult> {
    let response: PkgseerGraphqlResponse;
    try {
      response = await postPkgseerGraphql({
        endpointUrl: this.codeNavigationUrl,
        token,
        query: LIST_REPO_FILES_QUERY,
        variables: {
          registry: params.target.registry,
          packageName: params.target.packageName,
          repoUrl: params.target.repoUrl,
          gitRef: params.target.gitRef,
          version: params.target.version,
          pathPrefix: params.pathPrefix,
          limit: params.limit,
          waitTimeoutMs: params.waitTimeoutMs,
        },
        fetchFn: this.fetchFn,
      });
    } catch (cause) {
      if (cause instanceof PkgseerTransportError) {
        throw new CodeNavigationNetworkError(
          "Could not reach the code navigation service. Check your connection or set GITHITS_CODE_NAV_URL.",
          { cause },
        );
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
      shouldRefresh: (error) => error instanceof AuthenticationError,
      executeWithToken: (token) => this.executeReadFile(token, params),
    });
  }

  private async executeReadFile(
    token: string,
    params: ReadFileParams,
  ): Promise<ReadFileResult> {
    let response: PkgseerGraphqlResponse;
    try {
      response = await postPkgseerGraphql({
        endpointUrl: this.codeNavigationUrl,
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
        fetchFn: this.fetchFn,
      });
    } catch (cause) {
      if (cause instanceof PkgseerTransportError) {
        throw new CodeNavigationNetworkError(
          "Could not reach the code navigation service. Check your connection or set GITHITS_CODE_NAV_URL.",
          { cause },
        );
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

    // `fetchCodeContext` doesn't return availableVersions; pass a
    // minimal object to the shared helper.
    this.throwIfIndexing({
      codeIndexState: data.codeIndexState,
      indexingRef: data.indexingRef,
    });

    return {
      filePath: data.filePath ?? undefined,
      language: data.language ?? undefined,
      totalLines: data.totalLines ?? undefined,
      startLine: data.startLine ?? undefined,
      endLine: data.endLine ?? undefined,
      content: data.content ?? undefined,
      isBinary: data.isBinary ?? undefined,
    };
  }

  // ------------------------------------------------------------------
  // grepRepo
  // ------------------------------------------------------------------

  async grepRepo(params: GrepRepoParams): Promise<GrepRepoResult> {
    return executeWithTokenRefresh({
      getToken: () => this.tokenProvider.getToken(),
      forceRefresh: () => this.tokenProvider.forceRefresh(),
      shouldRefresh: (error) => error instanceof AuthenticationError,
      executeWithToken: (token) => this.executeGrepRepo(token, params),
    });
  }

  private async executeGrepRepo(
    token: string,
    params: GrepRepoParams,
  ): Promise<GrepRepoResult> {
    let response: PkgseerGraphqlResponse;
    try {
      response = await postPkgseerGraphql({
        endpointUrl: this.codeNavigationUrl,
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
        fetchFn: this.fetchFn,
      });
    } catch (cause) {
      if (cause instanceof PkgseerTransportError) {
        throw new CodeNavigationNetworkError(
          "Could not reach the code navigation service. Check your connection or set GITHITS_CODE_NAV_URL.",
          { cause },
        );
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

function isAuthMessage(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("unauthorized") ||
    lower.includes("forbidden") ||
    lower.includes("permission") ||
    lower.includes("authentication")
  );
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
