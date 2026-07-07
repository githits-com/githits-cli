/**
 * Low-level authenticated POST helper for the pkgseer GraphQL
 * endpoint. Shared by every service that talks to the endpoint.
 *
 * Scope boundary — deliberately narrow:
 * - Owns: URL trailing-slash normalisation, required headers
 *   (`Authorization`, `Content-Type`, `User-Agent`), one POST attempt,
 *   optional `fetchFn` injection, structured response shape, transport
 *   wrapping via {@link PkgseerTransportError}.
 * - Does NOT own: token refresh, GraphQL-error classification, Zod
 *   schema validation, HTTP status dispatch. Those live per-service
 *   so that GraphQL-level `UNAUTHORIZED` (which we only learn *after*
 *   the POST completes) can still trigger the service's
 *   `executeWithTokenRefresh` wrapper.
 *
 * Return contract:
 * - On any HTTP response (2xx, 4xx, 5xx): returns
 *   `{ status, responseBody, parsedBody }`. `parsedBody` is the
 *   JSON-parsed body when valid JSON, otherwise `null`. **Never
 *   throws for a completed response**, regardless of status.
 * - On fetch rejection (DNS, socket, abort): emits one
 *   `pkg-graphql` debug line, then throws
 *   {@link PkgseerTransportError} preserving the rejection `cause`.
 */

import { debugLog } from "./debug-log.js";
import {
  DEFAULT_FETCH_TIMEOUT_MS,
  fetchWithTimeout,
  type RetryFetchOptions,
  retryFetchWithTimeout,
} from "./fetch-timeout.js";
import type { ClientHeaderBuilder } from "./request-headers.js";

export interface PkgseerGraphqlRequest {
  /** Full base URL for the package/source service. Trailing slashes tolerated. */
  endpointUrl: string;
  /** Resolved bearer token. Caller is responsible for obtaining + refreshing. */
  token: string;
  /** GraphQL query string. */
  query: string;
  /** GraphQL variables object. */
  variables: Record<string, unknown>;
  /** Fetch implementation — defaults to `globalThis.fetch`. Injected for tests. */
  fetchFn?: typeof fetch;
  /** Per-request timeout in milliseconds. Defaults to 120s. */
  timeoutMs?: number;
  /** Override `User-Agent`. Production callers inject `githits-cli/<version>`. */
  userAgent?: string;
  /** Optional per-runtime GitHits telemetry headers. */
  clientHeaders?: ClientHeaderBuilder;
  /** Retry configuration for transient failures */
  retryOptions?: {
    /** Maximum number of retry attempts (default: 3) */
    maxRetries?: number;
    /** Base delay in milliseconds for exponential backoff (default: 1000) */
    baseDelayMs?: number;
    /** Maximum delay in milliseconds (default: 30000) */
    maxDelayMs?: number;
    /** Whether to add jitter to delay (default: true) */
    jitter?: boolean;
  };
}

export interface PkgseerGraphqlResponse {
  status: number;
  responseBody: string;
  /**
   * `responseBody` parsed as JSON when valid; `null` when the body is
   * empty, malformed, or not a JSON object. Callers decide whether
   * `null` is an error (e.g. 200 + null → malformed-response) or
   * expected (e.g. 5xx + plain-text body → fall through to raw text).
   */
  parsedBody: unknown;
}

/**
 * Thrown when `fetch` itself rejects — no HTTP response reached the
 * caller. Distinct from HTTP-level errors (which surface as a normal
 * response with non-2xx `status`). Callers catch and re-wrap into
 * their domain `NetworkError` class.
 */
export class PkgseerTransportError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "PkgseerTransportError";
  }
}

/**
 * Normalise the endpoint base URL by stripping trailing slashes. The
 * helper appends `/api/graphql` itself so callers don't repeat the
 * path fragment.
 */
function baseUrl(endpointUrl: string): string {
  return endpointUrl.replace(/\/+$/, "");
}

/**
 * One authenticated POST to the pkgseer GraphQL endpoint. See module
 * comment for the scope boundary.
 *
 * When retryOptions are provided, retries on transient network failures
 * with exponential backoff. GraphQL POST is idempotent (same query = same result).
 */
export async function postPkgseerGraphql(
  request: PkgseerGraphqlRequest,
): Promise<PkgseerGraphqlResponse> {
  const userAgent = request.userAgent ?? "githits-cli";
  const timeoutMs = request.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
  const { retryOptions, ...requestWithoutRetry } = request;

  const fetchFn = async (): Promise<Response> => {
    let response: Response;
    try {
      response = await fetchWithTimeout(
        `${baseUrl(request.endpointUrl)}/api/graphql`,
        {
          method: "POST",
          headers: {
            ...request.clientHeaders?.(),
            Authorization: `Bearer ${request.token}`,
            "Content-Type": "application/json",
            "User-Agent": userAgent,
          },
          body: JSON.stringify({
            query: request.query,
            variables: request.variables,
          }),
        },
        { fetchFn: request.fetchFn, timeoutMs },
      );
    } catch (cause) {
      debugLog("pkg-graphql", {
        event: "transport-error",
        errorName: cause instanceof Error ? cause.name : typeof cause,
        hasCause: true,
      });
      throw new PkgseerTransportError(
        "Network request failed before a response was received. Caller should re-wrap with a domain-specific message.",
        { cause },
      );
    }

    return response;
  };

  let response: Response;
  if (retryOptions) {
    // Use retry logic for transient failures
    const retryFetchFn = async (): Promise<Response> => {
      return retryFetchWithTimeout(
        `${baseUrl(request.endpointUrl)}/api/graphql`,
        {
          method: "POST",
          headers: {
            ...request.clientHeaders?.(),
            Authorization: `Bearer ${request.token}`,
            "Content-Type": "application/json",
            "User-Agent": userAgent,
          },
          body: JSON.stringify({
            query: request.query,
            variables: request.variables,
          }),
        },
        {
          fetchFn: request.fetchFn,
          timeoutMs,
          maxRetries: retryOptions.maxRetries,
          baseDelayMs: retryOptions.baseDelayMs,
          maxDelayMs: retryOptions.maxDelayMs,
          jitter: retryOptions.jitter,
          idempotent: true, // GraphQL POST is idempotent
          onRetry: (attempt, error, delayMs) => {
            debugLog("pkg-graphql", {
              event: "retry",
              attempt,
              delayMs,
              errorName: error instanceof Error ? error.name : typeof error,
            });
          },
        },
      );
    };
    response = await retryFetchFn();
  } else {
    // Use single attempt (backward compatible)
    response = await fetchFn();
  }

  const responseBody = await response.text().catch(() => "");
  const parsedBody = parseJsonOrNull(responseBody);

  return {
    status: response.status,
    responseBody,
    parsedBody,
  };
}

function parseJsonOrNull(body: string): unknown {
  if (!body) return null;
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}
