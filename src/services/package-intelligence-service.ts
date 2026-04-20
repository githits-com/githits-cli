/**
 * Package intelligence service — reads registry metadata, dependency
 * reports, vulnerability overviews, and changelogs from the pkgseer
 * GraphQL endpoint.
 *
 * Wire-level plumbing (URL, headers, POST, transport-error wrapping)
 * lives in `src/shared/pkgseer-graphql.ts`. This service owns:
 * - Domain error classes (`PackageIntelligence*Error`).
 * - GraphQL-error classification on structured responses.
 * - Zod schema validation for the `PackageSummary` response shape.
 * - Outer `executeWithTokenRefresh` wrapper so GraphQL-level
 *   `UNAUTHORIZED` errors — classified after the POST — continue to
 *   trigger token refresh.
 */

import { z } from "zod";
import {
  type PkgseerGraphqlResponse,
  PkgseerTransportError,
  postPkgseerGraphql,
} from "../shared/pkgseer-graphql.js";
import type { PkgseerRegistry } from "../shared/pkgseer-registry.js";
import { executeWithTokenRefresh } from "./execute-with-token-refresh.js";
import { AuthenticationError } from "./githits-service.js";
import type { TokenProvider } from "./token-manager.js";

export interface PackageSummaryParams {
  registry: PkgseerRegistry;
  packageName: string;
}

export interface PackageIdentity {
  name: string;
  registry?: string;
  description?: string;
  latestVersion: string;
  latestVersionPublishedAt?: string;
  homepage?: string;
  repositoryUrl?: string;
  license?: string;
  downloadsLastMonth?: number;
  downloadsTotal?: number;
  githubRepository?: GithubRepository;
}

export interface GithubRepository {
  stargazersCount?: number;
  forksCount?: number;
  openIssuesCount?: number;
  archived?: boolean;
  language?: string;
  topics?: string[];
  pushedAt?: string;
}

export interface VulnerabilityOverview {
  osvId?: string;
  summary?: string;
  severityScore?: number;
  publishedAt?: string;
}

export interface PackageSecurityOverview {
  vulnerabilityCount?: number;
  hasCurrentVulnerabilities?: boolean;
  recentVulnerabilities?: VulnerabilityOverview[];
}

export interface QuickstartInfo {
  installCommand?: string;
  usageExample?: string;
}

export interface ChangelogEntry {
  version?: string;
  publishedAt?: string;
  body?: string;
}

export interface PackageSummary {
  package: PackageIdentity;
  security?: PackageSecurityOverview;
  quickstart?: QuickstartInfo;
  latestChangelogs?: ChangelogEntry[];
}

export interface PackageIntelligenceService {
  packageSummary(params: PackageSummaryParams): Promise<PackageSummary>;
}

// --------------------------------------------------------------------
// Error classes
// --------------------------------------------------------------------

export class PackageIntelligenceAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PackageIntelligenceAccessError";
  }
}

export class PackageIntelligenceFeatureFlagRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PackageIntelligenceFeatureFlagRequiredError";
  }
}

export class PackageIntelligenceNetworkError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "PackageIntelligenceNetworkError";
  }
}

export class PackageIntelligenceBackendError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly graphqlCode?: string,
    public readonly retryable?: boolean,
  ) {
    super(message);
    this.name = "PackageIntelligenceBackendError";
  }
}

/**
 * Legacy fallback for GraphQL errors without a recognised
 * `extensions.code`. New backend builds should hit
 * `PackageIntelligenceBackendError` via `createGraphQLError`; this
 * exists for rollover-window compatibility.
 */
export class PackageIntelligenceGraphQLError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "PackageIntelligenceGraphQLError";
  }
}

export class PackageIntelligenceTargetNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PackageIntelligenceTargetNotFoundError";
  }
}

export class PackageIntelligenceValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PackageIntelligenceValidationError";
  }
}

export class MalformedPackageIntelligenceResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MalformedPackageIntelligenceResponseError";
  }
}

// --------------------------------------------------------------------
// Zod schema for the packageSummary response shape
// --------------------------------------------------------------------

const githubRepositorySchema = z
  .object({
    stargazersCount: z.number().int().nullable().optional(),
    forksCount: z.number().int().nullable().optional(),
    openIssuesCount: z.number().int().nullable().optional(),
    archived: z.boolean().nullable().optional(),
    language: z.string().nullable().optional(),
    topics: z.array(z.string()).nullable().optional(),
    pushedAt: z.string().nullable().optional(),
  })
  .nullable()
  .optional();

const packageIdentitySchema = z.object({
  name: z.string().nullable().optional(),
  registry: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  latestVersion: z.string().nullable().optional(),
  latestVersionPublishedAt: z.string().nullable().optional(),
  homepage: z.string().nullable().optional(),
  repositoryUrl: z.string().nullable().optional(),
  license: z.string().nullable().optional(),
  downloadsLastMonth: z.number().int().nullable().optional(),
  downloadsTotal: z.number().int().nullable().optional(),
  githubRepository: githubRepositorySchema,
});

const vulnerabilityOverviewSchema = z.object({
  osvId: z.string().nullable().optional(),
  summary: z.string().nullable().optional(),
  severityScore: z.number().nullable().optional(),
  publishedAt: z.string().nullable().optional(),
});

const packageSecurityOverviewSchema = z
  .object({
    vulnerabilityCount: z.number().int().nullable().optional(),
    hasCurrentVulnerabilities: z.boolean().nullable().optional(),
    recentVulnerabilities: z
      .array(vulnerabilityOverviewSchema)
      .nullable()
      .optional(),
  })
  .nullable()
  .optional();

const quickstartInfoSchema = z
  .object({
    installCommand: z.string().nullable().optional(),
    usageExample: z.string().nullable().optional(),
  })
  .nullable()
  .optional();

const changelogEntrySchema = z.object({
  version: z.string().nullable().optional(),
  publishedAt: z.string().nullable().optional(),
  body: z.string().nullable().optional(),
});

const packageSummaryResponseSchema = z.object({
  package: packageIdentitySchema.nullable().optional(),
  security: packageSecurityOverviewSchema,
  quickstart: quickstartInfoSchema,
  latestChangelogs: z.array(changelogEntrySchema).nullable().optional(),
});

const graphQLErrorSchema = z.object({
  message: z.string(),
  extensions: z.record(z.string(), z.unknown()).optional(),
});

const graphQLResponseSchema = z.object({
  data: z
    .object({
      packageSummary: packageSummaryResponseSchema.nullable().optional(),
    })
    .nullable()
    .optional(),
  errors: z.array(graphQLErrorSchema).optional(),
});

const PACKAGE_SUMMARY_QUERY = `
query PackageSummary($registry: Registry!, $name: String!) {
  packageSummary(registry: $registry, name: $name) {
    package {
      name
      registry
      description
      latestVersion
      latestVersionPublishedAt
      homepage
      repositoryUrl
      license
      downloadsLastMonth
      downloadsTotal
      githubRepository {
        stargazersCount
        forksCount
        openIssuesCount
        archived
        language
        topics
        pushedAt
      }
    }
    security {
      vulnerabilityCount
      hasCurrentVulnerabilities
      recentVulnerabilities {
        osvId
        summary
        severityScore
        publishedAt
      }
    }
    quickstart {
      installCommand
      usageExample
    }
    latestChangelogs(limit: 3) {
      version
      publishedAt
      body
    }
  }
}`;

// --------------------------------------------------------------------
// Service implementation
// --------------------------------------------------------------------

export class PackageIntelligenceServiceImpl
  implements PackageIntelligenceService
{
  constructor(
    private readonly endpointUrl: string,
    private readonly tokenProvider: TokenProvider,
    private readonly fetchFn: typeof fetch = globalThis.fetch,
  ) {}

  async packageSummary(params: PackageSummaryParams): Promise<PackageSummary> {
    return executeWithTokenRefresh({
      getToken: () => this.tokenProvider.getToken(),
      forceRefresh: () => this.tokenProvider.forceRefresh(),
      shouldRefresh: (error) => error instanceof AuthenticationError,
      executeWithToken: (token) => this.executePackageSummary(token, params),
    });
  }

  private async executePackageSummary(
    token: string,
    params: PackageSummaryParams,
  ): Promise<PackageSummary> {
    let response: PkgseerGraphqlResponse;
    try {
      response = await postPkgseerGraphql({
        endpointUrl: this.endpointUrl,
        token,
        query: PACKAGE_SUMMARY_QUERY,
        variables: {
          registry: params.registry,
          name: params.packageName,
        },
        fetchFn: this.fetchFn,
      });
    } catch (cause) {
      if (cause instanceof PkgseerTransportError) {
        throw new PackageIntelligenceNetworkError(
          "Could not reach the package intelligence service. Check your connection or set GITHITS_CODE_NAV_URL.",
          { cause },
        );
      }
      throw cause;
    }

    if (response.status < 200 || response.status >= 300) {
      throw this.createHttpError(response);
    }

    const parsed = graphQLResponseSchema.safeParse(response.parsedBody);
    if (!parsed.success) {
      throw new MalformedPackageIntelligenceResponseError(
        "Malformed response from the package-intelligence service.",
      );
    }

    if (parsed.data.errors && parsed.data.errors.length > 0) {
      throw this.createGraphQLError(parsed.data.errors);
    }

    const data = parsed.data.data?.packageSummary;
    if (!data) {
      throw new MalformedPackageIntelligenceResponseError(
        "Empty response from the package-intelligence service.",
      );
    }

    return this.normalise(data);
  }

  private createHttpError(response: PkgseerGraphqlResponse): Error {
    const status = response.status;
    const detail = parseDetail(response.responseBody);

    if (status === 401) {
      return new AuthenticationError(
        "Authentication required. Run `githits login` to authenticate.",
      );
    }

    if (status === 403) {
      return new PackageIntelligenceAccessError(detail ?? "Access denied.");
    }

    if (status >= 500) {
      return new PackageIntelligenceBackendError(
        detail
          ? `Server error (${status}): ${detail}`
          : `Server error (${status})`,
        status,
      );
    }

    return new PackageIntelligenceBackendError(
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

    switch (code) {
      case "NOT_FOUND":
      case "PACKAGE_NOT_FOUND":
        return new PackageIntelligenceTargetNotFoundError(message);

      case "UNSUPPORTED_REGISTRY":
      case "VALIDATION_ERROR":
        return new PackageIntelligenceValidationError(message);

      case "FEATURE_FLAG_REQUIRED":
        return new PackageIntelligenceFeatureFlagRequiredError(message);

      case "UNAUTHORIZED":
        return new AuthenticationError(
          "Authentication required. Run `githits login` to authenticate.",
        );

      case "FORBIDDEN":
        return new PackageIntelligenceAccessError(
          "Access denied. This feature may not be enabled for your account.",
        );

      case "UPSTREAM_ERROR":
      case "TIMEOUT":
      case "RATE_LIMITED":
      case "INTERNAL_ERROR":
      case "UNKNOWN_ERROR":
        return new PackageIntelligenceBackendError(
          message,
          undefined,
          code,
          retryable,
        );

      default:
        break;
    }

    return new PackageIntelligenceBackendError(
      message,
      undefined,
      code,
      retryable,
    );
  }

  private normalise(
    data: z.infer<typeof packageSummaryResponseSchema>,
  ): PackageSummary {
    const name = data.package?.name ?? undefined;
    const latestVersion = data.package?.latestVersion ?? undefined;
    if (!name || !latestVersion) {
      throw new MalformedPackageIntelligenceResponseError(
        "Package summary response missing required name/latestVersion.",
      );
    }

    const pkg = data.package;
    const github = pkg?.githubRepository;

    const identity: PackageIdentity = {
      name,
      latestVersion,
      registry: pkg?.registry ?? undefined,
      description: pkg?.description ?? undefined,
      latestVersionPublishedAt: pkg?.latestVersionPublishedAt ?? undefined,
      homepage: pkg?.homepage ?? undefined,
      repositoryUrl: pkg?.repositoryUrl ?? undefined,
      license: pkg?.license ?? undefined,
      downloadsLastMonth: pkg?.downloadsLastMonth ?? undefined,
      downloadsTotal: pkg?.downloadsTotal ?? undefined,
      githubRepository: github
        ? {
            stargazersCount: github.stargazersCount ?? undefined,
            forksCount: github.forksCount ?? undefined,
            openIssuesCount: github.openIssuesCount ?? undefined,
            archived: github.archived ?? undefined,
            language: github.language ?? undefined,
            topics: github.topics ?? undefined,
            pushedAt: github.pushedAt ?? undefined,
          }
        : undefined,
    };

    const security: PackageSecurityOverview | undefined = data.security
      ? {
          vulnerabilityCount: data.security.vulnerabilityCount ?? undefined,
          hasCurrentVulnerabilities:
            data.security.hasCurrentVulnerabilities ?? undefined,
          recentVulnerabilities:
            data.security.recentVulnerabilities?.map((vuln) => ({
              osvId: vuln.osvId ?? undefined,
              summary: vuln.summary ?? undefined,
              severityScore: vuln.severityScore ?? undefined,
              publishedAt: vuln.publishedAt ?? undefined,
            })) ?? undefined,
        }
      : undefined;

    const quickstart: QuickstartInfo | undefined = data.quickstart
      ? {
          installCommand: data.quickstart.installCommand ?? undefined,
          usageExample: data.quickstart.usageExample ?? undefined,
        }
      : undefined;

    const latestChangelogs: ChangelogEntry[] | undefined =
      data.latestChangelogs?.map((entry) => ({
        version: entry.version ?? undefined,
        publishedAt: entry.publishedAt ?? undefined,
        body: entry.body ?? undefined,
      })) ?? undefined;

    return {
      package: identity,
      security,
      quickstart,
      latestChangelogs,
    };
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
