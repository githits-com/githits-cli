import { describe, expect, it } from "bun:test";
import {
  AuthenticationError,
  ClientUpdateRequiredError,
  ListAccessError,
  ListBackendError,
  ListGraphQLError,
  ListNetworkError,
  MalformedListResponseError,
  TermsAcceptanceRequiredError,
} from "@githits/core-internal";
import { mapListError } from "./list-error-map.js";
import { InvalidListRequestError } from "./list-request.js";
import {
  InvalidArgumentError,
  InvalidPackageSpecError,
  UnsupportedRegistryError,
} from "./package-spec.js";
import { AuthRequiredError } from "./require-auth.js";

describe("mapListError", () => {
  it("maps common list, auth, update, terms, and invalid-input errors", () => {
    expect(mapListError(new TermsAcceptanceRequiredError())).toMatchObject({
      code: "TERMS_ACCEPTANCE_REQUIRED",
      retryable: false,
      details: {
        termsUrl: "https://githits.com/legal/terms-of-service/",
        acceptanceUrl: "https://app.githits.com/settings/privacy",
      },
    });
    expect(
      mapListError(
        new ClientUpdateRequiredError(undefined, undefined, "1.2.3"),
      ),
    ).toEqual({
      code: "UPDATE_REQUIRED",
      message: "Update required: Backend protocol changed",
      retryable: false,
      details: {
        currentVersion: "1.2.3",
        reason: "Backend protocol changed",
        updateCommand: "npm i -g githits@latest",
      },
    });
    expect(
      mapListError(new AuthenticationError("token rejected", "server")),
    ).toEqual({
      code: "AUTH_REQUIRED",
      message: "token rejected",
      retryable: false,
      details: { authSource: "server" },
    });
    expect(
      mapListError(new AuthRequiredError("login required", "https://mcp")),
    ).toEqual({
      code: "AUTH_REQUIRED",
      message: "login required",
      retryable: false,
      details: { authSource: "local" },
    });
    expect(mapListError(new ListAccessError("denied"))).toEqual({
      code: "ACCESS_DENIED",
      message: "denied",
      retryable: false,
    });
    expect(mapListError(new ListNetworkError("offline"))).toEqual({
      code: "NETWORK",
      message: "offline",
      retryable: true,
    });
    expect(mapListError(new MalformedListResponseError("bad shape"))).toEqual({
      code: "PROTOCOL_ERROR",
      message: "bad shape",
      retryable: false,
    });

    for (const error of [
      new InvalidListRequestError("paths", "Bad paths."),
      new InvalidArgumentError("Bad argument."),
      new InvalidPackageSpecError("Bad package spec."),
      new UnsupportedRegistryError("unknown"),
    ]) {
      expect(mapListError(error)).toMatchObject({
        code: "INVALID_ARGUMENT",
        message: error.message,
        retryable: false,
      });
    }
  });

  it.each([
    ["NOT_FOUND", "NOT_FOUND", false],
    ["INDEXING", "INDEXING", true],
    ["VALIDATION_ERROR", "INVALID_ARGUMENT", false],
    [
      "SOURCE_INVENTORY_SCOPE_UNAVAILABLE",
      "SOURCE_INVENTORY_SCOPE_UNAVAILABLE",
      false,
    ],
    ["LIST_UNSUPPORTED_API", "LIST_UNSUPPORTED_API", false],
    ["LIST_PAGE_TOO_LARGE", "LIST_PAGE_TOO_LARGE", false],
    ["TIMEOUT", "TIMEOUT", true],
    ["RATE_LIMITED", "RATE_LIMITED", true],
    ["INTERNAL_ERROR", "BACKEND_ERROR", false],
  ] as const)(
    "maps GraphQL code %s and honors backend retryability",
    (code, mappedCode, defaultRetryable) => {
      const defaultResult = mapListError(
        new ListGraphQLError("Backend message", code),
      );
      expect(defaultResult).toMatchObject({
        code: mappedCode,
        message:
          code === "VALIDATION_ERROR"
            ? "Backend message Correct the request and try again."
            : "Backend message",
        retryable: defaultRetryable,
        details: { graphqlCode: code },
      });

      const overridden = mapListError(
        new ListGraphQLError("Backend message", code, !defaultRetryable),
      );
      expect(overridden.retryable).toBe(!defaultRetryable);
    },
  );

  it("uses cursor context for validation guidance without inspecting the message", () => {
    const cursorContext = mapListError(
      new ListGraphQLError("Generic validation failure", "VALIDATION_ERROR"),
      { hasAfter: true },
    );
    expect(cursorContext).toEqual({
      code: "INVALID_ARGUMENT",
      message:
        "Generic validation failure Retry once without `after`; if validation still fails, correct the request.",
      retryable: false,
      details: { graphqlCode: "VALIDATION_ERROR" },
    });

    const noCursorContext = mapListError(
      new ListGraphQLError(
        "Cursor text does not mean after was supplied",
        "VALIDATION_ERROR",
      ),
      { hasAfter: false },
    );
    expect(noCursorContext.message).toBe(
      "Cursor text does not mean after was supplied Correct the request and try again.",
    );
    expect(noCursorContext.message).not.toContain("without `after`");
  });

  it("offers the exact pinned repository target only when both scope fields exist", () => {
    const repoUrl = "https://github.com/example/repo";
    const commitSha = "0123456789abcdef0123456789abcdef01234567";
    const complete = mapListError(
      new ListGraphQLError(
        "Package source scope is unavailable.",
        "SOURCE_INVENTORY_SCOPE_UNAVAILABLE",
        true,
        repoUrl,
        commitSha,
        "index-7",
        "Repository scope is broader.",
      ),
    );
    expect(complete).toEqual({
      code: "SOURCE_INVENTORY_SCOPE_UNAVAILABLE",
      message: `Package source scope is unavailable. The repository-wide alternative ${repoUrl}@${commitSha} broadens scope; use it only if those broader results are acceptable.`,
      retryable: true,
      details: {
        graphqlCode: "SOURCE_INVENTORY_SCOPE_UNAVAILABLE",
        indexingRef: "index-7",
        hint: "Repository scope is broader.",
        repoUrl,
        commitSha,
        action: `${repoUrl}@${commitSha}`,
      },
    });

    const repoOnly = mapListError(
      new ListGraphQLError(
        "Scope unavailable.",
        "SOURCE_INVENTORY_SCOPE_UNAVAILABLE",
        undefined,
        repoUrl,
      ),
    );
    expect(repoOnly.message).toBe("Scope unavailable.");
    expect(repoOnly.details).toEqual({
      graphqlCode: "SOURCE_INVENTORY_SCOPE_UNAVAILABLE",
      repoUrl,
    });

    const commitOnly = mapListError(
      new ListGraphQLError(
        "Scope unavailable.",
        "SOURCE_INVENTORY_SCOPE_UNAVAILABLE",
        undefined,
        undefined,
        commitSha,
      ),
    );
    expect(commitOnly.message).toBe("Scope unavailable.");
    expect(commitOnly.details).toEqual({
      graphqlCode: "SOURCE_INVENTORY_SCOPE_UNAVAILABLE",
      commitSha,
    });

    const emptyRecovery = mapListError(
      new ListGraphQLError(
        "Scope unavailable.",
        "SOURCE_INVENTORY_SCOPE_UNAVAILABLE",
        undefined,
        "",
        " ",
        "",
        " ",
      ),
    );
    expect(emptyRecovery.message).toBe("Scope unavailable.");
    expect(emptyRecovery.details).toEqual({
      graphqlCode: "SOURCE_INVENTORY_SCOPE_UNAVAILABLE",
    });
  });

  it("preserves GraphQL metadata for unknown codes and uses stable unknown fallbacks", () => {
    expect(
      mapListError(
        new ListGraphQLError(
          "Exact backend wording.",
          "FUTURE_LIST_CODE",
          true,
          undefined,
          undefined,
          "index-9",
          "try again later",
        ),
      ),
    ).toEqual({
      code: "BACKEND_ERROR",
      message: "Exact backend wording.",
      retryable: true,
      details: {
        graphqlCode: "FUTURE_LIST_CODE",
        indexingRef: "index-9",
        hint: "try again later",
      },
    });
    expect(mapListError(new Error("unknown exception"))).toEqual({
      code: "UNKNOWN",
      message: "unknown exception",
      retryable: false,
    });
    expect(mapListError(undefined)).toEqual({
      code: "UNKNOWN",
      message: "Unknown error",
      retryable: false,
    });
  });

  it("maps backend status and codes with the documented retry defaults", () => {
    const cases = [
      [new ListBackendError("Timed out", 504, "TIMEOUT"), "TIMEOUT", true],
      [
        new ListBackendError("Timed out", 504, "TIMEOUT", false),
        "TIMEOUT",
        false,
      ],
      [new ListBackendError("Busy", 429, "RATE_LIMITED"), "RATE_LIMITED", true],
      [
        new ListBackendError("Busy", 429, "RATE_LIMITED", false),
        "RATE_LIMITED",
        false,
      ],
      [
        new ListBackendError("Unavailable", 503, "INTERNAL_ERROR"),
        "BACKEND_ERROR",
        false,
      ],
      [
        new ListBackendError("Retry later", 503, "INTERNAL_ERROR", true),
        "BACKEND_ERROR",
        true,
      ],
    ] as const;

    for (const [error, code, retryable] of cases) {
      expect(mapListError(error)).toEqual({
        code,
        message: error.message,
        retryable,
        details: { status: error.status, graphqlCode: error.graphqlCode },
      });
    }
  });
});
