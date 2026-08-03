import { z } from "zod";
import {
  type PkgseerGraphqlResponse,
  PkgseerTransportError,
  postPkgseerGraphql,
} from "../shared/pkgseer-graphql.js";
import type { PkgseerRegistry } from "../shared/pkgseer-registry.js";
import type { ClientHeaderBuilder } from "../shared/request-headers.js";
import { withTelemetrySpan } from "../shared/telemetry.js";
import { executeWithTokenRefresh } from "./execute-with-token-refresh.js";
import { AuthenticationError } from "./githits-service.js";
import {
  createPackageIntelligenceGraphQLError,
  createPackageIntelligenceHttpError,
  createPackageIntelligenceTransportError,
  MalformedPackageIntelligenceResponseError,
} from "./package-intelligence-service.js";
import type { TokenProvider } from "./token-provider.js";

export type ResolveTargetKind = "PACKAGE" | "REPOSITORY";

export interface ResolveTargetParams {
  name: string;
  query?: string;
  registries?: PkgseerRegistry[];
  preferredKinds?: ResolveTargetKind[];
  intentHints?: string[];
  limit: number;
  includeDetailedFields: boolean;
}

export interface ResolveTargetCandidate {
  kind: string;
  canonicalKey: string;
  displayName: string;
  description?: string;
  registry?: string;
  packageName?: string;
  latestVersion?: string;
  repositoryUrl?: string;
  repositoryOwner?: string;
  repositoryName?: string;
  stars?: number;
  downloadsLastMonth?: number;
  downloadsTotal?: number;
  documentationUrl?: string;
  matchedAliases?: string[];
  docsAvailable: boolean;
  codeAvailable: boolean;
  protected: boolean;
  matchTier?: number;
  score?: number;
  confidence: string;
  reason?: string;
}

export interface ResolveTargetResult {
  best?: ResolveTargetCandidate;
  protectedMatches: ResolveTargetCandidate[];
  candidates: ResolveTargetCandidate[];
  ambiguous: boolean;
  ambiguousReason: string;
}

export interface ResolveTargetService {
  resolveTarget(params: ResolveTargetParams): Promise<ResolveTargetResult>;
}

const compactCandidateSchema = z.object({
  kind: z.string(),
  canonicalKey: z.string(),
  displayName: z.string(),
  description: z.string().nullable().optional(),
  registry: z.string().nullable().optional(),
  stars: z.number().int().nullable().optional(),
  downloadsLastMonth: z.number().int().nullable().optional(),
  docsAvailable: z.boolean(),
  codeAvailable: z.boolean(),
  protected: z.boolean(),
  confidence: z.string(),
});

const detailedCandidateSchema = compactCandidateSchema.extend({
  packageName: z.string().nullable().optional(),
  latestVersion: z.string().nullable().optional(),
  repositoryUrl: z.string().nullable().optional(),
  repositoryOwner: z.string().nullable().optional(),
  repositoryName: z.string().nullable().optional(),
  downloadsTotal: z.number().int().nullable().optional(),
  documentationUrl: z.string().nullable().optional(),
  matchedAliases: z.array(z.string()),
  matchTier: z.number().int(),
  score: z.number(),
  reason: z.string().nullable().optional(),
});

const graphQLErrorSchema = z.object({
  message: z.string(),
  extensions: z.record(z.string(), z.unknown()).optional(),
});

function responseSchema<Candidate extends z.ZodType>(
  candidateSchema: Candidate,
) {
  const resultSchema = z.object({
    best: candidateSchema.nullable(),
    protectedMatches: z.array(candidateSchema),
    candidates: z.array(candidateSchema),
    ambiguous: z.boolean(),
    ambiguousReason: z.string(),
  });

  return z.object({
    data: z
      .object({ resolveTarget: resultSchema.nullable() })
      .nullable()
      .optional(),
    errors: z.array(graphQLErrorSchema).optional(),
  });
}

export const RESOLVE_TARGET_QUERY = `
query ResolveTarget(
  $name: String!
  $query: String
  $registries: [Registry!]
  $preferredKinds: [TargetResolutionKind!]
  $intentHints: [String!]
  $limit: Int!
  $includeDetailedFields: Boolean!
) {
  resolveTarget(
    name: $name
    query: $query
    registries: $registries
    preferredKinds: $preferredKinds
    intentHints: $intentHints
    limit: $limit
  ) {
    best { ...ResolveTargetCandidateFields }
    protectedMatches { ...ResolveTargetCandidateFields }
    candidates { ...ResolveTargetCandidateFields }
    ambiguous
    ambiguousReason
  }
}

fragment ResolveTargetCandidateFields on TargetResolutionCandidate {
  kind
  canonicalKey
  displayName
  description
  registry
  stars
  downloadsLastMonth
  docsAvailable
  codeAvailable
  protected
  confidence
  packageName @include(if: $includeDetailedFields)
  latestVersion @include(if: $includeDetailedFields)
  repositoryUrl @include(if: $includeDetailedFields)
  repositoryOwner @include(if: $includeDetailedFields)
  repositoryName @include(if: $includeDetailedFields)
  downloadsTotal @include(if: $includeDetailedFields)
  documentationUrl @include(if: $includeDetailedFields)
  matchedAliases @include(if: $includeDetailedFields)
  matchTier @include(if: $includeDetailedFields)
  score @include(if: $includeDetailedFields)
  reason @include(if: $includeDetailedFields)
}`;

export class ResolveTargetServiceImpl implements ResolveTargetService {
  constructor(
    private readonly endpointUrl: string,
    private readonly tokenProvider: TokenProvider,
    private readonly fetchFn: typeof fetch = globalThis.fetch,
    private readonly runtime: {
      clientHeaders?: ClientHeaderBuilder;
      userAgent?: string;
      clientVersion?: string;
    } = {},
  ) {}

  async resolveTarget(
    params: ResolveTargetParams,
  ): Promise<ResolveTargetResult> {
    return withTelemetrySpan("resolve-target.request", () =>
      executeWithTokenRefresh({
        getToken: () => this.tokenProvider.getToken(),
        forceRefresh: () => this.tokenProvider.forceRefresh(),
        shouldRefresh: (error) => error instanceof AuthenticationError,
        executeWithToken: (token) => this.executeResolveTarget(token, params),
      }),
    );
  }

  private async executeResolveTarget(
    token: string,
    params: ResolveTargetParams,
  ): Promise<ResolveTargetResult> {
    let response: PkgseerGraphqlResponse;
    try {
      response = await postPkgseerGraphql({
        endpointUrl: this.endpointUrl,
        token,
        query: RESOLVE_TARGET_QUERY,
        variables: buildVariables(params),
        fetchFn: this.fetchFn,
        clientHeaders: this.runtime.clientHeaders,
        userAgent: this.runtime.userAgent,
      });
    } catch (cause) {
      if (cause instanceof PkgseerTransportError) {
        throw createPackageIntelligenceTransportError(cause);
      }
      throw cause;
    }

    if (response.status < 200 || response.status >= 300) {
      throw createPackageIntelligenceHttpError(response);
    }

    const candidateSchema = params.includeDetailedFields
      ? detailedCandidateSchema
      : compactCandidateSchema;
    const parsed = responseSchema(candidateSchema).safeParse(
      response.parsedBody,
    );
    if (!parsed.success) {
      throw new MalformedPackageIntelligenceResponseError(
        "Malformed response from the target-resolution service.",
      );
    }

    if (parsed.data.errors && parsed.data.errors.length > 0) {
      throw createPackageIntelligenceGraphQLError(
        parsed.data.errors,
        this.runtime.clientVersion,
      );
    }

    const result = parsed.data.data?.resolveTarget;
    if (!result) {
      throw new MalformedPackageIntelligenceResponseError(
        "Empty response from the target-resolution service.",
      );
    }

    return {
      best: result.best ? normaliseCandidate(result.best) : undefined,
      protectedMatches: result.protectedMatches.map(normaliseCandidate),
      candidates: result.candidates.map(normaliseCandidate),
      ambiguous: result.ambiguous,
      ambiguousReason: result.ambiguousReason,
    };
  }
}

function buildVariables(params: ResolveTargetParams): Record<string, unknown> {
  const variables: Record<string, unknown> = {
    name: params.name,
    limit: params.limit,
    includeDetailedFields: params.includeDetailedFields,
  };
  if (params.query !== undefined) variables.query = params.query;
  if (params.registries !== undefined) variables.registries = params.registries;
  if (params.preferredKinds !== undefined) {
    variables.preferredKinds = params.preferredKinds;
  }
  if (params.intentHints !== undefined)
    variables.intentHints = params.intentHints;
  return variables;
}

function normaliseCandidate(
  candidate:
    | z.infer<typeof compactCandidateSchema>
    | z.infer<typeof detailedCandidateSchema>,
): ResolveTargetCandidate {
  const result: ResolveTargetCandidate = {
    kind: candidate.kind,
    canonicalKey: candidate.canonicalKey,
    displayName: candidate.displayName,
    docsAvailable: candidate.docsAvailable,
    codeAvailable: candidate.codeAvailable,
    protected: candidate.protected,
    confidence: candidate.confidence,
  };

  assignDefined(result, "description", candidate.description);
  assignDefined(result, "registry", candidate.registry);
  assignDefined(result, "stars", candidate.stars);
  assignDefined(result, "downloadsLastMonth", candidate.downloadsLastMonth);
  if ("matchedAliases" in candidate) {
    assignDefined(result, "packageName", candidate.packageName);
    assignDefined(result, "latestVersion", candidate.latestVersion);
    assignDefined(result, "repositoryUrl", candidate.repositoryUrl);
    assignDefined(result, "repositoryOwner", candidate.repositoryOwner);
    assignDefined(result, "repositoryName", candidate.repositoryName);
    assignDefined(result, "downloadsTotal", candidate.downloadsTotal);
    assignDefined(result, "documentationUrl", candidate.documentationUrl);
    assignDefined(result, "matchedAliases", candidate.matchedAliases);
    assignDefined(result, "matchTier", candidate.matchTier);
    assignDefined(result, "score", candidate.score);
    assignDefined(result, "reason", candidate.reason);
  }
  return result;
}

function assignDefined<Key extends keyof ResolveTargetCandidate>(
  target: ResolveTargetCandidate,
  key: Key,
  value: ResolveTargetCandidate[Key] | null | undefined,
): void {
  if (value !== null && value !== undefined) target[key] = value;
}
