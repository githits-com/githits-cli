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
 * Sentinel: the caller explicitly asked for "all intents" (CLI
 * `--intent all`, MCP `file_intent: "all"`). Distinct from `undefined`
 * (which means "caller omitted the field") so the shared builders can
 * preserve that choice without guessing.
 *
 * Translates to "omit the GraphQL variable" at the service layer,
 * where omission returns results from every file intent (confirmed
 * against the live backend across both package and repo scopes).
 */
export const FILE_INTENT_ALL = Symbol("FILE_INTENT_ALL");

/**
 * User-facing file_intent input: either a specific intent, the
 * `FILE_INTENT_ALL` sentinel, or `undefined` (no filter requested).
 */
export type FileIntentInput =
  | import("../services/index.js").FileIntent
  | typeof FILE_INTENT_ALL
  | undefined;
