import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import {
  AuthenticationError,
  ClientUpdateRequiredError,
  CodeDiffError,
  CodeNavigationAccessError,
  CodeNavigationBackendError,
  CodeNavigationFeatureFlagRequiredError,
  CodeNavigationFileNotFoundError,
  CodeNavigationGraphQLError,
  CodeNavigationIndexingError,
  CodeNavigationNetworkError,
  CodeNavigationRefNotFoundError,
  CodeNavigationTargetNotFoundError,
  CodeNavigationUnresolvableError,
  CodeNavigationValidationError,
  CodeNavigationVersionNotFoundError,
  MalformedCodeNavigationResponseError,
  TermsAcceptanceRequiredError,
} from "@githits/core-internal";
import { mapCodeNavigationError } from "./code-navigation-error-map.js";

class InvalidPackageSpecError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidPackageSpecError";
  }
}

class UnsupportedRegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedRegistryError";
  }
}

describe("mapCodeNavigationError", () => {
  it("maps terms gating with stable command and URL remediation", () => {
    expect(
      mapCodeNavigationError(new TermsAcceptanceRequiredError()),
    ).toMatchObject({
      code: "TERMS_ACCEPTANCE_REQUIRED",
      retryable: false,
      details: {
        action: "githits settings terms accept",
        termsUrl: "https://githits.com/legal/terms-of-service/",
        acceptanceUrl: "https://app.githits.com/settings/privacy",
      },
    });
  });
  it("classifies ClientUpdateRequiredError as UPDATE_REQUIRED", () => {
    expect(
      mapCodeNavigationError(
        new ClientUpdateRequiredError(undefined, undefined, "0.2.0"),
      ),
    ).toEqual({
      code: "UPDATE_REQUIRED",
      message: "Update required: Backend protocol changed",
      retryable: false,
      details: {
        currentVersion: "0.2.0",
        reason: "Backend protocol changed",
        updateCommand: "npm i -g githits@latest",
      },
    });
  });

  it("classifies CodeDiff version failures with bounded recovery details", () => {
    const error = new CodeDiffError("Version was not published.", {
      code: "VERSION_NOT_FOUND",
      retryable: false,
      side: "from",
      registry: "NPM",
      publishedVersions: ["2.0.0", "1.0.0"],
      publishedVersionsTruncated: true,
    });

    expect(mapCodeNavigationError(error)).toEqual({
      code: "VERSION_NOT_FOUND",
      message: "Version was not published.",
      retryable: false,
      details: {
        side: "from",
        registry: "NPM",
        publishedVersions: ["2.0.0", "1.0.0"],
        publishedVersionsTruncated: true,
      },
    });
  });

  it("classifies ambiguous CodeDiff refs without exposing the raw code", () => {
    const error = new CodeDiffError("Ref is ambiguous.", {
      code: "AMBIGUOUS_REF",
      repoUrl: "https://github.com/example/repo",
      gitRef: "release",
      availableRefs: [{ ref: "refs/heads/release" }],
      suggestedRefs: [{ ref: "refs/tags/release", version: "1.0.0" }],
      refKinds: ["BRANCH", "TAG"],
    });

    expect(mapCodeNavigationError(error)).toEqual({
      code: "REF_NOT_FOUND",
      message: "Ref is ambiguous.",
      retryable: false,
      details: {
        repoUrl: "https://github.com/example/repo",
        gitRef: "release",
        availableRefs: [{ ref: "refs/heads/release" }],
        suggestedRefs: [{ ref: "refs/tags/release", version: "1.0.0" }],
        refKinds: ["BRANCH", "TAG"],
      },
    });
  });

  it("preserves exact root identity for a CodeDiff raw-field failure", () => {
    const error = new CodeDiffError(
      "Raw diff limit exceeded.",
      {
        code: "RAW_DIFF_LIMIT_EXCEEDED",
        retryable: false,
        stage: "content",
        limitKind: "max_content_entries",
      },
      {
        package: {
          registry: "NPM",
          name: "example",
          repoUrl: "https://github.com/example/repo",
        },
        fromResolution: {
          requested: "1.0.0",
          resolvedVersion: "1.0.0",
          ref: "v1.0.0",
          commitSha: "0123456789abcdef0123456789abcdef01234567",
          refKind: "TAG",
          versionSource: "REGISTRY",
        },
        toResolution: {
          requested: "2.0.0",
          resolvedVersion: "2.0.0",
          ref: "v2.0.0",
          commitSha: "fedcba9876543210fedcba9876543210fedcba98",
          refKind: "TAG",
          versionSource: "REGISTRY",
        },
      },
    );

    const mapped = mapCodeNavigationError(error);
    expect(mapped.code).toBe("BACKEND_ERROR");
    expect(mapped.retryable).toBe(false);
    expect(mapped.details).toMatchObject({
      stage: "content",
      limitKind: "max_content_entries",
      codeDiffResolution: {
        package: { registry: "NPM", name: "example" },
        from: { commitSha: "0123456789abcdef0123456789abcdef01234567" },
        to: { commitSha: "fedcba9876543210fedcba9876543210fedcba98" },
      },
    });
    expect(mapped.details).not.toHaveProperty("graphqlCode");
  });

  it.each([
    ["VALIDATION_ERROR", "INVALID_ARGUMENT", false],
    ["REF_NOT_FOUND", "REF_NOT_FOUND", false],
    ["REPOSITORY_NOT_FOUND", "NOT_FOUND", false],
    ["TIMEOUT", "TIMEOUT", true],
    ["RATE_LIMITED", "RATE_LIMITED", true],
    ["RAW_DIFF_UNAVAILABLE", "BACKEND_ERROR", false],
    [undefined, "BACKEND_ERROR", false],
  ] as const)(
    "maps CodeDiff code %s to %s",
    (graphqlCode, expectedCode, retryable) => {
      const mapped = mapCodeNavigationError(
        new CodeDiffError("failure", {
          code: graphqlCode,
          retryAfterMs: 250,
        }),
      );
      expect(mapped).toMatchObject({
        code: expectedCode,
        retryable,
        details: { retryAfterMs: 250 },
      });
    },
  );

  it("classifies CodeNavigationTargetNotFoundError as NOT_FOUND", () => {
    const err = new CodeNavigationTargetNotFoundError("Package not found", [
      { version: "5.2.1", ref: "v5.2.1" },
    ]);
    expect(mapCodeNavigationError(err)).toEqual({
      code: "NOT_FOUND",
      message: "Package not found",
      retryable: false,
      details: { availableVersions: [{ version: "5.2.1", ref: "v5.2.1" }] },
    });
  });

  it("preserves backend metadata on typed not-found errors", () => {
    const err = new CodeNavigationTargetNotFoundError(
      "Target not found.",
      undefined,
      undefined,
      undefined,
      {
        hint: "Use the canonical package name.",
        availableRefs: [{ ref: "main" }],
        suggestedRefs: [{ ref: "v5.2.1" }],
        indexingEstimate: { lowerSeconds: 3, upperSeconds: 8 },
      },
    );

    expect(mapCodeNavigationError(err)).toEqual({
      code: "NOT_FOUND",
      message: "Target not found.",
      retryable: false,
      details: {
        hint: "Use the canonical package name.",
        availableRefs: [{ ref: "main" }],
        suggestedRefs: [{ ref: "v5.2.1" }],
        indexingEstimate: { lowerSeconds: 3, upperSeconds: 8 },
      },
    });
  });

  it("classifies CodeNavigationTargetNotFoundError without availableVersions", () => {
    const err = new CodeNavigationTargetNotFoundError("Package not found");
    expect(mapCodeNavigationError(err)).toEqual({
      code: "NOT_FOUND",
      message: "Package not found",
      retryable: false,
    });
  });

  it("classifies repository CodeNavigationTargetNotFoundError with repository details", () => {
    const err = new CodeNavigationTargetNotFoundError(
      "Repository not found or inaccessible",
      undefined,
      "https://github.com/acme/missing",
      "main",
    );
    expect(mapCodeNavigationError(err)).toEqual({
      code: "NOT_FOUND",
      message: "Repository not found or inaccessible",
      retryable: false,
      details: {
        repoUrl: "https://github.com/acme/missing",
        requestedRef: "main",
      },
    });
  });

  it("classifies CodeNavigationVersionNotFoundError as VERSION_NOT_FOUND with structured details", () => {
    const err = new CodeNavigationVersionNotFoundError(
      'No version of npm/express matches "4". Available versions: 5.2.1, 5.1.0. Try: express@5.2.1.',
      "npm/express",
      "4",
      "5.2.1",
      [
        { version: "5.2.1", ref: "v5.2.1" },
        { version: "5.1.0", ref: "v5.1.0" },
      ],
    );
    expect(mapCodeNavigationError(err)).toEqual({
      code: "VERSION_NOT_FOUND",
      message:
        'No version of npm/express matches "4". Available versions: 5.2.1, 5.1.0. Try: express@5.2.1.',
      retryable: false,
      details: {
        package: "npm/express",
        requestedVersion: "4",
        latestIndexed: "5.2.1",
        availableVersions: [
          { version: "5.2.1", ref: "v5.2.1" },
          { version: "5.1.0", ref: "v5.1.0" },
        ],
      },
    });
  });

  it("classifies CodeNavigationRefNotFoundError as REF_NOT_FOUND with suggestions", () => {
    const err = new CodeNavigationRefNotFoundError(
      "Repository ref cannot be resolved for github:openai/codex#1.2.3.",
      "https://github.com/openai/codex",
      "1.2.3",
      [{ ref: "main" }],
      [{ ref: "codex@1.2.3" }, { ref: "v1.2.3" }],
    );
    expect(mapCodeNavigationError(err)).toEqual({
      code: "REF_NOT_FOUND",
      message:
        "Repository ref cannot be resolved for github:openai/codex#1.2.3. Did you mean codex@1.2.3, v1.2.3?",
      retryable: false,
      details: {
        repoUrl: "https://github.com/openai/codex",
        requestedRef: "1.2.3",
        availableRefs: [{ ref: "main" }],
        suggestedRefs: [{ ref: "codex@1.2.3" }, { ref: "v1.2.3" }],
      },
    });
  });

  it("does not treat indexed refs as REF_NOT_FOUND suggestions", () => {
    const err = new CodeNavigationRefNotFoundError(
      "Repository ref cannot be resolved.",
      undefined,
      undefined,
      [{ ref: "main" }],
      undefined,
    );

    expect(mapCodeNavigationError(err)).toEqual({
      code: "REF_NOT_FOUND",
      message: "Repository ref cannot be resolved.",
      retryable: false,
      details: { availableRefs: [{ ref: "main" }] },
    });
  });

  it("does not duplicate backend REF_NOT_FOUND suggestions", () => {
    const err = new CodeNavigationRefNotFoundError(
      "Repository ref cannot be resolved. Did you mean v1.2.3?",
      undefined,
      undefined,
      undefined,
      [{ ref: "v1.2.3" }],
    );
    expect(mapCodeNavigationError(err).message).toBe(
      "Repository ref cannot be resolved. Did you mean v1.2.3?",
    );
  });

  it("classifies CodeNavigationIndexingError as INDEXING with details", () => {
    const err = new CodeNavigationIndexingError(
      "Indexing in progress",
      "idx-42",
      [{ version: "5.2.1", ref: "v5.2.1" }],
      undefined,
      undefined,
      { lowerSeconds: 7, upperSeconds: 19, sampleCount: 9 },
      "Use an indexed version now or wait for this target.",
    );
    expect(mapCodeNavigationError(err)).toEqual({
      code: "INDEXING",
      message: "Indexing in progress",
      retryable: true,
      details: {
        indexingRef: "idx-42",
        availableVersions: [{ version: "5.2.1", ref: "v5.2.1" }],
        indexingEstimate: { lowerSeconds: 7, upperSeconds: 19, sampleCount: 9 },
        hint: "Use an indexed version now or wait for this target.",
      },
    });
  });

  it("classifies CodeNavigationUnresolvableError as UNRESOLVABLE", () => {
    const err = new CodeNavigationUnresolvableError("Cannot resolve");
    expect(mapCodeNavigationError(err)).toEqual({
      code: "UNRESOLVABLE",
      message: "Cannot resolve",
      retryable: false,
    });
  });

  it("classifies CodeNavigationAccessError as ACCESS_DENIED", () => {
    const err = new CodeNavigationAccessError("Denied");
    expect(mapCodeNavigationError(err)).toEqual({
      code: "ACCESS_DENIED",
      message: "Denied",
      retryable: false,
    });
  });

  it("classifies CodeNavigationFeatureFlagRequiredError as ACCESS_DENIED", () => {
    const err = new CodeNavigationFeatureFlagRequiredError(
      "Feature flag required",
    );
    expect(mapCodeNavigationError(err)).toEqual({
      code: "ACCESS_DENIED",
      message: "Feature flag required",
      retryable: false,
    });
  });

  it("classifies AuthenticationError as AUTH_REQUIRED", () => {
    const err = new AuthenticationError("Login required");
    expect(mapCodeNavigationError(err)).toEqual({
      code: "AUTH_REQUIRED",
      message: "Login required",
      retryable: false,
      details: { authSource: "local" },
    });
  });

  it("preserves server auth rejection source", () => {
    const err = new AuthenticationError("Token rejected", "server");
    expect(mapCodeNavigationError(err)).toEqual({
      code: "AUTH_REQUIRED",
      message: "Token rejected",
      retryable: false,
      details: { authSource: "server" },
    });
  });

  it("classifies CodeNavigationNetworkError as NETWORK", () => {
    const err = new CodeNavigationNetworkError("Cannot connect");
    expect(mapCodeNavigationError(err)).toEqual({
      code: "NETWORK",
      message: "Cannot connect",
      retryable: true,
    });
  });

  it("classifies CodeNavigationValidationError as INVALID_ARGUMENT", () => {
    const err = new CodeNavigationValidationError("Query too long");
    expect(mapCodeNavigationError(err)).toEqual({
      code: "INVALID_ARGUMENT",
      message: "Query too long",
      retryable: false,
    });
  });

  it("classifies CodeNavigationBackendError with INTERNAL_ERROR as BACKEND_ERROR (non-retryable default)", () => {
    const err = new CodeNavigationBackendError(
      "Server error (502)",
      502,
      "INTERNAL_ERROR",
    );
    expect(mapCodeNavigationError(err)).toEqual({
      code: "BACKEND_ERROR",
      message: "Server error (502)",
      retryable: false,
      details: { status: 502, graphqlCode: "INTERNAL_ERROR" },
    });
  });

  it("preserves backend metadata on generic GraphQL errors", () => {
    const err = new CodeNavigationBackendError(
      "Backend-specific failure.",
      undefined,
      "FUTURE_ERROR",
      false,
      {
        hint: "Follow the backend-specific recovery path.",
        availableVersions: [{ version: "5.2.1", ref: "v5.2.1" }],
        availableRefs: [{ ref: "main" }],
        suggestedRefs: [{ ref: "v5.2.1" }],
      },
    );

    expect(mapCodeNavigationError(err)).toEqual({
      code: "BACKEND_ERROR",
      message: "Backend-specific failure.",
      retryable: false,
      details: {
        hint: "Follow the backend-specific recovery path.",
        availableVersions: [{ version: "5.2.1", ref: "v5.2.1" }],
        availableRefs: [{ ref: "main" }],
        suggestedRefs: [{ ref: "v5.2.1" }],
        graphqlCode: "FUTURE_ERROR",
      },
    });
  });

  it.each([
    ["FILE_PATH_EXCLUDED", "generated_or_large"],
    ["SOURCE_FILE_INVENTORY_UNKNOWN", "inventory_unavailable"],
  ] as const)(
    "promotes %s and preserves exact-path authority details",
    (code, exclusionReason) => {
      const err = new CodeNavigationBackendError(
        "Exact path is not queryable.",
        undefined,
        code,
        false,
        {
          filePath: "bench/data/issue-90.json",
          exclusionReason,
          targetResolution: {
            requested: {
              registry: "HEX",
              packageName: "jason",
              version: "1.4.4",
            },
            served: { registry: "HEX", packageName: "jason", version: "1.4.4" },
            freshness: "current",
            freshnessReason: "exact_current",
            availableVersions: [],
            availableRefs: [],
          },
        },
      );

      expect(mapCodeNavigationError(err)).toEqual({
        code,
        message: "Exact path is not queryable.",
        retryable: false,
        details: {
          filePath: "bench/data/issue-90.json",
          exclusionReason,
          targetResolution: {
            requested: {
              registry: "HEX",
              packageName: "jason",
              version: "1.4.4",
            },
            served: { registry: "HEX", packageName: "jason", version: "1.4.4" },
            freshness: "current",
            freshnessReason: "exact_current",
            availableVersions: [],
            availableRefs: [],
          },
          graphqlCode: code,
        },
      });
    },
  );

  it("classifies CodeNavigationBackendError with TIMEOUT as TIMEOUT (retryable)", () => {
    const err = new CodeNavigationBackendError(
      "Backend timed out",
      undefined,
      "TIMEOUT",
    );
    expect(mapCodeNavigationError(err)).toEqual({
      code: "TIMEOUT",
      message: "Backend timed out",
      retryable: true,
      details: { graphqlCode: "TIMEOUT" },
    });
  });

  it("classifies CodeNavigationBackendError with RATE_LIMITED as RATE_LIMITED (retryable)", () => {
    const err = new CodeNavigationBackendError(
      "Too many requests",
      undefined,
      "RATE_LIMITED",
    );
    expect(mapCodeNavigationError(err)).toEqual({
      code: "RATE_LIMITED",
      message: "Too many requests",
      retryable: true,
      details: { graphqlCode: "RATE_LIMITED" },
    });
  });

  it("classifies CodeNavigationBackendError with REF_NOT_FOUND as REF_NOT_FOUND", () => {
    const err = new CodeNavigationBackendError(
      "Git ref not found: HEAD for repository https://github.com/acme/missing.",
      undefined,
      "REF_NOT_FOUND",
    );

    expect(mapCodeNavigationError(err)).toEqual({
      code: "REF_NOT_FOUND",
      message:
        "Git ref not found: HEAD for repository https://github.com/acme/missing.",
      retryable: false,
      details: { graphqlCode: "REF_NOT_FOUND" },
    });
  });

  it("classifies CodeNavigationBackendError with REPOSITORY_NOT_FOUND as NOT_FOUND", () => {
    const err = new CodeNavigationBackendError(
      "Repository not found or inaccessible",
      undefined,
      "REPOSITORY_NOT_FOUND",
      false,
    );

    expect(mapCodeNavigationError(err)).toEqual({
      code: "NOT_FOUND",
      message: "Repository not found or inaccessible",
      retryable: false,
      details: { graphqlCode: "REPOSITORY_NOT_FOUND" },
    });
  });

  it("classifies CodeNavigationBackendError with UPSTREAM_ERROR as BACKEND_ERROR (retryable default)", () => {
    const err = new CodeNavigationBackendError(
      "Upstream failed",
      undefined,
      "UPSTREAM_ERROR",
    );
    expect(mapCodeNavigationError(err)).toEqual({
      code: "BACKEND_ERROR",
      message: "Upstream failed",
      retryable: true,
      details: { graphqlCode: "UPSTREAM_ERROR" },
    });
  });

  it("honours backend-supplied retryable override on CodeNavigationBackendError", () => {
    // Backend ships `extensions.retryable: true` on a code that
    // would otherwise default to non-retryable.
    const err = new CodeNavigationBackendError(
      "Backend hiccup",
      500,
      "INTERNAL_ERROR",
      true,
    );
    expect(mapCodeNavigationError(err)).toEqual({
      code: "BACKEND_ERROR",
      message: "Backend hiccup",
      retryable: true,
      details: { status: 500, graphqlCode: "INTERNAL_ERROR" },
    });
  });

  it("classifies legacy CodeNavigationGraphQLError as BACKEND_ERROR", () => {
    const err = new CodeNavigationGraphQLError("Legacy graphql failure", "X");
    expect(mapCodeNavigationError(err)).toEqual({
      code: "BACKEND_ERROR",
      message: "Legacy graphql failure",
      retryable: false,
      details: { graphqlCode: "X" },
    });
  });

  it("classifies MalformedCodeNavigationResponseError as PROTOCOL_ERROR", () => {
    const err = new MalformedCodeNavigationResponseError("Bad payload");
    expect(mapCodeNavigationError(err)).toEqual({
      code: "PROTOCOL_ERROR",
      message: "Bad payload",
      retryable: false,
    });
  });

  it("classifies InvalidPackageSpecError as INVALID_ARGUMENT", () => {
    const err = new InvalidPackageSpecError("bad spec");
    expect(mapCodeNavigationError(err)).toEqual({
      code: "INVALID_ARGUMENT",
      message: "bad spec",
      retryable: false,
    });
  });

  it("classifies UnsupportedRegistryError as INVALID_ARGUMENT", () => {
    const err = new UnsupportedRegistryError("no such registry");
    expect(mapCodeNavigationError(err)).toEqual({
      code: "INVALID_ARGUMENT",
      message: "no such registry",
      retryable: false,
    });
  });

  it("falls through to UNKNOWN for plain Error", () => {
    const err = new Error("mystery");
    expect(mapCodeNavigationError(err)).toEqual({
      code: "UNKNOWN",
      message: "mystery",
      retryable: false,
    });
  });

  it("falls through to UNKNOWN for non-Error thrown values", () => {
    expect(mapCodeNavigationError("oops")).toEqual({
      code: "UNKNOWN",
      message: "Unknown error",
      retryable: false,
    });
    expect(mapCodeNavigationError(undefined)).toEqual({
      code: "UNKNOWN",
      message: "Unknown error",
      retryable: false,
    });
  });
});

describe("mapCodeNavigationError host effects", () => {
  const originalEnv = process.env.GITHITS_DEBUG;
  let stderrSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    stderrSpy = spyOn(process.stderr, "write").mockImplementation(
      () => true as never,
    );
  });

  afterEach(() => {
    stderrSpy.mockRestore();
    if (originalEnv === undefined) delete process.env.GITHITS_DEBUG;
    else process.env.GITHITS_DEBUG = originalEnv;
  });

  it("does not write to stderr even when GITHITS_DEBUG is enabled", () => {
    process.env.GITHITS_DEBUG = "*";
    mapCodeNavigationError(new CodeNavigationTargetNotFoundError("x"));
    expect(stderrSpy).not.toHaveBeenCalled();
  });
});

describe("mapCodeNavigationError file details", () => {
  it("classifies CodeNavigationFileNotFoundError as FILE_NOT_FOUND with filePath detail", () => {
    const err = new CodeNavigationFileNotFoundError(
      "File not found: src/missing.js",
      "src/missing.js",
    );
    expect(mapCodeNavigationError(err)).toEqual({
      code: "FILE_NOT_FOUND",
      message: "File not found: src/missing.js",
      retryable: false,
      details: { filePath: "src/missing.js" },
    });
  });

  it("classifies CodeNavigationFileNotFoundError without filePath", () => {
    const err = new CodeNavigationFileNotFoundError(
      "File not found",
      undefined,
    );
    expect(mapCodeNavigationError(err)).toEqual({
      code: "FILE_NOT_FOUND",
      message: "File not found",
      retryable: false,
    });
  });
});
