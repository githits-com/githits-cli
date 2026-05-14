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

import { version } from "../../package.json";
import { debugLog } from "./debug-log.js";
import { buildClientHeaders } from "./request-headers.js";

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
  /** Override `User-Agent`. Defaults to `githits-cli/<version>`. */
  userAgent?: string;
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
 */
export async function postPkgseerGraphql(
  request: PkgseerGraphqlRequest,
): Promise<PkgseerGraphqlResponse> {
  const fetchFn = request.fetchFn ?? globalThis.fetch;
  const userAgent = request.userAgent ?? `githits-cli/${version}`;

  let response: Response;
  try {
    response = await fetchFn(`${baseUrl(request.endpointUrl)}/api/graphql`, {
      method: "POST",
      headers: {
        ...buildClientHeaders(),
        Authorization: `Bearer ${request.token}`,
        "Content-Type": "application/json",
        "User-Agent": userAgent,
      },
      body: JSON.stringify({
        query: request.query,
        variables: request.variables,
      }),
    });
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
