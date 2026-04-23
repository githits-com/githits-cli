import type {
  UnifiedSearchCompleted,
  UnifiedSearchHit,
  UnifiedSearchIncomplete,
  UnifiedSearchOutcome,
  UnifiedSearchParams,
} from "../services/index.js";
import { mapCodeNavigationError } from "./code-navigation-error-map.js";

export interface UnifiedSearchQueryEcho {
  raw: string;
  compiled: string;
  warnings: string[];
  targets: UnifiedSearchParams["targets"];
  sources?: string[];
  filters?: {
    kind?: string;
    category?: string;
    pathPrefix?: string;
    fileIntent?: string;
    publicOnly?: boolean;
  };
  limit: number;
  offset: number;
  waitTimeoutMs: number;
  defaulted: ReadonlyArray<"limit" | "offset" | "waitTimeoutMs">;
}

export interface UnifiedSearchHitPayload {
  type: string;
  target: string;
  title?: string;
  summary?: string;
  score?: number;
  locator: {
    registry?: string;
    packageName?: string;
    version?: string;
    pageId?: string;
    repoUrl?: string;
    gitRef?: string;
    filePath?: string;
    startLine?: number;
    endLine?: number;
    fileContentHash?: string;
    symbolRef?: string;
    qualifiedPath?: string;
    kind?: string;
    category?: string;
    language?: string;
  };
}

export interface UnifiedSearchCompletedPayload {
  query: UnifiedSearchQueryEcho;
  completed: true;
  returnedCount: number;
  hasMore: boolean;
  nextOffset?: number;
  results: UnifiedSearchHitPayload[];
  searchRef?: string;
  progress?: UnifiedSearchCompleted["progress"];
  sourceStatus: UnifiedSearchCompleted["result"]["sourceStatus"];
}

export interface UnifiedSearchIncompletePayload {
  query: UnifiedSearchQueryEcho;
  completed: false;
  returnedCount: 0;
  hasMore: false;
  results: [];
  searchRef: string;
  progress?: UnifiedSearchIncomplete["progress"];
}

export interface UnifiedSearchErrorPayload {
  error: string;
  code: string;
  retryable?: boolean;
  details?: Record<string, unknown>;
}

export interface UnifiedSearchStatusResultPayload {
  query: string;
  queryWarnings: string[];
  sources: string[];
  returnedCount: number;
  hasMore: boolean;
  nextOffset?: number;
  results: UnifiedSearchHitPayload[];
  sourceStatus: UnifiedSearchCompleted["result"]["sourceStatus"];
}

export interface UnifiedSearchStatusCompletedPayload {
  completed: true;
  searchRef?: string;
  progress?: UnifiedSearchCompleted["progress"];
  result: UnifiedSearchStatusResultPayload;
}

export interface UnifiedSearchStatusIncompletePayload {
  completed: false;
  searchRef: string;
  progress?: UnifiedSearchIncomplete["progress"];
}

export function buildUnifiedSearchSuccessPayload(
  params: UnifiedSearchParams,
  rawQuery: string,
  compiledQuery: string,
  defaulted: ReadonlyArray<"limit" | "offset" | "waitTimeoutMs">,
  outcome: UnifiedSearchOutcome,
): UnifiedSearchCompletedPayload | UnifiedSearchIncompletePayload {
  const warnings =
    outcome.state === "completed"
      ? outcome.result.queryWarnings
      : (outcome.progress?.queryWarnings ?? []);
  const query = buildQueryEcho(
    params,
    rawQuery,
    compiledQuery,
    defaulted,
    warnings,
  );

  if (outcome.state === "incomplete") {
    return {
      query,
      completed: false,
      returnedCount: 0,
      hasMore: false,
      results: [],
      searchRef: outcome.searchRef,
      progress: outcome.progress,
    };
  }

  return {
    query,
    completed: true,
    returnedCount: outcome.result.results.length,
    hasMore: outcome.result.page.hasMore,
    nextOffset: outcome.result.page.hasMore
      ? outcome.result.page.offset + outcome.result.page.returned
      : undefined,
    results: outcome.result.results.map(buildHitPayload),
    searchRef: outcome.searchRef,
    progress: outcome.progress,
    sourceStatus: outcome.result.sourceStatus,
  };
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
    return {
      completed: false,
      searchRef: outcome.searchRef,
      progress: outcome.progress,
    };
  }

  return {
    completed: true,
    searchRef: outcome.searchRef,
    progress: outcome.progress,
    result: {
      query: outcome.result.query,
      queryWarnings: outcome.result.queryWarnings,
      sources: outcome.result.sources.map((entry) => entry.toLowerCase()),
      returnedCount: outcome.result.results.length,
      hasMore: outcome.result.page.hasMore,
      nextOffset: outcome.result.page.hasMore
        ? outcome.result.page.offset + outcome.result.page.returned
        : undefined,
      results: outcome.result.results.map(buildHitPayload),
      sourceStatus: outcome.result.sourceStatus,
    },
  };
}

function buildQueryEcho(
  params: UnifiedSearchParams,
  rawQuery: string,
  compiledQuery: string,
  defaulted: ReadonlyArray<"limit" | "offset" | "waitTimeoutMs">,
  warnings: string[],
): UnifiedSearchQueryEcho {
  return {
    raw: rawQuery,
    compiled: compiledQuery,
    warnings,
    targets: params.targets,
    sources: params.sources?.map((entry) => entry.toLowerCase()),
    filters: params.filters
      ? {
          kind: params.filters.kind?.toLowerCase(),
          category: params.filters.category?.toLowerCase(),
          pathPrefix: params.filters.pathPrefix,
          fileIntent: params.filters.fileIntent?.toLowerCase(),
          publicOnly: params.filters.publicOnly,
        }
      : undefined,
    limit: params.limit ?? 0,
    offset: params.offset ?? 0,
    waitTimeoutMs: params.waitTimeoutMs ?? 0,
    defaulted,
  };
}

function buildHitPayload(hit: UnifiedSearchHit): UnifiedSearchHitPayload {
  return {
    type: hit.resultType.toLowerCase(),
    target: hit.targetLabel,
    title: hit.title,
    summary: hit.summary,
    score: hit.score,
    locator: {
      registry: hit.locator.registry,
      packageName: hit.locator.packageName,
      version: hit.locator.version,
      pageId: hit.locator.pageId,
      repoUrl: hit.locator.repoUrl,
      gitRef: hit.locator.gitRef,
      filePath: hit.locator.filePath,
      startLine: hit.locator.startLine,
      endLine: hit.locator.endLine,
      fileContentHash: hit.locator.fileContentHash,
      symbolRef: hit.locator.symbolRef,
      qualifiedPath: hit.locator.qualifiedPath,
      kind: hit.locator.kind,
      category: hit.locator.category,
      language: hit.locator.language,
    },
  };
}
