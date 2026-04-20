import { z } from "zod";
import { version } from "../../package.json";
import { executeWithTokenRefresh } from "./execute-with-token-refresh.js";
import { AuthenticationError } from "./githits-service.js";
import type { TokenProvider } from "./token-manager.js";

export type CodeNavigationRegistry =
  | "NPM"
  | "PYPI"
  | "HEX"
  | "CRATES"
  | "NUGET"
  | "MAVEN"
  | "ZIG"
  | "VCPKG"
  | "PACKAGIST";

export type SearchSymbolsMatchMode = "OR" | "AND";

/**
 * Precise symbol kind from the backend's unified symbol taxonomy.
 * Prefer `SymbolCategory` for broad filtering; use `SymbolKind`
 * only when the caller knows the exact construct.
 *
 * Taxonomy notes:
 * - `method` excludes constructor/getter/setter/operator
 * - `field` excludes property/event
 * - `module` excludes namespace/package/object
 * - `class` excludes record/mixin/actor
 * - `interface` excludes protocol/annotation
 */
export type SearchSymbolsKind =
  | "FUNCTION"
  | "METHOD"
  | "CONSTRUCTOR"
  | "GETTER"
  | "SETTER"
  | "OPERATOR"
  | "CLASS"
  | "INTERFACE"
  | "TRAIT"
  | "STRUCT"
  | "ENUM"
  | "RECORD"
  | "PROTOCOL"
  | "EXTENSION"
  | "DELEGATE"
  | "MIXIN"
  | "ACTOR"
  | "ANNOTATION"
  | "TYPE"
  | "MODULE"
  | "NAMESPACE"
  | "PACKAGE"
  | "OBJECT"
  | "FIELD"
  | "PROPERTY"
  | "EVENT"
  | "CONSTANT"
  | "DOC_SECTION";

/**
 * Broad symbol category — the preferred filtering surface. Computed
 * by the backend from the precise `kind`, so it works across the
 * full kind taxonomy without enumerating individual kinds.
 */
export type SymbolCategory =
  | "CALLABLE"
  | "TYPE"
  | "MODULE"
  | "DATA"
  | "DOCUMENTATION";

export type SearchSymbolsFileIntent =
  | "PRODUCTION"
  | "TEST"
  | "BENCHMARK"
  | "EXAMPLE"
  | "GENERATED"
  | "FIXTURE"
  | "BUILD"
  | "VENDOR";

export interface CodeNavigationTarget {
  registry?: CodeNavigationRegistry;
  packageName?: string;
  version?: string;
  repoUrl?: string;
  gitRef?: string;
}

export interface SearchSymbolsParams {
  target: CodeNavigationTarget;
  query?: string;
  keywords?: string[];
  matchMode?: SearchSymbolsMatchMode;
  /**
   * Precise symbol kind. Prefer `category` for broad filtering;
   * use `kind` only when the caller wants a specific construct.
   */
  kind?: SearchSymbolsKind;
  /**
   * Broad symbol category filter. Preferred surface for filtering
   * navigation queries — works across the 27-value kind taxonomy
   * without enumerating individual kinds.
   */
  category?: SymbolCategory;
  filePath?: string;
  limit?: number;
  fileIntent?: SearchSymbolsFileIntent;
  waitTimeoutMs?: number;
}

export interface SearchSymbolsResultEntry {
  name?: string;
  filePath?: string;
  startLine?: number;
  endLine?: number;
  preview?: string;
  code?: string;
  language?: string;
  symbolRef?: string;
  qualifiedPath?: string;
  /**
   * Precise symbol kind (lowercase string) from the backend's
   * unified symbol taxonomy. Populated for every chunk — the
   * backend handles the fallback from chunk-level classification
   * to enrichment-level kind internally, so callers can treat
   * this as the single source of truth for taxonomy.
   */
  kind?: string;
  /**
   * Broad category of the primary symbol — one of `callable`,
   * `type`, `module`, `data`, `documentation`. Computed by the
   * backend from `kind`. Null for kinds with no category
   * (e.g. CSS rules).
   */
  category?: string;
  arity?: number;
  isPublic?: boolean;
  /**
   * Number of symbols contained in this chunk (DETAILED mode only,
   * populated when > 1). Schema coerced to `Int` in the April 2026
   * backend update; earlier versions returned a string array.
   */
  containedSymbols?: number;
}

export interface SearchSymbolsResolution {
  requestedVersion?: string;
  requestedRef?: string;
  resolvedRef?: string;
  commitSha?: string;
}

export interface SearchSymbolsResult {
  results: SearchSymbolsResultEntry[];
  totalMatches: number;
  hasMore: boolean;
  version?: string;
  resolution?: SearchSymbolsResolution;
  hint?: string;
  warning?: string;
}

export interface AvailableVersion {
  version?: string;
  ref: string;
}

export interface CodeNavigationService {
  searchSymbols(params: SearchSymbolsParams): Promise<SearchSymbolsResult>;
}

export class CodeNavigationAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CodeNavigationAccessError";
  }
}

export class CodeNavigationGraphQLError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "CodeNavigationGraphQLError";
  }
}

export class CodeNavigationIndexingError extends Error {
  constructor(
    message: string,
    public readonly indexingRef?: string,
    public readonly availableVersions?: AvailableVersion[],
  ) {
    super(message);
    this.name = "CodeNavigationIndexingError";
  }
}

export class CodeNavigationUnresolvableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CodeNavigationUnresolvableError";
  }
}

export class MalformedCodeNavigationResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MalformedCodeNavigationResponseError";
  }
}

export class CodeNavigationTargetNotFoundError extends Error {
  constructor(
    message: string,
    public readonly availableVersions?: AvailableVersion[],
  ) {
    super(message);
    this.name = "CodeNavigationTargetNotFoundError";
  }
}

/**
 * Raised when the target package exists in the index but the
 * requested version has no matching indexed ref. Distinct from
 * `CodeNavigationTargetNotFoundError` because the recovery path
 * differs (switch to a supported version rather than check the
 * package name). Carries the structured fields backend populates
 * on `VERSION_NOT_FOUND`.
 */
export class CodeNavigationVersionNotFoundError extends Error {
  constructor(
    message: string,
    public readonly packageName: string | undefined,
    public readonly requestedVersion: string | undefined,
    public readonly latestIndexed: string | undefined,
    public readonly availableVersions: AvailableVersion[] | undefined,
  ) {
    super(message);
    this.name = "CodeNavigationVersionNotFoundError";
  }
}

/**
 * Raised when the caller submitted invalid input that the backend
 * rejected with `VALIDATION_ERROR` (e.g. query too long). Treated as
 * a client error (non-retryable, INVALID_ARGUMENT on the mapped
 * envelope).
 */
export class CodeNavigationValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CodeNavigationValidationError";
  }
}

/**
 * Raised when the caller hit a backend feature flag they don't have
 * access to. Same user-facing handling as ACCESS_DENIED.
 */
export class CodeNavigationFeatureFlagRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CodeNavigationFeatureFlagRequiredError";
  }
}

export class CodeNavigationNetworkError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "CodeNavigationNetworkError";
  }
}

export class CodeNavigationBackendError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly graphqlCode?: string,
    /**
     * Backend-provided retryability hint. When present, callers
     * should trust it over per-code defaults. Populated by the
     * April 2026 `extensions.retryable` contract on GraphQL errors.
     */
    public readonly retryable?: boolean,
  ) {
    super(message);
    this.name = "CodeNavigationBackendError";
  }
}

/**
 * Raised by the service when the caller supplied neither a query
 * nor any keywords. Name starts with `Invalid` so
 * `mapCodeNavigationError` classifies it as `INVALID_ARGUMENT`.
 */
export class InvalidSearchSymbolsRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidSearchSymbolsRequestError";
  }
}

// Always requests `mode: DETAILED` — the service makes this choice
// once so both CLI and MCP get the richest response (kind, category,
// endLine, language). Consumers derive a snippet from `code` when
// needed; `preview` is available in both modes but the formatter
// owns snippet rendering client-side for consistent truncation.
const SEARCH_SYMBOLS_QUERY = `
query SearchSymbols(
  $registry: Registry
  $packageName: String
  $repoUrl: String
  $gitRef: String
  $query: String
  $keywords: [String!]
  $matchMode: MatchMode
  $kind: SymbolKind
  $category: SymbolCategory
  $filePath: String
  $version: String
  $limit: Int
  $fileIntent: FileIntent
  $waitTimeoutMs: Int
) {
  searchSymbols(
    registry: $registry
    packageName: $packageName
    repoUrl: $repoUrl
    gitRef: $gitRef
    query: $query
    keywords: $keywords
    matchMode: $matchMode
    kind: $kind
    category: $category
    filePath: $filePath
    version: $version
    limit: $limit
    fileIntent: $fileIntent
    mode: DETAILED
    waitTimeoutMs: $waitTimeoutMs
  ) {
    results {
      name
      filePath
      startLine
      endLine
      preview
      code
      language
      symbolRef
      qualifiedPath
      kind
      category
      arity
      isPublic
      containedSymbols
    }
    totalMatches
    hasMore
    indexedVersion
    resolution {
      requestedVersion
      requestedRef
      resolvedRef
      commitSha
    }
    diagnostics {
      hint
    }
    warning
    indexingStatus
    indexingRef
    availableVersions {
      version
      ref
    }
  }
}`;

const availableVersionSchema = z.object({
  version: z.string().nullable().optional(),
  ref: z.string(),
});

const searchSymbolsResultEntrySchema = z.object({
  name: z.string().nullable().optional(),
  filePath: z.string().nullable().optional(),
  startLine: z.number().int().nullable().optional(),
  endLine: z.number().int().nullable().optional(),
  preview: z.string().nullable().optional(),
  code: z.string().nullable().optional(),
  language: z.string().nullable().optional(),
  symbolRef: z.string().nullable().optional(),
  qualifiedPath: z.string().nullable().optional(),
  kind: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  arity: z.number().int().nullable().optional(),
  isPublic: z.boolean().nullable().optional(),
  containedSymbols: z.number().int().nullable().optional(),
});

const searchSymbolsResponseSchema = z.object({
  results: z.array(searchSymbolsResultEntrySchema),
  totalMatches: z.number().int(),
  hasMore: z.boolean(),
  indexedVersion: z.string().nullable().optional(),
  resolution: z
    .object({
      requestedVersion: z.string().nullable().optional(),
      requestedRef: z.string().nullable().optional(),
      resolvedRef: z.string().nullable().optional(),
      commitSha: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
  diagnostics: z
    .object({
      hint: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
  warning: z.string().nullable().optional(),
  indexingStatus: z.string(),
  indexingRef: z.string().nullable().optional(),
  availableVersions: z.array(availableVersionSchema).nullable().optional(),
});

const graphQLErrorSchema = z.object({
  message: z.string(),
  extensions: z.record(z.string(), z.unknown()).optional(),
});

// `data` may be null (seen live for unknown packages that also carry
// `errors`), and `searchSymbols` may be null even when `data` is present.
// Both must parse successfully so the error-handling layer can classify.
const graphQLResponseSchema = z.object({
  data: z
    .object({
      searchSymbols: searchSymbolsResponseSchema.nullable().optional(),
    })
    .nullable()
    .optional(),
  errors: z.array(graphQLErrorSchema).optional(),
});

export class CodeNavigationServiceImpl implements CodeNavigationService {
  constructor(
    private readonly codeNavigationUrl: string,
    private readonly tokenProvider: TokenProvider,
    private readonly fetchFn: typeof fetch = globalThis.fetch,
  ) {}

  async searchSymbols(
    params: SearchSymbolsParams,
  ): Promise<SearchSymbolsResult> {
    return executeWithTokenRefresh({
      getToken: () => this.tokenProvider.getToken(),
      forceRefresh: () => this.tokenProvider.forceRefresh(),
      shouldRefresh: (error) => error instanceof AuthenticationError,
      executeWithToken: (token) => this.executeSearchSymbols(token, params),
    });
  }

  private async executeSearchSymbols(
    token: string,
    params: SearchSymbolsParams,
  ): Promise<SearchSymbolsResult> {
    if (!params.query && (!params.keywords || params.keywords.length === 0)) {
      throw new InvalidSearchSymbolsRequestError(
        "Either query or keywords must be provided.",
      );
    }

    let response: Response;
    try {
      response = await this.fetchFn(`${this.baseUrl()}/api/graphql`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "User-Agent": `githits-cli/${version}`,
        },
        body: JSON.stringify({
          query: SEARCH_SYMBOLS_QUERY,
          variables: {
            registry: params.target.registry,
            packageName: params.target.packageName,
            repoUrl: params.target.repoUrl,
            gitRef: params.target.gitRef,
            query: params.query,
            keywords: params.keywords,
            matchMode: params.matchMode,
            kind: params.kind,
            category: params.category,
            filePath: params.filePath,
            version: params.target.version,
            limit: params.limit,
            fileIntent: params.fileIntent,
            waitTimeoutMs: params.waitTimeoutMs,
          },
        }),
      });
    } catch (cause) {
      throw new CodeNavigationNetworkError(
        "Could not reach the code navigation service. Check your connection or set GITHITS_CODE_NAV_URL.",
        { cause },
      );
    }

    if (!response.ok) {
      throw await this.createHttpError(response);
    }

    const parsed = graphQLResponseSchema.safeParse(
      await response.json().catch(() => null),
    );
    if (!parsed.success) {
      throw new MalformedCodeNavigationResponseError(
        "Malformed response from code navigation service.",
      );
    }

    if (parsed.data.errors && parsed.data.errors.length > 0) {
      throw this.createGraphQLError(parsed.data.errors);
    }

    const data = parsed.data.data?.searchSymbols;
    if (!data) {
      // `data: null` or `data.searchSymbols: null` with no `errors` entry.
      // Rare — the backend normally couples null payloads with errors.
      throw new MalformedCodeNavigationResponseError(
        "Malformed response from code navigation service.",
      );
    }

    if (data.indexingStatus === "INDEXING") {
      throw new CodeNavigationIndexingError(
        this.createIndexingMessage(data.indexingRef ?? undefined),
        data.indexingRef ?? undefined,
        data.availableVersions?.map((entry) => ({
          version: entry.version ?? undefined,
          ref: entry.ref,
        })),
      );
    }

    if (data.indexingStatus === "UNRESOLVABLE") {
      throw new CodeNavigationUnresolvableError(
        "The requested target or version could not be resolved.",
      );
    }

    return {
      results: data.results.map((entry) => ({
        name: entry.name ?? undefined,
        filePath: entry.filePath ?? undefined,
        startLine: entry.startLine ?? undefined,
        endLine: entry.endLine ?? undefined,
        preview: entry.preview ?? undefined,
        code: entry.code ?? undefined,
        language: entry.language ?? undefined,
        symbolRef: entry.symbolRef ?? undefined,
        qualifiedPath: entry.qualifiedPath ?? undefined,
        kind: entry.kind ?? undefined,
        category: entry.category ?? undefined,
        arity: entry.arity ?? undefined,
        isPublic: entry.isPublic ?? undefined,
        containedSymbols: entry.containedSymbols ?? undefined,
      })),
      totalMatches: data.totalMatches,
      hasMore: data.hasMore,
      version: data.indexedVersion ?? undefined,
      resolution: data.resolution
        ? {
            requestedVersion: data.resolution.requestedVersion ?? undefined,
            requestedRef: data.resolution.requestedRef ?? undefined,
            resolvedRef: data.resolution.resolvedRef ?? undefined,
            commitSha: data.resolution.commitSha ?? undefined,
          }
        : undefined,
      hint: data.diagnostics?.hint ?? undefined,
      warning: data.warning ?? undefined,
    };
  }

  private baseUrl(): string {
    return this.codeNavigationUrl.replace(/\/+$/, "");
  }

  private async createHttpError(response: Response): Promise<Error> {
    const status = response.status;
    const body = await response.text().catch(() => "");
    const detail = parseDetail(body);

    if (status === 401) {
      return new AuthenticationError(
        "Authentication required. Run `githits login` to authenticate.",
      );
    }

    if (status === 403) {
      return new CodeNavigationAccessError(
        detail ?? "Code navigation access denied.",
      );
    }

    if (status >= 500) {
      return new CodeNavigationBackendError(
        detail
          ? `Server error (${status}): ${detail}`
          : `Server error (${status})`,
        status,
      );
    }

    return new CodeNavigationBackendError(
      detail ?? `Request failed with status ${status}`,
      status,
    );
  }

  private createGraphQLError(
    errors: Array<z.infer<typeof graphQLErrorSchema>>,
  ): Error {
    const message = errors.map((error) => error.message).join(", ");
    const extensions = getPrimaryExtensions(errors);
    const code =
      typeof extensions?.code === "string" ? extensions.code : undefined;
    const retryable =
      typeof extensions?.retryable === "boolean"
        ? extensions.retryable
        : undefined;
    const indexingRef = getGraphQLIndexingRef(errors);

    // Direct dispatch on extensions.code — the April 2026 backend
    // contract populates this on every error. Fall back to message
    // heuristics below for older backend builds that haven't
    // deployed yet (safe to remove once rollout completes).
    switch (code) {
      case "PACKAGE_INDEXING":
        return new CodeNavigationIndexingError(
          this.createIndexingMessage(indexingRef),
          indexingRef,
          parseAvailableVersions(extensions),
        );

      case "VERSION_NOT_FOUND":
        return new CodeNavigationVersionNotFoundError(
          message,
          typeof extensions?.package === "string"
            ? extensions.package
            : undefined,
          typeof extensions?.requested_version === "string"
            ? extensions.requested_version
            : undefined,
          typeof extensions?.latest_indexed === "string"
            ? extensions.latest_indexed
            : undefined,
          parseAvailableVersions(extensions),
        );

      case "NOT_FOUND":
      case "PACKAGE_NOT_FOUND":
      case "NO_REPOSITORY_URL":
        return new CodeNavigationTargetNotFoundError(message);

      case "UNSUPPORTED_REGISTRY":
      case "VALIDATION_ERROR":
        return new CodeNavigationValidationError(message);

      case "FEATURE_FLAG_REQUIRED":
        return new CodeNavigationFeatureFlagRequiredError(message);

      case "UNAUTHORIZED":
        return new AuthenticationError(
          "Authentication required. Run `githits login` to authenticate.",
        );

      case "FORBIDDEN":
        return new CodeNavigationAccessError(
          "Code navigation access denied. This feature may not be enabled for your account.",
        );

      case "UPSTREAM_ERROR":
      case "TIMEOUT":
      case "RATE_LIMITED":
      case "INTERNAL_ERROR":
      case "UNKNOWN_ERROR":
        return new CodeNavigationBackendError(
          message,
          undefined,
          code,
          retryable,
        );

      // `code` was present but not one of the recognised values —
      // forward it onward as BACKEND_ERROR, preserving the code so
      // the classifier can still surface it to callers.
      default:
        break;
    }

    // Legacy fallback: backend didn't populate `extensions.code`.
    // Retain the message-text heuristics so rollover works smoothly;
    // remove once all backend deploys are confirmed.
    if (code === undefined) {
      if (isAuthMessage(message)) {
        return new CodeNavigationAccessError(
          "Code navigation access denied. This feature may not be enabled for your account.",
        );
      }
      if (isUnresolvableMessage(message)) {
        return new CodeNavigationUnresolvableError(message);
      }
      if (isTargetNotFoundMessage(message)) {
        return new CodeNavigationTargetNotFoundError(message);
      }
    }

    return new CodeNavigationBackendError(message, undefined, code, retryable);
  }

  private createIndexingMessage(indexingRef?: string): string {
    // Backend p50 indexing time ~11 s, mean ~17 s, backend ceiling 60
    // s. Give callers both a concrete "retry shortly" expectation and
    // the option to block until ready via a longer wait timeout.
    const base =
      "Target is still indexing. Indexing usually completes within 30 seconds. Retry this request, or pass a longer wait timeout (CLI: `--wait 60`, MCP: `wait_timeout_ms: 60000`) to block until ready.";
    if (indexingRef) {
      return `${base} Indexing reference: ${indexingRef}.`;
    }
    return base;
  }
}

function parseDetail(body: string): string | undefined {
  if (!body) return undefined;

  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    if (typeof parsed.detail === "string") return parsed.detail;
    if (typeof parsed.error === "string") return parsed.error;
  } catch {
    return body;
  }

  return undefined;
}

/**
 * Pick the first GraphQL error entry that carries an `extensions`
 * block. Backends typically emit a single error per failure; when
 * multiple are present the primary one wins. Separate from the
 * joined message string so callers can reach structured fields
 * (package, latest_indexed, available_versions, retryable).
 */
function getPrimaryExtensions(
  errors: Array<z.infer<typeof graphQLErrorSchema>>,
): Record<string, unknown> | undefined {
  for (const error of errors) {
    if (error.extensions && Object.keys(error.extensions).length > 0) {
      return error.extensions;
    }
  }
  return undefined;
}

function getGraphQLIndexingRef(
  errors: Array<z.infer<typeof graphQLErrorSchema>>,
): string | undefined {
  for (const error of errors) {
    const indexingRef =
      error.extensions?.indexing_ref ?? error.extensions?.indexingRef;
    if (typeof indexingRef === "string") return indexingRef;
  }

  return undefined;
}

/**
 * Parse `extensions.available_versions` (snake_case on the wire) into
 * the internal `AvailableVersion` shape. Silently drops malformed
 * entries so a partially-broken extensions block does not prevent
 * the user from seeing whatever good suggestions are available.
 */
function parseAvailableVersions(
  extensions: Record<string, unknown> | undefined,
): AvailableVersion[] | undefined {
  const raw = extensions?.available_versions ?? extensions?.availableVersions;
  if (!Array.isArray(raw)) return undefined;
  const parsed: AvailableVersion[] = [];
  for (const item of raw) {
    if (item && typeof item === "object" && "ref" in item) {
      const entry = item as { ref?: unknown; version?: unknown };
      if (typeof entry.ref === "string") {
        parsed.push({
          ref: entry.ref,
          version:
            typeof entry.version === "string" ? entry.version : undefined,
        });
      }
    }
  }
  return parsed.length > 0 ? parsed : undefined;
}

function isAuthMessage(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("unauthorized") ||
    lower.includes("forbidden") ||
    lower.includes("permission") ||
    lower.includes("authentication")
  );
}

/**
 * Heuristic fallback for NOT_FOUND detection when the backend does not
 * populate `extensions.code` on GraphQL errors. See backend request B8
 * — once backend adds structured codes, this heuristic becomes a
 * secondary fallback rather than the primary signal.
 *
 * Scope deliberately narrow: "not found" / "unknown package" are
 * lookup-failure signals. Phrases like "could not resolve" are avoided
 * here because they also appear in `UNRESOLVABLE` messages, which
 * have different semantics for the caller (version/ref resolution
 * failure rather than the target not existing).
 */
function isTargetNotFoundMessage(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("not found") ||
    lower.includes("unknown package") ||
    lower.includes("no such package") ||
    lower.includes("does not exist")
  );
}

/**
 * Heuristic for UNRESOLVABLE — used when the backend returns a
 * version/ref resolution failure (e.g. "Could not resolve version
 * X to a Git ref") without populating `extensions.code`. Semantically
 * distinct from NOT_FOUND: the target is known, but the requested
 * version/ref cannot be mapped to indexable source.
 */
function isUnresolvableMessage(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("could not resolve") || lower.includes("cannot resolve")
  );
}
