import type {
  UnifiedSearchCompleted,
  UnifiedSearchHit,
  UnifiedSearchIncomplete,
  UnifiedSearchOutcome,
  UnifiedSearchParams,
} from "../services/index.js";
import { MalformedCodeNavigationResponseError } from "../services/index.js";
import { mapCodeNavigationError } from "./code-navigation-error-map.js";
import {
  buildDocReadFollowUp,
  buildFileReadFollowUp,
} from "./docs-follow-up.js";

export type UnifiedSearchFollowUpPayload =
  | {
      type: "read_doc";
      pageId: string;
    }
  | {
      type: "read_file";
      repoUrl: string;
      gitRef: string;
      path: string;
    };

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
  allowPartialResults: boolean;
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
  highlights?: {
    title?: Array<readonly [number, number]>;
    summary?: Array<readonly [number, number]>;
  };
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
    fileContentHash?: string;
    symbolRef?: string;
    qualifiedPath?: string;
    kind?: string;
    category?: string;
    language?: string;
  };
  followUp?: UnifiedSearchFollowUpPayload;
  alternateFollowUps?: UnifiedSearchFollowUpPayload[];
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
  returnedCount: number;
  hasMore: boolean;
  nextOffset?: number;
  results: UnifiedSearchHitPayload[];
  searchRef: string;
  progress?: UnifiedSearchIncomplete["progress"];
  sourceStatus?: UnifiedSearchCompleted["result"]["sourceStatus"];
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
  result?: UnifiedSearchStatusResultPayload;
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
      : (outcome.result?.queryWarnings ??
        outcome.progress?.queryWarnings ??
        []);
  const query = buildQueryEcho(
    params,
    rawQuery,
    compiledQuery,
    defaulted,
    warnings,
  );

  if (outcome.state === "incomplete") {
    const result = outcome.result;
    const payload: UnifiedSearchIncompletePayload = {
      query,
      completed: false,
      returnedCount: result?.results.length ?? 0,
      hasMore: result?.page.hasMore ?? false,
      results: result?.results.map(buildHitPayload) ?? [],
      searchRef: outcome.searchRef,
      progress: outcome.progress,
    };
    if (result?.page.hasMore === true) {
      payload.nextOffset = result.page.offset + result.page.returned;
    }
    if (result) {
      payload.sourceStatus = result.sourceStatus;
    }
    return payload;
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
    const payload: UnifiedSearchStatusIncompletePayload = {
      completed: false,
      searchRef: outcome.searchRef,
      progress: outcome.progress,
    };
    if (outcome.result) {
      payload.result = buildUnifiedSearchStatusResultPayload(outcome.result);
    }
    return payload;
  }

  return {
    completed: true,
    searchRef: outcome.searchRef,
    progress: outcome.progress,
    result: buildUnifiedSearchStatusResultPayload(outcome.result),
  };
}

function buildUnifiedSearchStatusResultPayload(
  result: UnifiedSearchCompleted["result"],
): UnifiedSearchStatusResultPayload {
  return {
    query: result.query,
    queryWarnings: result.queryWarnings,
    sources: result.sources.map((entry) => entry.toLowerCase()),
    returnedCount: result.results.length,
    hasMore: result.page.hasMore,
    nextOffset: result.page.hasMore
      ? result.page.offset + result.page.returned
      : undefined,
    results: result.results.map(buildHitPayload),
    sourceStatus: result.sourceStatus,
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
    allowPartialResults: params.allowPartialResults ?? false,
    limit: params.limit ?? 0,
    offset: params.offset ?? 0,
    waitTimeoutMs: params.waitTimeoutMs ?? 0,
    defaulted,
  };
}

function buildHitPayload(hit: UnifiedSearchHit): UnifiedSearchHitPayload {
  assertSearchFollowUpInvariant(hit);
  return {
    type: hit.resultType.toLowerCase(),
    target: hit.targetLabel,
    title: hit.title,
    summary: hit.summary,
    score: hit.score,
    highlights: hit.highlights,
    locator: {
      registry: hit.locator.registry,
      packageName: hit.locator.packageName,
      version: hit.locator.version,
      pageId: hit.locator.pageId,
      sourceKind: hit.locator.sourceKind,
      sourceUrl: hit.locator.sourceUrl,
      repoUrl: hit.locator.repoUrl,
      gitRef: hit.locator.gitRef,
      requestedRef: hit.locator.requestedRef,
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
    followUp: buildPrimaryFollowUp(hit),
    alternateFollowUps: buildAlternateFollowUps(hit),
  };
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

function buildPrimaryFollowUp(
  hit: UnifiedSearchHit,
): UnifiedSearchFollowUpPayload | undefined {
  switch (hit.resultType) {
    case "DOCUMENTATION_PAGE":
    case "REPOSITORY_DOC":
      return buildDocReadFollowUp(hit.locator.pageId);
    case "REPOSITORY_CODE":
      return buildFileReadFollowUp(hit.locator);
    default:
      return undefined;
  }
}

function buildAlternateFollowUps(
  hit: UnifiedSearchHit,
): UnifiedSearchFollowUpPayload[] | undefined {
  if (hit.resultType !== "REPOSITORY_DOC") {
    return undefined;
  }

  const readFile = buildFileReadFollowUp(hit.locator);
  return readFile ? [readFile] : undefined;
}
