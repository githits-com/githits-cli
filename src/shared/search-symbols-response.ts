import type {
  CodeNavigationTarget,
  SearchSymbolsParams,
  SearchSymbolsResult,
} from "../services/index.js";
import { mapCodeNavigationError } from "./code-navigation-error-map.js";

/**
 * The canonical success envelope emitted by both the CLI (`--json`)
 * and the MCP tool text payload. Both paths round-trip through
 * `buildSearchSymbolsSuccessPayload` so the shapes can never drift.
 *
 * No leading-underscore keys — `warning` / `hint` are plain.
 * `returnedCount` is an explicit echo of `results.length`;
 * `totalMatches` carries the backend-provided total (today equal to
 * `returnedCount` — see backend request B2).
 */
export interface SearchSymbolsSuccessPayload {
  query: SearchSymbolsQueryEcho;
  results: SearchSymbolsResult["results"];
  returnedCount: number;
  totalMatches: number;
  hasMore: boolean;
  version?: string;
  resolution?: SearchSymbolsResult["resolution"];
  warning?: string;
  hint?: string;
}

/**
 * Echo of the resolved request. Agents and human readers see exactly
 * which parameters were applied to the search; `defaulted` names the
 * fields the client filled in rather than the caller supplying.
 */
export interface SearchSymbolsQueryEcho {
  target: CodeNavigationTarget;
  query?: string;
  keywords?: string[];
  matchMode?: string;
  kind?: string;
  /**
   * Lowercase broad-category filter applied to the query — one of
   * `callable`, `type`, `module`, `data`, `documentation`. Absent
   * when the caller supplied no category.
   */
  category?: string;
  filePath?: string;
  fileIntent: string; // lowercase enum value or the literal "all"
  limit?: number;
  waitTimeoutMs: number;
  defaulted: ReadonlyArray<"waitTimeoutMs">;
}

export interface SearchSymbolsErrorPayload {
  error: string;
  code: string;
  /**
   * Whether the caller can retry the same request. Sourced from
   * `mapCodeNavigationError(...).retryable`; populated on every
   * error path so agents do not need a per-code retryability table.
   */
  retryable?: boolean;
  details?: Record<string, unknown>;
}

/**
 * Build the success envelope from the already-resolved request
 * `params` plus the raw service result and the `defaulted` array
 * returned by `buildSearchSymbolsParams`.
 *
 * `buildSuccessPayload` is pure so it is cheap to cover in both the
 * CLI and MCP surface tests and in the shared parity test.
 */
export function buildSearchSymbolsSuccessPayload(
  params: SearchSymbolsParams,
  defaulted: ReadonlyArray<"waitTimeoutMs">,
  result: SearchSymbolsResult,
): SearchSymbolsSuccessPayload {
  const payload: SearchSymbolsSuccessPayload = {
    query: {
      target: params.target,
      query: params.query,
      keywords: params.keywords,
      matchMode: params.matchMode?.toLowerCase(),
      kind: params.kind?.toLowerCase(),
      category: params.category?.toLowerCase(),
      filePath: params.filePath,
      fileIntent: echoFileIntent(params.fileIntent),
      limit: params.limit,
      // waitTimeoutMs is always resolved to a concrete number by the builder.
      waitTimeoutMs: params.waitTimeoutMs ?? 0,
      defaulted,
    },
    results: result.results,
    returnedCount: result.results.length,
    totalMatches: result.totalMatches,
    hasMore: result.hasMore,
  };

  if (result.version) payload.version = result.version;
  if (result.resolution) payload.resolution = result.resolution;
  if (result.warning) payload.warning = result.warning;
  // Pass the server hint through on all result counts. The April
  // 2026 backend rewrite made zero-result hints accurate and
  // actionable ("N chunks indexed across M files..." or "docs-only,
  // binary-heavy, or uses an unsupported language..."). Defensive
  // filter for the legacy "0 searchable chunks" string remains in
  // place until every backend deploy is confirmed on the new
  // contract.
  if (result.hint && !isLegacyZeroChunksHint(result.hint)) {
    payload.hint = result.hint;
  }

  return payload;
}

function isLegacyZeroChunksHint(hint: string): boolean {
  return hint.toLowerCase().includes("0 searchable chunks");
}

/**
 * Build the error envelope from any thrown error. Routes through
 * `mapCodeNavigationError` so the emitted `code` is stable and every
 * non-UNKNOWN branch carries a specific classification.
 */
export function buildSearchSymbolsErrorPayload(
  error: unknown,
): SearchSymbolsErrorPayload {
  const mapped = mapCodeNavigationError(error);
  const payload: SearchSymbolsErrorPayload = {
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

function echoFileIntent(resolved: SearchSymbolsParams["fileIntent"]): string {
  // Omitted file intent means "search across all intents". Keep
  // echoing that as the literal "all" so the legacy JSON contract
  // stays stable whether the caller explicitly chose the alias or just
  // omitted the filter.
  if (resolved === undefined) return "all";
  return resolved.toLowerCase();
}
