import type {
  UnifiedSearchCompleted,
  UnifiedSearchHit,
  UnifiedSearchOutcome,
  UnifiedSearchParams,
  UnifiedSearchProgress,
  UnifiedSearchSourceStatus,
} from "../services/index.js";
import { MalformedCodeNavigationResponseError } from "../services/index.js";
import { DEFAULT_WAIT_TIMEOUT_MS } from "./code-navigation-defaults.js";
import { mapCodeNavigationError } from "./code-navigation-error-map.js";
import { buildSearchHitFollowUpCommand } from "./follow-up-command-text.js";
import { DEFAULT_UNIFIED_SEARCH_LIMIT } from "./unified-search-request.js";

/**
 * Default values folded out of the JSON envelope when the caller did
 * not set them. Agents asked for what they want; echoing the default
 * back wastes tokens. The defaults must stay aligned with
 * `buildUnifiedSearchParams`.
 */
const DEFAULT_LIMIT = DEFAULT_UNIFIED_SEARCH_LIMIT;
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
  requestedTarget?: string;
  freshTarget?: string;
  servedTarget?: string;
  freshness?: string;
  title?: string;
  summary?: string;
  highlights?: UnifiedSearchHighlightsPayload;
  followUp?: string;
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
  query?: string;
  requestedSources?: string[];
  targetMode?: string;
  requestedTargets?: Array<{
    registry?: string;
    name?: string;
    version?: string;
    repoUrl?: string;
    gitRef?: string;
  }>;
  filters?: UnifiedSearchQueryEcho["filters"];
  limit?: number;
  offset?: number;
  targets?: Array<{
    requested?: string;
    resolvedRequested?: string;
    served?: string;
    freshness?: string;
    indexingRef?: string;
    requestedRefKind?: string;
  }>;
  expiresAt?: string;
  next?: string;
}

export interface UnifiedSearchSourceStatusPayload {
  source: string;
  targetLabel: string;
  requestedTarget?: string;
  freshTarget?: string;
  servedTarget?: string;
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
  /**
   * Top-level execution warnings derived from `sourceStatus`. Promoted
   * here so agents see them without inspecting the nested
   * `sourceStatus` block — the structured detail still lives there for
   * callers that need it. Parser-level warnings stay in
   * {@link UnifiedSearchQueryEcho.warnings}.
   */
  warnings?: string[];
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
  warnings?: string[];
  sourceStatus?: UnifiedSearchSourceStatusPayload[];
}

export interface UnifiedSearchErrorPayload {
  error: string;
  code: string;
  retryable?: boolean;
  details?: Record<string, unknown>;
}

export interface UnifiedSearchStatusResultPayload {
  query?: UnifiedSearchQueryEcho;
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
  warnings?: string[];
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
  const progress = compactProgress(outcome.progress);
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
    if (progress) payload.progress = progress;
    const sourceStatus = compactSourceStatus(result?.sourceStatus);
    if (sourceStatus) payload.sourceStatus = sourceStatus;
    const combinedWarnings = combineWarnings(
      warnings,
      sourceStatus,
      payload.results,
      progress,
    );
    if (combinedWarnings.length > 0) payload.warnings = combinedWarnings;
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
  const combinedWarnings = combineWarnings(
    warnings,
    sourceStatus,
    completed.results,
    progress,
  );
  if (combinedWarnings.length > 0) completed.warnings = combinedWarnings;
  return completed;
}

/**
 * Compose the top-level `warnings[]` array from parser warnings
 * (compile-time issues with the query string) and sourceStatus-derived
 * warnings (runtime issues affecting result completeness). Parser
 * warnings come first so query-shape issues remain at the head of the
 * list; the same ordering applies in `buildUnifiedSearchStatusResultPayload`.
 *
 * `query.warnings` on the echoed query stays populated for callers that
 * specifically inspect the parser-warning surface; including parser
 * warnings here too gives text-v1 readers a single, consistent
 * `warnings:` preamble.
 */
function combineWarnings(
  parserWarnings: readonly string[],
  sourceStatus: UnifiedSearchSourceStatusPayload[] | undefined,
  hits: UnifiedSearchHitPayload[] = [],
  progress?: UnifiedSearchProgressPayload,
): string[] {
  const out: string[] = [];
  if (parserWarnings.length > 0) out.push(...parserWarnings);
  out.push(...buildHitFreshnessWarnings(hits));
  out.push(...buildProgressFreshnessWarnings(progress));
  out.push(...buildSourceStatusWarnings(sourceStatus));
  return out;
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
    const progressWarnings = buildProgressFreshnessWarnings(progress);
    if (progressWarnings.length > 0) payload.warnings = progressWarnings;
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
    query: buildStatusQueryEcho(result),
    hasMore: result.page.hasMore,
    results: result.results.map(buildHitPayload),
  };
  if (result.page.hasMore) {
    payload.nextOffset = result.page.offset + result.page.returned;
  }
  if (result.sources.length > 0) {
    payload.sources = result.sources.map((entry) => entry.toLowerCase());
  }
  const sourceStatus = compactSourceStatus(result.sourceStatus);
  if (sourceStatus) payload.sourceStatus = sourceStatus;
  const combinedWarnings = combineWarnings(result.queryWarnings, sourceStatus);
  if (combinedWarnings.length > 0) {
    payload.warnings = combinedWarnings;
  }
  return payload;
}

function buildStatusQueryEcho(
  result: UnifiedSearchCompleted["result"],
): UnifiedSearchQueryEcho {
  // Status responses only retain the backend result query. Request-only
  // compile/filter metadata is not available when following up by searchRef.
  const query: UnifiedSearchQueryEcho = {
    raw: result.query,
  };
  if (result.queryWarnings.length > 0) {
    query.warnings = result.queryWarnings;
  }
  if (result.sources.length > 0) {
    query.sources = result.sources.map((entry) => entry.toLowerCase());
  }
  return query;
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
  appendFreshness(payload, {
    requestedTargetLabel: hit.requestedTargetLabel,
    freshTargetLabel: hit.freshTargetLabel,
    servedTargetLabel: hit.servedTargetLabel,
    freshness: hit.freshness,
  });
  if (hit.title) payload.title = hit.title;
  if (hit.summary) payload.summary = hit.summary;
  const highlights = buildHighlights(hit.highlights);
  if (highlights) payload.highlights = highlights;
  const followUp = buildSearchHitFollowUpCommand(payload);
  if (followUp) payload.followUp = followUp;
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
  if (progress.query) payload.query = progress.query;
  if (progress.requestedSources?.length) {
    payload.requestedSources = progress.requestedSources.map((entry) =>
      entry.toLowerCase(),
    );
  }
  if (progress.targetMode) payload.targetMode = progress.targetMode;
  if (progress.requestedTargets?.length) {
    payload.requestedTargets = progress.requestedTargets;
  }
  if (progress.filters) payload.filters = buildFilterEcho(progress.filters);
  if (typeof progress.limit === "number") payload.limit = progress.limit;
  if (typeof progress.offset === "number") payload.offset = progress.offset;
  const targets = progress.targets?.map(compactProgressTarget).filter(Boolean);
  if (targets?.length) {
    payload.targets = targets as NonNullable<
      UnifiedSearchProgressPayload["targets"]
    >;
  }
  if (progress.expiresAt) payload.expiresAt = progress.expiresAt;
  payload.next = `search_status search_ref=${JSON.stringify(progress.searchRef)}`;
  return payload;
}

function appendFreshness(
  payload: {
    requestedTarget?: string;
    freshTarget?: string;
    servedTarget?: string;
    freshness?: string;
  },
  source: {
    requestedTargetLabel?: string;
    freshTargetLabel?: string;
    servedTargetLabel?: string;
    freshness?: string;
  },
): void {
  if (
    !isTrustRelevantFreshness(source.freshness) ||
    !labelsDiverge({
      requestedTarget: source.requestedTargetLabel,
      freshTarget: source.freshTargetLabel,
      servedTarget: source.servedTargetLabel,
    })
  ) {
    return;
  }
  if (source.requestedTargetLabel)
    payload.requestedTarget = source.requestedTargetLabel;
  if (source.freshTargetLabel) payload.freshTarget = source.freshTargetLabel;
  if (source.servedTargetLabel) payload.servedTarget = source.servedTargetLabel;
  if (source.freshness) payload.freshness = source.freshness;
}

function compactProgressTarget(
  target: NonNullable<UnifiedSearchProgress["targets"]>[number],
): NonNullable<UnifiedSearchProgressPayload["targets"]>[number] | undefined {
  const payload: NonNullable<UnifiedSearchProgressPayload["targets"]>[number] =
    {};
  if (target.requested) payload.requested = target.requested;
  if (target.resolvedRequested)
    payload.resolvedRequested = target.resolvedRequested;
  if (target.served) payload.served = target.served;
  if (target.freshness) payload.freshness = target.freshness;
  if (target.indexingRef) payload.indexingRef = target.indexingRef;
  if (target.requestedRefKind)
    payload.requestedRefKind = target.requestedRefKind;
  return Object.keys(payload).length > 0 ? payload : undefined;
}

function buildFilterEcho(
  filters: NonNullable<UnifiedSearchProgress["filters"]>,
): UnifiedSearchQueryEcho["filters"] | undefined {
  const echo: NonNullable<UnifiedSearchQueryEcho["filters"]> = {};
  if (filters.kind) echo.kind = filters.kind.toLowerCase();
  if (filters.category) echo.category = filters.category.toLowerCase();
  if (filters.pathPrefix) echo.pathPrefix = filters.pathPrefix;
  if (filters.fileIntent) echo.fileIntent = filters.fileIntent.toLowerCase();
  if (typeof filters.publicOnly === "boolean") {
    echo.publicOnly = filters.publicOnly;
  }
  return Object.keys(echo).length > 0 ? echo : undefined;
}

/**
 * Promote noteworthy `sourceStatus` entries into top-level human-readable
 * warning strings so callers see them without inspecting the nested
 * structured block. Mitigation for backend issue B5 (search responses
 * with `sources: ["docs"]` plus a `kind:`/`lang:` qualifier silently
 * return empty results because the only signal — incompatibility — is
 * buried inside `sourceStatus[].note`).
 *
 * Order: each compacted entry contributes at most one warning. We
 * derive the message from the structured fields first; if none of
 * those fired but a free-form `note` is present, the note alone is
 * promoted. Iteration order matches `compactSourceStatus`, which is
 * the backend's order.
 */
export function buildSourceStatusWarnings(
  sourceStatus: UnifiedSearchSourceStatusPayload[] | undefined,
): string[] {
  if (!sourceStatus || sourceStatus.length === 0) return [];
  const warnings: string[] = [];
  for (const entry of sourceStatus) {
    const message = warningForEntry(entry);
    if (message !== undefined) warnings.push(message);
  }
  return warnings;
}

function buildHitFreshnessWarnings(hits: UnifiedSearchHitPayload[]): string[] {
  return hits
    .map((hit) =>
      freshnessWarning({
        freshness: hit.freshness,
        requestedTarget: hit.requestedTarget,
        freshTarget: hit.freshTarget,
        servedTarget: hit.servedTarget,
      }),
    )
    .filter((entry): entry is string => Boolean(entry));
}

function buildProgressFreshnessWarnings(
  progress: UnifiedSearchProgressPayload | undefined,
): string[] {
  return (progress?.targets ?? [])
    .map((target) =>
      freshnessWarning({
        freshness: target.freshness,
        requestedTarget: target.requested,
        freshTarget: target.resolvedRequested,
        servedTarget: target.served,
      }),
    )
    .filter((entry): entry is string => Boolean(entry));
}

function freshnessWarning(input: {
  freshness?: string;
  requestedTarget?: string;
  freshTarget?: string;
  servedTarget?: string;
}): string | undefined {
  if (!isTrustRelevantFreshness(input.freshness)) return undefined;
  if (!labelsDiverge(input)) return undefined;
  const requested = input.requestedTarget ?? "requested target";
  const served = input.servedTarget ?? "served target";
  const fresh = input.freshTarget;
  return fresh
    ? `requested ${requested}; served stale ${served} while ${fresh} indexes.`
    : `requested ${requested}; served stale ${served}.`;
}

function isTrustRelevantFreshness(value: string | undefined): boolean {
  return value === "STALE" || value === "INDEXING";
}

function labelsDiverge(input: {
  requestedTarget?: string;
  freshTarget?: string;
  servedTarget?: string;
}): boolean {
  const served = input.servedTarget;
  if (!served) return false;
  return Boolean(
    (input.freshTarget && input.freshTarget !== served) ||
      (input.requestedTarget && input.requestedTarget !== served),
  );
}

function warningForEntry(
  entry: UnifiedSearchSourceStatusPayload,
): string | undefined {
  const reasons: string[] = [];
  const freshness = freshnessWarning({
    freshness: entry.codeIndexState,
    requestedTarget: entry.requestedTarget,
    freshTarget: entry.freshTarget,
    servedTarget: entry.servedTarget,
  });
  if (freshness) return freshness;
  if (entry.incompatibleQueryFeatures?.length) {
    reasons.push(
      `incompatible query features [${entry.incompatibleQueryFeatures.join(", ")}]`,
    );
  }
  if (entry.ignoredQueryFeatures?.length) {
    reasons.push(
      `ignored query features [${entry.ignoredQueryFeatures.join(", ")}]`,
    );
  }
  if (entry.incompatibleFilters?.length) {
    reasons.push(
      `incompatible filters [${entry.incompatibleFilters.join(", ")}]`,
    );
  }
  if (entry.ignoredFilters?.length) {
    reasons.push(`ignored filters [${entry.ignoredFilters.join(", ")}]`);
  }
  // Healthy lifecycle states (`INDEXED`, `CURRENT`, `STALE`) are
  // already filtered out upstream in `compactSourceStatusEntry`; if
  // these fields are present here, the state is genuinely worth
  // surfacing.
  if (entry.indexingStatus) {
    reasons.push(`indexing status ${entry.indexingStatus}`);
  }
  if (entry.codeIndexState) {
    if (entry.codeIndexState !== "STALE") {
      reasons.push(`code index state ${entry.codeIndexState}`);
    }
  }
  // Source/target prefix anchors the message so an agent reading
  // multi-source warnings can tell which target each refers to.
  const prefix = `Source '${entry.source}' for ${entry.targetLabel}`;
  if (reasons.length > 0) {
    return `${prefix}: ${reasons.join("; ")}`;
  }
  if (entry.note) {
    return `${prefix}: ${entry.note}`;
  }
  return undefined;
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

  const staleDiverges =
    entry.codeIndexState === "STALE" &&
    labelsDiverge({
      requestedTarget: entry.requestedTargetLabel,
      freshTarget: entry.freshTargetLabel,
      servedTarget: entry.servedTargetLabel,
    });
  if (staleDiverges) {
    payload.requestedTarget = entry.requestedTargetLabel;
    payload.freshTarget = entry.freshTargetLabel;
    payload.servedTarget = entry.servedTargetLabel;
    payload.codeIndexState = entry.codeIndexState;
    interesting = true;
  }

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
    (entry.codeIndexState !== "STALE" || staleDiverges)
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
