import type { SearchSymbolsFileIntent } from "../services/index.js";

/**
 * Default indexing wait time for any code-navigation request issued
 * by the CLI or MCP surfaces. Both surfaces import this so defaults
 * never diverge silently.
 *
 * 20 seconds sits above the p50 (~11 s) and close to the mean (~17
 * s) observed backend indexing time — most first-time requests
 * complete within this window. Callers who hit an INDEXING response
 * can retry with up to `MAX_WAIT_TIMEOUT_MS` to block until ready.
 */
export const DEFAULT_WAIT_TIMEOUT_MS = 20_000;

/**
 * Backend ceiling on how long a single request may wait for
 * indexing. Clamp callers to this ceiling so the backend never
 * rejects a request for an oversized wait.
 */
export const MAX_WAIT_TIMEOUT_MS = 60_000;

/**
 * Tool-scoped default: when a caller omits `file_intent` on the
 * `search_symbols` surface, apply this filter so top results are
 * production source rather than tests/benchmarks/examples. Named with
 * a `SEARCH_SYMBOLS_` prefix so tool #2 can declare its own defaults
 * alongside without naming churn.
 */
export const SEARCH_SYMBOLS_DEFAULT_FILE_INTENT: SearchSymbolsFileIntent =
  "PRODUCTION";

/**
 * Sentinel: the caller explicitly asked for "all intents" (CLI
 * `--intent all`, MCP `file_intent: "all"`). Distinct from `undefined`
 * (which means "caller did not set the field") so the service
 * translation layer can make an intentional choice rather than guess.
 *
 * Translates to "omit the GraphQL variable" at the service layer,
 * where omission returns results from every file intent (confirmed
 * against the live backend across both package and repo scopes).
 */
export const FILE_INTENT_ALL = Symbol("FILE_INTENT_ALL");

/**
 * User-facing file_intent input: either a specific intent, the
 * `FILE_INTENT_ALL` sentinel, or `undefined` (no intent set — callers
 * should default this at the entry point).
 */
export type FileIntentInput =
  | SearchSymbolsFileIntent
  | typeof FILE_INTENT_ALL
  | undefined;
