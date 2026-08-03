import { describe, expect, it, mock } from "bun:test";
import { AuthenticationError } from "./githits-service.js";
import {
  MalformedPackageIntelligenceResponseError,
  PackageIntelligenceAccessError,
  PackageIntelligenceFeatureFlagRequiredError,
  PackageIntelligenceValidationError,
} from "./package-intelligence-service.js";
import {
  RESOLVE_TARGET_QUERY,
  ResolveTargetServiceImpl,
} from "./resolve-target-service.js";
import { createMockTokenProvider } from "./test-helpers.js";

const ENDPOINT = "https://pkgseer.dev";

const COMPACT_CANDIDATE = {
  kind: "PACKAGE",
  canonicalKey: "npm:express",
  displayName: "express",
  description: "Fast web framework",
  registry: "NPM",
  stars: 66_000,
  downloadsLastMonth: 89_000_000,
  docsAvailable: true,
  codeAvailable: true,
  protected: true,
  confidence: "EXACT",
};

const DETAILED_CANDIDATE = {
  ...COMPACT_CANDIDATE,
  packageName: "express",
  latestVersion: "5.1.0",
  repositoryUrl: "https://github.com/expressjs/express",
  repositoryOwner: "expressjs",
  repositoryName: "express",
  downloadsTotal: null,
  documentationUrl: "https://expressjs.com",
  matchedAliases: ["express"],
  matchTier: 0,
  score: 100,
  reason: "Exact package identity match",
};

function resultBody(candidate: Record<string, unknown>) {
  return {
    data: {
      resolveTarget: {
        best: candidate,
        protectedMatches: [candidate],
        candidates: [candidate],
        ambiguous: false,
        ambiguousReason: "NOT_AMBIGUOUS",
      },
    },
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function asFetchFn<T extends (...args: never[]) => unknown>(
  fn: T,
): typeof fetch {
  return fn as unknown as typeof fetch;
}

describe("ResolveTargetServiceImpl", () => {
  it("fetches the compact field set with only normalized resolver variables", async () => {
    let capturedBody: string | undefined;
    const fetchFn = mock((_url: string, init?: RequestInit) => {
      capturedBody = init?.body as string;
      return Promise.resolve(jsonResponse(resultBody(COMPACT_CANDIDATE)));
    });
    const service = new ResolveTargetServiceImpl(
      ENDPOINT,
      createMockTokenProvider(),
      asFetchFn(fetchFn),
    );

    const result = await service.resolveTarget({
      name: "express",
      limit: 8,
      includeDetailedFields: false,
    });

    const request = JSON.parse(capturedBody ?? "{}");
    expect(request.variables).toEqual({
      name: "express",
      limit: 8,
      includeDetailedFields: false,
    });
    expect(request.query).toBe(RESOLVE_TARGET_QUERY);
    for (const field of [
      "kind",
      "canonicalKey",
      "displayName",
      "description",
      "registry",
      "stars",
      "downloadsLastMonth",
      "docsAvailable",
      "codeAvailable",
      "protected",
      "confidence",
    ]) {
      expect(request.query).toContain(`  ${field}\n`);
      expect(request.query).not.toContain(`${field} @include`);
    }
    for (const field of [
      "packageName",
      "latestVersion",
      "repositoryUrl",
      "repositoryOwner",
      "repositoryName",
      "downloadsTotal",
      "documentationUrl",
      "matchedAliases",
      "matchTier",
      "score",
      "reason",
    ]) {
      expect(request.query).toContain(
        `${field} @include(if: $includeDetailedFields)`,
      );
    }
    expect(request.query).not.toContain("inspection");
    expect(result.best).toEqual(COMPACT_CANDIDATE);
  });

  it("fetches and parses detailed fields for JSON output", async () => {
    let capturedBody: string | undefined;
    const fetchFn = mock((_url: string, init?: RequestInit) => {
      capturedBody = init?.body as string;
      return Promise.resolve(jsonResponse(resultBody(DETAILED_CANDIDATE)));
    });
    const service = new ResolveTargetServiceImpl(
      ENDPOINT,
      createMockTokenProvider(),
      asFetchFn(fetchFn),
    );

    const result = await service.resolveTarget({
      name: "express",
      query: "web framework",
      registries: ["NPM"],
      preferredKinds: ["PACKAGE"],
      intentHints: ["server"],
      limit: 3,
      includeDetailedFields: true,
    });

    const request = JSON.parse(capturedBody ?? "{}");
    expect(request.variables).toEqual({
      name: "express",
      query: "web framework",
      registries: ["NPM"],
      preferredKinds: ["PACKAGE"],
      intentHints: ["server"],
      limit: 3,
      includeDetailedFields: true,
    });
    expect(result.best).toEqual({
      ...DETAILED_CANDIDATE,
      downloadsTotal: undefined,
    });
    expect(result.best).not.toHaveProperty("downloadsTotal");
  });

  it("requires detailed non-null fields only in detailed mode", async () => {
    const compactService = new ResolveTargetServiceImpl(
      ENDPOINT,
      createMockTokenProvider(),
      asFetchFn(
        mock(() =>
          Promise.resolve(jsonResponse(resultBody(COMPACT_CANDIDATE))),
        ),
      ),
    );
    await expect(
      compactService.resolveTarget({
        name: "express",
        limit: 8,
        includeDetailedFields: false,
      }),
    ).resolves.toBeDefined();

    const detailedService = new ResolveTargetServiceImpl(
      ENDPOINT,
      createMockTokenProvider(),
      asFetchFn(
        mock(() =>
          Promise.resolve(jsonResponse(resultBody(COMPACT_CANDIDATE))),
        ),
      ),
    );
    await expect(
      detailedService.resolveTarget({
        name: "express",
        limit: 8,
        includeDetailedFields: true,
      }),
    ).rejects.toBeInstanceOf(MalformedPackageIntelligenceResponseError);
  });

  it("rejects compact responses missing always-selected fields", async () => {
    const { confidence: _confidence, ...malformed } = COMPACT_CANDIDATE;
    const service = new ResolveTargetServiceImpl(
      ENDPOINT,
      createMockTokenProvider(),
      asFetchFn(
        mock(() => Promise.resolve(jsonResponse(resultBody(malformed)))),
      ),
    );

    await expect(
      service.resolveTarget({
        name: "express",
        limit: 8,
        includeDetailedFields: false,
      }),
    ).rejects.toBeInstanceOf(MalformedPackageIntelligenceResponseError);
  });

  it("refreshes after a GraphQL authentication failure", async () => {
    let calls = 0;
    const fetchFn = mock(() => {
      calls++;
      if (calls === 1) {
        return Promise.resolve(
          jsonResponse({
            errors: [
              { message: "unauthorized", extensions: { code: "UNAUTHORIZED" } },
            ],
          }),
        );
      }
      return Promise.resolve(jsonResponse(resultBody(COMPACT_CANDIDATE)));
    });
    const forceRefresh = mock(() => Promise.resolve("new-token"));
    const service = new ResolveTargetServiceImpl(
      ENDPOINT,
      createMockTokenProvider({ forceRefresh }),
      asFetchFn(fetchFn),
    );

    await expect(
      service.resolveTarget({
        name: "express",
        limit: 8,
        includeDetailedFields: false,
      }),
    ).resolves.toBeDefined();
    expect(forceRefresh).toHaveBeenCalledTimes(1);
  });

  it("preserves shared HTTP access classification", async () => {
    const service = new ResolveTargetServiceImpl(
      ENDPOINT,
      createMockTokenProvider(),
      asFetchFn(
        mock(() => Promise.resolve(jsonResponse({ detail: "no access" }, 403))),
      ),
    );

    await expect(
      service.resolveTarget({
        name: "express",
        limit: 8,
        includeDetailedFields: false,
      }),
    ).rejects.toBeInstanceOf(PackageIntelligenceAccessError);
  });

  it("maps feature-gate and validation GraphQL errors", async () => {
    for (const [code, errorClass] of [
      ["FEATURE_FLAG_REQUIRED", PackageIntelligenceFeatureFlagRequiredError],
      ["VALIDATION_ERROR", PackageIntelligenceValidationError],
    ] as const) {
      const service = new ResolveTargetServiceImpl(
        ENDPOINT,
        createMockTokenProvider(),
        asFetchFn(
          mock(() =>
            Promise.resolve(
              jsonResponse({
                errors: [{ message: code, extensions: { code } }],
              }),
            ),
          ),
        ),
      );

      await expect(
        service.resolveTarget({
          name: "express",
          limit: 8,
          includeDetailedFields: false,
        }),
      ).rejects.toBeInstanceOf(errorClass);
    }
  });

  it("propagates authentication when refresh cannot supply a token", async () => {
    const service = new ResolveTargetServiceImpl(
      ENDPOINT,
      createMockTokenProvider({
        forceRefresh: mock(() => Promise.resolve(undefined)),
      }),
      asFetchFn(
        mock(() =>
          Promise.resolve(
            jsonResponse({
              errors: [
                {
                  message: "unauthorized",
                  extensions: { code: "UNAUTHORIZED" },
                },
              ],
            }),
          ),
        ),
      ),
    );

    await expect(
      service.resolveTarget({
        name: "express",
        limit: 8,
        includeDetailedFields: false,
      }),
    ).rejects.toBeInstanceOf(AuthenticationError);
  });
});
