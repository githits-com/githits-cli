import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { FetchTimeoutError } from "../shared/fetch-timeout.js";
import {
  AuthenticationError,
  TermsAcceptanceRequiredError,
} from "./githits-service.js";
import {
  MalformedPackageIntelligenceResponseError,
  PackageIntelligenceAccessError,
  PackageIntelligenceBackendError,
  PackageIntelligenceChangelogSourceNotFoundError,
  PackageIntelligenceFeatureFlagRequiredError,
  PackageIntelligenceNetworkError,
  PackageIntelligenceServiceImpl,
  PackageIntelligenceTargetNotFoundError,
  PackageIntelligenceValidationError,
  PackageIntelligenceVersionNotFoundError,
} from "./package-intelligence-service.js";
import type { ServiceDiagnostics } from "./runtime-diagnostics.js";
import { createMockTokenProvider } from "./test-helpers.js";

function asFetchFn<T extends (...args: never[]) => unknown>(
  fn: T,
): typeof fetch {
  return fn as unknown as typeof fetch;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function createDiagnostics(
  enabledArea: string,
  events: Array<{ area: string; event: Record<string, unknown> }>,
): ServiceDiagnostics {
  return {
    withOperation: async <T>(_name: string, operation: () => Promise<T>) =>
      operation(),
    isEnabled: (area) => area === enabledArea,
    debug: (area, event) => events.push({ area, event }),
  };
}

const HAPPY_BODY = {
  data: {
    packageSummary: {
      package: {
        name: "express",
        registry: "NPM",
        description: "Fast web framework",
        latestVersion: "4.18.2",
        latestVersionPublishedAt: "2023-05-28T00:00:00Z",
        versionCount: 42,
        downloadsRefreshedAt: "2024-06-15T00:00:00Z",
        homepage: "https://expressjs.com",
        repositoryUrl: "https://github.com/expressjs/express",
        license: "MIT",
        downloadsLastMonth: 86_000_000,
        downloadsTotal: null,
        githubRepository: {
          stargazersCount: 63_400,
          forksCount: 14_300,
          openIssuesCount: 123,
          archived: false,
          language: "JavaScript",
          topics: ["framework", "http", "middleware"],
          pushedAt: "2024-05-10T00:00:00Z",
        },
      },
      security: {
        vulnerabilityCount: 5,
        allVulnerabilityCount: 5,
        hasCurrentVulnerabilities: true,
        recentVulnerabilities: [
          {
            osvId: "GHSA-xxxx-xxxx-xxxx",
            summary: "Open redirect",
            severityScore: 7.5,
            publishedAt: "2024-06-01T00:00:00Z",
          },
        ],
      },
      latestChangelogs: [
        {
          version: "4.18.2",
          publishedAt: "2023-05-28T00:00:00Z",
          body: "Bug fixes",
        },
      ],
    },
  },
};

describe("PackageIntelligenceServiceImpl", () => {
  const ENDPOINT = "https://pkgseer.dev";

  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("maps a happy-path response to PackageSummary", async () => {
    const fetchFn = mock(() => Promise.resolve(jsonResponse(HAPPY_BODY)));
    const service = new PackageIntelligenceServiceImpl(
      ENDPOINT,
      createMockTokenProvider(),
      asFetchFn(fetchFn),
    );

    const result = await service.packageSummary({
      registry: "NPM",
      packageName: "express",
    });

    expect(result.package.name).toBe("express");
    expect(result.package.latestVersion).toBe("4.18.2");
    expect(result.package.versionCount).toBe(42);
    expect(result.package.downloadsRefreshedAt).toBe("2024-06-15T00:00:00Z");
    expect(result.package.downloadsLastMonth).toBe(86_000_000);
    expect(result.package.githubRepository?.stargazersCount).toBe(63_400);
    expect(result.security?.vulnerabilityCount).toBe(5);
    expect(result.security?.allVulnerabilityCount).toBe(5);
    expect(result.latestChangelogs?.[0]?.version).toBe("4.18.2");
  });

  it("preserves zero values for summary metadata", async () => {
    const body = {
      data: {
        packageSummary: {
          package: {
            name: "new-package",
            latestVersion: "0.0.1",
            versionCount: 0,
            downloadsRefreshedAt: null,
          },
          security: {
            allVulnerabilityCount: 0,
          },
        },
      },
    };
    const fetchFn = mock(() => Promise.resolve(jsonResponse(body)));
    const service = new PackageIntelligenceServiceImpl(
      ENDPOINT,
      createMockTokenProvider(),
      asFetchFn(fetchFn),
    );

    const result = await service.packageSummary({
      registry: "NPM",
      packageName: "new-package",
    });

    expect(result.package.versionCount).toBe(0);
    expect(result.package.downloadsRefreshedAt).toBeUndefined();
    expect(result.security?.allVulnerabilityCount).toBe(0);
  });

  it("preserves null blocks (security / github absent)", async () => {
    const body = {
      data: {
        packageSummary: {
          package: {
            name: "obscure",
            latestVersion: "0.0.1",
            description: null,
            registry: "PYPI",
            latestVersionPublishedAt: null,
            homepage: null,
            repositoryUrl: null,
            license: null,
            downloadsLastMonth: null,
            downloadsTotal: null,
            githubRepository: null,
          },
          security: null,
          latestChangelogs: null,
        },
      },
    };

    const fetchFn = mock(() => Promise.resolve(jsonResponse(body)));
    const service = new PackageIntelligenceServiceImpl(
      ENDPOINT,
      createMockTokenProvider(),
      asFetchFn(fetchFn),
    );

    const result = await service.packageSummary({
      registry: "PYPI",
      packageName: "obscure",
    });

    expect(result.package.name).toBe("obscure");
    expect(result.package.githubRepository).toBeUndefined();
    expect(result.security).toBeUndefined();
    expect(result.latestChangelogs).toBeUndefined();
  });

  it("throws MalformedPackageIntelligenceResponseError when name is null", async () => {
    const body = {
      data: {
        packageSummary: {
          package: { name: null, latestVersion: "1.0.0" },
          security: null,
          latestChangelogs: null,
        },
      },
    };
    const fetchFn = mock(() => Promise.resolve(jsonResponse(body)));
    const service = new PackageIntelligenceServiceImpl(
      ENDPOINT,
      createMockTokenProvider(),
      asFetchFn(fetchFn),
    );

    await expect(
      service.packageSummary({ registry: "NPM", packageName: "x" }),
    ).rejects.toBeInstanceOf(MalformedPackageIntelligenceResponseError);
  });

  it("throws MalformedPackageIntelligenceResponseError when latestVersion is null", async () => {
    const body = {
      data: {
        packageSummary: {
          package: { name: "x", latestVersion: null },
          security: null,
          latestChangelogs: null,
        },
      },
    };
    const fetchFn = mock(() => Promise.resolve(jsonResponse(body)));
    const service = new PackageIntelligenceServiceImpl(
      ENDPOINT,
      createMockTokenProvider(),
      asFetchFn(fetchFn),
    );

    await expect(
      service.packageSummary({ registry: "NPM", packageName: "x" }),
    ).rejects.toBeInstanceOf(MalformedPackageIntelligenceResponseError);
  });

  it.each([
    ["missing", undefined],
    ["null", null],
  ])(
    "throws MalformedPackageIntelligenceResponseError when security allVulnerabilityCount is %s",
    async (_label, allVulnerabilityCount) => {
      const body = {
        data: {
          packageSummary: {
            package: { name: "x", latestVersion: "1.0.0" },
            security:
              allVulnerabilityCount === undefined
                ? { vulnerabilityCount: 0 }
                : { allVulnerabilityCount },
          },
        },
      };
      const fetchFn = mock(() => Promise.resolve(jsonResponse(body)));
      const service = new PackageIntelligenceServiceImpl(
        ENDPOINT,
        createMockTokenProvider(),
        asFetchFn(fetchFn),
      );

      await expect(
        service.packageSummary({ registry: "NPM", packageName: "x" }),
      ).rejects.toBeInstanceOf(MalformedPackageIntelligenceResponseError);
    },
  );

  it("sends packageSummary query with registry + name vars and conditional details", async () => {
    let capturedBody: string | undefined;
    const fetchFn = mock((_url: string, init?: RequestInit) => {
      capturedBody = init?.body as string;
      return Promise.resolve(jsonResponse(HAPPY_BODY));
    });
    const service = new PackageIntelligenceServiceImpl(
      ENDPOINT,
      createMockTokenProvider(),
      asFetchFn(fetchFn),
    );

    await service.packageSummary({ registry: "NPM", packageName: "express" });

    expect(capturedBody).toBeDefined();
    const parsed = JSON.parse(capturedBody ?? "{}");
    expect(parsed.query).toContain("packageSummary(registry: $registry");
    expect(parsed.query).toContain(
      "latestChangelogs(limit: 3) @include(if: $includeVerboseFields)",
    );
    expect(parsed.query).toContain("allVulnerabilityCount");
    expect(parsed.query).not.toContain(
      "allVulnerabilityCount @include(if: $includeVerboseFields)",
    );
    expect(parsed.query).toContain(
      "versionCount @include(if: $includeVerboseFields)",
    );
    expect(parsed.query).toContain(
      "downloadsRefreshedAt @include(if: $includeVerboseFields)",
    );
    expect(parsed.query).not.toContain("quickstart");
    expect(parsed.query).not.toContain("installCommand");
    expect(parsed.query).not.toContain("usageExample");
    expect(parsed.variables).toEqual({
      registry: "NPM",
      name: "express",
      includeVerboseFields: true,
    });
  });

  it("can skip verbose packageSummary fields", async () => {
    let capturedBody: string | undefined;
    const fetchFn = mock((_url: string, init?: RequestInit) => {
      capturedBody = init?.body as string;
      return Promise.resolve(jsonResponse(HAPPY_BODY));
    });
    const service = new PackageIntelligenceServiceImpl(
      ENDPOINT,
      createMockTokenProvider(),
      asFetchFn(fetchFn),
    );

    await service.packageSummary({
      registry: "NPM",
      packageName: "express",
      includeVerboseFields: false,
    });

    const parsed = JSON.parse(capturedBody ?? "{}");
    expect(parsed.variables.includeVerboseFields).toBe(false);
    expect(parsed.query).toContain(
      "versionCount @include(if: $includeVerboseFields)",
    );
    expect(parsed.query).toContain(
      "downloadsRefreshedAt @include(if: $includeVerboseFields)",
    );
  });

  it("sends Bearer token and hits the correct URL", async () => {
    let capturedUrl: string | undefined;
    let capturedAuth: string | undefined;
    const fetchFn = mock((url: string, init?: RequestInit) => {
      capturedUrl = url;
      capturedAuth = (init?.headers as Record<string, string>)?.Authorization;
      return Promise.resolve(jsonResponse(HAPPY_BODY));
    });
    const service = new PackageIntelligenceServiceImpl(
      "https://pkgseer.dev/",
      createMockTokenProvider({
        getToken: mock(() => Promise.resolve("tok-123")),
      }),
      asFetchFn(fetchFn),
    );

    await service.packageSummary({ registry: "NPM", packageName: "express" });

    expect(capturedUrl).toBe("https://pkgseer.dev/api/graphql");
    expect(capturedAuth).toBe("Bearer tok-123");
  });

  it("classifies HTTP 401 as AuthenticationError and triggers token refresh", async () => {
    let callCount = 0;
    const fetchFn = mock(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve(
          new Response(JSON.stringify({ detail: "unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      return Promise.resolve(jsonResponse(HAPPY_BODY));
    });
    const refreshed = mock(() => Promise.resolve("new-token"));
    const tokenProvider = createMockTokenProvider({
      getToken: mock(() => Promise.resolve("old-token")),
      forceRefresh: refreshed,
    });

    const service = new PackageIntelligenceServiceImpl(
      ENDPOINT,
      tokenProvider,
      asFetchFn(fetchFn),
    );

    const result = await service.packageSummary({
      registry: "NPM",
      packageName: "express",
    });

    expect(refreshed).toHaveBeenCalledTimes(1);
    expect(result.package.name).toBe("express");
  });

  it("propagates AuthenticationError when no refreshed token is available", async () => {
    const fetchFn = mock(() =>
      Promise.resolve(
        new Response("{}", {
          status: 401,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    const tokenProvider = createMockTokenProvider({
      getToken: mock(() => Promise.resolve("token")),
      forceRefresh: mock(() => Promise.resolve(undefined)),
    });

    const service = new PackageIntelligenceServiceImpl(
      ENDPOINT,
      tokenProvider,
      asFetchFn(fetchFn),
    );

    await expect(
      service.packageSummary({ registry: "NPM", packageName: "express" }),
    ).rejects.toBeInstanceOf(AuthenticationError);
  });

  it("GraphQL-level UNAUTHORIZED (on 2xx response) still triggers token refresh", async () => {
    let callCount = 0;
    const fetchFn = mock(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve(
          jsonResponse({
            errors: [
              { message: "unauthorized", extensions: { code: "UNAUTHORIZED" } },
            ],
          }),
        );
      }
      return Promise.resolve(jsonResponse(HAPPY_BODY));
    });
    const refreshed = mock(() => Promise.resolve("new-token"));
    const tokenProvider = createMockTokenProvider({
      getToken: mock(() => Promise.resolve("old-token")),
      forceRefresh: refreshed,
    });

    const service = new PackageIntelligenceServiceImpl(
      ENDPOINT,
      tokenProvider,
      asFetchFn(fetchFn),
    );

    const result = await service.packageSummary({
      registry: "NPM",
      packageName: "express",
    });

    expect(refreshed).toHaveBeenCalledTimes(1);
    expect(result.package.name).toBe("express");
  });

  it("refreshes and retries once for GraphQL terms gating", async () => {
    let callCount = 0;
    const fetchFn = mock(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve(
          jsonResponse({
            errors: [
              {
                message: "Terms acceptance required",
                extensions: { code: "TERMS_ACCEPTANCE_REQUIRED" },
              },
            ],
          }),
        );
      }
      return Promise.resolve(jsonResponse(HAPPY_BODY));
    });
    const refreshed = mock(() => Promise.resolve("new-token"));
    const service = new PackageIntelligenceServiceImpl(
      ENDPOINT,
      createMockTokenProvider({ forceRefresh: refreshed }),
      asFetchFn(fetchFn),
    );

    const result = await service.packageSummary({
      registry: "NPM",
      packageName: "express",
    });

    expect(result.package.name).toBe("express");
    expect(refreshed).toHaveBeenCalledTimes(1);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("recognises the canonical terms-required HTTP 403 contract", async () => {
    const fetchFn = mock(() =>
      Promise.resolve(
        jsonResponse(
          {
            errors: [
              {
                message: "Terms acceptance required",
                extensions: {
                  code: "TERMS_ACCEPTANCE_REQUIRED",
                  terms_url: "https://githits.com/legal/terms-of-service/",
                  acceptance_url:
                    "https://acceptance.example.test/settings/privacy",
                },
              },
            ],
          },
          403,
        ),
      ),
    );
    const service = new PackageIntelligenceServiceImpl(
      ENDPOINT,
      createMockTokenProvider({
        forceRefresh: mock(() => Promise.resolve(undefined)),
      }),
      asFetchFn(fetchFn),
    );

    await expect(
      service.packageSummary({ registry: "NPM", packageName: "express" }),
    ).rejects.toBeInstanceOf(TermsAcceptanceRequiredError);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("classifies 403 as PackageIntelligenceAccessError", async () => {
    const fetchFn = mock(() =>
      Promise.resolve(jsonResponse({ detail: "no access" }, 403)),
    );
    const service = new PackageIntelligenceServiceImpl(
      ENDPOINT,
      createMockTokenProvider(),
      asFetchFn(fetchFn),
    );

    await expect(
      service.packageSummary({ registry: "NPM", packageName: "x" }),
    ).rejects.toBeInstanceOf(PackageIntelligenceAccessError);
  });

  it("classifies GraphQL FEATURE_FLAG_REQUIRED as PackageIntelligenceFeatureFlagRequiredError", async () => {
    const fetchFn = mock(() =>
      Promise.resolve(
        jsonResponse({
          errors: [
            {
              message: "flag missing",
              extensions: { code: "FEATURE_FLAG_REQUIRED" },
            },
          ],
        }),
      ),
    );
    const service = new PackageIntelligenceServiceImpl(
      ENDPOINT,
      createMockTokenProvider(),
      asFetchFn(fetchFn),
    );

    await expect(
      service.packageSummary({ registry: "NPM", packageName: "x" }),
    ).rejects.toBeInstanceOf(PackageIntelligenceFeatureFlagRequiredError);
  });

  it("classifies GraphQL NOT_FOUND as PackageIntelligenceTargetNotFoundError", async () => {
    const fetchFn = mock(() =>
      Promise.resolve(
        jsonResponse({
          errors: [
            { message: "no such package", extensions: { code: "NOT_FOUND" } },
          ],
        }),
      ),
    );
    const service = new PackageIntelligenceServiceImpl(
      ENDPOINT,
      createMockTokenProvider(),
      asFetchFn(fetchFn),
    );

    await expect(
      service.packageSummary({ registry: "NPM", packageName: "ghost" }),
    ).rejects.toBeInstanceOf(PackageIntelligenceTargetNotFoundError);
  });

  it("classifies GraphQL VALIDATION_ERROR as PackageIntelligenceValidationError", async () => {
    const fetchFn = mock(() =>
      Promise.resolve(
        jsonResponse({
          errors: [
            {
              message: "bad input",
              extensions: { code: "VALIDATION_ERROR" },
            },
          ],
        }),
      ),
    );
    const service = new PackageIntelligenceServiceImpl(
      ENDPOINT,
      createMockTokenProvider(),
      asFetchFn(fetchFn),
    );

    await expect(
      service.packageSummary({ registry: "NPM", packageName: "x" }),
    ).rejects.toBeInstanceOf(PackageIntelligenceValidationError);
  });

  it("classifies GraphQL schema mismatch as backend protocol error", async () => {
    const fetchFn = mock(() =>
      Promise.resolve(
        jsonResponse({
          errors: [
            {
              message: 'Cannot query field "packageSummary" on type "Query".',
              extensions: { code: "GRAPHQL_VALIDATION_FAILED" },
            },
          ],
        }),
      ),
    );
    const service = new PackageIntelligenceServiceImpl(
      ENDPOINT,
      createMockTokenProvider(),
      asFetchFn(fetchFn),
    );

    await expect(
      service.packageSummary({ registry: "NPM", packageName: "x" }),
    ).rejects.toMatchObject({
      name: "PackageIntelligenceBackendError",
      message: expect.stringContaining("Backend protocol mismatch"),
    });
  });

  it("exposes GraphQL schema mismatch details when pkg-graphql debug is enabled", async () => {
    const events: Array<{ area: string; event: Record<string, unknown> }> = [];
    const fetchFn = mock(() =>
      Promise.resolve(
        jsonResponse({
          errors: [
            {
              message: 'Cannot query field "packageSummary" on type "Query".',
              extensions: { code: "GRAPHQL_VALIDATION_FAILED" },
            },
          ],
        }),
      ),
    );
    const service = new PackageIntelligenceServiceImpl(
      ENDPOINT,
      createMockTokenProvider(),
      asFetchFn(fetchFn),
      {
        diagnostics: createDiagnostics("pkg-graphql", events),
      },
    );

    await expect(
      service.packageSummary({ registry: "NPM", packageName: "x" }),
    ).rejects.toMatchObject({
      name: "PackageIntelligenceBackendError",
      message: 'Cannot query field "packageSummary" on type "Query".',
    });
    expect(events).toEqual([
      {
        area: "pkg-graphql",
        event: {
          event: "graphql-schema-mismatch",
          code: "GRAPHQL_VALIDATION_FAILED",
          message: 'Cannot query field "packageSummary" on type "Query".',
        },
      },
    ]);
  });

  it("honors explicit backend CLIENT_UPDATE_REQUIRED errors", async () => {
    const fetchFn = mock(() =>
      Promise.resolve(
        jsonResponse({
          errors: [
            {
              message: "Client version is no longer supported.",
              extensions: { code: "CLIENT_UPDATE_REQUIRED" },
            },
          ],
        }),
      ),
    );
    const service = new PackageIntelligenceServiceImpl(
      ENDPOINT,
      createMockTokenProvider(),
      asFetchFn(fetchFn),
    );

    await expect(
      service.packageSummary({ registry: "NPM", packageName: "x" }),
    ).rejects.toMatchObject({ name: "ClientUpdateRequiredError" });
  });

  it("classifies 5xx plain-text body via parseDetail as PackageIntelligenceBackendError", async () => {
    const fetchFn = mock(() =>
      Promise.resolve(
        new Response("Gateway Timeout", {
          status: 504,
          headers: { "Content-Type": "text/plain" },
        }),
      ),
    );
    const service = new PackageIntelligenceServiceImpl(
      ENDPOINT,
      createMockTokenProvider(),
      asFetchFn(fetchFn),
    );

    try {
      await service.packageSummary({ registry: "NPM", packageName: "x" });
      throw new Error("expected backend error");
    } catch (error) {
      expect(error).toBeInstanceOf(PackageIntelligenceBackendError);
      expect((error as PackageIntelligenceBackendError).status).toBe(504);
      expect((error as PackageIntelligenceBackendError).message).toContain(
        "Gateway Timeout",
      );
    }
  });

  it("classifies malformed JSON body (non-GraphQL shape) as MalformedPackageIntelligenceResponseError", async () => {
    const fetchFn = mock(() =>
      Promise.resolve(
        new Response("not-json", {
          status: 200,
          headers: { "Content-Type": "text/plain" },
        }),
      ),
    );
    const service = new PackageIntelligenceServiceImpl(
      ENDPOINT,
      createMockTokenProvider(),
      asFetchFn(fetchFn),
    );

    await expect(
      service.packageSummary({ registry: "NPM", packageName: "x" }),
    ).rejects.toBeInstanceOf(MalformedPackageIntelligenceResponseError);
  });

  it("classifies `data: null` without errors as MalformedPackageIntelligenceResponseError", async () => {
    const fetchFn = mock(() => Promise.resolve(jsonResponse({ data: null })));
    const service = new PackageIntelligenceServiceImpl(
      ENDPOINT,
      createMockTokenProvider(),
      asFetchFn(fetchFn),
    );

    await expect(
      service.packageSummary({ registry: "NPM", packageName: "x" }),
    ).rejects.toBeInstanceOf(MalformedPackageIntelligenceResponseError);
  });

  it("wraps fetch rejections as PackageIntelligenceNetworkError preserving cause", async () => {
    const cause = new Error("ENOTFOUND");
    const fetchFn = mock(() => Promise.reject(cause));
    const service = new PackageIntelligenceServiceImpl(
      ENDPOINT,
      createMockTokenProvider(),
      asFetchFn(fetchFn),
    );

    try {
      await service.packageSummary({ registry: "NPM", packageName: "x" });
      throw new Error("expected network error");
    } catch (error) {
      expect(error).toBeInstanceOf(PackageIntelligenceNetworkError);
      expect((error as PackageIntelligenceNetworkError).cause).toBeDefined();
    }
  });

  it("classifies client-side timeouts as PackageIntelligenceBackendError TIMEOUT", async () => {
    const fetchFn = mock(() => Promise.reject(new FetchTimeoutError(1)));
    const service = new PackageIntelligenceServiceImpl(
      ENDPOINT,
      createMockTokenProvider(),
      asFetchFn(fetchFn),
    );

    try {
      await service.packageSummary({ registry: "NPM", packageName: "x" });
      throw new Error("expected timeout error");
    } catch (error) {
      expect(error).toBeInstanceOf(PackageIntelligenceBackendError);
      expect((error as PackageIntelligenceBackendError).graphqlCode).toBe(
        "TIMEOUT",
      );
      expect((error as PackageIntelligenceBackendError).retryable).toBe(true);
    }
  });
});

// --------------------------------------------------------------------
// packageVulnerabilities
// --------------------------------------------------------------------

const VULNS_HAPPY_BODY = {
  data: {
    packageVulnerabilities: {
      package: { name: "express", registry: "NPM", version: "4.18.0" },
      security: {
        affectedVulnerabilityCount: 2,
        nonAffectingVulnerabilityCount: 3,
        allVulnerabilityCount: 5,
        currentVersionAffected: true,
        upgradePaths: ["4.18.2"],
        advisories: {
          entries: [
            {
              osvId: "GHSA-xxxx-xxxx-xxxx",
              summary: "Open redirect",
              severityScore: 7.5,
              severityType: "CVSS_V3",
              affectedVersionRanges: [">= 4.0.0, < 4.18.2"],
              affectedVersionRangesCount: 1,
              affectedVersionRangesTruncated: false,
              fixedInVersions: ["4.18.2"],
              publishedAt: "2024-06-01T00:00:00Z",
              modifiedAt: null,
              withdrawnAt: null,
              aliases: ["CVE-2024-1234"],
              isMalicious: false,
              affectsInspectedVersion: true,
              matchedAffectedVersionRanges: [">= 4.0.0, < 4.18.2"],
              duplicateIds: [],
            },
            {
              osvId: "GHSA-mmmm-mmmm-mmmm",
              summary: "Malicious impersonator",
              severityScore: null,
              severityType: null,
              affectedVersionRanges: [">= 4.17.0, < 4.18.1"],
              affectedVersionRangesCount: 1,
              affectedVersionRangesTruncated: false,
              fixedInVersions: [],
              publishedAt: "2024-07-10T00:00:00Z",
              modifiedAt: null,
              withdrawnAt: null,
              aliases: [],
              isMalicious: true,
              affectsInspectedVersion: true,
              matchedAffectedVersionRanges: [">= 4.17.0, < 4.18.1"],
              duplicateIds: [],
            },
          ],
          pageInfo: { hasNextPage: false, endCursor: null, totalCount: 2 },
        },
      },
    },
  },
};

const TRANSITIVE_AUDIT_BODY = {
  data: {
    packageDependencies: {
      package: { name: "express", registry: "NPM", version: "4.18.0" },
      dependencies: {
        transitive: {
          vulnerabilitySummary: {
            affected: { totalVulnerabilities: 2 },
            totalPackagesAnalyzed: 4,
            affectedPackageCount: 1,
            calculatedAt: "2025-01-01T00:00:00Z",
            packages: [
              {
                registry: "NPM",
                name: "cookie",
                affectedCount: 2,
                advisoryOccurrences: [
                  {
                    version: "0.7.0",
                    affectsResolvedVersion: true,
                    matchedAffectedVersionRanges: [">= 0.0.0, < 0.7.1"],
                    fixVersionsAboveResolved: ["0.7.1"],
                    nearestFixedVersion: "0.7.1",
                    advisory: {
                      osvId: "GHSA-cookie-1111-1111",
                      registry: "NPM",
                      packageName: "cookie",
                      summary: "Cookie issue",
                      severityScore: 7.5,
                      severityType: "CVSS_V3",
                      publishedAt: "2024-01-01T00:00:00Z",
                      modifiedAt: null,
                      withdrawnAt: null,
                      aliases: ["CVE-2024-1111"],
                      isMalicious: false,
                    },
                  },
                  {
                    version: "0.7.0",
                    affectsResolvedVersion: true,
                    matchedAffectedVersionRanges: [">= 0.0.0, < 0.7.2"],
                    fixVersionsAboveResolved: ["0.7.2"],
                    nearestFixedVersion: "0.7.2",
                    advisory: {
                      osvId: "GHSA-cookie-2222-2222",
                      registry: "NPM",
                      packageName: "cookie",
                      summary: "Another cookie issue",
                      severityScore: null,
                      severityType: null,
                      publishedAt: "2024-02-01T00:00:00Z",
                      modifiedAt: null,
                      withdrawnAt: null,
                      aliases: [],
                      isMalicious: true,
                    },
                  },
                ],
              },
              {
                registry: "NPM",
                name: "clean-package",
                affectedCount: 0,
                advisoryOccurrences: [],
              },
            ],
          },
        },
      },
    },
  },
};

interface MutableTransitiveAuditOccurrence {
  affectsResolvedVersion: boolean;
  matchedAffectedVersionRanges: string[];
}

interface MutableTransitiveAuditPackage {
  affectedCount: number;
  advisoryOccurrences: MutableTransitiveAuditOccurrence[];
}

interface MutableTransitiveAuditSummary {
  affected: { totalVulnerabilities: number };
  totalPackagesAnalyzed: number;
  affectedPackageCount: number;
  packages: MutableTransitiveAuditPackage[];
}

interface MutableTransitiveAuditBody {
  data: {
    packageDependencies: {
      package: {
        name: string;
        registry: string;
        version: string;
      };
      dependencies: {
        transitive: {
          vulnerabilitySummary?: MutableTransitiveAuditSummary;
        };
      };
    };
  };
}

function mutableTransitiveAuditBody(): MutableTransitiveAuditBody {
  return structuredClone(TRANSITIVE_AUDIT_BODY) as MutableTransitiveAuditBody;
}

function mutableTransitiveAuditSummary(
  body: MutableTransitiveAuditBody,
): MutableTransitiveAuditSummary {
  const summary =
    body.data.packageDependencies.dependencies.transitive.vulnerabilitySummary;
  if (!summary) throw new Error("fixture missing vulnerability summary");
  return summary;
}

function mutableFirstAuditPackage(
  body: MutableTransitiveAuditBody,
): MutableTransitiveAuditPackage {
  const pkg = mutableTransitiveAuditSummary(body).packages[0];
  if (!pkg) throw new Error("fixture missing vulnerable package");
  return pkg;
}

function mutableFirstAuditOccurrence(
  body: MutableTransitiveAuditBody,
): MutableTransitiveAuditOccurrence {
  const occurrence = mutableFirstAuditPackage(body).advisoryOccurrences[0];
  if (!occurrence) throw new Error("fixture missing advisory occurrence");
  return occurrence;
}

describe("PackageIntelligenceServiceImpl.packageVulnerabilities", () => {
  const ENDPOINT = "https://pkgseer.dev";
  let originalFetch: typeof globalThis.fetch;

  function createAuditService(auditBody: unknown) {
    const fetchFn = mock((_url: string, init?: RequestInit) => {
      const body = JSON.parse((init?.body as string | undefined) ?? "{}");
      if (body.query.includes("PackageTransitiveVulnerabilityAudit")) {
        return Promise.resolve(jsonResponse(auditBody));
      }
      return Promise.resolve(jsonResponse(VULNS_HAPPY_BODY));
    });
    return {
      fetchFn,
      service: new PackageIntelligenceServiceImpl(
        ENDPOINT,
        createMockTokenProvider(),
        asFetchFn(fetchFn),
      ),
    };
  }

  async function expectMalformedAudit(auditBody: unknown): Promise<void> {
    const { service, fetchFn } = createAuditService(auditBody);
    await expect(
      service.packageVulnerabilities({
        registry: "NPM",
        packageName: "express",
        includeTransitive: true,
      }),
    ).rejects.toBeInstanceOf(MalformedPackageIntelligenceResponseError);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  }

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("maps a happy-path response to VulnerabilityReport", async () => {
    const fetchFn = mock(() => Promise.resolve(jsonResponse(VULNS_HAPPY_BODY)));
    const service = new PackageIntelligenceServiceImpl(
      ENDPOINT,
      createMockTokenProvider(),
      asFetchFn(fetchFn),
    );

    const result = await service.packageVulnerabilities({
      registry: "NPM",
      packageName: "express",
    });

    expect(result.package.name).toBe("express");
    expect(result.package.version).toBe("4.18.0");
    expect(result.security?.affectedVulnerabilityCount).toBe(2);
    expect(result.security?.nonAffectingVulnerabilityCount).toBe(3);
    expect(result.security?.allVulnerabilityCount).toBe(5);
    expect(result.security?.upgradePaths).toEqual(["4.18.2"]);
    expect(result.security?.vulnerabilities?.[0]?.osvId).toBe(
      "GHSA-xxxx-xxxx-xxxx",
    );
    expect(result.security?.vulnerabilities?.[1]?.isMalicious).toBe(true);
    expect(result.security?.vulnerabilities?.[0]?.affectsInspectedVersion).toBe(
      true,
    );
    expect(
      result.security?.vulnerabilities?.[0]?.matchedAffectedVersionRanges,
    ).toEqual([">= 4.0.0, < 4.18.2"]);
  });

  it.each([undefined, false] as const)(
    "keeps direct-only query and result unchanged when includeTransitive=%s",
    async (includeTransitive) => {
      let captured: string | undefined;
      const fetchFn = mock((_url: string, init?: RequestInit) => {
        captured = init?.body as string;
        return Promise.resolve(jsonResponse(VULNS_HAPPY_BODY));
      });
      const service = new PackageIntelligenceServiceImpl(
        ENDPOINT,
        createMockTokenProvider(),
        asFetchFn(fetchFn),
      );

      await service.packageVulnerabilities({
        registry: "NPM",
        packageName: "express",
        ...(includeTransitive === undefined ? {} : { includeTransitive }),
      });

      expect(fetchFn).toHaveBeenCalledTimes(1);
      const parsed = JSON.parse(captured ?? "{}");
      expect(parsed.variables).toEqual({
        registry: "NPM",
        name: "express",
        version: undefined,
        minSeverity: undefined,
        includeWithdrawn: undefined,
        scope: undefined,
        after: null,
      });
      expect(parsed.query).toContain("packageVulnerabilities(");
      expect(parsed.query).not.toContain("PackageTransitiveVulnerabilityAudit");
    },
  );

  it("sends packageVulnerabilities query with wire variables", async () => {
    let captured: string | undefined;
    const fetchFn = mock((_url: string, init?: RequestInit) => {
      captured = init?.body as string;
      return Promise.resolve(jsonResponse(VULNS_HAPPY_BODY));
    });
    const service = new PackageIntelligenceServiceImpl(
      ENDPOINT,
      createMockTokenProvider(),
      asFetchFn(fetchFn),
    );

    await service.packageVulnerabilities({
      registry: "NPM",
      packageName: "express",
      version: "4.18.0",
      minSeverity: 7.0,
      includeWithdrawn: true,
    });

    expect(captured).toBeDefined();
    const parsed = JSON.parse(captured ?? "{}");
    expect(parsed.query).toContain(
      "packageVulnerabilities(\n    registry: $registry",
    );
    expect(parsed.query).toContain("advisories(scope: $scope");
    expect(parsed.query).not.toContain("vulnerabilityCount");
    expect(parsed.variables).toEqual({
      registry: "NPM",
      name: "express",
      version: "4.18.0",
      minSeverity: 7.0,
      includeWithdrawn: true,
      scope: undefined,
      after: null,
    });
  });

  it("sends requested advisory scope on vulnerability queries", async () => {
    let captured: string | undefined;
    const fetchFn = mock((_url: string, init?: RequestInit) => {
      captured = init?.body as string;
      return Promise.resolve(jsonResponse(VULNS_HAPPY_BODY));
    });
    const service = new PackageIntelligenceServiceImpl(
      ENDPOINT,
      createMockTokenProvider(),
      asFetchFn(fetchFn),
    );

    await service.packageVulnerabilities({
      registry: "NPM",
      packageName: "express",
      advisoryScope: "NON_AFFECTING",
    });

    const parsed = JSON.parse(captured ?? "{}");
    expect(parsed.variables.scope).toBe("NON_AFFECTING");
  });

  it("throws MalformedPackageIntelligenceResponseError when name is null", async () => {
    const body = {
      data: {
        packageVulnerabilities: {
          package: { name: null, registry: "NPM", version: "1.0.0" },
          security: null,
        },
      },
    };
    const fetchFn = mock(() => Promise.resolve(jsonResponse(body)));
    const service = new PackageIntelligenceServiceImpl(
      ENDPOINT,
      createMockTokenProvider(),
      asFetchFn(fetchFn),
    );

    await expect(
      service.packageVulnerabilities({
        registry: "NPM",
        packageName: "x",
      }),
    ).rejects.toBeInstanceOf(MalformedPackageIntelligenceResponseError);
  });

  it("throws MalformedPackageIntelligenceResponseError when version is null", async () => {
    const body = {
      data: {
        packageVulnerabilities: {
          package: { name: "express", version: null },
          security: null,
        },
      },
    };
    const fetchFn = mock(() => Promise.resolve(jsonResponse(body)));
    const service = new PackageIntelligenceServiceImpl(
      ENDPOINT,
      createMockTokenProvider(),
      asFetchFn(fetchFn),
    );

    await expect(
      service.packageVulnerabilities({
        registry: "NPM",
        packageName: "express",
      }),
    ).rejects.toBeInstanceOf(MalformedPackageIntelligenceResponseError);
  });

  it("handles empty vulnerabilities list (zero-vulns success)", async () => {
    const body = {
      data: {
        packageVulnerabilities: {
          package: { name: "express", registry: "NPM", version: "4.18.2" },
          security: {
            affectedVulnerabilityCount: 0,
            nonAffectingVulnerabilityCount: 2,
            allVulnerabilityCount: 2,
            currentVersionAffected: false,
            upgradePaths: [],
            advisories: {
              entries: [],
              pageInfo: { hasNextPage: false, endCursor: null, totalCount: 0 },
            },
          },
        },
      },
    };
    const fetchFn = mock(() => Promise.resolve(jsonResponse(body)));
    const service = new PackageIntelligenceServiceImpl(
      ENDPOINT,
      createMockTokenProvider(),
      asFetchFn(fetchFn),
    );

    const result = await service.packageVulnerabilities({
      registry: "NPM",
      packageName: "express",
    });

    expect(result.security?.affectedVulnerabilityCount).toBe(0);
    expect(result.security?.nonAffectingVulnerabilityCount).toBe(2);
    expect(result.security?.allVulnerabilityCount).toBe(2);
    expect(result.security?.vulnerabilities).toEqual([]);
  });

  it("fetches all affected advisory pages", async () => {
    const firstPage = structuredClone(VULNS_HAPPY_BODY);
    if (!firstPage.data.packageVulnerabilities.security) {
      throw new Error("fixture missing security block");
    }
    const firstPageInfo = firstPage.data.packageVulnerabilities.security
      .advisories.pageInfo as {
      hasNextPage: boolean;
      endCursor: string | null;
      totalCount: number;
    };
    firstPageInfo.hasNextPage = true;
    firstPageInfo.endCursor = "cursor-1";
    firstPageInfo.totalCount = 3;
    const secondPage = structuredClone(VULNS_HAPPY_BODY);
    if (!secondPage.data.packageVulnerabilities.security) {
      throw new Error("fixture missing security block");
    }
    secondPage.data.packageVulnerabilities.security.advisories.entries = [
      {
        osvId: "GHSA-last-last-last",
        summary: "Last page advisory",
        severityScore: 4.1,
        severityType: "CVSS_V3",
        affectedVersionRanges: [">= 4.0.0, < 4.17.0"],
        affectedVersionRangesCount: 1,
        affectedVersionRangesTruncated: false,
        fixedInVersions: ["4.17.0"],
        publishedAt: "2023-01-01T00:00:00Z",
        modifiedAt: null,
        withdrawnAt: null,
        aliases: [],
        isMalicious: false,
        affectsInspectedVersion: true,
        matchedAffectedVersionRanges: [">= 4.0.0, < 4.17.0"],
        duplicateIds: [],
      },
    ];
    secondPage.data.packageVulnerabilities.security.advisories.pageInfo = {
      hasNextPage: false,
      endCursor: null,
      totalCount: 3,
    };

    const fetchFn = mock((_url: string, init?: RequestInit) => {
      const parsed = JSON.parse((init?.body as string | undefined) ?? "{}");
      if (parsed.variables.after === "cursor-1") {
        return Promise.resolve(jsonResponse(secondPage));
      }
      return Promise.resolve(jsonResponse(firstPage));
    });
    const service = new PackageIntelligenceServiceImpl(
      ENDPOINT,
      createMockTokenProvider(),
      asFetchFn(fetchFn),
    );

    const result = await service.packageVulnerabilities({
      registry: "NPM",
      packageName: "express",
    });

    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(result.security?.vulnerabilities?.map((vuln) => vuln.osvId)).toEqual(
      ["GHSA-xxxx-xxxx-xxxx", "GHSA-mmmm-mmmm-mmmm", "GHSA-last-last-last"],
    );
  });

  it("runs one minimal transitive audit after direct pagination", async () => {
    const firstPage = structuredClone(VULNS_HAPPY_BODY);
    if (!firstPage.data.packageVulnerabilities.security) {
      throw new Error("fixture missing security block");
    }
    const firstPageInfo = firstPage.data.packageVulnerabilities.security
      .advisories.pageInfo as {
      hasNextPage: boolean;
      endCursor: string | null;
      totalCount: number;
    };
    firstPageInfo.hasNextPage = true;
    firstPageInfo.endCursor = "cursor-1";
    firstPageInfo.totalCount = 3;
    const secondPage = structuredClone(VULNS_HAPPY_BODY);
    if (!secondPage.data.packageVulnerabilities.security) {
      throw new Error("fixture missing security block");
    }
    const firstEntry =
      firstPage.data.packageVulnerabilities.security.advisories.entries[0];
    if (!firstEntry) throw new Error("fixture missing first advisory entry");
    secondPage.data.packageVulnerabilities.security.advisories.entries = [
      firstEntry,
    ];
    secondPage.data.packageVulnerabilities.security.advisories.pageInfo = {
      hasNextPage: false,
      endCursor: null,
      totalCount: 3,
    };

    const requests: Array<{
      query: string;
      variables: Record<string, unknown>;
    }> = [];
    const fetchFn = mock((_url: string, init?: RequestInit) => {
      const body = JSON.parse((init?.body as string | undefined) ?? "{}");
      requests.push(body);
      if (body.query.includes("PackageTransitiveVulnerabilityAudit")) {
        return Promise.resolve(jsonResponse(TRANSITIVE_AUDIT_BODY));
      }
      if (body.variables.after === "cursor-1") {
        return Promise.resolve(jsonResponse(secondPage));
      }
      return Promise.resolve(jsonResponse(firstPage));
    });
    const service = new PackageIntelligenceServiceImpl(
      ENDPOINT,
      createMockTokenProvider(),
      asFetchFn(fetchFn),
    );

    const result = await service.packageVulnerabilities({
      registry: "NPM",
      packageName: "express",
      version: "4.17.0",
      minSeverity: 7.0,
      includeTransitive: true,
    });

    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(requests[2]?.variables).toEqual({
      registry: "NPM",
      name: "express",
      version: "4.18.0",
      minSeverity: 7.0,
    });
    expect(requests[2]?.query).toContain("includeTransitive: true");
    expect(requests[2]?.query).toContain(
      "advisoryOccurrences(scope: AFFECTED, minSeverity: $minSeverity)",
    );
    expect(result.transitive).toMatchObject({
      totalPackagesAnalyzed: 4,
      affectedPackageCount: 1,
      affectedOccurrenceCount: 2,
    });
  });

  it("selects only the field-minimal transitive audit contract", async () => {
    const { service, fetchFn } = createAuditService(TRANSITIVE_AUDIT_BODY);

    await service.packageVulnerabilities({
      registry: "NPM",
      packageName: "express",
      minSeverity: 4.0,
      includeTransitive: true,
    });

    const captured = JSON.parse(
      ((fetchFn.mock.calls as unknown as Array<[string, RequestInit]>)[1]?.[1]
        ?.body as string) ?? "{}",
    );
    const query = captured.query as string;
    expect(query).toContain("name");
    expect(query).toContain("registry");
    expect(query).toContain("version");
    expect(query).toContain("totalVulnerabilities");
    expect(query).toContain("totalPackagesAnalyzed");
    expect(query).toContain("affectedPackageCount");
    expect(query).toContain("affectedCount");
    expect(query).toContain("matchedAffectedVersionRanges");
    expect(query).toContain("fixVersionsAboveResolved");
    expect(query).toContain("nearestFixedVersion");
    expect(query).not.toContain("limit");
    for (const forbidden of [
      "nonAffecting",
      "combined",
      "versions",
      "advisoryIds",
      "mostCritical",
      "affectedVersionRanges",
      "fixedInVersions",
      "direct",
      "dependencyGraph",
      "dependencyGroups",
      "dependencyIssues",
      "conflicts",
      "circularDependencyCycles",
    ]) {
      if (forbidden === "affectedVersionRanges") {
        expect(query).not.toMatch(/\baffectedVersionRanges\b/);
      } else {
        expect(query).not.toContain(forbidden);
      }
    }
    expect(captured.variables).toEqual({
      registry: "NPM",
      name: "express",
      version: "4.18.0",
      minSeverity: 4.0,
    });
  });

  it("normalizes positive affected packages and preserves occurrence evidence", async () => {
    const { service } = createAuditService(TRANSITIVE_AUDIT_BODY);

    const result = await service.packageVulnerabilities({
      registry: "NPM",
      packageName: "express",
      includeTransitive: true,
    });

    expect(result.transitive).toMatchObject({
      totalPackagesAnalyzed: 4,
      affectedPackageCount: 1,
      affectedOccurrenceCount: 2,
      calculatedAt: "2025-01-01T00:00:00Z",
    });
    const packageResult = result.transitive?.packages[0];
    expect(packageResult).toMatchObject({
      registry: "NPM",
      name: "cookie",
      affectedOccurrenceCount: 2,
    });
    expect(packageResult?.occurrences).toHaveLength(2);
    expect(packageResult?.occurrences[0]).toMatchObject({
      version: "0.7.0",
      affectsResolvedVersion: true,
      matchedAffectedVersionRanges: [">= 0.0.0, < 0.7.1"],
      fixVersionsAboveResolved: ["0.7.1"],
      nearestFixedVersion: "0.7.1",
      advisory: {
        osvId: "GHSA-cookie-1111-1111",
        aliases: ["CVE-2024-1111"],
      },
    });
  });

  it("normalizes a checked clean transitive audit with an empty package list", async () => {
    const cleanBody = mutableTransitiveAuditBody();
    const summary = mutableTransitiveAuditSummary(cleanBody);
    summary.affected.totalVulnerabilities = 0;
    summary.affectedPackageCount = 0;
    summary.packages = [];
    summary.totalPackagesAnalyzed = 0;
    const { service } = createAuditService(cleanBody);

    const result = await service.packageVulnerabilities({
      registry: "NPM",
      packageName: "express",
      includeTransitive: true,
    });

    expect(result.transitive).toEqual({
      totalPackagesAnalyzed: 0,
      affectedPackageCount: 0,
      affectedOccurrenceCount: 0,
      calculatedAt: "2025-01-01T00:00:00Z",
      packages: [],
    });
  });

  it("fails closed when the transitive summary is absent", async () => {
    const body = mutableTransitiveAuditBody();
    delete body.data.packageDependencies.dependencies.transitive
      .vulnerabilitySummary;
    await expectMalformedAudit(body);
  });

  it.each(["name", "registry", "version"] as const)(
    "fails closed when the transitive root %s differs",
    async (field) => {
      const body = mutableTransitiveAuditBody();
      body.data.packageDependencies.package[field] =
        field === "version" ? "9.9.9" : `different-${field}`;
      await expectMalformedAudit(body);
    },
  );

  it("fails closed when an occurrence lacks resolved-version affectedness", async () => {
    const body = mutableTransitiveAuditBody();
    mutableFirstAuditOccurrence(body).affectsResolvedVersion = false;
    await expectMalformedAudit(body);
  });

  it("fails closed when an occurrence has no matched affected range", async () => {
    const body = mutableTransitiveAuditBody();
    mutableFirstAuditOccurrence(body).matchedAffectedVersionRanges = [];
    await expectMalformedAudit(body);
  });

  it("fails closed when a package occurrence count differs from affectedCount", async () => {
    const body = mutableTransitiveAuditBody();
    mutableFirstAuditPackage(body).affectedCount = 1;
    await expectMalformedAudit(body);
  });

  it("fails closed when positive package rows differ from affectedPackageCount", async () => {
    const body = mutableTransitiveAuditBody();
    const summary = mutableTransitiveAuditSummary(body);
    summary.affectedPackageCount = 2;
    await expectMalformedAudit(body);
  });

  it("fails closed when occurrence sum differs from affected total", async () => {
    const body = mutableTransitiveAuditBody();
    const summary = mutableTransitiveAuditSummary(body);
    summary.affected.totalVulnerabilities = 1;
    await expectMalformedAudit(body);
  });

  it("rejects incomplete advisory pagination", async () => {
    const body = structuredClone(VULNS_HAPPY_BODY);
    if (!body.data.packageVulnerabilities.security) {
      throw new Error("fixture missing security block");
    }
    body.data.packageVulnerabilities.security.advisories.pageInfo = {
      hasNextPage: false,
      endCursor: null,
      totalCount: 3,
    };
    const fetchFn = mock(() => Promise.resolve(jsonResponse(body)));
    const service = new PackageIntelligenceServiceImpl(
      ENDPOINT,
      createMockTokenProvider(),
      asFetchFn(fetchFn),
    );

    await expect(
      service.packageVulnerabilities({
        registry: "NPM",
        packageName: "express",
      }),
    ).rejects.toBeInstanceOf(MalformedPackageIntelligenceResponseError);
  });

  it("rejects repeated advisory pagination cursors", async () => {
    const body = structuredClone(VULNS_HAPPY_BODY);
    if (!body.data.packageVulnerabilities.security) {
      throw new Error("fixture missing security block");
    }
    const pageInfo = body.data.packageVulnerabilities.security.advisories
      .pageInfo as {
      hasNextPage: boolean;
      endCursor: string | null;
      totalCount: number;
    };
    pageInfo.hasNextPage = true;
    pageInfo.endCursor = "cursor-1";
    pageInfo.totalCount = 3;
    const fetchFn = mock(() => Promise.resolve(jsonResponse(body)));
    const service = new PackageIntelligenceServiceImpl(
      ENDPOINT,
      createMockTokenProvider(),
      asFetchFn(fetchFn),
    );

    await expect(
      service.packageVulnerabilities({
        registry: "NPM",
        packageName: "express",
      }),
    ).rejects.toBeInstanceOf(MalformedPackageIntelligenceResponseError);
  });

  it("classifies GraphQL VERSION_NOT_FOUND as typed error with structured details", async () => {
    const fetchFn = mock(() =>
      Promise.resolve(
        jsonResponse({
          errors: [
            {
              message: "version not found",
              extensions: {
                code: "VERSION_NOT_FOUND",
                package: "npm:express",
                requested_version: "99.0.0",
                available_versions: ["4.18.2", "4.18.1"],
              },
            },
          ],
        }),
      ),
    );
    const service = new PackageIntelligenceServiceImpl(
      ENDPOINT,
      createMockTokenProvider(),
      asFetchFn(fetchFn),
    );

    try {
      await service.packageVulnerabilities({
        registry: "NPM",
        packageName: "express",
        version: "99.0.0",
      });
      throw new Error("expected typed version error");
    } catch (error) {
      expect(error).toBeInstanceOf(PackageIntelligenceVersionNotFoundError);
      const typed = error as PackageIntelligenceVersionNotFoundError;
      expect(typed.packageName).toBe("npm:express");
      expect(typed.requestedVersion).toBe("99.0.0");
      expect(typed.availableVersions).toEqual(["4.18.2", "4.18.1"]);
    }
  });

  it("classifies GraphQL VERSION_NOT_FOUND with empty extensions (backend not wired)", async () => {
    const fetchFn = mock(() =>
      Promise.resolve(
        jsonResponse({
          errors: [
            {
              message: "version not found",
              extensions: { code: "VERSION_NOT_FOUND" },
            },
          ],
        }),
      ),
    );
    const service = new PackageIntelligenceServiceImpl(
      ENDPOINT,
      createMockTokenProvider(),
      asFetchFn(fetchFn),
    );

    try {
      await service.packageVulnerabilities({
        registry: "NPM",
        packageName: "express",
        version: "99.0.0",
      });
      throw new Error("expected typed version error");
    } catch (error) {
      expect(error).toBeInstanceOf(PackageIntelligenceVersionNotFoundError);
      const typed = error as PackageIntelligenceVersionNotFoundError;
      expect(typed.packageName).toBeUndefined();
      expect(typed.requestedVersion).toBeUndefined();
      expect(typed.availableVersions).toBeUndefined();
    }
  });

  it("promotes generic 'no matching version' backend error to VersionNotFoundError when a version was requested", async () => {
    // Live backend currently returns the plain message without the
    // typed extensions.code. We recover the `package` and
    // `requestedVersion` fields from the caller's params so the CLI /
    // MCP surfaces can render actionable output.
    const fetchFn = mock(() =>
      Promise.resolve(
        jsonResponse({
          errors: [{ message: "No matching version found" }],
        }),
      ),
    );
    const service = new PackageIntelligenceServiceImpl(
      ENDPOINT,
      createMockTokenProvider(),
      asFetchFn(fetchFn),
    );

    try {
      await service.packageVulnerabilities({
        registry: "NPM",
        packageName: "lodash",
        version: "99.99.99",
      });
      throw new Error("expected typed version error");
    } catch (error) {
      expect(error).toBeInstanceOf(PackageIntelligenceVersionNotFoundError);
      const typed = error as PackageIntelligenceVersionNotFoundError;
      // Qualified with lowercase registry prefix to match the typed
      // (backend-sent) VERSION_NOT_FOUND shape — keeps CLI / MCP
      // output consistent across the two code paths.
      expect(typed.packageName).toBe("npm:lodash");
      expect(typed.requestedVersion).toBe("99.99.99");
      expect(typed.availableVersions).toBeUndefined();
    }
  });

  it("does NOT promote to VersionNotFoundError when no version was requested (caller asked for latest)", async () => {
    const fetchFn = mock(() =>
      Promise.resolve(
        jsonResponse({
          errors: [{ message: "No matching version found" }],
        }),
      ),
    );
    const service = new PackageIntelligenceServiceImpl(
      ENDPOINT,
      createMockTokenProvider(),
      asFetchFn(fetchFn),
    );

    try {
      await service.packageVulnerabilities({
        registry: "NPM",
        packageName: "lodash",
      });
      throw new Error("expected backend error");
    } catch (error) {
      expect(error).not.toBeInstanceOf(PackageIntelligenceVersionNotFoundError);
    }
  });

  it("does NOT promote when backend supplies an explicit graphqlCode (INTERNAL_ERROR)", async () => {
    // Real backend faults that happen to mention "no matching
    // version" in a joined error string must not have their typed
    // code / retryability silently flipped. Only messages with no
    // graphqlCode at all (current production behaviour on
    // packageVulnerabilities) are eligible for promotion.
    const fetchFn = mock(() =>
      Promise.resolve(
        jsonResponse({
          errors: [
            {
              message: "internal error, no matching version table",
              extensions: { code: "INTERNAL_ERROR" },
            },
          ],
        }),
      ),
    );
    const service = new PackageIntelligenceServiceImpl(
      ENDPOINT,
      createMockTokenProvider(),
      asFetchFn(fetchFn),
    );

    try {
      await service.packageVulnerabilities({
        registry: "NPM",
        packageName: "lodash",
        version: "99.99.99",
      });
      throw new Error("expected backend error");
    } catch (error) {
      expect(error).not.toBeInstanceOf(PackageIntelligenceVersionNotFoundError);
      expect(error).toBeInstanceOf(PackageIntelligenceBackendError);
    }
  });

  it("classifies GraphQL UNAUTHORIZED (after 2xx) and triggers token refresh", async () => {
    let callCount = 0;
    const fetchFn = mock(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve(
          jsonResponse({
            errors: [
              { message: "unauthorized", extensions: { code: "UNAUTHORIZED" } },
            ],
          }),
        );
      }
      return Promise.resolve(jsonResponse(VULNS_HAPPY_BODY));
    });
    const refreshed = mock(() => Promise.resolve("new-token"));
    const tokenProvider = createMockTokenProvider({
      getToken: mock(() => Promise.resolve("old-token")),
      forceRefresh: refreshed,
    });

    const service = new PackageIntelligenceServiceImpl(
      ENDPOINT,
      tokenProvider,
      asFetchFn(fetchFn),
    );

    const result = await service.packageVulnerabilities({
      registry: "NPM",
      packageName: "express",
    });

    expect(refreshed).toHaveBeenCalledTimes(1);
    expect(result.package.name).toBe("express");
  });

  it("classifies 403 as PackageIntelligenceAccessError", async () => {
    const fetchFn = mock(() =>
      Promise.resolve(jsonResponse({ detail: "no access" }, 403)),
    );
    const service = new PackageIntelligenceServiceImpl(
      ENDPOINT,
      createMockTokenProvider(),
      asFetchFn(fetchFn),
    );

    await expect(
      service.packageVulnerabilities({ registry: "NPM", packageName: "x" }),
    ).rejects.toBeInstanceOf(PackageIntelligenceAccessError);
  });

  it("classifies FEATURE_FLAG_REQUIRED correctly", async () => {
    const fetchFn = mock(() =>
      Promise.resolve(
        jsonResponse({
          errors: [
            {
              message: "flag missing",
              extensions: { code: "FEATURE_FLAG_REQUIRED" },
            },
          ],
        }),
      ),
    );
    const service = new PackageIntelligenceServiceImpl(
      ENDPOINT,
      createMockTokenProvider(),
      asFetchFn(fetchFn),
    );

    await expect(
      service.packageVulnerabilities({ registry: "NPM", packageName: "x" }),
    ).rejects.toBeInstanceOf(PackageIntelligenceFeatureFlagRequiredError);
  });

  it("classifies GraphQL NOT_FOUND as PackageIntelligenceTargetNotFoundError", async () => {
    const fetchFn = mock(() =>
      Promise.resolve(
        jsonResponse({
          errors: [
            { message: "package not found", extensions: { code: "NOT_FOUND" } },
          ],
        }),
      ),
    );
    const service = new PackageIntelligenceServiceImpl(
      ENDPOINT,
      createMockTokenProvider(),
      asFetchFn(fetchFn),
    );

    await expect(
      service.packageVulnerabilities({ registry: "NPM", packageName: "ghost" }),
    ).rejects.toBeInstanceOf(PackageIntelligenceTargetNotFoundError);
  });

  it("classifies VALIDATION_ERROR as PackageIntelligenceValidationError", async () => {
    const fetchFn = mock(() =>
      Promise.resolve(
        jsonResponse({
          errors: [
            {
              message: "bad input",
              extensions: { code: "VALIDATION_ERROR" },
            },
          ],
        }),
      ),
    );
    const service = new PackageIntelligenceServiceImpl(
      ENDPOINT,
      createMockTokenProvider(),
      asFetchFn(fetchFn),
    );

    await expect(
      service.packageVulnerabilities({ registry: "NPM", packageName: "x" }),
    ).rejects.toBeInstanceOf(PackageIntelligenceValidationError);
  });

  it("classifies 5xx as PackageIntelligenceBackendError", async () => {
    const fetchFn = mock(() =>
      Promise.resolve(
        new Response("Server went away", {
          status: 503,
          headers: { "Content-Type": "text/plain" },
        }),
      ),
    );
    const service = new PackageIntelligenceServiceImpl(
      ENDPOINT,
      createMockTokenProvider(),
      asFetchFn(fetchFn),
    );

    try {
      await service.packageVulnerabilities({
        registry: "NPM",
        packageName: "x",
      });
      throw new Error("expected backend error");
    } catch (error) {
      expect(error).toBeInstanceOf(PackageIntelligenceBackendError);
    }
  });

  it("wraps fetch rejection as PackageIntelligenceNetworkError preserving cause", async () => {
    const cause = new Error("ENOTFOUND");
    const fetchFn = mock(() => Promise.reject(cause));
    const service = new PackageIntelligenceServiceImpl(
      ENDPOINT,
      createMockTokenProvider(),
      asFetchFn(fetchFn),
    );

    try {
      await service.packageVulnerabilities({
        registry: "NPM",
        packageName: "x",
      });
      throw new Error("expected network error");
    } catch (error) {
      expect(error).toBeInstanceOf(PackageIntelligenceNetworkError);
      expect((error as PackageIntelligenceNetworkError).cause).toBeDefined();
    }
  });

  it("preserves malicious and withdrawn flags round-trip", async () => {
    const body = {
      data: {
        packageVulnerabilities: {
          package: { name: "shady", registry: "NPM", version: "1.0.0" },
          security: {
            affectedVulnerabilityCount: 2,
            nonAffectingVulnerabilityCount: 0,
            allVulnerabilityCount: 2,
            currentVersionAffected: true,
            upgradePaths: [],
            advisories: {
              entries: [
                {
                  osvId: "GHSA-mal",
                  summary: "Malicious",
                  severityScore: null,
                  severityType: null,
                  affectedVersionRanges: [">= 1.0.0"],
                  affectedVersionRangesCount: 1,
                  affectedVersionRangesTruncated: false,
                  fixedInVersions: [],
                  publishedAt: "2024-01-01T00:00:00Z",
                  modifiedAt: null,
                  withdrawnAt: null,
                  aliases: [],
                  isMalicious: true,
                  affectsInspectedVersion: true,
                  matchedAffectedVersionRanges: [">= 1.0.0"],
                  duplicateIds: [],
                },
                {
                  osvId: "GHSA-wit",
                  summary: "Retracted advisory",
                  severityScore: 6.5,
                  severityType: null,
                  affectedVersionRanges: [">= 1.0.0"],
                  affectedVersionRangesCount: 1,
                  affectedVersionRangesTruncated: false,
                  fixedInVersions: ["1.0.1"],
                  publishedAt: "2023-12-01T00:00:00Z",
                  modifiedAt: null,
                  withdrawnAt: "2024-02-01T00:00:00Z",
                  aliases: [],
                  isMalicious: false,
                  affectsInspectedVersion: true,
                  matchedAffectedVersionRanges: [">= 1.0.0"],
                  duplicateIds: [],
                },
              ],
              pageInfo: { hasNextPage: false, endCursor: null, totalCount: 2 },
            },
          },
        },
      },
    };
    const fetchFn = mock(() => Promise.resolve(jsonResponse(body)));
    const service = new PackageIntelligenceServiceImpl(
      ENDPOINT,
      createMockTokenProvider(),
      asFetchFn(fetchFn),
    );

    const result = await service.packageVulnerabilities({
      registry: "NPM",
      packageName: "shady",
    });

    expect(result.security?.vulnerabilities?.[0]?.isMalicious).toBe(true);
    expect(result.security?.vulnerabilities?.[1]?.withdrawnAt).toBe(
      "2024-02-01T00:00:00Z",
    );
  });
});

describe("PackageIntelligenceServiceImpl — packageChangelog", () => {
  const ENDPOINT = "https://pkgseer.dev";

  it("treats an empty source as no changelog data", async () => {
    const fetchFn = mock(() =>
      Promise.resolve(
        jsonResponse({
          data: {
            packageChangelog: {
              package: { name: "express", registry: "NPM" },
              source: "",
              entries: [],
            },
          },
        }),
      ),
    );
    const service = new PackageIntelligenceServiceImpl(
      ENDPOINT,
      createMockTokenProvider(),
      asFetchFn(fetchFn),
    );

    await expect(
      service.packageChangelog({ registry: "NPM", packageName: "express" }),
    ).rejects.toBeInstanceOf(PackageIntelligenceChangelogSourceNotFoundError);
  });

  it("sends includeBodies and omits unused metadata from changelog query", async () => {
    let capturedBody: string | undefined;
    const fetchFn = mock((_url: string, init?: RequestInit) => {
      capturedBody = init?.body as string;
      return Promise.resolve(
        jsonResponse({
          data: {
            packageChangelog: {
              package: { name: "express", registry: "NPM" },
              source: "releases",
              entries: [
                {
                  version: "5.0.0",
                  normalizedVersion: "5.0.0",
                  htmlUrl: "https://example.com/release",
                  publishedAt: "2026-01-01T00:00:00Z",
                },
              ],
            },
          },
        }),
      );
    });
    const service = new PackageIntelligenceServiceImpl(
      ENDPOINT,
      createMockTokenProvider(),
      asFetchFn(fetchFn),
    );

    await service.packageChangelog({
      registry: "NPM",
      packageName: "express",
      includeBodies: false,
    });

    const parsed = JSON.parse(capturedBody ?? "{}");
    expect(parsed.query).toContain("body @include(if: $includeBodies)");
    expect(parsed.query).not.toContain("metadata");
    expect(parsed.variables.includeBodies).toBe(false);
  });

  it("accepts package version entries without a changelog source", async () => {
    const fetchFn = mock(() =>
      Promise.resolve(
        jsonResponse({
          data: {
            packageChangelog: {
              package: { name: "react", registry: "NPM" },
              source: null,
              entries: [
                {
                  version: "19.2.5",
                  normalizedVersion: "19.2.5",
                  body: "React Server Components",
                  htmlUrl: null,
                  publishedAt: "2026-04-08T00:00:00Z",
                },
              ],
            },
          },
        }),
      ),
    );
    const service = new PackageIntelligenceServiceImpl(
      ENDPOINT,
      createMockTokenProvider(),
      asFetchFn(fetchFn),
    );

    const result = await service.packageChangelog({
      registry: "NPM",
      packageName: "react",
    });

    expect(result.source).toBeUndefined();
    expect(result.entries[0]?.version).toBe("19.2.5");
  });

  it("normalizes an empty changelog source to absent when entries are present", async () => {
    const fetchFn = mock(() =>
      Promise.resolve(
        jsonResponse({
          data: {
            packageChangelog: {
              package: { name: "react", registry: "NPM" },
              source: "",
              entries: [
                {
                  version: "19.2.5",
                  normalizedVersion: "19.2.5",
                  body: null,
                  htmlUrl: null,
                  publishedAt: "2026-04-08T00:00:00Z",
                },
              ],
            },
          },
        }),
      ),
    );
    const service = new PackageIntelligenceServiceImpl(
      ENDPOINT,
      createMockTokenProvider(),
      asFetchFn(fetchFn),
    );

    const result = await service.packageChangelog({
      registry: "NPM",
      packageName: "react",
    });

    expect(result.source).toBeUndefined();
    expect(result.entries).toHaveLength(1);
  });
});

describe("PackageIntelligenceServiceImpl — packageUpgradeReview", () => {
  const ENDPOINT = "https://pkgseer.dev";

  it("sends aggregate upgrade-review variables and maps the typed response", async () => {
    let capturedBody: string | undefined;
    const fetchFn = mock((_url: string, init?: RequestInit) => {
      capturedBody = init?.body as string;
      return Promise.resolve(
        jsonResponse({
          data: {
            packageUpgradeReview: {
              summary: {
                total: 1,
                withUnknowns: 0,
                withAddedAdvisories: 1,
                withBreakingSignals: 0,
                withDirectDependencyChanges: 0,
                withTransitiveVulnerabilityAdditions: 0,
              },
              reviews: [
                {
                  registry: "NPM",
                  name: "express",
                  currentVersion: "4.18.0",
                  targetVersion: "5.0.0",
                  latestVersion: "5.0.0",
                  versionDelta: "MAJOR",
                  security: {
                    current: null,
                    target: null,
                    added: [
                      {
                        id: "GHSA-test",
                        aliases: [],
                        summary: "Example advisory",
                        severity: 7.5,
                        severityLabel: "HIGH",
                        fixedIn: ["5.0.1"],
                        isMalicious: false,
                      },
                    ],
                    removed: [],
                    notAddressed: [],
                    fixed: [],
                    introduced: [],
                    unchanged: [],
                  },
                  changelog: {
                    source: null,
                    fallback: "PACKAGE_VERSIONS",
                    entries: [],
                    sampledEntries: [],
                    keywordEntries: [],
                    totalKeywordEntries: 0,
                    totalEntries: 0,
                    totalEntriesWithBodies: 0,
                    truncated: false,
                    hasReleaseNoteBodies: false,
                    breakingSignals: [],
                    migrationSignals: [],
                  },
                  compatibility: null,
                  dependencyChanges: null,
                  dependencyIssues: null,
                  unknowns: [],
                },
              ],
            },
          },
        }),
      );
    });
    const service = new PackageIntelligenceServiceImpl(
      ENDPOINT,
      createMockTokenProvider(),
      asFetchFn(fetchFn),
    );

    const result = await service.packageUpgradeReview({
      packages: [
        {
          registry: "NPM",
          name: "express",
          currentVersion: "4.18.0",
          targetVersion: "5.0.0",
        },
      ],
      includeTransitiveSecurity: false,
      includeDependencyIssues: true,
      changelogLimit: 20,
      minSeverity: 7,
    });

    const parsed = JSON.parse(capturedBody ?? "{}");
    expect(parsed.query).toContain("packageUpgradeReview(");
    expect(parsed.query).toContain("dependencyIssues @include");
    expect(parsed.query).not.toContain("duplicateIds");
    expect(parsed.query).not.toContain("matchedAffectedVersionRanges");
    expect(parsed.query).not.toContain("affectedVersionRangesCount");
    expect(parsed.query).not.toContain("affectedVersionRangesTruncated");
    expect(parsed.query).not.toContain("affectsInspectedVersion");
    expect(parsed.variables).toMatchObject({
      packages: [
        {
          registry: "NPM",
          name: "express",
          currentVersion: "4.18.0",
          targetVersion: "5.0.0",
        },
      ],
      includeTransitiveSecurity: false,
      includeDependencyIssues: true,
      changelogLimit: 20,
      minSeverity: 7,
    });
    expect(result.summary.withAddedAdvisories).toBe(1);
    expect(result.reviews[0]?.security.added[0]?.severityLabel).toBe("HIGH");
    expect(result.reviews[0]?.changelog.source).toBeUndefined();
    expect(result.reviews[0]?.compatibility).toBeUndefined();
  });
});

describe("PackageIntelligenceServiceImpl — packageDependencies", () => {
  const ENDPOINT = "https://pkgseer.dev";

  const EXPRESS_BODY = {
    data: {
      packageDependencies: {
        package: { name: "express", registry: "NPM", version: "5.2.1" },
        dependencies: {
          direct: [
            { name: "accepts", versionConstraint: "^2.0.0", type: "runtime" },
            { name: "cookie", versionConstraint: "^0.7.1", type: "runtime" },
          ],
          transitive: null,
        },
        dependencyGroups: {
          primaryGroup: null,
          environmentMarkers: null,
          groups: [
            {
              name: "runtime",
              lifecycle: "runtime",
              conditionType: "always",
              conditionValue: null,
              selectionMode: "required",
              exclusiveGroup: null,
              fallbackPriority: null,
              compatibleWith: null,
              defaultEnabled: true,
              dependencies: [
                { name: "accepts", constraint: "^2.0.0" },
                { name: "cookie", constraint: "^0.7.1" },
              ],
            },
          ],
        },
      },
    },
  };

  const ZERO_DEPENDENCY_ISSUES = {
    totalCount: 0,
    deprecatedCount: 0,
    outdatedCount: 0,
    duplicateCount: 0,
    conflictCount: 0,
    deprecatedPackages: [],
    outdatedPackages: [],
    duplicatePackages: [],
    conflicts: [],
  };

  const MINIMAL_DEPENDENCY_GRAPH = {
    formatVersion: 1,
    nodes: [{ registry: "NPM", name: "express", version: "5.2.1" }],
    edges: [],
  };

  function createIssueAnalysisBody(
    options: { dependencyIssues?: unknown; dependencyGraph?: unknown } = {},
  ) {
    const dependencyIssues = Object.hasOwn(options, "dependencyIssues")
      ? options.dependencyIssues
      : ZERO_DEPENDENCY_ISSUES;
    const dependencyGraph = Object.hasOwn(options, "dependencyGraph")
      ? options.dependencyGraph
      : MINIMAL_DEPENDENCY_GRAPH;

    return {
      data: {
        packageDependencies: {
          package: { name: "express", registry: "NPM", version: "5.2.1" },
          dependencies: {
            direct: [],
            transitive: {
              dependencyIssues,
              dependencyGraph,
            },
          },
          dependencyGroups: null,
        },
      },
    };
  }

  function createTransitiveConflictBody(
    includeGraph: boolean,
    dependencyGraph: unknown,
    conflictingEdges: unknown[] = [
      {
        fromIndex: null,
        toIndex: 0,
        versionConstraint: "^1.0.0",
        dependencyType: "runtime",
      },
    ],
  ) {
    return {
      data: {
        packageDependencies: {
          package: { name: "express", registry: "NPM", version: "5.2.1" },
          dependencies: {
            direct: [],
            transitive: {
              ...(includeGraph ? { dependencyGraph } : {}),
              dependencyConflicts: [
                {
                  packageName: "shared",
                  requiredVersions: ["^1.0.0", "^2.0.0"],
                  conflictingEdges,
                },
              ],
            },
          },
          dependencyGroups: null,
        },
      },
    };
  }

  const ISSUE_ANALYSIS_BODY = createIssueAnalysisBody();

  it("maps a happy-path response to DependencyReport", async () => {
    const fetchFn = mock(() => Promise.resolve(jsonResponse(EXPRESS_BODY)));
    const service = new PackageIntelligenceServiceImpl(
      ENDPOINT,
      createMockTokenProvider(),
      asFetchFn(fetchFn),
    );
    const report = await service.packageDependencies({
      registry: "NPM",
      packageName: "express",
    });
    expect(report.package.name).toBe("express");
    expect(report.package.version).toBe("5.2.1");
    expect(report.dependencies?.direct?.length).toBe(2);
    expect(report.dependencyGroups?.groups[0]?.name).toBe("runtime");
  });

  it("sends lifecycle + includeTransitive + maxDepth variables on the wire", async () => {
    let capturedBody: string | undefined;
    const fetchFn = mock((_url: string, init?: RequestInit) => {
      capturedBody = init?.body as string;
      return Promise.resolve(jsonResponse(EXPRESS_BODY));
    });
    const service = new PackageIntelligenceServiceImpl(
      ENDPOINT,
      createMockTokenProvider(),
      asFetchFn(fetchFn),
    );
    await service.packageDependencies({
      registry: "NPM",
      packageName: "express",
      lifecycle: ["runtime", "development"],
      includeTransitive: true,
      maxDepth: 3,
    });
    const parsed = JSON.parse(capturedBody ?? "{}");
    expect(parsed.variables.lifecycle).toEqual(["runtime", "development"]);
    expect(parsed.variables.includeTransitive).toBe(true);
    expect(parsed.variables.includeTransitiveDetails).toBe(true);
    expect(parsed.variables.includeDependencyGraph).toBe(true);
    expect(parsed.variables.includeGroups).toBe(true);
    expect(parsed.variables.maxDepth).toBe(3);
  });

  it.each([
    ["omitted", undefined, undefined, false, false],
    ["explicit false", false, undefined, false, false],
    ["explicit true", true, true, true, true],
  ])(
    "uses a strict issue-analysis selection for %s",
    async (_label, includeDependencyIssues, expectedIncludeTransitive, expectedIncludeDependencyIssues, expectedIncludeDependencyGraph) => {
      let capturedBody: string | undefined;
      const fetchFn = mock((_url: string, init?: RequestInit) => {
        capturedBody = init?.body as string;
        return Promise.resolve(
          jsonResponse(
            includeDependencyIssues === true
              ? ISSUE_ANALYSIS_BODY
              : EXPRESS_BODY,
          ),
        );
      });
      const service = new PackageIntelligenceServiceImpl(
        ENDPOINT,
        createMockTokenProvider(),
        asFetchFn(fetchFn),
      );

      await service.packageDependencies({
        registry: "NPM",
        packageName: "express",
        ...(includeDependencyIssues === undefined
          ? {}
          : { includeDependencyIssues }),
      });

      const parsed = JSON.parse(capturedBody ?? "{}");
      expect(parsed.query).toContain(
        "$includeDependencyIssues: Boolean! = false",
      );
      expect(parsed.query).toContain(
        "dependencyIssues @include(if: $includeDependencyIssues)",
      );
      expect(parsed.variables.includeTransitive).toBe(
        expectedIncludeTransitive,
      );
      expect(parsed.variables.includeDependencyIssues).toBe(
        expectedIncludeDependencyIssues,
      );
      expect(parsed.variables.includeDependencyGraph).toBe(
        expectedIncludeDependencyGraph,
      );
    },
  );

  it("keeps bounded issue analysis on the requested transitive graph", async () => {
    let capturedBody: string | undefined;
    const fetchFn = mock((_url: string, init?: RequestInit) => {
      capturedBody = init?.body as string;
      return Promise.resolve(jsonResponse(ISSUE_ANALYSIS_BODY));
    });
    const service = new PackageIntelligenceServiceImpl(
      ENDPOINT,
      createMockTokenProvider(),
      asFetchFn(fetchFn),
    );

    await service.packageDependencies({
      registry: "NPM",
      packageName: "express",
      includeDependencyIssues: true,
      maxDepth: 4,
    });

    const parsed = JSON.parse(capturedBody ?? "{}");
    expect(parsed.variables).toMatchObject({
      includeTransitive: true,
      includeDependencyIssues: true,
      includeDependencyGraph: true,
      maxDepth: 4,
    });
  });

  it("can skip dependency groups and transitive details while keeping the graph", async () => {
    let capturedBody: string | undefined;
    const fetchFn = mock((_url: string, init?: RequestInit) => {
      capturedBody = init?.body as string;
      return Promise.resolve(jsonResponse(EXPRESS_BODY));
    });
    const service = new PackageIntelligenceServiceImpl(
      ENDPOINT,
      createMockTokenProvider(),
      asFetchFn(fetchFn),
    );
    await service.packageDependencies({
      registry: "NPM",
      packageName: "express",
      includeTransitive: true,
      includeTransitiveDetails: false,
      includeGroups: false,
      maxDepth: 1,
    });
    const parsed = JSON.parse(capturedBody ?? "{}");
    expect(parsed.variables.includeTransitive).toBe(true);
    expect(parsed.variables.includeDependencyGraph).toBe(true);
    expect(parsed.variables.includeTransitiveDetails).toBe(false);
    expect(parsed.variables.includeGroups).toBe(false);
  });

  it("normalizes selected dependency issue categories and conflict edges", async () => {
    const body = {
      data: {
        packageDependencies: {
          package: { name: "express", registry: "NPM", version: "5.2.1" },
          dependencies: {
            direct: [],
            transitive: {
              dependencyGraph: {
                formatVersion: 1,
                nodes: [
                  { registry: "NPM", name: "express", version: "5.2.1" },
                  {
                    registry: "NPM",
                    name: "parent-package",
                    version: "1.0.0",
                  },
                  {
                    registry: "NPM",
                    name: "conflicted-package",
                    version: "1.0.0",
                  },
                  {
                    registry: "NPM",
                    name: "conflicted-package",
                    version: "2.0.0",
                  },
                ],
                edges: [],
              },
              dependencyIssues: {
                totalCount: 4,
                deprecatedCount: 1,
                outdatedCount: 1,
                duplicateCount: 1,
                conflictCount: 1,
                deprecatedPackages: [
                  {
                    registry: "NPM",
                    name: "old-package",
                    versions: ["1.0.0"],
                    reasons: [{ version: "1.0.0", reason: "Use new-package" }],
                  },
                ],
                outdatedPackages: [
                  {
                    registry: "NPM",
                    name: "stale-package",
                    latestVersion: "2.0.0",
                    severity: "HIGH",
                    versions: [{ version: "1.0.0", severity: "HIGH" }],
                    repositoryUrl: "https://example.test/stale-package",
                  },
                ],
                duplicatePackages: [
                  {
                    registry: "NPM",
                    name: "duplicate-package",
                    versions: ["1.0.0", "2.0.0"],
                  },
                ],
                conflicts: [
                  {
                    registry: "NPM",
                    name: "conflicted-package",
                    versions: ["1.0.0", "2.0.0"],
                    requiredVersions: ["^1.0.0", "^2.0.0"],
                    conflictingEdges: [
                      {
                        fromIndex: null,
                        toIndex: 2,
                        versionConstraint: "^1.0.0",
                        dependencyType: "runtime",
                      },
                      {
                        fromIndex: 1,
                        toIndex: 3,
                        versionConstraint: "^2.0.0",
                        dependencyType: "peer",
                      },
                    ],
                  },
                ],
              },
            },
          },
          dependencyGroups: null,
        },
      },
    };
    const fetchFn = mock(() => Promise.resolve(jsonResponse(body)));
    const service = new PackageIntelligenceServiceImpl(
      ENDPOINT,
      createMockTokenProvider(),
      asFetchFn(fetchFn),
    );

    const report = await service.packageDependencies({
      registry: "NPM",
      packageName: "express",
      includeDependencyIssues: true,
    });

    expect(report.dependencies?.transitive?.dependencyIssues).toEqual({
      totalCount: 4,
      deprecatedCount: 1,
      outdatedCount: 1,
      duplicateCount: 1,
      conflictCount: 1,
      deprecatedPackages: [
        {
          registry: "NPM",
          name: "old-package",
          versions: ["1.0.0"],
          reasons: [{ version: "1.0.0", reason: "Use new-package" }],
        },
      ],
      outdatedPackages: [
        {
          registry: "NPM",
          name: "stale-package",
          latestVersion: "2.0.0",
          severity: "HIGH",
          versions: [{ version: "1.0.0", severity: "HIGH" }],
          repositoryUrl: "https://example.test/stale-package",
        },
      ],
      duplicatePackages: [
        {
          registry: "NPM",
          name: "duplicate-package",
          versions: ["1.0.0", "2.0.0"],
        },
      ],
      conflicts: [
        {
          registry: "NPM",
          name: "conflicted-package",
          versions: ["1.0.0", "2.0.0"],
          requiredVersions: ["^1.0.0", "^2.0.0"],
          conflictingEdges: [
            {
              fromIndex: undefined,
              toIndex: 2,
              versionConstraint: "^1.0.0",
              dependencyType: "runtime",
            },
            {
              fromIndex: 1,
              toIndex: 3,
              versionConstraint: "^2.0.0",
              dependencyType: "peer",
            },
          ],
        },
      ],
    });
  });

  it.each([
    [
      "missing issue summary",
      { dependencyIssues: undefined },
      "Dependency issue analysis response missing dependency issues.",
    ],
    [
      "null issue summary",
      { dependencyIssues: null },
      "Dependency issue analysis response missing dependency issues.",
    ],
    [
      "missing companion graph",
      { dependencyGraph: undefined },
      "Dependency issue analysis response missing dependency graph.",
    ],
    [
      "null companion graph",
      { dependencyGraph: null },
      "Dependency issue analysis response missing dependency graph.",
    ],
  ] as const)(
    "rejects explicit issue analysis with %s",
    async (_label, options, message) => {
      const fetchFn = mock(() =>
        Promise.resolve(jsonResponse(createIssueAnalysisBody(options))),
      );
      const service = new PackageIntelligenceServiceImpl(
        ENDPOINT,
        createMockTokenProvider(),
        asFetchFn(fetchFn),
      );

      const result = await service
        .packageDependencies({
          registry: "NPM",
          packageName: "express",
          includeDependencyIssues: true,
        })
        .catch((error: unknown) => error);

      expect(result).toBeInstanceOf(MalformedPackageIntelligenceResponseError);
      expect(result).toMatchObject({ message });
    },
  );

  it.each([
    ["missing", false, undefined],
    ["null", true, null],
  ] as const)(
    "rejects ordinary transitive conflicts with %s dependency graph when edges are present",
    async (_label, includeGraph, dependencyGraph) => {
      const fetchFn = mock(() =>
        Promise.resolve(
          jsonResponse(
            createTransitiveConflictBody(includeGraph, dependencyGraph),
          ),
        ),
      );
      const service = new PackageIntelligenceServiceImpl(
        ENDPOINT,
        createMockTokenProvider(),
        asFetchFn(fetchFn),
      );

      const result = await service
        .packageDependencies({
          registry: "NPM",
          packageName: "express",
          includeTransitive: true,
        })
        .catch((error: unknown) => error);

      expect(result).toBeInstanceOf(MalformedPackageIntelligenceResponseError);
      expect(result).toMatchObject({
        message:
          "Transitive dependency conflict edges response missing dependency graph.",
      });
    },
  );

  it("accepts edge-free ordinary conflicts without a dependency graph", async () => {
    const fetchFn = mock(() =>
      Promise.resolve(
        jsonResponse(createTransitiveConflictBody(true, null, [])),
      ),
    );
    const service = new PackageIntelligenceServiceImpl(
      ENDPOINT,
      createMockTokenProvider(),
      asFetchFn(fetchFn),
    );

    const report = await service.packageDependencies({
      registry: "NPM",
      packageName: "express",
      includeTransitive: true,
    });

    expect(report.dependencies?.transitive?.dependencyConflicts).toEqual([
      {
        packageName: "shared",
        requiredVersions: ["^1.0.0", "^2.0.0"],
        conflictingEdges: [],
      },
    ]);
  });

  it("omits lifecycle when empty array (treated as 'no filter')", async () => {
    let capturedBody: string | undefined;
    const fetchFn = mock((_url: string, init?: RequestInit) => {
      capturedBody = init?.body as string;
      return Promise.resolve(jsonResponse(EXPRESS_BODY));
    });
    const service = new PackageIntelligenceServiceImpl(
      ENDPOINT,
      createMockTokenProvider(),
      asFetchFn(fetchFn),
    );
    await service.packageDependencies({
      registry: "NPM",
      packageName: "express",
      lifecycle: [],
    });
    const parsed = JSON.parse(capturedBody ?? "{}");
    expect(parsed.variables.lifecycle).toBeUndefined();
  });

  it("promotes a generic 'no matching version' error to VERSION_NOT_FOUND when version was requested", async () => {
    const fetchFn = mock(() =>
      Promise.resolve(
        jsonResponse({ errors: [{ message: "No matching version found" }] }),
      ),
    );
    const service = new PackageIntelligenceServiceImpl(
      ENDPOINT,
      createMockTokenProvider(),
      asFetchFn(fetchFn),
    );
    try {
      await service.packageDependencies({
        registry: "NPM",
        packageName: "express",
        version: "99.99.99",
      });
      throw new Error("expected VERSION_NOT_FOUND promotion");
    } catch (err) {
      expect(err).toBeInstanceOf(PackageIntelligenceVersionNotFoundError);
      const typed = err as PackageIntelligenceVersionNotFoundError;
      expect(typed.packageName).toBe("npm:express");
      expect(typed.requestedVersion).toBe("99.99.99");
    }
  });

  it("does NOT promote when graphqlCode is present", async () => {
    const fetchFn = mock(() =>
      Promise.resolve(
        jsonResponse({
          errors: [
            {
              message: "no matching version (backend mid-recovery)",
              extensions: { code: "INTERNAL_ERROR" },
            },
          ],
        }),
      ),
    );
    const service = new PackageIntelligenceServiceImpl(
      ENDPOINT,
      createMockTokenProvider(),
      asFetchFn(fetchFn),
    );
    try {
      await service.packageDependencies({
        registry: "NPM",
        packageName: "express",
        version: "99.99.99",
      });
      throw new Error("expected BackendError");
    } catch (err) {
      expect(err).not.toBeInstanceOf(PackageIntelligenceVersionNotFoundError);
      expect(err).toBeInstanceOf(PackageIntelligenceBackendError);
    }
  });

  it("classifies typed VERSION_NOT_FOUND response with structured details", async () => {
    const fetchFn = mock(() =>
      Promise.resolve(
        jsonResponse({
          errors: [
            {
              message: "version missing",
              extensions: {
                code: "VERSION_NOT_FOUND",
                package: "npm:express",
                requested_version: "99.0.0",
                available_versions: ["5.2.1", "5.2.0"],
              },
            },
          ],
        }),
      ),
    );
    const service = new PackageIntelligenceServiceImpl(
      ENDPOINT,
      createMockTokenProvider(),
      asFetchFn(fetchFn),
    );
    try {
      await service.packageDependencies({
        registry: "NPM",
        packageName: "express",
        version: "99.0.0",
      });
      throw new Error("expected VERSION_NOT_FOUND");
    } catch (err) {
      expect(err).toBeInstanceOf(PackageIntelligenceVersionNotFoundError);
      const typed = err as PackageIntelligenceVersionNotFoundError;
      expect(typed.availableVersions).toEqual(["5.2.1", "5.2.0"]);
    }
  });

  it("throws Malformed when package.name or package.version is missing", async () => {
    const body = {
      data: {
        packageDependencies: {
          package: { name: null, registry: "NPM", version: "5.2.1" },
          dependencies: null,
          dependencyGroups: null,
        },
      },
    };
    const fetchFn = mock(() => Promise.resolve(jsonResponse(body)));
    const service = new PackageIntelligenceServiceImpl(
      ENDPOINT,
      createMockTokenProvider(),
      asFetchFn(fetchFn),
    );
    await expect(
      service.packageDependencies({ registry: "NPM", packageName: "x" }),
    ).rejects.toBeInstanceOf(MalformedPackageIntelligenceResponseError);
  });

  it("throws Malformed when a direct[] entry has a null name (no silent empty-string coercion)", async () => {
    const body = {
      data: {
        packageDependencies: {
          package: { name: "express", registry: "NPM", version: "5.2.1" },
          dependencies: {
            direct: [
              { name: null, versionConstraint: "^1.0.0", type: "runtime" },
            ],
            transitive: null,
          },
          dependencyGroups: null,
        },
      },
    };
    const fetchFn = mock(() => Promise.resolve(jsonResponse(body)));
    const service = new PackageIntelligenceServiceImpl(
      ENDPOINT,
      createMockTokenProvider(),
      asFetchFn(fetchFn),
    );
    await expect(
      service.packageDependencies({ registry: "NPM", packageName: "x" }),
    ).rejects.toBeInstanceOf(MalformedPackageIntelligenceResponseError);
  });
});
