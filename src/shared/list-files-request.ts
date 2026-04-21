/**
 * Shared request builder for the `list_files` tool. CLI and MCP
 * normalise inputs here so the two surfaces cannot diverge on
 * addressing or limit validation. Addressing XOR is delegated to
 * the shipped `resolveCodeTarget` helper; this module owns the
 * tool-specific bounds.
 */

import type {
  CodeNavigationTarget,
  ListFilesParams,
} from "../services/index.js";
import { DEFAULT_WAIT_TIMEOUT_MS } from "./code-navigation-defaults.js";
import { InvalidPackageSpecError } from "./package-spec.js";

/** Mirrors the backend input bounds; callers stay below these. */
const LIMIT_MIN = 1;
const LIMIT_MAX = 1000;
const LIMIT_DEFAULT = 200;

const WAIT_MIN = 0;
const WAIT_MAX = 60_000;

export interface ListFilesRequestInput {
  target: CodeNavigationTarget;
  pathPrefix?: string;
  limit?: number;
  waitTimeoutMs?: number;
}

export interface ListFilesRequestBuildResult {
  params: ListFilesParams;
  /**
   * Limit that was actually sent on the wire. Emitted in the
   * envelope's `filter.limit` when the caller supplied one
   * explicitly; when omitted, the builder substitutes the default
   * and the envelope omits `filter.limit`.
   */
  effectiveLimit: number;
  /**
   * True iff the caller explicitly supplied a `limit` (so the
   * envelope knows to echo it under `filter.limit`).
   */
  limitExplicit: boolean;
  pathPrefixExplicit: boolean;
}

export function buildListFilesParams(
  input: ListFilesRequestInput,
): ListFilesRequestBuildResult {
  const limitExplicit = input.limit !== undefined;
  const limit = normaliseLimit(input.limit);

  const waitTimeoutMs = normaliseWaitTimeoutMs(input.waitTimeoutMs);

  const pathPrefix = normalisePathPrefix(input.pathPrefix);
  const pathPrefixExplicit = pathPrefix !== undefined;

  return {
    params: {
      target: input.target,
      pathPrefix,
      limit,
      waitTimeoutMs,
    },
    effectiveLimit: limit,
    limitExplicit,
    pathPrefixExplicit,
  };
}

function normaliseLimit(raw: number | undefined): number {
  if (raw === undefined) return LIMIT_DEFAULT;
  if (!Number.isInteger(raw) || raw < LIMIT_MIN || raw > LIMIT_MAX) {
    throw new InvalidPackageSpecError(
      `\`limit\` must be an integer between ${LIMIT_MIN} and ${LIMIT_MAX}. Got ${raw}.`,
    );
  }
  return raw;
}

function normaliseWaitTimeoutMs(raw: number | undefined): number {
  if (raw === undefined) return DEFAULT_WAIT_TIMEOUT_MS;
  if (!Number.isInteger(raw) || raw < WAIT_MIN || raw > WAIT_MAX) {
    throw new InvalidPackageSpecError(
      `\`wait_timeout_ms\` must be an integer between ${WAIT_MIN} and ${WAIT_MAX}. Got ${raw}.`,
    );
  }
  return raw;
}

function normalisePathPrefix(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
