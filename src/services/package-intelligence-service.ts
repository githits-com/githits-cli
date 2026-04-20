/**
 * Package intelligence service — reads registry metadata, vulnerability
 * reports, dependency reports, and changelogs from the upstream
 * GraphQL endpoint.
 *
 * Wire-level plumbing (URL, headers, POST, transport-error wrapping)
 * lives in `src/shared/pkgseer-graphql.ts`. This service owns:
 * - Domain error classes (`PackageIntelligence*Error`) including the
 *   typed `PackageIntelligenceVersionNotFoundError` for structured
 *   VERSION_NOT_FOUND responses.
 * - GraphQL-error classification on structured responses.
 * - Zod schemas for each query's response shape (packageSummary,
 *   packageVulnerabilities).
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

export interface PackageVulnerabilitiesParams {
  registry: PkgseerRegistry;
  packageName: string;
  /** Optional — backend defaults to latest when omitted. */
  version?: string;
  /** Optional CVSS float; backend filters advisories below this score. */
  minSeverity?: number;
  /** Optional — backend defaults to false when omitted. */
  includeWithdrawn?: boolean;
}

export interface PackageVersionIdentity {
  name: string;
  registry?: string;
  version: string;
}

export interface VulnerabilityDetail {
  osvId?: string;
  summary?: string;
  severityScore?: number;
  severityType?: string;
  affectedVersionRanges?: string[];
  fixedInVersions?: string[];
  publishedAt?: string;
  modifiedAt?: string;
  withdrawnAt?: string;
  aliases?: string[];
  isMalicious?: boolean;
}

export interface VulnerabilitySecurityDetails {
  vulnerabilityCount?: number;
  currentVersionAffected?: boolean;
  vulnerabilities?: VulnerabilityDetail[];
  upgradePaths?: string[];
}

export interface VulnerabilityReport {
  package: PackageVersionIdentity;
  security?: VulnerabilitySecurityDetails;
}

export interface PackageIntelligenceService {
  packageSummary(params: PackageSummaryParams): Promise<PackageSummary>;
  packageVulnerabilities(
    params: PackageVulnerabilitiesParams,
  ): Promise<VulnerabilityReport>;
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

/**
 * Raised when the caller asked for a version that the backend has no
 * record of. Mirrors the code-navigation precedent but narrower:
 * vulnerability data has no indexing lifecycle, so there is no
 * `latestIndexed` field. Backend may populate `availableVersions` in
 * `extensions` for "did you mean" hints — shape is `string[]` because
 * vulns registries expose plain version strings (no ref / commit
 * concept).
 */
export class PackageIntelligenceVersionNotFoundError extends Error {
  constructor(
    message: string,
    public readonly packageName: string | undefined,
    public readonly requestedVersion: string | undefined,
    public readonly availableVersions: string[] | undefined,
  ) {
    super(message);
    this.name = "PackageIntelligenceVersionNotFoundError";
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
// Zod schema + query for packageVulnerabilities
// --------------------------------------------------------------------

const packageVersionIdentitySchema = z.object({
  name: z.string().nullable().optional(),
  registry: z.string().nullable().optional(),
  version: z.string().nullable().optional(),
});

const vulnerabilityDetailSchema = z.object({
  osvId: z.string().nullable().optional(),
  summary: z.string().nullable().optional(),
  severityScore: z.number().nullable().optional(),
  severityType: z.string().nullable().optional(),
  affectedVersionRanges: z.array(z.string()).nullable().optional(),
  fixedInVersions: z.array(z.string()).nullable().optional(),
  publishedAt: z.string().nullable().optional(),
  modifiedAt: z.string().nullable().optional(),
  withdrawnAt: z.string().nullable().optional(),
  aliases: z.array(z.string()).nullable().optional(),
  isMalicious: z.boolean().nullable().optional(),
});

const vulnerabilitySecurityDetailsSchema = z
  .object({
    vulnerabilityCount: z.number().int().nullable().optional(),
    currentVersionAffected: z.boolean().nullable().optional(),
    vulnerabilities: z.array(vulnerabilityDetailSchema).nullable().optional(),
    upgradePaths: z.array(z.string()).nullable().optional(),
  })
  .nullable()
  .optional();

const vulnerabilityReportResponseSchema = z.object({
  package: packageVersionIdentitySchema.nullable().optional(),
  security: vulnerabilitySecurityDetailsSchema,
});

const vulnerabilitiesGraphQLResponseSchema = z.object({
  data: z
    .object({
      packageVulnerabilities: vulnerabilityReportResponseSchema
        .nullable()
        .optional(),
    })
    .nullable()
    .optional(),
  errors: z.array(graphQLErrorSchema).optional(),
});

const PACKAGE_VULNERABILITIES_QUERY = `
query PackageVulnerabilities(
  $registry: Registry!
  $name: String!
  $version: String
  $minSeverity: Float
  $includeWithdrawn: Boolean
) {
  packageVulnerabilities(
    registry: $registry
    name: $name
    version: $version
    minSeverity: $minSeverity
    includeWithdrawn: $includeWithdrawn
  ) {
    package {
      name
      registry
      version
    }
    security {
      vulnerabilityCount
      currentVersionAffected
      upgradePaths
      vulnerabilities {
        osvId
        summary
        severityScore
        severityType
        affectedVersionRanges
        fixedInVersions
        publishedAt
        modifiedAt
        withdrawnAt
        aliases
        isMalicious
      }
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

      case "VERSION_NOT_FOUND":
        return new PackageIntelligenceVersionNotFoundError(
          message,
          typeof extensions?.package === "string"
            ? extensions.package
            : undefined,
          typeof extensions?.requested_version === "string"
            ? extensions.requested_version
            : undefined,
          parseVersionList(
            extensions?.available_versions ?? extensions?.availableVersions,
          ),
        );

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

  async packageVulnerabilities(
    params: PackageVulnerabilitiesParams,
  ): Promise<VulnerabilityReport> {
    return executeWithTokenRefresh({
      getToken: () => this.tokenProvider.getToken(),
      forceRefresh: () => this.tokenProvider.forceRefresh(),
      shouldRefresh: (error) => error instanceof AuthenticationError,
      executeWithToken: (token) =>
        this.executePackageVulnerabilities(token, params),
    });
  }

  private async executePackageVulnerabilities(
    token: string,
    params: PackageVulnerabilitiesParams,
  ): Promise<VulnerabilityReport> {
    let response: PkgseerGraphqlResponse;
    try {
      response = await postPkgseerGraphql({
        endpointUrl: this.endpointUrl,
        token,
        query: PACKAGE_VULNERABILITIES_QUERY,
        variables: {
          registry: params.registry,
          name: params.packageName,
          version: params.version,
          minSeverity: params.minSeverity,
          includeWithdrawn: params.includeWithdrawn,
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

    const parsed = vulnerabilitiesGraphQLResponseSchema.safeParse(
      response.parsedBody,
    );
    if (!parsed.success) {
      throw new MalformedPackageIntelligenceResponseError(
        "Malformed response from the package-intelligence service.",
      );
    }

    if (parsed.data.errors && parsed.data.errors.length > 0) {
      throw promoteVersionNotFound(
        this.createGraphQLError(parsed.data.errors),
        params,
      );
    }

    const data = parsed.data.data?.packageVulnerabilities;
    if (!data) {
      throw new MalformedPackageIntelligenceResponseError(
        "Empty response from the package-intelligence service.",
      );
    }

    return this.normaliseVulnerabilityReport(data);
  }

  private normaliseVulnerabilityReport(
    data: z.infer<typeof vulnerabilityReportResponseSchema>,
  ): VulnerabilityReport {
    const name = data.package?.name ?? undefined;
    const version = data.package?.version ?? undefined;
    if (!name || !version) {
      throw new MalformedPackageIntelligenceResponseError(
        "Vulnerability report response missing required name/version.",
      );
    }

    const identity: PackageVersionIdentity = {
      name,
      version,
      registry: data.package?.registry ?? undefined,
    };

    const security: VulnerabilitySecurityDetails | undefined = data.security
      ? {
          vulnerabilityCount: data.security.vulnerabilityCount ?? undefined,
          currentVersionAffected:
            data.security.currentVersionAffected ?? undefined,
          vulnerabilities:
            data.security.vulnerabilities?.map((vuln) => ({
              osvId: vuln.osvId ?? undefined,
              summary: vuln.summary ?? undefined,
              severityScore: vuln.severityScore ?? undefined,
              severityType: vuln.severityType ?? undefined,
              affectedVersionRanges: vuln.affectedVersionRanges ?? undefined,
              fixedInVersions: vuln.fixedInVersions ?? undefined,
              publishedAt: vuln.publishedAt ?? undefined,
              modifiedAt: vuln.modifiedAt ?? undefined,
              withdrawnAt: vuln.withdrawnAt ?? undefined,
              aliases: vuln.aliases ?? undefined,
              isMalicious: vuln.isMalicious ?? undefined,
            })) ?? undefined,
          upgradePaths: data.security.upgradePaths ?? undefined,
        }
      : undefined;

    return {
      package: identity,
      security,
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

/**
 * Parse a possibly-present list of version strings from an `extensions`
 * value. Accepts a raw array of strings or returns undefined for
 * missing/malformed data. Narrower than the code-nav
 * `availableVersions` parser because vulnerability data has no ref
 * concept — plain version strings suffice.
 */
function parseVersionList(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const versions: string[] = [];
  for (const item of raw) {
    if (typeof item === "string" && item.length > 0) {
      versions.push(item);
    }
  }
  return versions.length > 0 ? versions : undefined;
}

/**
 * Fallback: if the backend returns a generic backend error whose
 * message matches the well-known "no matching version" phrase and the
 * caller explicitly requested a version, promote it to the typed
 * {@link PackageIntelligenceVersionNotFoundError} so downstream
 * surfaces can render structured, actionable error details.
 *
 * TODO(pkgseer-backend): remove this helper once the upstream
 * `packageVulnerabilities` resolver emits
 * `extensions.code = "VERSION_NOT_FOUND"` with `package`,
 * `requested_version`, and `available_versions`. The typed path in
 * `createGraphQLError` already handles that shape; deleting this
 * helper + its two fallback-specific service tests will be the only
 * cleanup needed, and the typed-error parity test will catch any
 * regression in the structured-details envelope.
 *
 * Guard rails:
 * - Only promotes when `graphqlCode` is absent. Any explicit code
 *   (including INTERNAL_ERROR, UPSTREAM_ERROR, TIMEOUT, …) is
 *   respected as-is so we never swallow real backend signalling or
 *   flip retryability.
 * - Only promotes when `params.version` is set — if the caller asked
 *   for "latest", a "no matching version" message can only reflect
 *   an unrelated upstream condition, not a caller-addressable one.
 * - `details.package` is qualified with the lowercase registry
 *   prefix (e.g. `"npm:lodash"`) so CLI / MCP output matches the
 *   shape produced when the backend sends the typed code.
 */
function promoteVersionNotFound(
  error: Error,
  params: PackageVulnerabilitiesParams,
): Error {
  if (!(error instanceof PackageIntelligenceBackendError)) return error;
  if (error.graphqlCode !== undefined) return error;
  if (!params.version) return error;
  if (!/no matching version/i.test(error.message)) return error;
  const qualifiedName = `${params.registry.toLowerCase()}:${params.packageName}`;
  return new PackageIntelligenceVersionNotFoundError(
    error.message,
    qualifiedName,
    params.version,
    undefined,
  );
}
