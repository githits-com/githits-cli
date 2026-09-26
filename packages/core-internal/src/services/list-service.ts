import { z } from "zod";
import { isFetchTimeoutError } from "../shared/fetch-timeout.js";
import { parseHttpErrorDetail } from "../shared/http-error-detail.js";
import {
  type PkgseerGraphqlResponse,
  PkgseerTransportError,
  postPkgseerGraphql,
} from "../shared/pkgseer-graphql.js";
import type { ClientHeaderBuilder } from "../shared/request-headers.js";
import {
  ClientUpdateRequiredError,
  isClientUpdateRequiredGraphQLError,
  isGraphQLSchemaMismatchError,
} from "./client-update-required-error.js";
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
import type { TokenProvider } from "./token-provider.js";

export type ListFileIntent =
  | "PRODUCTION"
  | "TEST"
  | "BENCHMARK"
  | "EXAMPLE"
  | "GENERATED"
  | "FIXTURE"
  | "BUILD"
  | "VENDOR";

export interface ListParams {
  target: string;
  paths?: string[];
  recursive?: boolean;
  fileTypes?: string[];
  languages?: string[];
  intents?: ListFileIntent[];
  limit?: number;
  after?: string;
  waitTimeoutMs?: number;
  includeDetailedFields: boolean;
}

export type ListInventoryKind = "SOURCE" | "SITE";
export type ListEntryKind = "FILE" | "PAGE" | "DIRECTORY";
export type ListSiteWaitOutcome =
  | "COMPLETED"
  | "DISCARDED"
  | "CANCELLED"
  | "TIMEOUT";

export interface ListReadAction {
  target: string;
  path: string | null;
}

export interface ListBrowseAction {
  target: string;
  paths: string[] | null;
}

export type ListAction = ListReadAction | ListBrowseAction;

export interface ListEntry {
  kind: ListEntryKind;
  path: string;
  title: string | null;
  language?: string | null;
  fileType?: string | null;
  intent?: string | null;
  byteSize?: number | null;
  lineCount?: number | null;
  contentHash?: string | null;
  read: ListReadAction | null;
  browse: ListBrowseAction | null;
}

export interface ListAvailableVersion {
  version: string | null;
  ref: string;
}

export interface ListResolution {
  requestedVersion: string | null;
  requestedRef: string | null;
  resolvedRef: string | null;
  commitSha: string | null;
}

export interface ListTargetIdentity {
  kind: string | null;
  registry: string | null;
  packageName: string | null;
  version: string | null;
  repoUrl: string | null;
  gitRef: string | null;
  commitSha: string | null;
}

export interface ListTargetResolution {
  requested: ListTargetIdentity | null;
  resolvedRequested: ListTargetIdentity | null;
  served: ListTargetIdentity | null;
  freshness: string | null;
  freshnessReason: string | null;
  indexingRef: string | null;
  availableVersions: ListAvailableVersion[] | null;
  availableRefs: ListAvailableVersion[] | null;
  suggestedRefs: ListAvailableVersion[] | null;
}

export interface ListIndexingEstimate {
  lowerSeconds: number | null;
  upperSeconds: number | null;
  elapsedSeconds: number | null;
  sampleCount: number | null;
  source: string | null;
}

export interface ListSiteJob {
  mode: string | null;
  state: string;
}

export interface ListSiteWait {
  mode: string | null;
  outcome: ListSiteWaitOutcome;
}

export interface ListSitePreparation {
  selected: number;
  enqueued: number;
  activeJobs: ListSiteJob[];
  awaited: ListSiteWait[];
}

export interface ListResult {
  inventoryKind: ListInventoryKind;
  requestedTarget: string;
  canonicalTarget: string | null;
  entries: ListEntry[];
  hasMore: boolean;
  nextCursor: string | null;
  indexedVersion: string | null;
  resolution?: ListResolution | null;
  targetResolution?: ListTargetResolution | null;
  codeIndexState: string | null;
  indexingStatus: string | null;
  indexingRef: string | null;
  availableVersions?: ListAvailableVersion[] | null;
  indexingEstimate?: ListIndexingEstimate | null;
  inventoryState: "AVAILABLE" | "EMPTY" | null;
  crawlStatus: "IDLE" | "RUNNING" | "COMPLETE" | "FAILED" | null;
  coverageState: "NONE" | "PARTIAL" | "CAPPED" | "COMPLETE" | null;
  coverageReason: string | null;
  preparation: ListSitePreparation | null;
}

export interface ListService {
  list(params: ListParams): Promise<ListResult>;
}

interface ListServiceRuntime {
  clientHeaders?: ClientHeaderBuilder;
  userAgent?: string;
  clientVersion?: string;
  diagnostics?: ServiceDiagnostics;
}

export class ListAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ListAccessError";
  }
}

export class ListGraphQLError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
    public readonly retryable?: boolean,
    public readonly repoUrl?: string,
    public readonly commitSha?: string,
    public readonly indexingRef?: string,
    public readonly hint?: string,
  ) {
    super(message);
    this.name = "ListGraphQLError";
  }
}

export class ListBackendError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly graphqlCode?: string,
    public readonly retryable?: boolean,
  ) {
    super(message);
    this.name = "ListBackendError";
  }
}

export class ListNetworkError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ListNetworkError";
  }
}

export class MalformedListResponseError extends Error {
  constructor(message = "Malformed response from the list service.") {
    super(message);
    this.name = "MalformedListResponseError";
  }
}

const nullableString = z.string().nullable();
const optionalNullableString = nullableString.optional();
const nullableInt = z.number().int().nullable();
const optionalNullableInt = nullableInt.optional();

const listReadActionSchema = z
  .object({ target: z.string(), path: nullableString })
  .nullable();
const listBrowseActionSchema = z
  .object({ target: z.string(), paths: z.array(z.string()).nullable() })
  .nullable();

const listEntrySchema = z.object({
  kind: z.enum(["FILE", "PAGE", "DIRECTORY"]),
  path: z.string(),
  title: nullableString,
  language: optionalNullableString,
  fileType: optionalNullableString,
  intent: optionalNullableString,
  byteSize: optionalNullableInt,
  lineCount: optionalNullableInt,
  contentHash: optionalNullableString,
  read: listReadActionSchema,
  browse: listBrowseActionSchema,
});

const availableVersionSchema = z.object({
  version: nullableString,
  ref: z.string(),
});

const resolutionSchema = z.object({
  requestedVersion: nullableString,
  requestedRef: nullableString,
  resolvedRef: nullableString,
  commitSha: nullableString,
});

const targetIdentitySchema = z.object({
  kind: nullableString,
  registry: nullableString,
  packageName: nullableString,
  version: nullableString,
  repoUrl: nullableString,
  gitRef: nullableString,
  commitSha: nullableString,
});

const targetResolutionSchema = z.object({
  requested: targetIdentitySchema.nullable(),
  resolvedRequested: targetIdentitySchema.nullable(),
  served: targetIdentitySchema.nullable(),
  freshness: nullableString,
  freshnessReason: nullableString,
  indexingRef: nullableString,
  availableVersions: z.array(availableVersionSchema).nullable(),
  availableRefs: z.array(availableVersionSchema).nullable(),
  suggestedRefs: z.array(availableVersionSchema).nullable(),
});

const indexingEstimateSchema = z.object({
  lowerSeconds: nullableInt,
  upperSeconds: nullableInt,
  elapsedSeconds: nullableInt,
  sampleCount: nullableInt,
  source: nullableString,
});

const sitePreparationSchema = z
  .object({
    selected: z.number().int(),
    enqueued: z.number().int(),
    activeJobs: z.array(z.object({ mode: nullableString, state: z.string() })),
    awaited: z.array(
      z.object({
        mode: nullableString,
        outcome: z.enum(["COMPLETED", "DISCARDED", "CANCELLED", "TIMEOUT"]),
      }),
    ),
  })
  .nullable();

const listResultSchema = z.object({
  inventoryKind: z.enum(["SOURCE", "SITE"]),
  requestedTarget: z.string(),
  canonicalTarget: nullableString,
  entries: z.array(listEntrySchema),
  hasMore: z.boolean(),
  nextCursor: nullableString,
  indexedVersion: nullableString,
  resolution: resolutionSchema.nullable().optional(),
  targetResolution: targetResolutionSchema.nullable().optional(),
  codeIndexState: nullableString,
  indexingStatus: nullableString,
  indexingRef: nullableString,
  availableVersions: z.array(availableVersionSchema).nullable().optional(),
  indexingEstimate: indexingEstimateSchema.nullable().optional(),
  inventoryState: z.enum(["AVAILABLE", "EMPTY"]).nullable(),
  crawlStatus: z.enum(["IDLE", "RUNNING", "COMPLETE", "FAILED"]).nullable(),
  coverageState: z.enum(["NONE", "PARTIAL", "CAPPED", "COMPLETE"]).nullable(),
  coverageReason: nullableString,
  preparation: sitePreparationSchema,
});

const graphQLErrorSchema = z.object({
  message: z.string(),
  extensions: z.record(z.string(), z.unknown()).optional(),
});

const listGraphQLResponseSchema = z.object({
  data: z
    .object({ list: z.unknown().nullable().optional() })
    .nullable()
    .optional(),
  errors: z.array(graphQLErrorSchema).optional(),
});

const LIST_QUERY = `
query List(
  $target: String!
  $paths: [String!]
  $recursive: Boolean
  $fileTypes: [String!]
  $languages: [String!]
  $intents: [FileIntent!]
  $limit: Int
  $after: String
  $waitTimeoutMs: Int
  $includeDetailedFields: Boolean!
) {
  list(
    target: $target
    paths: $paths
    recursive: $recursive
    fileTypes: $fileTypes
    languages: $languages
    intents: $intents
    limit: $limit
    after: $after
    waitTimeoutMs: $waitTimeoutMs
  ) {
    inventoryKind
    requestedTarget
    canonicalTarget
    entries {
      kind
      path
      title
      language @include(if: $includeDetailedFields)
      fileType @include(if: $includeDetailedFields)
      intent @include(if: $includeDetailedFields)
      byteSize @include(if: $includeDetailedFields)
      lineCount @include(if: $includeDetailedFields)
      contentHash @include(if: $includeDetailedFields)
      read {
        target
        path
      }
      browse {
        target
        paths
      }
    }
    hasMore
    nextCursor
    indexedVersion
    resolution @include(if: $includeDetailedFields) {
      requestedVersion
      requestedRef
      resolvedRef
      commitSha
    }
    targetResolution @include(if: $includeDetailedFields) {
      requested {
        kind
        registry
        packageName
        version
        repoUrl
        gitRef
        commitSha
      }
      resolvedRequested {
        kind
        registry
        packageName
        version
        repoUrl
        gitRef
        commitSha
      }
      served {
        kind
        registry
        packageName
        version
        repoUrl
        gitRef
        commitSha
      }
      freshness
      freshnessReason
      indexingRef
      availableVersions {
        version
        ref
      }
      availableRefs {
        version
        ref
      }
      suggestedRefs {
        version
        ref
      }
    }
    codeIndexState
    indexingStatus
    indexingRef
    availableVersions @include(if: $includeDetailedFields) {
      version
      ref
    }
    indexingEstimate @include(if: $includeDetailedFields) {
      lowerSeconds
      upperSeconds
      elapsedSeconds
      sampleCount
      source
    }
    inventoryState
    crawlStatus
    coverageState
    coverageReason
    preparation {
      selected
      enqueued
      activeJobs {
        mode
        state
      }
      awaited {
        mode
        outcome
      }
    }
  }
}`;

/** Client for the backend's unified package, repository, and site inventory. */
export class ListServiceImpl implements ListService {
  constructor(
    private readonly endpointUrl: string,
    private readonly tokenProvider: TokenProvider,
    private readonly fetchFn: typeof fetch = globalThis.fetch,
    private readonly runtime: ListServiceRuntime = {},
  ) {}

  async list(params: ListParams): Promise<ListResult> {
    return withServiceDiagnostics(
      this.runtime.diagnostics,
      "list.request",
      () =>
        executeWithTokenRefresh({
          getToken: () => this.tokenProvider.getToken(),
          forceRefresh: () => this.tokenProvider.forceRefresh(),
          shouldRefresh: isTokenRefreshableError,
          executeWithToken: (token) => this.executeList(token, params),
        }),
    );
  }

  private async executeList(
    token: string,
    params: ListParams,
  ): Promise<ListResult> {
    let response: PkgseerGraphqlResponse;
    try {
      response = await postPkgseerGraphql({
        endpointUrl: this.endpointUrl,
        token,
        query: LIST_QUERY,
        variables: buildListVariables(params),
        fetchFn: this.fetchFn,
        clientHeaders: this.runtime.clientHeaders,
        userAgent: this.runtime.userAgent,
        diagnostics: this.runtime.diagnostics,
      });
    } catch (cause) {
      if (cause instanceof PkgseerTransportError) {
        throw createListTransportError(cause);
      }
      throw cause;
    }

    if (response.status < 200 || response.status >= 300) {
      throw createListHttpError(response);
    }

    const parsed = listGraphQLResponseSchema.safeParse(response.parsedBody);
    if (!parsed.success) throw new MalformedListResponseError();

    if (parsed.data.errors && parsed.data.errors.length > 0) {
      throw createListGraphQLError(
        parsed.data.errors,
        this.runtime.clientVersion,
        this.runtime.diagnostics,
      );
    }

    const resultParsed = listResultSchema.safeParse(parsed.data.data?.list);
    if (!resultParsed.success) throw new MalformedListResponseError();
    const result: ListResult = resultParsed.data;
    if (result.hasMore && !result.nextCursor) {
      throw new MalformedListResponseError(
        "Malformed response from the list service: a continuation cursor is missing.",
      );
    }

    return result;
  }
}

function buildListVariables(params: ListParams): Record<string, unknown> {
  return {
    target: params.target,
    ...(params.paths !== undefined ? { paths: params.paths } : {}),
    ...(params.recursive !== undefined ? { recursive: params.recursive } : {}),
    ...(params.fileTypes !== undefined ? { fileTypes: params.fileTypes } : {}),
    ...(params.languages !== undefined ? { languages: params.languages } : {}),
    ...(params.intents !== undefined ? { intents: params.intents } : {}),
    ...(params.limit !== undefined ? { limit: params.limit } : {}),
    ...(params.after !== undefined ? { after: params.after } : {}),
    ...(params.waitTimeoutMs !== undefined
      ? { waitTimeoutMs: params.waitTimeoutMs }
      : {}),
    includeDetailedFields: params.includeDetailedFields,
  };
}

function createListHttpError(response: PkgseerGraphqlResponse): Error {
  const detail = parseHttpErrorDetail(response.responseBody, [
    "message",
    "error",
    "detail",
  ]);
  if (response.status === 401) {
    return new AuthenticationError(
      SERVER_AUTHENTICATION_REJECTED_MESSAGE,
      "server",
    );
  }
  if (response.status === 403) {
    return new ListAccessError(detail ?? "List access denied.");
  }
  if (response.status >= 500) {
    return new ListBackendError(
      detail
        ? `Server error (${response.status}): ${detail}`
        : `Server error (${response.status})`,
      response.status,
    );
  }
  return new ListBackendError(
    detail ?? `Request failed with status ${response.status}`,
    response.status,
  );
}

function createListTransportError(error: PkgseerTransportError): Error {
  if (isFetchTimeoutError(error.cause)) {
    return new ListBackendError(
      "List request timed out.",
      undefined,
      "TIMEOUT",
      true,
    );
  }
  return new ListNetworkError(
    "Could not reach the package and documentation service. Check your connection.",
    { cause: error },
  );
}

interface ListGraphQLResponseError {
  message: string;
  extensions?: Record<string, unknown>;
}

function createListGraphQLError(
  errors: ListGraphQLResponseError[],
  clientVersion?: string,
  diagnostics?: ServiceDiagnostics,
): Error {
  const message = errors.map((error) => error.message).join(", ");
  const extensions = errors.find(
    (error) => error.extensions && Object.keys(error.extensions).length > 0,
  )?.extensions;
  const code =
    typeof extensions?.code === "string" ? extensions.code : undefined;
  const retryable =
    typeof extensions?.retryable === "boolean"
      ? extensions.retryable
      : undefined;

  if (isClientUpdateRequiredGraphQLError({ message, code })) {
    return new ClientUpdateRequiredError(undefined, undefined, clientVersion);
  }

  if (isGraphQLSchemaMismatchError({ message, code })) {
    const sanitized =
      "Backend protocol mismatch. Your CLI may be newer than the server, or the server may require a newer CLI. Run `githits update-check` to verify your installed version. Set GITHITS_DEBUG=code-nav-wire to inspect GraphQL details during local development.";
    return new ListBackendError(
      diagnostics?.isEnabled("code-nav-wire") ? message : sanitized,
      undefined,
      code,
      retryable,
    );
  }

  if (code === "AUTHENTICATION_REQUIRED" || code === "UNAUTHORIZED") {
    return new AuthenticationError(
      SERVER_AUTHENTICATION_REJECTED_MESSAGE,
      "server",
    );
  }
  if (code === "FORBIDDEN" || code === "ACCESS_DENIED") {
    return new ListAccessError(message);
  }

  return new ListGraphQLError(
    message,
    code,
    retryable,
    typeof extensions?.repo_url === "string" ? extensions.repo_url : undefined,
    typeof extensions?.commit_sha === "string"
      ? extensions.commit_sha
      : undefined,
    typeof extensions?.indexing_ref === "string"
      ? extensions.indexing_ref
      : undefined,
    typeof extensions?.hint === "string" ? extensions.hint : undefined,
  );
}
