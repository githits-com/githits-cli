import type {
  UnifiedSearchCompleted,
  UnifiedSearchHit,
  UnifiedSearchIncomplete,
  UnifiedSearchOutcome,
  UnifiedSearchParams,
  UnifiedSearchProgress,
  UnifiedSearchSourceStatus,
} from "../services/index.js";
import { MalformedCodeNavigationResponseError } from "../services/index.js";
import { DEFAULT_WAIT_TIMEOUT_MS } from "./code-navigation-defaults.js";
import { mapCodeNavigationError } from "./code-navigation-error-map.js";

/**
 * Default values folded out of the JSON envelope when the caller did
 * not set them. Agents asked for what they want; echoing the default
 * back wastes tokens. The defaults must stay aligned with
 * `buildUnifiedSearchParams`.
 */
const DEFAULT_LIMIT = 20;
const DEFAULT_OFFSET = 0;

export interface UnifiedSearchQueryEcho {
  raw: string;
  compiled?: string;
  warnings?: string[];
  sources?: string[];
  filters?: {
    kind?: string;
    category?: string;
    pathPrefix?: string;
    fileIntent?: string;
    publicOnly?: boolean;
  };
  allowPartialResults?: true;
  limit?: number;
  offset?: number;
  waitTimeoutMs?: number;
}

export interface UnifiedSearchHighlightsPayload {
  title?: Array<readonly [number, number]>;
  summary?: Array<readonly [number, number]>;
}

export interface UnifiedSearchHitPayload {
  type: string;
  target: string;
  title?: string;
  summary?: string;
  score?: number;
  highlights?: UnifiedSearchHighlightsPayload;
  locator: {
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
    qualifiedPath?: string;
    kind?: string;
    category?: string;
    language?: string;
  };
}

export interface UnifiedSearchProgressPayload {
  status: string;
  targetsReady: number;
  targetsTotal: number;
  elapsedMs: number;
  expiresAt?: string;
}

export interface UnifiedSearchSourceStatusPayload {
  source: string;
  targetLabel: string;
  indexingStatus?: string;
  codeIndexState?: string;
  resultCount?: number;
  ignoredFilters?: string[];
  incompatibleFilters?: string[];
  ignoredQueryFeatures?: string[];
  incompatibleQueryFeatures?: string[];
  note?: string;
}

export interface UnifiedSearchCompletedPayload {
  query: UnifiedSearchQueryEcho;
  completed: true;
  hasMore: boolean;
  nextOffset?: number;
  results: UnifiedSearchHitPayload[];
  searchRef?: string;
  sourceStatus?: UnifiedSearchSourceStatusPayload[];
}

export interface UnifiedSearchIncompletePayload {
  query: UnifiedSearchQueryEcho;
  completed: false;
  hasMore: boolean;
  nextOffset?: number;
  results: UnifiedSearchHitPayload[];
  searchRef: string;
  progress?: UnifiedSearchProgressPayload;
  sourceStatus?: UnifiedSearchSourceStatusPayload[];
}

export interface UnifiedSearchErrorPayload {
  error: string;
  code: string;
  retryable?: boolean;
  details?: Record<string, unknown>;
}

export interface UnifiedSearchStatusResultPayload {
  warnings?: string[];
  sources?: string[];
  hasMore: boolean;
  nextOffset?: number;
  results: UnifiedSearchHitPayload[];
  sourceStatus?: UnifiedSearchSourceStatusPayload[];
}

export interface UnifiedSearchStatusCompletedPayload {
  completed: true;
  searchRef?: string;
  result: UnifiedSearchStatusResultPayload;
}

export interface UnifiedSearchStatusIncompletePayload {
  completed: false;
  searchRef: string;
  progress?: UnifiedSearchProgressPayload;
  result?: UnifiedSearchStatusResultPayload;
}

export function buildUnifiedSearchSuccessPayload(
  params: UnifiedSearchParams,
  rawQuery: string,
  compiledQuery: string,
  outcome: UnifiedSearchOutcome,
): UnifiedSearchCompletedPayload | UnifiedSearchIncompletePayload {
  const warnings =
    outcome.state === "completed"
      ? outcome.result.queryWarnings
      : (outcome.result?.queryWarnings ??
        outcome.progress?.queryWarnings ??
        []);
  const query = buildQueryEcho(params, rawQuery, compiledQuery, warnings);

  if (outcome.state === "incomplete") {
    const result = outcome.result;
    const payload: UnifiedSearchIncompletePayload = {
      query,
      completed: false,
      hasMore: result?.page.hasMore ?? false,
      results: result?.results.map(buildHitPayload) ?? [],
      searchRef: outcome.searchRef,
    };
    if (result?.page.hasMore === true) {
      payload.nextOffset = result.page.offset + result.page.returned;
    }
    const progress = compactProgress(outcome.progress);
    if (progress) payload.progress = progress;
    const sourceStatus = compactSourceStatus(result?.sourceStatus);
    if (sourceStatus) payload.sourceStatus = sourceStatus;
    return payload;
  }

  const completed: UnifiedSearchCompletedPayload = {
    query,
    completed: true,
    hasMore: outcome.result.page.hasMore,
    results: outcome.result.results.map(buildHitPayload),
  };
  if (outcome.result.page.hasMore) {
    completed.nextOffset =
      outcome.result.page.offset + outcome.result.page.returned;
  }
  if (outcome.searchRef) completed.searchRef = outcome.searchRef;
  const sourceStatus = compactSourceStatus(outcome.result.sourceStatus);
  if (sourceStatus) completed.sourceStatus = sourceStatus;
  return completed;
}

export function buildUnifiedSearchErrorPayload(
  error: unknown,
): UnifiedSearchErrorPayload {
  const mapped = mapCodeNavigationError(error);
  const payload: UnifiedSearchErrorPayload = {
    error: mapped.message,
    code: mapped.code,
  };
  if (typeof mapped.retryable === "boolean") {
    payload.retryable = mapped.retryable;
  }
  if (mapped.details && Object.keys(mapped.details).length > 0) {
    payload.details = mapped.details as Record<string, unknown>;
  }
  return payload;
}

export function buildUnifiedSearchStatusPayload(
  outcome: UnifiedSearchOutcome,
): UnifiedSearchStatusCompletedPayload | UnifiedSearchStatusIncompletePayload {
  if (outcome.state === "incomplete") {
    const payload: UnifiedSearchStatusIncompletePayload = {
      completed: false,
      searchRef: outcome.searchRef,
    };
    const progress = compactProgress(outcome.progress);
    if (progress) payload.progress = progress;
    if (outcome.result) {
      payload.result = buildUnifiedSearchStatusResultPayload(outcome.result);
    }
    return payload;
  }

  const payload: UnifiedSearchStatusCompletedPayload = {
    completed: true,
    result: buildUnifiedSearchStatusResultPayload(outcome.result),
  };
  if (outcome.searchRef) payload.searchRef = outcome.searchRef;
  return payload;
}

function buildUnifiedSearchStatusResultPayload(
  result: UnifiedSearchCompleted["result"],
): UnifiedSearchStatusResultPayload {
  const payload: UnifiedSearchStatusResultPayload = {
    hasMore: result.page.hasMore,
    results: result.results.map(buildHitPayload),
  };
  if (result.page.hasMore) {
    payload.nextOffset = result.page.offset + result.page.returned;
  }
  if (result.queryWarnings.length > 0) {
    payload.warnings = result.queryWarnings;
  }
  if (result.sources.length > 0) {
    payload.sources = result.sources.map((entry) => entry.toLowerCase());
  }
  const sourceStatus = compactSourceStatus(result.sourceStatus);
  if (sourceStatus) payload.sourceStatus = sourceStatus;
  return payload;
}

function buildQueryEcho(
  params: UnifiedSearchParams,
  rawQuery: string,
  compiledQuery: string,
  warnings: string[],
): UnifiedSearchQueryEcho {
  const echo: UnifiedSearchQueryEcho = {
    raw: rawQuery,
  };
  if (compiledQuery !== rawQuery) {
    echo.compiled = compiledQuery;
  }
  if (warnings.length > 0) {
    echo.warnings = warnings;
  }
  if (params.sources && params.sources.length > 0) {
    echo.sources = params.sources.map((entry) => entry.toLowerCase());
  }
  if (params.filters) {
    const filters: UnifiedSearchQueryEcho["filters"] = {};
    if (params.filters.kind) filters.kind = params.filters.kind.toLowerCase();
    if (params.filters.category)
      filters.category = params.filters.category.toLowerCase();
    if (params.filters.pathPrefix)
      filters.pathPrefix = params.filters.pathPrefix;
    if (params.filters.fileIntent)
      filters.fileIntent = params.filters.fileIntent.toLowerCase();
    if (typeof params.filters.publicOnly === "boolean")
      filters.publicOnly = params.filters.publicOnly;
    if (Object.keys(filters).length > 0) echo.filters = filters;
  }
  if (params.allowPartialResults === true) {
    echo.allowPartialResults = true;
  }
  if (params.limit !== undefined && params.limit !== DEFAULT_LIMIT) {
    echo.limit = params.limit;
  }
  if (params.offset !== undefined && params.offset !== DEFAULT_OFFSET) {
    echo.offset = params.offset;
  }
  if (
    params.waitTimeoutMs !== undefined &&
    params.waitTimeoutMs !== DEFAULT_WAIT_TIMEOUT_MS
  ) {
    echo.waitTimeoutMs = params.waitTimeoutMs;
  }
  return echo;
}

function buildHitPayload(hit: UnifiedSearchHit): UnifiedSearchHitPayload {
  assertSearchFollowUpInvariant(hit);
  const payload: UnifiedSearchHitPayload = {
    type: hit.resultType.toLowerCase(),
    target: hit.targetLabel,
    locator: buildLocatorPayload(hit),
  };
  if (hit.title) payload.title = hit.title;
  if (hit.summary) payload.summary = hit.summary;
  if (typeof hit.score === "number") payload.score = hit.score;
  const highlights = buildHighlights(hit.highlights);
  if (highlights) payload.highlights = highlights;
  return payload;
}

function buildLocatorPayload(
  hit: UnifiedSearchHit,
): UnifiedSearchHitPayload["locator"] {
  const locator: UnifiedSearchHitPayload["locator"] = {};
  const src = hit.locator;
  if (src.registry) locator.registry = src.registry;
  if (src.packageName) locator.packageName = src.packageName;
  if (src.version) locator.version = src.version;
  if (src.pageId) locator.pageId = src.pageId;
  if (src.sourceKind) locator.sourceKind = src.sourceKind;
  if (src.sourceUrl) locator.sourceUrl = src.sourceUrl;
  if (src.repoUrl) locator.repoUrl = src.repoUrl;
  if (src.gitRef) locator.gitRef = src.gitRef;
  if (src.requestedRef) locator.requestedRef = src.requestedRef;
  if (src.filePath) locator.filePath = src.filePath;
  if (typeof src.startLine === "number") locator.startLine = src.startLine;
  if (typeof src.endLine === "number") locator.endLine = src.endLine;
  // Top-level symbols often have qualifiedPath identical to title;
  // skip the duplicate. Nested members (e.g. `MyClass.method`) still
  // carry the disambiguating path.
  if (src.qualifiedPath && src.qualifiedPath !== hit.title) {
    locator.qualifiedPath = src.qualifiedPath;
  }
  if (src.kind) locator.kind = src.kind;
  if (src.category) locator.category = src.category;
  if (src.language) locator.language = src.language;
  return locator;
}

function buildHighlights(
  highlights: UnifiedSearchHit["highlights"],
): UnifiedSearchHighlightsPayload | undefined {
  if (!highlights) return undefined;
  const compact: UnifiedSearchHighlightsPayload = {};
  if (highlights.title && highlights.title.length > 0) {
    compact.title = highlights.title;
  }
  if (highlights.summary && highlights.summary.length > 0) {
    compact.summary = highlights.summary;
  }
  return Object.keys(compact).length > 0 ? compact : undefined;
}

function compactProgress(
  progress: UnifiedSearchProgress | undefined,
): UnifiedSearchProgressPayload | undefined {
  if (!progress) return undefined;
  const payload: UnifiedSearchProgressPayload = {
    status: progress.status,
    targetsReady: progress.targetsReady,
    targetsTotal: progress.targetsTotal,
    elapsedMs: progress.elapsedMs,
  };
  if (progress.expiresAt) payload.expiresAt = progress.expiresAt;
  return payload;
}

function compactSourceStatus(
  sourceStatus: UnifiedSearchSourceStatus[] | undefined,
): UnifiedSearchSourceStatusPayload[] | undefined {
  if (!sourceStatus || sourceStatus.length === 0) return undefined;
  const compact: UnifiedSearchSourceStatusPayload[] = [];
  for (const entry of sourceStatus) {
    const slim = compactSourceStatusEntry(entry);
    if (slim) compact.push(slim);
  }
  return compact.length > 0 ? compact : undefined;
}

function compactSourceStatusEntry(
  entry: UnifiedSearchSourceStatus,
): UnifiedSearchSourceStatusPayload | undefined {
  const payload: UnifiedSearchSourceStatusPayload = {
    source: entry.source.toLowerCase(),
    targetLabel: entry.targetLabel,
  };
  let interesting = false;

  // Suppress healthy lifecycle states. INDEXED means searchable; CURRENT
  // and STALE both have data agents can use (STALE = served from a slightly
  // older navpack while a reindex runs — we do not warn agents about it).
  if (entry.indexingStatus && entry.indexingStatus !== "INDEXED") {
    payload.indexingStatus = entry.indexingStatus;
    interesting = true;
  }
  if (
    entry.codeIndexState &&
    entry.codeIndexState !== "CURRENT" &&
    entry.codeIndexState !== "STALE"
  ) {
    payload.codeIndexState = entry.codeIndexState;
    interesting = true;
  }
  if (typeof entry.resultCount === "number" && entry.resultCount > 0) {
    payload.resultCount = entry.resultCount;
  }
  if (entry.ignoredFilters.length > 0) {
    payload.ignoredFilters = entry.ignoredFilters;
    interesting = true;
  }
  if (entry.incompatibleFilters.length > 0) {
    payload.incompatibleFilters = entry.incompatibleFilters;
    interesting = true;
  }
  if (entry.ignoredQueryFeatures.length > 0) {
    payload.ignoredQueryFeatures = entry.ignoredQueryFeatures;
    interesting = true;
  }
  if (entry.incompatibleQueryFeatures.length > 0) {
    payload.incompatibleQueryFeatures = entry.incompatibleQueryFeatures;
    interesting = true;
  }
  if (entry.note) {
    payload.note = entry.note;
    interesting = true;
  }

  return interesting ? payload : undefined;
}

function assertSearchFollowUpInvariant(hit: UnifiedSearchHit): void {
  if (
    (hit.resultType === "DOCUMENTATION_PAGE" ||
      hit.resultType === "REPOSITORY_DOC") &&
    !hit.locator.pageId
  ) {
    throw new MalformedCodeNavigationResponseError(
      `${hit.resultType} search hit missing required pageId.`,
    );
  }

  if (
    hit.resultType === "REPOSITORY_DOC" &&
    (!hit.locator.repoUrl || !hit.locator.gitRef || !hit.locator.filePath)
  ) {
    throw new MalformedCodeNavigationResponseError(
      "REPOSITORY_DOC search hit missing repo locator fields.",
    );
  }
}
