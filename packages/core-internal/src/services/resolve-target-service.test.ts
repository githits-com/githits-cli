import { describe, expect, it, mock } from "bun:test";
import { AuthenticationError } from "./githits-service.js";
import {
  MalformedPackageIntelligenceResponseError,
  PackageIntelligenceAccessError,
  PackageIntelligenceFeatureFlagRequiredError,
  PackageIntelligenceNetworkError,
  PackageIntelligenceValidationError,
} from "./package-intelligence-service.js";
import {
  RESOLVE_TARGET_QUERY,
  ResolveTargetServiceImpl,
} from "./resolve-target-service.js";
import { createMockTokenProvider } from "./test-helpers.js";

const ENDPOINT = "https://pkgseer.dev";

const LIST_CANDIDATE = {
  kind: "PACKAGE",
  canonicalKey: "npm:express",
  latestVersionMaliciousStatus: "CLEAR",
};

const COMPACT_CANDIDATE = {
  ...LIST_CANDIDATE,
  displayName: "express",
  description: "Fast web framework",
  registry: "NPM",
  latestVersion: "5.1.0",
  latestVersionMaliciousEvidence: null,
  repositoryUrl: "https://github.com/expressjs/express",
  stars: 66_000,
  downloadsLastMonth: 89_000_000,
  downloadsTotal: null,
  docsAvailable: true,
  codeAvailable: true,
  groupKey: "g1",
  match: { confidence: "EXACT" },
  docsPageCount: 128,
  codeFileCount: 1_200,
  license: "MIT",
};

const DETAILED_CANDIDATE = {
  ...COMPACT_CANDIDATE,
  packageName: "express",
  repositoryOwner: "expressjs",
  repositoryName: "express",
  documentationUrl: "https://expressjs.com",
  match: {
    confidence: "EXACT",
    matchedAliases: ["express"],
    matchTier: 0,
    score: 100,
    reason: "Exact package identity match",
  },
};

const MALICIOUS_EVIDENCE = {
  advisories: [
    {
      osvId: "MAL-2026-1234",
      classificationReasons: ["AFFECTED_VERSION_RANGE_MATCH"],
    },
  ],
  totalCount: 1,
  truncated: false,
};

function resultBody(
  candidate: Record<string, unknown>,
  overrides: Record<string, unknown> = {},
) {
  return {
    data: {
      resolveTarget: {
        best: {
          kind: "PACKAGE",
          canonicalKey: "npm:express",
          confidence: "EXACT",
        },
        protectedMatches: [
          {
            kind: "PACKAGE",
            canonicalKey: "npm:express",
            confidence: "EXACT",
          },
        ],
        targets: [candidate],
        targetsTruncated: false,
        ambiguous: false,
        ambiguousReason: "NOT_AMBIGUOUS",
        ...overrides,
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
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(request.query).toBe(RESOLVE_TARGET_QUERY);
    expect(request.query).not.toContain("candidates");
    expect(request.query).toContain(`best {
      ...ResolveTargetReferenceFields
    }`);
    expect(request.query).toContain(`protectedMatches {
      ...ResolveTargetReferenceFields
    }`);
    expect(request.query).toContain(`targets {
      ...ResolveTargetListFields
      ...ResolveTargetJsonFields @include(if: $includeDetailedFields)
      match {
        confidence
        ...ResolveTargetMatchJsonFields @include(if: $includeDetailedFields)`);
    expect(
      request.query,
    ).toContain(`fragment ResolveTargetReferenceFields on TargetResolutionCandidate {
  kind
  canonicalKey
  confidence
}`);
    expect(request.query.match(/\.\.\.ResolveTargetJsonFields/g)).toHaveLength(
      1,
    );
    expect(request.query.match(/\.\.\.ResolveTargetListFields/g)).toHaveLength(
      1,
    );
    expect(
      request.query.match(/\.\.\.ResolveTargetMatchJsonFields/g),
    ).toHaveLength(1);
    for (const field of [
      "kind",
      "canonicalKey",
      "confidence",
      "latestVersionMaliciousStatus",
      "description",
      "repositoryUrl",
      "stars",
      "downloadsLastMonth",
      "downloadsTotal",
      "docsAvailable",
      "codeAvailable",
      "groupKey",
      "docsPageCount",
      "codeFileCount",
      "license",
    ]) {
      expect(request.query).toContain(`  ${field}\n`);
      expect(request.query).not.toContain(`${field} @include`);
    }
    for (const field of [
      "displayName",
      "registry",
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
      expect(request.query).toContain(`  ${field}\n`);
    }
    expect(request.query).not.toContain("inspection");
    expect(request.query).toContain(`latestVersionMaliciousEvidence {
    advisories {
      osvId
      classificationReasons
    }
    totalCount
    truncated
  }`);
    const compactResult = {
      ...LIST_CANDIDATE,
      description: "Fast web framework",
      repositoryUrl: "https://github.com/expressjs/express",
      stars: 66_000,
      downloadsLastMonth: 89_000_000,
      docsAvailable: true,
      codeAvailable: true,
      groupKey: "g1",
      match: { confidence: "EXACT" },
      docsPageCount: 128,
      codeFileCount: 1_200,
      license: "MIT",
    };
    expect(result.best).toEqual({
      kind: "PACKAGE",
      canonicalKey: "npm:express",
      confidence: "EXACT",
    });
    expect(result.protectedMatches).toEqual([
      {
        kind: "PACKAGE",
        canonicalKey: "npm:express",
        confidence: "EXACT",
      },
    ]);
    expect(result.targets).toEqual([compactResult]);
    expect(result.targetsTruncated).toBe(false);
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
      kind: "PACKAGE",
      canonicalKey: "npm:express",
      confidence: "EXACT",
    });
    const {
      latestVersionMaliciousEvidence: _evidence,
      downloadsTotal: _downloadsTotal,
      ...detailedResult
    } = DETAILED_CANDIDATE;
    expect(result.targets[0]).toEqual(detailedResult);
    expect(result.targets[0]).not.toHaveProperty("downloadsTotal");
  });

  it("parses bounded malicious advisory evidence in compact mode", async () => {
    const affected = {
      ...COMPACT_CANDIDATE,
      latestVersionMaliciousStatus: "AFFECTED",
      latestVersionMaliciousEvidence: MALICIOUS_EVIDENCE,
    };
    const service = new ResolveTargetServiceImpl(
      ENDPOINT,
      createMockTokenProvider(),
      asFetchFn(
        mock(() => Promise.resolve(jsonResponse(resultBody(affected)))),
      ),
    );

    const result = await service.resolveTarget({
      name: "express",
      limit: 8,
      includeDetailedFields: false,
    });

    expect(result.targets[0]?.latestVersionMaliciousEvidence).toEqual(
      MALICIOUS_EVIDENCE,
    );
  });

  it("parses relation-only targets, missing presentation signals, zero counts, and truncation", async () => {
    const related = {
      ...COMPACT_CANDIDATE,
      kind: "SITE",
      canonicalKey: "site:expressjs.com",
      latestVersionMaliciousStatus: "NOT_APPLICABLE",
      repositoryUrl: null,
      stars: null,
      downloadsLastMonth: null,
      downloadsTotal: null,
      codeAvailable: false,
      match: null,
      docsPageCount: 0,
      codeFileCount: null,
      license: null,
    };
    const service = new ResolveTargetServiceImpl(
      ENDPOINT,
      createMockTokenProvider(),
      asFetchFn(
        mock(() =>
          Promise.resolve(
            jsonResponse(
              resultBody(related, {
                targetsTruncated: true,
              }),
            ),
          ),
        ),
      ),
    );

    const parsed = await service.resolveTarget({
      name: "expressjs",
      limit: 8,
      includeDetailedFields: false,
    });

    expect(parsed.targetsTruncated).toBe(true);
    expect(parsed.targets).toEqual([
      {
        kind: "SITE",
        canonicalKey: "site:expressjs.com",
        latestVersionMaliciousStatus: "NOT_APPLICABLE",
        description: "Fast web framework",
        docsAvailable: true,
        codeAvailable: false,
        groupKey: "g1",
        docsPageCount: 0,
      },
    ]);
  });

  it("rejects malformed malicious advisory evidence", async () => {
    const malformed = {
      ...COMPACT_CANDIDATE,
      latestVersionMaliciousStatus: "UNKNOWN",
      latestVersionMaliciousEvidence: {
        advisories: [{ osvId: "MAL-2026-1234" }],
        totalCount: 1,
        truncated: false,
      },
    };
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
    const { confidence: _confidence, ...missingMatchConfidence } =
      COMPACT_CANDIDATE.match;
    const missingConfidence = {
      ...COMPACT_CANDIDATE,
      match: missingMatchConfidence,
    };
    const {
      latestVersionMaliciousEvidence: _evidence,
      ...missingMaliciousEvidence
    } = COMPACT_CANDIDATE;

    for (const malformed of [missingConfidence, missingMaliciousEvidence]) {
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
    }
  });

  it("requires a non-null malicious status and preserves future values", async () => {
    for (const invalidStatus of [undefined, null]) {
      const malformed = {
        ...COMPACT_CANDIDATE,
        latestVersionMaliciousStatus: invalidStatus,
      };
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
    }

    const futureStatus = {
      ...COMPACT_CANDIDATE,
      latestVersionMaliciousStatus: "REVIEW_REQUIRED",
    };
    const service = new ResolveTargetServiceImpl(
      ENDPOINT,
      createMockTokenProvider(),
      asFetchFn(
        mock(() => Promise.resolve(jsonResponse(resultBody(futureStatus)))),
      ),
    );

    const result = await service.resolveTarget({
      name: "express",
      limit: 8,
      includeDetailedFields: false,
    });
    expect(result.targets[0]?.latestVersionMaliciousStatus).toBe(
      "REVIEW_REQUIRED",
    );
  });

  it("refreshes after the backend GraphQL authentication-required code", async () => {
    let calls = 0;
    const fetchFn = mock(() => {
      calls++;
      if (calls === 1) {
        return Promise.resolve(
          jsonResponse({
            errors: [
              {
                message: "Authentication required",
                extensions: { code: "AUTHENTICATION_REQUIRED" },
              },
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

  it("preserves shared transport-error classification", async () => {
    const service = new ResolveTargetServiceImpl(
      ENDPOINT,
      createMockTokenProvider(),
      asFetchFn(mock(() => Promise.reject(new TypeError("network failed")))),
    );

    await expect(
      service.resolveTarget({
        name: "express",
        limit: 8,
        includeDetailedFields: false,
      }),
    ).rejects.toBeInstanceOf(PackageIntelligenceNetworkError);
  });

  it("rejects an empty resolveTarget payload", async () => {
    const service = new ResolveTargetServiceImpl(
      ENDPOINT,
      createMockTokenProvider(),
      asFetchFn(
        mock(() =>
          Promise.resolve(jsonResponse({ data: { resolveTarget: null } })),
        ),
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
