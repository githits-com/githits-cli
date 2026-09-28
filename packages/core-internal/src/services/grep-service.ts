import { z } from "zod";
import {
  DEFAULT_FETCH_TIMEOUT_MS,
  isFetchTimeoutError,
} from "../shared/fetch-timeout.js";
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
import type { ContentModification } from "./code-navigation-service.js";
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

export type GrepCorpus = "SOURCE" | "DOCUMENTATION" | "ALL";
export type GrepTraversal =
  | "COMPLETE"
  | "RESUMABLE_LIMIT"
  | "NON_RESUMABLE_PARTIAL"
  | "FAILED"
  | "CURSOR_EXPIRED";
/** Observed readiness; UNSPECIFIED denotes a scope not yet visited in this page. */
export type GrepReadiness =
  | "UNSPECIFIED"
  | "CURRENT"
  | "STALE"
  | "NOT_AVAILABLE"
  | "MISSING_REF"
  | "READER_OPEN_FAILED"
  | "INCOMPLETE"
  | "RESOURCE_LIMIT"
  | "VERSION_UNSUPPORTED"
  | "READ_FAILED";
export interface GrepPathSelector {
  kind: "EXACT" | "PREFIX" | "GLOB";
  value: string;
}
export interface GrepTarget {
  target: string;
  corpus?: GrepCorpus;
  pathSelectors?: GrepPathSelector[];
  allowUnscoped?: boolean;
}
export interface GrepParams {
  targets: GrepTarget[];
  pattern: string;
  patternType: "REGEX" | "LITERAL";
  caseSensitive: boolean;
  contextLinesBefore: number;
  contextLinesAfter: number;
  maxMatches?: number;
  cursor?: string;
  waitTimeoutMs?: number;
  includeDetailedFields: boolean;
}
export interface GrepLineSlice {
  content: string;
  startByte: number;
  endByte: number;
  originalLineBytes: number;
}
export interface GrepContentSafety {
  filtered: boolean;
  modifications?: ContentModification[];
}
export interface GrepReadAction {
  target: string;
  path: string | null;
  startLine: number;
  endLine: number;
}
interface GrepHitBase {
  targetIndex: number;
  line: number;
  lineSlice: GrepLineSlice;
  contextBeforeSlices: GrepLineSlice[];
  contextAfterSlices: GrepLineSlice[];
  read: GrepReadAction;
  contentSafety: GrepContentSafety;
  lineContent?: string;
  matchStartByte?: number;
  matchEndByte?: number;
  sourceMatchStartByte?: number;
  sourceMatchEndByte?: number;
}
export interface GrepRepositoryHit extends GrepHitBase {
  __typename: "GrepRepositoryHit";
  filePath: string;
  repoUrl?: string;
  commitSha?: string;
  repositoryFilePath?: string;
}
export interface GrepSiteHit extends GrepHitBase {
  __typename: "GrepSiteHit";
  pageUrl: string;
}
export type GrepHit = GrepRepositoryHit | GrepSiteHit;
export interface GrepFileIssue {
  filePath: string;
  code: string;
  line: number;
  contentSafety: GrepContentSafety;
  lineBytes?: number;
  matchStartByte?: number | null;
  matchEndByte?: number | null;
}
export interface GrepTargetStatus {
  targetIndex: number;
  requestedInputIndices: number[];
  kind: "REPOSITORY" | "SITE";
  target: string;
  traversal: GrepTraversal;
  readiness: GrepReadiness;
  errorCode: string | null;
  retryable: boolean;
  publicMessage: string | null;
  requestedRef: string | null;
  commitSha: string | null;
  corpus: GrepCorpus | null;
  filesScanned: number | null;
  filesInScope: number | null;
  binaryFilesSkipped: number | null;
  filesTooLargeSkipped: number | null;
  fileIssues: GrepFileIssue[] | null;
  fileIssuesOmitted: number | null;
  repoUrl?: string | null;
  canonicalSite?: string | null;
  urlPrefixes?: string[];
}
export interface GrepUnavailableTarget {
  inputIndex: number;
  target: string;
  reason: string;
  retryable: boolean;
  progressRef: string | null;
  suggestedSiteTargets: string[] | null;
}
export interface GrepResult {
  hits: GrepHit[];
  targets: GrepTargetStatus[];
  unavailableTargets: GrepUnavailableTarget[];
  traversal: GrepTraversal;
  nextCursor: string | null;
  totalMatches: number;
}
export interface GrepService {
  grep(params: GrepParams): Promise<GrepResult>;
}
interface GrepServiceRuntime {
  clientHeaders?: ClientHeaderBuilder;
  userAgent?: string;
  clientVersion?: string;
  diagnostics?: ServiceDiagnostics;
}

/** Public backend error details, retained without interpreting message text. */
export class GrepGraphQLError extends Error {
  constructor(
    message: string,
    public readonly extensions: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "GrepGraphQLError";
  }
}
export class GrepBackendError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly graphqlCode?: string,
    public readonly retryable?: boolean,
  ) {
    super(message);
    this.name = "GrepBackendError";
  }
}
export class GrepAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GrepAccessError";
  }
}
export class GrepNetworkError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "GrepNetworkError";
  }
}
export class MalformedGrepResponseError extends Error {
  constructor() {
    super("Malformed response from the grep service.");
    this.name = "MalformedGrepResponseError";
  }
}

const traversal = z.enum([
  "COMPLETE",
  "RESUMABLE_LIMIT",
  "NON_RESUMABLE_PARTIAL",
  "FAILED",
  "CURSOR_EXPIRED",
]);
const corpus = z.enum(["SOURCE", "DOCUMENTATION", "ALL"]);
const nonnegativeInt = z.number().int().nonnegative();
const nullableString = z.string().nullable();
const lineSlice = z.object({
  content: z.string(),
  startByte: nonnegativeInt,
  endByte: nonnegativeInt,
  originalLineBytes: nonnegativeInt,
});
const readAction = z.object({
  target: z.string(),
  path: nullableString,
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
});
const modifications = z.array(
  z.enum([
    "INVISIBLE_CONTROLS_STRIPPED",
    "HTML_COMMENTS_STRIPPED",
    "IMAGES_REPLACED",
    "UNSAFE_LINKS_NEUTRALIZED",
  ]),
);

/** Conditional fields must exist when selected, and stay absent in compact results. */
function resultSchema(detailed: boolean): z.ZodType<GrepResult> {
  const selected = <T extends z.ZodType>(schema: T): T | z.ZodOptional<T> =>
    detailed ? schema : schema.optional();
  const safety = z.object({
    filtered: z.boolean(),
    modifications: selected(modifications),
  });
  const common = {
    targetIndex: nonnegativeInt,
    line: z.number().int().positive(),
    lineSlice,
    contextBeforeSlices: z.array(lineSlice),
    contextAfterSlices: z.array(lineSlice),
    read: readAction,
    contentSafety: safety,
    lineContent: selected(z.string()),
    matchStartByte: selected(nonnegativeInt),
    matchEndByte: selected(nonnegativeInt),
    sourceMatchStartByte: selected(nonnegativeInt),
    sourceMatchEndByte: selected(nonnegativeInt),
  };
  return z.object({
    hits: z.array(
      z.discriminatedUnion("__typename", [
        z.object({
          ...common,
          __typename: z.literal("GrepRepositoryHit"),
          filePath: z.string(),
          repoUrl: selected(z.string()),
          commitSha: selected(z.string()),
          repositoryFilePath: selected(z.string()),
        }),
        z.object({
          ...common,
          __typename: z.literal("GrepSiteHit"),
          pageUrl: z.string(),
        }),
      ]),
    ),
    targets: z.array(
      z.object({
        targetIndex: nonnegativeInt,
        requestedInputIndices: z.array(nonnegativeInt),
        kind: z.enum(["REPOSITORY", "SITE"]),
        target: z.string(),
        traversal,
        readiness: z.enum([
          "UNSPECIFIED",
          "CURRENT",
          "STALE",
          "NOT_AVAILABLE",
          "MISSING_REF",
          "READER_OPEN_FAILED",
          "INCOMPLETE",
          "RESOURCE_LIMIT",
          "VERSION_UNSUPPORTED",
          "READ_FAILED",
        ]),
        errorCode: nullableString,
        retryable: z.boolean(),
        publicMessage: nullableString,
        requestedRef: nullableString,
        commitSha: nullableString,
        corpus: corpus.nullable(),
        filesScanned: nonnegativeInt.nullable(),
        filesInScope: nonnegativeInt.nullable(),
        binaryFilesSkipped: nonnegativeInt.nullable(),
        filesTooLargeSkipped: nonnegativeInt.nullable(),
        fileIssuesOmitted: nonnegativeInt.nullable(),
        fileIssues: z
          .array(
            z.object({
              filePath: z.string(),
              contentSafety: safety,
              code: z.string(),
              line: nonnegativeInt,
              lineBytes: selected(nonnegativeInt),
              matchStartByte: selected(nonnegativeInt.nullable()),
              matchEndByte: selected(nonnegativeInt.nullable()),
            }),
          )
          .nullable(),
        repoUrl: selected(nullableString),
        canonicalSite: selected(nullableString),
        urlPrefixes: selected(z.array(z.string())),
      }),
    ),
    unavailableTargets: z.array(
      z.object({
        inputIndex: nonnegativeInt,
        target: z.string(),
        reason: z.string(),
        retryable: z.boolean(),
        progressRef: nullableString,
        suggestedSiteTargets: z.array(z.string()).nullable(),
      }),
    ),
    traversal,
    nextCursor: nullableString,
    totalMatches: nonnegativeInt,
  });
}

/** Validate and allowlist selected fields; detailed mode requires its selections. */
export function parseGrepResult(value: unknown, detailed = false): GrepResult {
  const parsed = resultSchema(detailed).safeParse(value);
  if (!parsed.success) throw new MalformedGrepResponseError();
  const result = parsed.data;
  const indices = new Set(result.targets.map((target) => target.targetIndex));
  if (
    indices.size !== result.targets.length ||
    result.hits.some((hit) => !indices.has(hit.targetIndex)) ||
    (result.traversal === "RESUMABLE_LIMIT" && !result.nextCursor)
  )
    throw new MalformedGrepResponseError();
  return result;
}

const GRAPHQL_QUERY = `query Grep(
  $targets: [GrepTargetInput!]!, $pattern: String!, $patternType: GrepPatternType,
  $caseSensitive: Boolean, $contextLinesBefore: Int, $contextLinesAfter: Int,
  $maxMatches: Int, $cursor: String, $waitTimeoutMs: Int, $includeDetailedFields: Boolean!
) {
  grep(targets: $targets, pattern: $pattern, patternType: $patternType,
    caseSensitive: $caseSensitive, contextLinesBefore: $contextLinesBefore,
    contextLinesAfter: $contextLinesAfter, maxMatches: $maxMatches,
    cursor: $cursor, waitTimeoutMs: $waitTimeoutMs) {
    traversal nextCursor totalMatches
    hits {
      __typename
      ... on GrepRepositoryHit {
        filePath
        repoUrl @include(if: $includeDetailedFields)
        commitSha @include(if: $includeDetailedFields)
        repositoryFilePath @include(if: $includeDetailedFields)
        ...RepositoryMatch
      }
      ... on GrepSiteHit { pageUrl ...SiteMatch }
    }
    targets {
      targetIndex requestedInputIndices kind target traversal readiness errorCode retryable publicMessage
      requestedRef commitSha corpus filesScanned filesInScope binaryFilesSkipped filesTooLargeSkipped fileIssuesOmitted
      repoUrl @include(if: $includeDetailedFields)
      canonicalSite @include(if: $includeDetailedFields)
      urlPrefixes @include(if: $includeDetailedFields)
      fileIssues {
        filePath code line contentSafety { filtered modifications @include(if: $includeDetailedFields) }
        lineBytes @include(if: $includeDetailedFields)
        matchStartByte @include(if: $includeDetailedFields)
        matchEndByte @include(if: $includeDetailedFields)
      }
    }
    unavailableTargets { inputIndex target reason retryable progressRef suggestedSiteTargets }
  }
}
fragment RepositoryMatch on GrepRepositoryHit {
  targetIndex line lineSlice { ...LineSlice } contextBeforeSlices { ...LineSlice } contextAfterSlices { ...LineSlice }
  read { target path startLine endLine } contentSafety { filtered modifications @include(if: $includeDetailedFields) }
  lineContent @include(if: $includeDetailedFields)
  matchStartByte @include(if: $includeDetailedFields) matchEndByte @include(if: $includeDetailedFields)
  sourceMatchStartByte @include(if: $includeDetailedFields) sourceMatchEndByte @include(if: $includeDetailedFields)
}
fragment SiteMatch on GrepSiteHit {
  targetIndex line lineSlice { ...LineSlice } contextBeforeSlices { ...LineSlice } contextAfterSlices { ...LineSlice }
  read { target path startLine endLine } contentSafety { filtered modifications @include(if: $includeDetailedFields) }
  lineContent @include(if: $includeDetailedFields)
  matchStartByte @include(if: $includeDetailedFields) matchEndByte @include(if: $includeDetailedFields)
  sourceMatchStartByte @include(if: $includeDetailedFields) sourceMatchEndByte @include(if: $includeDetailedFields)
}
fragment LineSlice on GrepRepoLineSlice { content startByte endByte originalLineBytes }`;

const graphQLResponse = z.object({
  data: z.object({ grep: z.unknown().optional() }).nullable().optional(),
  errors: z
    .array(
      z.object({
        message: z.string(),
        extensions: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .optional(),
});

/** One transport-neutral request for a mixed-source grep page. */
export class GrepServiceImpl implements GrepService {
  constructor(
    private readonly endpointUrl: string,
    private readonly tokenProvider: TokenProvider,
    private readonly fetchFn: typeof fetch = globalThis.fetch,
    private readonly runtime: GrepServiceRuntime = {},
  ) {}

  async grep(params: GrepParams): Promise<GrepResult> {
    return withServiceDiagnostics(
      this.runtime.diagnostics,
      "grep.request",
      () =>
        executeWithTokenRefresh({
          getToken: () => this.tokenProvider.getToken(),
          forceRefresh: () => this.tokenProvider.forceRefresh(),
          shouldRefresh: isTokenRefreshableError,
          executeWithToken: (token) => this.executeGrep(token, params),
        }),
    );
  }

  private async executeGrep(
    token: string,
    params: GrepParams,
  ): Promise<GrepResult> {
    let response: PkgseerGraphqlResponse;
    const { includeDetailedFields, ...controls } = params;
    try {
      response = await postPkgseerGraphql({
        endpointUrl: this.endpointUrl,
        token,
        query: GRAPHQL_QUERY,
        variables: { ...controls, includeDetailedFields },
        timeoutMs: Math.max(
          DEFAULT_FETCH_TIMEOUT_MS,
          (params.waitTimeoutMs ?? 0) + 30_000,
        ),
        fetchFn: this.fetchFn,
        clientHeaders: this.runtime.clientHeaders,
        userAgent: this.runtime.userAgent,
        diagnostics: this.runtime.diagnostics,
      });
    } catch (cause) {
      if (!(cause instanceof PkgseerTransportError)) throw cause;
      if (isFetchTimeoutError(cause.cause))
        throw new GrepBackendError(
          "Grep request timed out.",
          undefined,
          "TIMEOUT",
          true,
        );
      throw new GrepNetworkError(
        "Could not reach the package and documentation service. Check your connection.",
        { cause },
      );
    }
    if (response.status < 200 || response.status >= 300)
      throw httpError(response);
    const envelope = graphQLResponse.safeParse(response.parsedBody);
    if (!envelope.success) throw new MalformedGrepResponseError();
    const errors = envelope.data.errors;
    if (errors?.length) {
      const message = errors.map((error) => error.message).join(", ");
      const extensions =
        errors.find((error) => error.extensions?.code)?.extensions ?? {};
      const code =
        typeof extensions.code === "string" ? extensions.code : undefined;
      if (isClientUpdateRequiredGraphQLError({ message, code }))
        throw new ClientUpdateRequiredError(
          undefined,
          undefined,
          this.runtime.clientVersion,
        );
      if (isGraphQLSchemaMismatchError({ message, code }))
        throw new GrepBackendError(
          "Backend protocol mismatch: the endpoint must support unified grep. Run `githits update-check` to check your client version.",
          undefined,
          code,
          false,
        );
      if (code === "AUTHENTICATION_REQUIRED" || code === "UNAUTHORIZED")
        throw new AuthenticationError(
          SERVER_AUTHENTICATION_REJECTED_MESSAGE,
          "server",
        );
      if (code === "FORBIDDEN" || code === "ACCESS_DENIED")
        throw new GrepAccessError(message);
      throw new GrepGraphQLError(message, extensions);
    }
    return parseGrepResult(envelope.data.data?.grep, includeDetailedFields);
  }
}

function httpError(response: PkgseerGraphqlResponse): Error {
  const detail = parseHttpErrorDetail(response.responseBody, [
    "message",
    "error",
    "detail",
  ]);
  if (response.status === 401)
    return new AuthenticationError(
      SERVER_AUTHENTICATION_REJECTED_MESSAGE,
      "server",
    );
  if (response.status === 403)
    return new GrepAccessError(detail ?? "Grep access denied.");
  return new GrepBackendError(
    detail ?? `Request failed with status ${response.status}`,
    response.status,
  );
}
