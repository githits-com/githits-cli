import {
  AuthenticationError,
  ClientUpdateRequiredError,
  GrepAccessError,
  GrepBackendError,
  GrepGraphQLError,
  GrepNetworkError,
  MalformedGrepResponseError,
  parseVersionRefRecovery,
} from "@githits/core-internal";
import { buildUpdateRequiredError } from "./code-navigation-error-map.js";
import { grepPreparationReason } from "./grep-preparation-text.js";
import { InvalidGrepRequestError } from "./grep-request.js";
import type {
  MappedError,
  MappedErrorCode,
  MappedErrorDetails,
} from "./mapped-error.js";
import { AuthRequiredError } from "./require-auth.js";
import { mapSessionIdError } from "./session-id-error-map.js";
import { mapTermsAcceptanceError } from "./terms-acceptance-error-map.js";
import { mapVersionRefRecovery } from "./version-ref-recovery.js";

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
    const recovery = parseVersionRefRecovery(ext);
    if (recovery) return mapVersionRefRecovery(error.message, recovery);
    const graphqlCode = typeof ext.code === "string" ? ext.code : undefined;
    const code: MappedErrorCode =
      graphqlCode === "GREP_TARGET_PREPARATION_REQUIRED"
        ? preparationErrorCode(ext.target_issues, ext.retryable)
        : graphqlCode === "GREP_CURSOR_INVALID" ||
            graphqlCode === "MULTI_GREP_CURSOR_INVALID" ||
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
      const hints = details.targetIssues.flatMap((issue, index) => {
        const target =
          typeof issue.target === "string"
            ? issue.target
            : typeof issue.input_index === "number"
              ? `Input ${issue.input_index}`
              : undefined;
        const translatedReason =
          typeof issue.reason === "string"
            ? grepPreparationReason(issue.reason)
            : undefined;
        const reason =
          translatedReason && translatedReason !== issue.reason
            ? translatedReason
            : code === "INDEXING"
              ? "target is being prepared"
              : "target is unavailable";
        // Package-source diagnostics can append raw reason-only boilerplate.
        const message =
          typeof issue.message === "string"
            ? typeof issue.reason === "string" &&
              issue.message.endsWith(`Reason: ${issue.reason}.`)
              ? reason
              : issue.message
            : undefined;
        // Terminal headlines describe the first blocker; INDEXING replaces that
        // headline, so its hint must retain the target identity and reason.
        const diagnostic =
          code === "INDEXING"
            ? reason
            : graphqlCode === "GREP_TARGET_PREPARATION_REQUIRED" && index === 0
              ? undefined
              : message !== undefined
                ? typeof issue.message === "string" &&
                  error.message.includes(issue.message)
                  ? undefined
                  : message
                : reason;
        const path =
          typeof issue.file_path === "string"
            ? `path ${issue.file_path}`
            : undefined;
        const text = [diagnostic, path].filter(Boolean).join("; ");
        return text ? [`${target ? `${target}: ` : ""}${text}`] : [];
      });
      if (hints.length) details.hint = hints.join("\n");
    }
    if (
      graphqlCode === "GREP_CURSOR_INVALID" ||
      graphqlCode === "MULTI_GREP_CURSOR_INVALID"
    )
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

/** First non-progress blocker wins; aggregate false can reveal unpublished blockers. */
function preparationErrorCode(
  issues: unknown,
  retryable: unknown,
): MappedErrorCode {
  if (!Array.isArray(issues) || issues.length === 0) return "UNRESOLVABLE";
  for (const issue of issues) {
    const code = isRecord(issue) ? preparationIssueCode(issue) : "UNRESOLVABLE";
    if (code !== "INDEXING") return code;
  }
  return retryable === false ? "UNRESOLVABLE" : "INDEXING";
}

function preparationIssueCode(issue: Record<string, unknown>): MappedErrorCode {
  switch (issue.reason) {
    case "repository_indexing":
    case "documentation_publishing":
    case "documentation_discovery":
    case "site_v6_required":
    case "starting_url_pending":
      return issue.retryable === false ? "UNRESOLVABLE" : "INDEXING";
    case "repository_not_found":
    case "package_not_found":
    case "package_source_not_found":
      return "NOT_FOUND";
    case "repository_ref_not_found":
    case "ref_not_found":
      return "REF_NOT_FOUND";
    case "package_version_not_found":
    case "package_version_unresolved":
    case "package_source_ref_not_found":
      return "VERSION_NOT_FOUND";
    case "repository_ref_ambiguous":
    case "site_ambiguous":
      return "INVALID_ARGUMENT";
    case "repository_resolution_error":
    case "repository_unavailable":
      return "BACKEND_ERROR";
    case "no_grep_scopes":
    case "no_site_pages":
    case "repository_legally_blocked":
    case "package_source_unsupported":
    case "package_security_removed":
    case "package_scope_unavailable":
    case "package_release_unusable":
    case "site_not_indexed":
    case "site_no_docs":
    case "site_redirected":
    case "site_failed":
    case "documentation_site_not_admitted":
    case "documentation_source_resolution_required":
    case "documentation_site_no_docs":
    case "documentation_site_identity_blocked":
    case "documentation_site_failed":
    case "documentation_unavailable":
    case "starting_url_missed_at_cap":
    case "starting_url_absent_from_current_corpus":
      return "UNRESOLVABLE";
    default:
      return typeof issue.reason === "string" &&
        issue.reason.trim() &&
        issue.retryable === true &&
        typeof issue.progress_ref === "string" &&
        issue.progress_ref.trim()
        ? "INDEXING"
        : "UNRESOLVABLE";
  }
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
