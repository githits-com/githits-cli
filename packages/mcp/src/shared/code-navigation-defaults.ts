import type { FileIntent } from "@githits/core-internal";

/**
 * Default indexing wait time for any code-navigation request issued
 * by the CLI or MCP surfaces. Both surfaces import this so defaults
 * never diverge silently.
 *
 * Allow headroom for indexing plus metadata fetches before returning
 * progress. Discovery uses `MAX_DISCOVERY_WAIT_TIMEOUT_MS`; other navigation
 * requests use `MAX_WAIT_TIMEOUT_MS`.
 */
export const DEFAULT_WAIT_TIMEOUT_MS = 30_000;

/**
 * Supported client ceiling for non-discovery indexing waits. Raising it requires
 * verifying request timeouts and the MCP host/proxy chain end to end;
 * backend support alone does not establish a safe client limit.
 */
export const MAX_WAIT_TIMEOUT_MS = 60_000;

/** Discovery readiness ceiling below the standard 125-second Cloudflare origin limit. */
export const MAX_DISCOVERY_WAIT_TIMEOUT_MS = 120_000;

/** Default and maximum line spans enforced by the MCP `code_read` surface. */
export const MCP_READ_DEFAULT_SPAN = 150;
export const MCP_READ_MAX_SPAN = 300;

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
export const FILE_INTENT_ALL: unique symbol = Symbol("FILE_INTENT_ALL");

/**
 * User-facing file_intent input: either a specific intent, the
 * `FILE_INTENT_ALL` sentinel, or `undefined` (no filter requested).
 */
export type FileIntentInput = FileIntent | typeof FILE_INTENT_ALL | undefined;
