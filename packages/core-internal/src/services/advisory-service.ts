/** CLI-only cohesive source/package lookup using the shared GraphQL transport. */
import { z } from "zod";
import { isFetchTimeoutError } from "../shared/fetch-timeout.js";
import {
  type PkgseerGraphqlResponse,
  PkgseerTransportError,
  postPkgseerGraphql,
} from "../shared/pkgseer-graphql.js";
import type { ClientHeaderBuilder } from "../shared/request-headers.js";
import { createTermsAcceptanceError } from "../shared/terms-acceptance.js";
import { buildAdvisoryLookupQuery } from "./advisory-lookup-query.js";
import {
  type AdvisoryLookup,
  parseAdvisoryLookups,
} from "./advisory-lookup-schema.js";
import { executeWithTokenRefresh } from "./execute-with-token-refresh.js";
import {
  AuthenticationError,
  isTokenRefreshableError,
  SERVER_AUTHENTICATION_REJECTED_MESSAGE,
} from "./githits-service.js";
import {
  type ServiceDiagnostics,
  withServiceDiagnostics,
} from "./runtime-diagnostics.js";
import type { ServiceRequestOptions } from "./service-request-options.js";
import type { TokenProvider } from "./token-provider.js";

export type {
  AdvisoryDetails,
  AdvisoryLookup,
  LookupPackage,
  LookupUnknown,
} from "./advisory-lookup-schema.js";

export interface AdvisoryService {
  lookup(
    ids: string[],
    detailed: boolean,
    after?: string,
    options?: ServiceRequestOptions,
  ): Promise<AdvisoryLookup[]>;
}

/** Lookup failures retain domain codes and backend evidence without package-specific wording. */
export class AdvisoryLookupError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean = false,
    readonly details: Record<string, unknown> | undefined = undefined,
  ) {
    super(message);
    this.name = "AdvisoryLookupError";
  }
}

/** Mirror backend whitespace trimming without discarding format characters such as BOM. */
export function normalizeAdvisoryId(input: string): string {
  const id = input.replace(/^\p{White_Space}+|\p{White_Space}+$/gu, "");
  if (
    !id ||
    new TextEncoder().encode(id).length > 512 ||
    /[\s\p{Cc}\p{Cf}\p{Cs}]/u.test(id)
  ) {
    throw new AdvisoryLookupError(
      "VALIDATION_ERROR",
      "Advisory ID must contain 1-512 UTF-8 bytes without embedded whitespace, control or format characters.",
    );
  }
  return id;
}

const graphQLErrorSchema = z.object({
  message: z.string(),
  path: z.array(z.union([z.string(), z.number().int()])).optional(),
  extensions: z.record(z.string(), z.unknown()).optional(),
});
const envelopeSchema = z.object({
  data: z.object({ vulnerabilityLookup: z.unknown() }).nullish(),
  errors: z.array(graphQLErrorSchema).optional(),
});

export interface AdvisoryServiceRuntime {
  clientHeaders?: ClientHeaderBuilder;
  userAgent?: string;
  diagnostics?: ServiceDiagnostics;
}

/** Bounded reads only; the CLI owns ordered input admission and independent page drains. */
export class AdvisoryServiceImpl implements AdvisoryService {
  constructor(
    private readonly endpointUrl: string,
    private readonly tokenProvider: TokenProvider,
    private readonly fetchFn: typeof fetch = globalThis.fetch,
    private readonly runtime: AdvisoryServiceRuntime = {},
  ) {}

  async lookup(
    inputs: string[],
    detailed: boolean,
    after?: string,
    options?: ServiceRequestOptions,
  ): Promise<AdvisoryLookup[]> {
    const ids = inputs.map(normalizeAdvisoryId);
    if (ids.length !== 1) {
      throw new AdvisoryLookupError(
        "VALIDATION_ERROR",
        "Use one advisory ID per request.",
      );
    }
    const first = 5;
    return withServiceDiagnostics(
      this.runtime.diagnostics,
      "advisory.lookup.request",
      () =>
        executeWithTokenRefresh({
          getToken: () => this.tokenProvider.getToken(),
          forceRefresh: () => this.tokenProvider.forceRefresh(),
          shouldRefresh: isTokenRefreshableError,
          signal: options?.signal,
          executeWithToken: (token) =>
            this.read(token, ids, detailed, first, after, options?.signal),
        }),
    );
  }

  private async read(
    token: string,
    ids: string[],
    detailed: boolean,
    first: number,
    after?: string,
    signal?: AbortSignal,
  ): Promise<AdvisoryLookup[]> {
    let response: PkgseerGraphqlResponse;
    try {
      response = await postPkgseerGraphql({
        endpointUrl: this.endpointUrl,
        token,
        query: buildAdvisoryLookupQuery(detailed, after !== undefined),
        variables: { ids, first, after: after ?? null },
        signal,
        fetchFn: this.fetchFn,
        ...this.runtime,
      });
    } catch (error) {
      if (!(error instanceof PkgseerTransportError)) throw error;
      const timeout = isFetchTimeoutError(error.cause);
      throw new AdvisoryLookupError(
        timeout ? "TIMEOUT" : "NETWORK",
        timeout
          ? "Advisory request timed out."
          : "Could not reach the advisory service.",
        true,
      );
    }
    if (response.status === 401) throw serverAuthError();
    if (response.status === 403)
      throw new AdvisoryLookupError("FORBIDDEN", "Access denied.");
    const envelope = envelopeSchema.safeParse(response.parsedBody);
    const errors = envelope.success ? (envelope.data.errors ?? []) : [];
    for (const error of errors) {
      const terms = createTermsAcceptanceError({ errors: [error] });
      if (terms) throw terms;
      if (
        ["AUTHENTICATION_REQUIRED", "UNAUTHORIZED"].includes(
          String(error.extensions?.code),
        )
      )
        throw serverAuthError();
      if (error.extensions?.code === "FORBIDDEN")
        throw new AdvisoryLookupError("FORBIDDEN", "Access denied.");
    }
    if (response.status < 200 || response.status >= 300) {
      if (errors[0]) throw requestGraphQLError(errors[0]);
      throw new AdvisoryLookupError(
        response.status === 429 ? "RATE_LIMITED" : "UPSTREAM_ERROR",
        `Advisory service returned HTTP ${response.status}.`,
        response.status === 429 || response.status >= 500,
        { status: response.status },
      );
    }
    const items = parseAdvisoryLookups(
      envelope.success ? envelope.data.data?.vulnerabilityLookup : undefined,
      detailed,
      after !== undefined,
    );
    if (
      !items ||
      items.length !== ids.length ||
      items.some((item, i) => item.requestedId !== ids[i])
    ) {
      if (errors[0]) throw requestGraphQLError(errors[0]);
      throw new AdvisoryLookupError(
        "UPSTREAM_ERROR",
        "Malformed advisory lookup response.",
      );
    }
    for (const error of errors) {
      const item = supportingErrorItem(items, error.path);
      if (!item) throw requestGraphQLError(error);
      const code =
        typeof error.extensions?.code === "string"
          ? error.extensions.code
          : "UPSTREAM_ERROR";
      item.unknownDetails.push({
        section: "AFFECTED_PACKAGES",
        code,
        message: "Optional affected-version display is unavailable.",
        retryable: error.extensions?.retryable === true,
        candidateIds: null,
        candidateIdsTruncated: null,
        path: error.path?.slice(2),
      });
      if (this.runtime.diagnostics?.isEnabled("pkg-graphql")) {
        this.runtime.diagnostics.debug("pkg-graphql", {
          event: "lookup-support-error",
          code,
          path: error.path,
        });
      }
    }
    return items;
  }
}

/** Accept only the selected, nullable display resolvers with valid indices and null leaves. */
function supportingErrorItem(
  items: AdvisoryLookup[],
  path?: Array<string | number>,
): AdvisoryLookup | undefined {
  if (
    path?.[0] !== "vulnerabilityLookup" ||
    !isIndex(path[1]) ||
    path[2] !== "affectedPackages" ||
    path[3] !== "entries" ||
    !isIndex(path[4])
  )
    return;
  const item = items[path[1]];
  const group = item?.affectedPackages?.entries[path[4]];
  if (!group) return;
  if (
    path.length === 7 &&
    path[5] === "sourceEvidence" &&
    path[6] === "affectedVersionDisplay" &&
    group.sourceEvidence?.affectedVersionDisplay === null
  )
    return item;
  if (
    path.length === 8 &&
    path[5] === "advisories" &&
    isIndex(path[6]) &&
    path[7] === "affectedVersionDisplay" &&
    group.advisories[path[6]]?.affectedVersionDisplay === null
  )
    return item;
}
function isIndex(value: string | number | undefined): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}
function serverAuthError(): AuthenticationError {
  return new AuthenticationError(
    SERVER_AUTHENTICATION_REJECTED_MESSAGE,
    "server",
  );
}

function requestGraphQLError(
  error: z.infer<typeof graphQLErrorSchema>,
): AdvisoryLookupError {
  return new AdvisoryLookupError(
    typeof error.extensions?.code === "string"
      ? error.extensions.code
      : "UPSTREAM_ERROR",
    "Advisory lookup request failed.",
    error.extensions?.retryable === true,
    error.path ? { path: error.path } : undefined,
  );
}
