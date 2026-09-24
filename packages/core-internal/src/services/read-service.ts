import { z } from "zod";
import {
  type PkgseerGraphqlResponse,
  PkgseerTransportError,
  postPkgseerGraphql,
} from "../shared/pkgseer-graphql.js";
import { PKGSEER_REGISTRY_ARGS } from "../shared/pkgseer-registry.js";
import type { ClientHeaderBuilder } from "../shared/request-headers.js";
import {
  CODE_CONTEXT_AVAILABLE_VERSIONS_SELECTION,
  createCodeNavigationGraphQLError,
  createCodeNavigationHttpError,
  createCodeNavigationTransportError,
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
  createPackageIntelligenceHttpError,
  createPackageIntelligenceTransportError,
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
    request: NormalisedReadRequest,
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
        throw request.source === "code"
          ? createCodeNavigationTransportError(cause)
          : createPackageIntelligenceTransportError(cause);
      }
      throw cause;
    }

    if (response.status < 200 || response.status >= 300) {
      throw request.source === "code"
        ? createCodeNavigationHttpError(response)
        : createPackageIntelligenceHttpError(response);
    }

    const parsed = readGraphQLResponseSchema.safeParse(response.parsedBody);
    if (!parsed.success) throw malformedReadResponse(request.source);

    if (parsed.data.errors && parsed.data.errors.length > 0) {
      throw request.source === "code"
        ? createCodeNavigationGraphQLError(parsed.data.errors, this.runtime)
        : createPackageIntelligenceGraphQLError(
            parsed.data.errors,
            this.runtime.clientVersion,
            this.runtime.diagnostics,
          );
    }

    const data = parsed.data.data?.read;
    if (!data) throw malformedReadResponse(request.source);
    const resultType = readResultTypeSchema.safeParse(data);
    if (!resultType.success) throw malformedReadResponse(request.source);

    const selectorWithoutPath =
      request.selector !== undefined && request.path === undefined;
    if (resultType.data.__typename === "CodeSymbolResolutionResult") {
      if (request.source !== "code" && !selectorWithoutPath)
        throw malformedReadResponse("docs");
      const resolution = symbolResolutionSchema.safeParse(data);
      if (!resolution.success) throw malformedReadResponse("code");
      return { source: "symbol_resolution", result: resolution.data };
    }
    if (
      resultType.data.__typename === "CodeContextResult" &&
      (request.source === "code" || selectorWithoutPath)
    ) {
      return { source: "code", result: parseCodeContextResult(data) };
    }
    if (
      resultType.data.__typename === "GetDocPageResult" &&
      (request.source === "docs" || selectorWithoutPath)
    ) {
      return { source: "docs", result: parsePackageDocResult(data) };
    }
    throw malformedReadResponse(request.source);
  }
}

interface NormalisedReadRequest extends ReadParams {
  source: "code" | "docs";
}

/** Return the raw symbol fragment only for compact code targets. */
export function compactCodeSymbolFragment(
  target: string,
  path?: string,
): string | undefined {
  const hash = target.indexOf("#");
  if (hash < 0 || /^https?:\/\//.test(target)) return undefined;
  const base = target.slice(0, hash);
  // Repository documentation page IDs include a ref and a page path.
  if (!path?.trim() && /^(?:github|gitlab|codeberg):.+@[^/]+\/.+/.test(base))
    return undefined;
  const prefix = /^([a-z][a-z0-9+.-]*):/.exec(base)?.[1];
  if (
    /^(?:github|gitlab|codeberg):/.test(base) ||
    /^github\.com\//.test(base) ||
    (prefix !== undefined &&
      PKGSEER_REGISTRY_ARGS.some((registry) => registry === prefix))
  ) {
    return target.slice(hash + 1);
  }
  return undefined;
}

function normaliseReadRequest(params: ReadParams): NormalisedReadRequest {
  const path = params.path?.trim() || undefined;
  const prefix = /^([a-z][a-z0-9+.-]*):/.exec(params.target)?.[1];
  const repositoryPageLike = /^(?:github|gitlab|codeberg):.+@[^/]+\/.+/.test(
    params.target,
  );
  const codeSelector =
    params.selector !== undefined &&
    !repositoryPageLike &&
    (/^(?:github|gitlab|codeberg):/.test(params.target) ||
      /^(?:https?:\/\/)?(?:github\.com|gitlab\.com|codeberg\.org)\//.test(
        params.target,
      ) ||
      (prefix !== undefined &&
        PKGSEER_REGISTRY_ARGS.some((registry) => registry === prefix)));
  return path ||
    codeSelector ||
    compactCodeSymbolFragment(params.target, path) !== undefined
    ? { ...params, path, source: "code" }
    : { ...params, path: undefined, waitTimeoutMs: undefined, source: "docs" };
}

function buildReadVariables(
  request: NormalisedReadRequest,
): Record<string, unknown> {
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

function malformedReadResponse(source: NormalisedReadRequest["source"]): Error {
  return source === "code"
    ? new MalformedCodeNavigationResponseError(
        "Malformed response from code navigation service.",
      )
    : new MalformedPackageIntelligenceResponseError(
        "Malformed response from the package-intelligence service.",
      );
}
