import { z } from "zod";
import {
  type PkgseerGraphqlResponse,
  PkgseerTransportError,
  postPkgseerGraphql,
} from "../shared/pkgseer-graphql.js";
import type { PkgseerRegistry } from "../shared/pkgseer-registry.js";
import type { ClientHeaderBuilder } from "../shared/request-headers.js";
import { executeWithTokenRefresh } from "./execute-with-token-refresh.js";
import { AuthenticationError } from "./githits-service.js";
import {
  createPackageIntelligenceGraphQLError,
  createPackageIntelligenceHttpError,
  createPackageIntelligenceTransportError,
  MalformedPackageIntelligenceResponseError,
} from "./package-intelligence-service.js";
import {
  type ServiceDiagnostics,
  withServiceDiagnostics,
} from "./runtime-diagnostics.js";
import type { TokenProvider } from "./token-provider.js";

export type ResolveTargetKind = "PACKAGE" | "REPOSITORY" | "SITE";

export type KnownLatestVersionMaliciousStatus =
  | "NOT_APPLICABLE"
  | "CLEAR"
  | "AFFECTED"
  | "UNKNOWN";

/**
 * Backend-owned malicious-content decision for the displayed latest version.
 * Future values remain readable and are interpreted conservatively by clients.
 */
export type LatestVersionMaliciousStatus =
  | KnownLatestVersionMaliciousStatus
  | (string & {});

export type KnownMaliciousAdvisoryClassificationReason =
  | "AFFECTED_VERSION_RANGE_MATCH"
  | "MISSING_DISPLAYED_VERSION"
  | "INVALID_DISPLAYED_VERSION"
  | "MISSING_AFFECTED_RANGES"
  | "EMPTY_AFFECTED_RANGES"
  | "INVALID_AFFECTED_RANGE";

export type MaliciousAdvisoryClassificationReason =
  | KnownMaliciousAdvisoryClassificationReason
  | (string & {});

export interface ResolveTargetLatestVersionMaliciousAdvisory {
  osvId: string;
  classificationReasons: MaliciousAdvisoryClassificationReason[];
}

export interface ResolveTargetLatestVersionMaliciousEvidence {
  advisories: ResolveTargetLatestVersionMaliciousAdvisory[];
  totalCount: number;
  truncated: boolean;
}

export interface ResolveTargetParams {
  name: string;
  query?: string;
  registries?: PkgseerRegistry[];
  preferredKinds?: ResolveTargetKind[];
  intentHints?: string[];
  limit: number;
  includeDetailedFields: boolean;
  includeNameSimilarity: boolean;
}

export interface ResolveTargetReference {
  kind: string;
  canonicalKey: string;
  confidence: string;
}

export interface ResolveTargetMatch {
  confidence: string;
  nameSimilarity?: number;
  matchedAliases?: string[];
  matchTier?: number;
  score?: number;
}

export interface ResolveTargetTarget {
  kind: string;
  canonicalKey: string;
  displayName?: string;
  description?: string;
  registry?: string;
  packageName?: string;
  latestVersion?: string;
  latestVersionMaliciousStatus: LatestVersionMaliciousStatus;
  latestVersionMaliciousEvidence?: ResolveTargetLatestVersionMaliciousEvidence;
  repositoryUrl?: string;
  repositoryOwner?: string;
  repositoryName?: string;
  stars?: number;
  downloadsLastMonth?: number;
  downloadsTotal?: number;
  documentationUrl?: string;
  docsAvailable: boolean;
  codeAvailable: boolean;
  groupKey?: string;
  match?: ResolveTargetMatch;
  docsPageCount?: number;
  codeFileCount?: number;
  license?: string;
}

export interface ResolveTargetResult {
  best?: ResolveTargetReference;
  protectedMatches: ResolveTargetReference[];
  targets: ResolveTargetTarget[];
  targetsTruncated: boolean;
  ambiguous: boolean;
  ambiguousReason: string;
}

export interface ResolveTargetService {
  resolveTarget(params: ResolveTargetParams): Promise<ResolveTargetResult>;
}

const latestVersionMaliciousEvidenceSchema = z
  .object({
    advisories: z
      .array(
        z.object({
          osvId: z.string(),
          classificationReasons: z.array(z.string()),
        }),
      )
      .max(5),
    totalCount: z.number().int().nonnegative(),
    truncated: z.boolean(),
  })
  .nullable();

const compactMatchSchema = z.object({
  confidence: z.string(),
});

const candidateEvidenceSchema = z.object({
  canonicalKey: z.string(),
  nameSimilarity: z.number().nullable(),
});

const detailedMatchSchema = compactMatchSchema.extend({
  matchedAliases: z.array(z.string()),
  matchTier: z.number().int(),
  score: z.number(),
});

const listTargetSchema = z.object({
  kind: z.string(),
  canonicalKey: z.string(),
  latestVersionMaliciousStatus: z.string(),
  latestVersionMaliciousEvidence: latestVersionMaliciousEvidenceSchema,
  description: z.string().nullable().optional(),
  repositoryUrl: z.string().nullable().optional(),
  stars: z.number().int().nullable().optional(),
  downloadsLastMonth: z.number().int().nullable().optional(),
  downloadsTotal: z.number().int().nullable().optional(),
  docsAvailable: z.boolean(),
  codeAvailable: z.boolean(),
  groupKey: z.string().nullable(),
  match: compactMatchSchema.nullable(),
  docsPageCount: z.number().int().nullable(),
  codeFileCount: z.number().int().nullable(),
  license: z.string().nullable(),
});

const targetReferenceSchema = z.object({
  kind: z.string(),
  canonicalKey: z.string(),
  confidence: z.string(),
});

const detailedTargetSchema = listTargetSchema.omit({ match: true }).extend({
  match: detailedMatchSchema.nullable(),
  displayName: z.string(),
  registry: z.string().nullable().optional(),
  packageName: z.string().nullable().optional(),
  latestVersion: z.string().nullable().optional(),
  repositoryOwner: z.string().nullable().optional(),
  repositoryName: z.string().nullable().optional(),
  documentationUrl: z.string().nullable().optional(),
});

const graphQLErrorSchema = z.object({
  message: z.string(),
  extensions: z.record(z.string(), z.unknown()).optional(),
});

function responseSchema<Target extends z.ZodType>(
  targetSchema: Target,
  includeNameSimilarity: boolean,
) {
  const resultSchema = z.object({
    best: targetReferenceSchema.nullable(),
    protectedMatches: z.array(targetReferenceSchema),
    candidates: includeNameSimilarity
      ? z.array(candidateEvidenceSchema)
      : z.array(candidateEvidenceSchema).optional(),
    targets: z.array(targetSchema),
    targetsTruncated: z.boolean(),
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
  $includeNameSimilarity: Boolean!
) {
  resolveTarget(
    name: $name
    query: $query
    registries: $registries
    preferredKinds: $preferredKinds
    intentHints: $intentHints
    limit: $limit
  ) {
    best {
      ...ResolveTargetReferenceFields
    }
    protectedMatches {
      ...ResolveTargetReferenceFields
    }
    candidates @include(if: $includeNameSimilarity) {
      canonicalKey
      nameSimilarity
    }
    targetsTruncated
    targets {
      ...ResolveTargetListFields
      ...ResolveTargetJsonFields @include(if: $includeDetailedFields)
      match {
        confidence
        ...ResolveTargetMatchJsonFields @include(if: $includeDetailedFields)
      }
    }
    ambiguous
    ambiguousReason
  }
}

fragment ResolveTargetReferenceFields on TargetResolutionCandidate {
  kind
  canonicalKey
  confidence
}

fragment ResolveTargetListFields on TargetResolutionTarget {
  kind
  canonicalKey
  latestVersionMaliciousStatus
  latestVersionMaliciousEvidence {
    advisories {
      osvId
      classificationReasons
    }
    totalCount
    truncated
  }
  description
  repositoryUrl
  stars
  downloadsLastMonth
  downloadsTotal
  docsAvailable
  codeAvailable
  groupKey
  docsPageCount
  codeFileCount
  license
}

fragment ResolveTargetJsonFields on TargetResolutionTarget {
  displayName
  registry
  packageName
  latestVersion
  repositoryOwner
  repositoryName
  documentationUrl
}

fragment ResolveTargetMatchJsonFields on TargetResolutionMatch {
  matchedAliases
  matchTier
  score
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
      diagnostics?: ServiceDiagnostics;
    } = {},
  ) {}

  async resolveTarget(
    params: ResolveTargetParams,
  ): Promise<ResolveTargetResult> {
    return withServiceDiagnostics(
      this.runtime.diagnostics,
      "resolve-target.request",
      () =>
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
        diagnostics: this.runtime.diagnostics,
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

    const parsed = (
      params.includeDetailedFields
        ? responseSchema(detailedTargetSchema, params.includeNameSimilarity)
        : responseSchema(listTargetSchema, params.includeNameSimilarity)
    ).safeParse(response.parsedBody);
    if (!parsed.success) {
      throw new MalformedPackageIntelligenceResponseError(
        "Malformed response from the target-resolution service.",
      );
    }

    if (parsed.data.errors && parsed.data.errors.length > 0) {
      throw createPackageIntelligenceGraphQLError(
        parsed.data.errors,
        this.runtime.clientVersion,
        this.runtime.diagnostics,
      );
    }

    const result = parsed.data.data?.resolveTarget;
    if (!result) {
      throw new MalformedPackageIntelligenceResponseError(
        "Empty response from the target-resolution service.",
      );
    }

    const nameSimilarityByCanonicalKey = new Map(
      (result.candidates ?? []).map((candidate) => [
        candidate.canonicalKey,
        candidate.nameSimilarity,
      ]),
    );
    return {
      best: result.best ? normaliseReference(result.best) : undefined,
      protectedMatches: result.protectedMatches.map(normaliseReference),
      targets: result.targets.map((target) =>
        normaliseTarget(
          target,
          nameSimilarityByCanonicalKey.get(target.canonicalKey),
        ),
      ),
      targetsTruncated: result.targetsTruncated,
      ambiguous: result.ambiguous,
      ambiguousReason: result.ambiguousReason,
    };
  }
}

function normaliseReference(
  target: z.infer<typeof targetReferenceSchema>,
): ResolveTargetReference {
  return {
    kind: target.kind,
    canonicalKey: target.canonicalKey,
    confidence: target.confidence,
  };
}

function buildVariables(params: ResolveTargetParams): Record<string, unknown> {
  const variables: Record<string, unknown> = {
    name: params.name,
    limit: params.limit,
    includeDetailedFields: params.includeDetailedFields,
    includeNameSimilarity: params.includeNameSimilarity,
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

function normaliseTarget(
  target:
    | z.infer<typeof listTargetSchema>
    | z.infer<typeof detailedTargetSchema>,
  nameSimilarity: number | null | undefined,
): ResolveTargetTarget {
  const result: ResolveTargetTarget = {
    kind: target.kind,
    canonicalKey: target.canonicalKey,
    latestVersionMaliciousStatus: target.latestVersionMaliciousStatus,
    docsAvailable: target.docsAvailable,
    codeAvailable: target.codeAvailable,
  };

  assignDefined(result, "description", target.description);
  assignDefined(
    result,
    "latestVersionMaliciousEvidence",
    target.latestVersionMaliciousEvidence,
  );
  assignDefined(result, "repositoryUrl", target.repositoryUrl);
  assignDefined(result, "stars", target.stars);
  assignDefined(result, "downloadsLastMonth", target.downloadsLastMonth);
  assignDefined(result, "downloadsTotal", target.downloadsTotal);
  assignDefined(result, "groupKey", target.groupKey);
  assignDefined(result, "docsPageCount", target.docsPageCount);
  assignDefined(result, "codeFileCount", target.codeFileCount);
  assignDefined(result, "license", target.license);
  if (target.match) {
    const match: ResolveTargetMatch = { confidence: target.match.confidence };
    assignDefined(match, "nameSimilarity", nameSimilarity);
    if ("matchedAliases" in target.match) {
      assignDefined(match, "matchedAliases", target.match.matchedAliases);
      assignDefined(match, "matchTier", target.match.matchTier);
      assignDefined(match, "score", target.match.score);
    }
    result.match = match;
  }
  if ("displayName" in target) {
    assignDefined(result, "displayName", target.displayName);
    assignDefined(result, "registry", target.registry);
    assignDefined(result, "packageName", target.packageName);
    assignDefined(result, "latestVersion", target.latestVersion);
    assignDefined(result, "repositoryOwner", target.repositoryOwner);
    assignDefined(result, "repositoryName", target.repositoryName);
    assignDefined(result, "documentationUrl", target.documentationUrl);
  }
  return result;
}

function assignDefined<Target extends object, Key extends keyof Target>(
  target: Target,
  key: Key,
  value: Target[Key] | null | undefined,
): void {
  if (value !== null && value !== undefined) target[key] = value;
}
