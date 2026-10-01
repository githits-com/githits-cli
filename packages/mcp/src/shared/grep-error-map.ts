import {
  AuthenticationError,
  ClientUpdateRequiredError,
  GrepAccessError,
  GrepBackendError,
  GrepGraphQLError,
  GrepNetworkError,
  MalformedGrepResponseError,
} from "@githits/core-internal";
import { buildUpdateRequiredError } from "./code-navigation-error-map.js";
import { InvalidGrepRequestError } from "./grep-request.js";
import type {
  MappedError,
  MappedErrorCode,
  MappedErrorDetails,
} from "./mapped-error.js";
import { AuthRequiredError } from "./require-auth.js";
import { mapSessionIdError } from "./session-id-error-map.js";
import { mapTermsAcceptanceError } from "./terms-acceptance-error-map.js";

/** Classify failures without interpreting backend prose or retrying requests. */
export function mapGrepError(error: unknown): MappedError {
  const sessionError = mapSessionIdError(error);
  if (sessionError) return sessionError;
  const terms = mapTermsAcceptanceError(error);
  if (terms) return terms;
  if (error instanceof ClientUpdateRequiredError)
    return buildUpdateRequiredError(error.reason, error.currentVersion);
  if (
    error instanceof AuthenticationError ||
    error instanceof AuthRequiredError
  )
    return {
      code: "AUTH_REQUIRED",
      message: error.message,
      retryable: false,
      details: {
        authSource:
          error instanceof AuthenticationError ? error.source : "local",
      },
    };
  if (error instanceof InvalidGrepRequestError)
    return {
      code: "INVALID_ARGUMENT",
      message: error.message,
      retryable: false,
    };
  if (error instanceof GrepAccessError)
    return { code: "ACCESS_DENIED", message: error.message, retryable: false };
  if (error instanceof GrepNetworkError)
    return { code: "NETWORK", message: error.message, retryable: true };
  if (error instanceof MalformedGrepResponseError)
    return { code: "PROTOCOL_ERROR", message: error.message, retryable: false };
  if (error instanceof GrepBackendError) {
    const code: MappedErrorCode =
      error.graphqlCode === "TIMEOUT"
        ? "TIMEOUT"
        : error.status === 429
          ? "RATE_LIMITED"
          : "BACKEND_ERROR";
    return {
      code,
      message: error.message,
      retryable:
        error.retryable ??
        (code === "TIMEOUT" ||
          code === "RATE_LIMITED" ||
          (error.status !== undefined && error.status >= 500)),
      details: {
        ...(error.status !== undefined ? { status: error.status } : {}),
        ...(error.graphqlCode ? { graphqlCode: error.graphqlCode } : {}),
      },
    };
  }
  if (error instanceof GrepGraphQLError) {
    const ext = error.extensions;
    const graphqlCode = typeof ext.code === "string" ? ext.code : undefined;
    const code: MappedErrorCode =
      graphqlCode === "GREP_TARGET_PREPARATION_REQUIRED"
        ? "INDEXING"
        : graphqlCode === "GREP_CURSOR_INVALID" ||
            graphqlCode === "VALIDATION_ERROR" ||
            graphqlCode === "INVALID_ARGUMENT"
          ? "INVALID_ARGUMENT"
          : graphqlCode === "GREP_BACKEND_PROTOCOL_ERROR"
            ? "PROTOCOL_ERROR"
            : graphqlCode === "TIMEOUT"
              ? "TIMEOUT"
              : graphqlCode === "RATE_LIMITED"
                ? "RATE_LIMITED"
                : "BACKEND_ERROR";
    const details: MappedErrorDetails = { graphqlCode };
    if (Array.isArray(ext.target_issues)) {
      details.targetIssues = ext.target_issues
        .slice(0, 20)
        .filter(isRecord)
        .map((issue) =>
          Object.fromEntries(
            Object.entries(issue).filter(([key]) => PUBLIC_ISSUE_KEYS.has(key)),
          ),
        );
      details.hint = details.targetIssues
        .map(
          (issue) =>
            `Input ${issue.input_index}: ${issue.reason}${typeof issue.progress_ref === "string" ? `; progress ${issue.progress_ref}` : ""}${typeof issue.file_path === "string" ? `; path ${issue.file_path}` : ""}`,
        )
        .join("\n");
    }
    if (graphqlCode === "GREP_CURSOR_INVALID")
      details.hint =
        "Restart explicitly without the cursor, using the same targets and controls.";
    return {
      code,
      message: error.message,
      retryable:
        typeof ext.retryable === "boolean"
          ? ext.retryable
          : code === "INDEXING" ||
            code === "TIMEOUT" ||
            code === "RATE_LIMITED",
      details,
    };
  }
  return {
    code: "UNKNOWN",
    message: error instanceof Error ? error.message : "Unknown error",
    retryable: false,
  };
}

const PUBLIC_ISSUE_KEYS = new Set([
  "input_index",
  "target",
  "reason",
  "retryable",
  "progress_ref",
  "file_path",
  "repo_url",
  "git_ref",
  "requested_ref",
  "available_refs",
  "available_versions",
  "message",
  "suggested_refs",
  "published_versions",
  "published_versions_truncated",
  "suggested_site_targets",
  "registry",
  "package",
]);
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
