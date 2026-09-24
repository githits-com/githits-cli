import { z } from "zod";
import { isFetchTimeoutError } from "../shared/fetch-timeout.js";
import {
  type PkgseerGraphqlResponse,
  PkgseerTransportError,
  postPkgseerGraphql,
} from "../shared/pkgseer-graphql.js";
import type { ClientHeaderBuilder } from "../shared/request-headers.js";
import {
  CODE_CONTEXT_AVAILABLE_VERSIONS_SELECTION,
  CodeNavigationAccessError,
  CodeNavigationBackendError,
  CodeNavigationNetworkError,
  createCodeNavigationGraphQLError,
  createCodeNavigationHttpError,
  INDEXING_DURATION_ESTIMATE_SELECTION,
  MalformedCodeNavigationResponseError,
  parseCodeContextResult,
  type ReadFileResult,
  TARGET_RESOLUTION_SELECTION,
} from "./code-navigation-service.js";
import { executeWithTokenRefresh } from "./execute-with-token-refresh.js";
import { isTokenRefreshableError } from "./githits-service.js";
import {
  createPackageIntelligenceGraphQLError,
  MalformedPackageIntelligenceResponseError,
  type PackageDocResult,
  parsePackageDocResult,
} from "./package-intelligence-service.js";
import {
  type ServiceDiagnostics,
  withServiceDiagnostics,
} from "./runtime-diagnostics.js";
import type { TokenProvider } from "./token-provider.js";

export interface ReadParams {
  target: string;
  path?: string;
  selector?: string;
  startLine?: number;
  endLine?: number;
  waitTimeoutMs?: number;
}

export interface ReadCodeResult {
  source: "code";
  result: ReadFileResult;
}

export interface ReadDocsResult {
  source: "docs";
  result: PackageDocResult;
}

export interface CodeSymbolCandidate {
  name: string | null;
  qualifiedPath: string | null;
  kind: string | null;
  arity: number | null;
  filePath: string | null;
  startLine: number | null;
  endLine: number | null;
}

export interface CodeSymbolSuggestion {
  name: string;
  qualifiedPath: string | null;
  localId: string | null;
  arity: number | null;
  filePath: string | null;
  reason: string | null;
}

export interface CodeSymbolResolution {
  status: "AMBIGUOUS" | "NOT_FOUND" | "SNAPSHOT_UNSUPPORTED";
  candidates: CodeSymbolCandidate[];
  suggestions: CodeSymbolSuggestion[];
  hasMore: boolean;
  repoUrl: string;
  gitRef: string;
  message: string | null;
  codeIndexState: string;
}

export interface ReadSymbolResolutionResult {
  source: "symbol_resolution";
  result: CodeSymbolResolution;
}

export type ReadResult =
  | ReadCodeResult
  | ReadDocsResult
  | ReadSymbolResolutionResult;

export interface ReadService {
  read(params: ReadParams): Promise<ReadResult>;
}

interface ReadServiceRuntime {
  clientHeaders?: ClientHeaderBuilder;
  userAgent?: string;
  clientVersion?: string;
  diagnostics?: ServiceDiagnostics;
}

const readResultTypeSchema = z.object({
  __typename: z.enum([
    "CodeContextResult",
    "GetDocPageResult",
    "CodeSymbolResolutionResult",
  ]),
});

const symbolResolutionSchema = z.object({
  __typename: z.literal("CodeSymbolResolutionResult"),
  status: z.enum(["AMBIGUOUS", "NOT_FOUND", "SNAPSHOT_UNSUPPORTED"]),
  candidates: z
    .array(
      z.object({
        name: z.string().nullable(),
        qualifiedPath: z.string().nullable(),
        kind: z.string().nullable(),
        arity: z.number().int().nullable(),
        filePath: z.string().nullable(),
        startLine: z.number().int().nullable(),
        endLine: z.number().int().nullable(),
      }),
    )
    .max(10),
  suggestions: z
    .array(
      z.object({
        name: z.string(),
        qualifiedPath: z.string().nullable(),
        localId: z.string().nullable(),
        arity: z.number().int().nullable(),
        filePath: z.string().nullable(),
        reason: z.string().nullable(),
      }),
    )
    .max(10),
  hasMore: z.boolean(),
  repoUrl: z.string(),
  gitRef: z.string(),
  message: z.string().nullable(),
  codeIndexState: z.string(),
});

const readGraphQLErrorSchema = z.object({
  message: z.string(),
  extensions: z.record(z.string(), z.unknown()).optional(),
});

const readGraphQLResponseSchema = z.object({
  data: z
    .object({
      read: z.unknown().nullable().optional(),
    })
    .nullable()
    .optional(),
  errors: z.array(readGraphQLErrorSchema).optional(),
});

const READ_QUERY = `
query Read(
  $target: String!
  $path: String
  $selector: String
  $startLine: Int
  $endLine: Int
  $waitTimeoutMs: Int
) {
  read(
    target: $target
    path: $path
    selector: $selector
    startLine: $startLine
    endLine: $endLine
    waitTimeoutMs: $waitTimeoutMs
  ) {
    __typename
    ... on CodeContextResult {
      content
      filePath
      language
      totalLines
      startLine
      endLine
      isBinary
      codeIndexState
      indexingRef
      ${CODE_CONTEXT_AVAILABLE_VERSIONS_SELECTION}
      ${INDEXING_DURATION_ESTIMATE_SELECTION}
      ${TARGET_RESOLUTION_SELECTION}
    }
    ... on GetDocPageResult {
      registry
      packageName
      version
      sourceKind
      contentRange {
        startLine
        endLine
        totalLines
        anchor
      }
      page {
        id
        docsReadTarget
        title
        content
        contentFormat
        breadcrumbs
        lastUpdatedAt
        sourceKind
        source {
          url
          label
        }
        repoUrl
        gitRef
        requestedRef
        filePath
        baseUrl
      }
    }
    ... on CodeSymbolResolutionResult {
      status
      candidates { name qualifiedPath kind arity filePath startLine endLine }
      suggestions { name qualifiedPath localId arity filePath reason }
      hasMore
      repoUrl
      gitRef
      message
      codeIndexState
    }
  }
}`;

/** Client for the backend's compact documentation/code read union. */
export class ReadServiceImpl implements ReadService {
  constructor(
    private readonly endpointUrl: string,
    private readonly tokenProvider: TokenProvider,
    private readonly fetchFn: typeof fetch = globalThis.fetch,
    private readonly runtime: ReadServiceRuntime = {},
  ) {}

  async read(params: ReadParams): Promise<ReadResult> {
    const request = normaliseReadRequest(params);
    return withServiceDiagnostics(
      this.runtime.diagnostics,
      "read.request",
      () =>
        executeWithTokenRefresh({
          getToken: () => this.tokenProvider.getToken(),
          forceRefresh: () => this.tokenProvider.forceRefresh(),
          shouldRefresh: isTokenRefreshableError,
          executeWithToken: (token) => this.executeRead(token, request),
        }),
    );
  }

  private async executeRead(
    token: string,
    request: ReadParams,
  ): Promise<ReadResult> {
    let response: PkgseerGraphqlResponse;
    try {
      response = await postPkgseerGraphql({
        endpointUrl: this.endpointUrl,
        token,
        query: READ_QUERY,
        variables: buildReadVariables(request),
        fetchFn: this.fetchFn,
        clientHeaders: this.runtime.clientHeaders,
        userAgent: this.runtime.userAgent,
        diagnostics: this.runtime.diagnostics,
      });
    } catch (cause) {
      if (cause instanceof PkgseerTransportError) {
        if (isFetchTimeoutError(cause.cause)) {
          throw new CodeNavigationBackendError(
            "Read request timed out.",
            undefined,
            "TIMEOUT",
            true,
          );
        }
        throw new CodeNavigationNetworkError(
          "Could not reach the read service. Check your connection or set GITHITS_CODE_NAV_URL.",
          { cause },
        );
      }
      throw cause;
    }

    if (response.status < 200 || response.status >= 300) {
      const error = createCodeNavigationHttpError(response);
      if (
        error instanceof CodeNavigationAccessError &&
        error.message === "Code navigation access denied."
      ) {
        throw new CodeNavigationAccessError("Read access denied.");
      }
      throw error;
    }

    const parsed = readGraphQLResponseSchema.safeParse(response.parsedBody);
    if (!parsed.success) throw malformedReadResponse();

    if (parsed.data.errors && parsed.data.errors.length > 0) {
      const backendCode = parsed.data.errors[0]?.extensions?.code;
      if (backendCode === "DOCUMENTATION_SECTION_UNRESOLVED") {
        throw createPackageIntelligenceGraphQLError(
          parsed.data.errors,
          this.runtime.clientVersion,
          this.runtime.diagnostics,
        );
      }
      if (backendCode === "FORBIDDEN") {
        throw new CodeNavigationAccessError("Read access denied.");
      }
      throw createCodeNavigationGraphQLError(parsed.data.errors, this.runtime);
    }

    const data = parsed.data.data?.read;
    if (!data) throw malformedReadResponse();
    const resultType = readResultTypeSchema.safeParse(data);
    if (!resultType.success) throw malformedReadResponse();

    if (resultType.data.__typename === "CodeSymbolResolutionResult") {
      const resolution = symbolResolutionSchema.safeParse(data);
      if (!resolution.success) throw malformedReadResponse();
      return { source: "symbol_resolution", result: resolution.data };
    }
    if (resultType.data.__typename === "CodeContextResult") {
      return {
        source: "code",
        result: parseReadBranch(parseCodeContextResult, data),
      };
    }
    if (resultType.data.__typename === "GetDocPageResult") {
      return {
        source: "docs",
        result: parseReadBranch(parsePackageDocResult, data),
      };
    }
    throw malformedReadResponse();
  }
}

function normaliseReadRequest(params: ReadParams): ReadParams {
  const path = params.path?.trim() || undefined;
  return { ...params, path };
}

function buildReadVariables(request: ReadParams): Record<string, unknown> {
  return {
    target: request.target,
    ...(request.path !== undefined ? { path: request.path } : {}),
    ...(request.selector !== undefined ? { selector: request.selector } : {}),
    ...(request.startLine !== undefined
      ? { startLine: request.startLine }
      : {}),
    ...(request.endLine !== undefined ? { endLine: request.endLine } : {}),
    ...(request.waitTimeoutMs !== undefined
      ? { waitTimeoutMs: request.waitTimeoutMs }
      : {}),
  };
}

function malformedReadResponse(): Error {
  return new MalformedCodeNavigationResponseError(
    "Malformed response from read service.",
  );
}

function parseReadBranch<T>(parse: (data: unknown) => T, data: unknown): T {
  try {
    return parse(data);
  } catch (error) {
    if (
      error instanceof MalformedCodeNavigationResponseError ||
      error instanceof MalformedPackageIntelligenceResponseError
    ) {
      throw malformedReadResponse();
    }
    throw error;
  }
}
