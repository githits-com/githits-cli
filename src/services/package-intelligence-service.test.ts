import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { AuthenticationError } from "./githits-service.js";
import {
  MalformedPackageIntelligenceResponseError,
  PackageIntelligenceAccessError,
  PackageIntelligenceBackendError,
  PackageIntelligenceFeatureFlagRequiredError,
  PackageIntelligenceNetworkError,
  PackageIntelligenceServiceImpl,
  PackageIntelligenceTargetNotFoundError,
  PackageIntelligenceValidationError,
} from "./package-intelligence-service.js";
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

const HAPPY_BODY = {
  data: {
    packageSummary: {
      package: {
        name: "express",
        registry: "NPM",
        description: "Fast web framework",
        latestVersion: "4.18.2",
        latestVersionPublishedAt: "2023-05-28T00:00:00Z",
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
      quickstart: {
        installCommand: "npm install express",
        usageExample: "const express = require('express')",
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
    expect(result.package.downloadsLastMonth).toBe(86_000_000);
    expect(result.package.githubRepository?.stargazersCount).toBe(63_400);
    expect(result.security?.vulnerabilityCount).toBe(5);
    expect(result.quickstart?.installCommand).toBe("npm install express");
    expect(result.latestChangelogs?.[0]?.version).toBe("4.18.2");
  });

  it("preserves null blocks (security / quickstart / github absent)", async () => {
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
          quickstart: null,
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
    expect(result.quickstart).toBeUndefined();
    expect(result.latestChangelogs).toBeUndefined();
  });

  it("throws MalformedPackageIntelligenceResponseError when name is null", async () => {
    const body = {
      data: {
        packageSummary: {
          package: { name: null, latestVersion: "1.0.0" },
          security: null,
          quickstart: null,
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
          quickstart: null,
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

  it("sends packageSummary query with registry + name vars and latestChangelogs(limit: 3)", async () => {
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
    expect(parsed.query).toContain("latestChangelogs(limit: 3)");
    expect(parsed.variables).toEqual({ registry: "NPM", name: "express" });
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
});
