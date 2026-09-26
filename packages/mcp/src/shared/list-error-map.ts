import {
  AuthenticationError,
  ClientUpdateRequiredError,
  ListAccessError,
  ListBackendError,
  ListGraphQLError,
  ListNetworkError,
  MalformedListResponseError,
} from "@githits/core-internal";
import { buildUpdateRequiredError } from "./code-navigation-error-map.js";
import type {
  MappedError,
  MappedErrorCode,
  MappedErrorDetails,
} from "./mapped-error.js";
import { AuthRequiredError } from "./require-auth.js";
import { mapTermsAcceptanceError } from "./terms-acceptance-error-map.js";

export interface ListErrorContext {
  /** True only when the normalized request carried a nonempty `after` cursor. */
  hasAfter: boolean;
}

/** Map a unified-list failure into the shared CLI and MCP error envelope. */
export function mapListError(
  error: unknown,
  context?: ListErrorContext,
): MappedError {
  const termsError = mapTermsAcceptanceError(error);
  if (termsError) return termsError;
  if (error instanceof ClientUpdateRequiredError) {
    return buildUpdateRequiredError(error.reason, error.currentVersion);
  }
  if (
    error instanceof AuthenticationError ||
    error instanceof AuthRequiredError
  ) {
    return {
      code: "AUTH_REQUIRED",
      message: error.message,
      retryable: false,
      details: {
        authSource:
          error instanceof AuthenticationError ? error.source : "local",
      },
    };
  }
  if (error instanceof ListAccessError) {
    return { code: "ACCESS_DENIED", message: error.message, retryable: false };
  }
  if (error instanceof ListNetworkError) {
    return { code: "NETWORK", message: error.message, retryable: true };
  }
  if (error instanceof MalformedListResponseError) {
    return { code: "PROTOCOL_ERROR", message: error.message, retryable: false };
  }
  if (error instanceof ListBackendError) {
    return mapBackendError(error);
  }
  if (error instanceof ListGraphQLError) {
    return mapGraphQLError(error, context);
  }
  if (isInvalidArgumentError(error)) {
    return {
      code: "INVALID_ARGUMENT",
      message: error.message,
      retryable: false,
    };
  }
  if (error instanceof Error) {
    return { code: "UNKNOWN", message: error.message, retryable: false };
  }
  return { code: "UNKNOWN", message: "Unknown error", retryable: false };
}

function mapBackendError(error: ListBackendError): MappedError {
  const details: MappedErrorDetails = {};
  if (typeof error.status === "number") details.status = error.status;
  if (isNonempty(error.graphqlCode)) details.graphqlCode = error.graphqlCode;

  const build = (
    code: MappedErrorCode,
    defaultRetryable: boolean,
  ): MappedError => ({
    code,
    message: error.message,
    retryable: error.retryable ?? defaultRetryable,
    details: Object.keys(details).length > 0 ? details : undefined,
  });

  switch (error.graphqlCode) {
    case "TIMEOUT":
      return build("TIMEOUT", true);
    case "RATE_LIMITED":
      return build("RATE_LIMITED", true);
    default:
      return build("BACKEND_ERROR", false);
  }
}

function mapGraphQLError(
  error: ListGraphQLError,
  context?: ListErrorContext,
): MappedError {
  const details = graphQLErrorDetails(error);
  const build = (
    code: MappedErrorCode,
    defaultRetryable: boolean,
    message = error.message,
    extraDetails?: MappedErrorDetails,
  ): MappedError => {
    const allDetails = { ...details, ...extraDetails };
    return {
      code,
      message,
      retryable: error.retryable ?? defaultRetryable,
      details: Object.keys(allDetails).length > 0 ? allDetails : undefined,
    };
  };

  switch (error.code) {
    case "NOT_FOUND":
      return build("NOT_FOUND", false);
    case "INDEXING":
      return build("INDEXING", true);
    case "VALIDATION_ERROR":
      return build(
        "INVALID_ARGUMENT",
        false,
        context?.hasAfter
          ? `${error.message} Retry once without \`after\`; if validation still fails, correct the request.`
          : `${error.message} Correct the request and try again.`,
      );
    case "SOURCE_INVENTORY_SCOPE_UNAVAILABLE":
      return mapScopeUnavailableError(error, build);
    case "LIST_UNSUPPORTED_API":
      return build("LIST_UNSUPPORTED_API", false);
    case "LIST_PAGE_TOO_LARGE":
      return build("LIST_PAGE_TOO_LARGE", false);
    case "TIMEOUT":
      return build("TIMEOUT", true);
    case "RATE_LIMITED":
      return build("RATE_LIMITED", true);
    default:
      return build("BACKEND_ERROR", false);
  }
}

function mapScopeUnavailableError(
  error: ListGraphQLError,
  build: (
    code: MappedErrorCode,
    defaultRetryable: boolean,
    message?: string,
    extraDetails?: MappedErrorDetails,
  ) => MappedError,
): MappedError {
  const extraDetails: MappedErrorDetails = {};
  const repoUrl = nonemptyValue(error.repoUrl);
  const commitSha = nonemptyValue(error.commitSha);
  if (repoUrl !== undefined) extraDetails.repoUrl = repoUrl;
  if (commitSha !== undefined) extraDetails.commitSha = commitSha;

  if (repoUrl === undefined || commitSha === undefined) {
    return build(
      "SOURCE_INVENTORY_SCOPE_UNAVAILABLE",
      false,
      error.message,
      extraDetails,
    );
  }

  const action = `${repoUrl}@${commitSha}`;
  extraDetails.action = action;
  return build(
    "SOURCE_INVENTORY_SCOPE_UNAVAILABLE",
    false,
    `${error.message} The repository-wide alternative ${action} broadens scope; use it only if those broader results are acceptable.`,
    extraDetails,
  );
}

function graphQLErrorDetails(error: ListGraphQLError): MappedErrorDetails {
  const details: MappedErrorDetails = {};
  if (isNonempty(error.code)) details.graphqlCode = error.code;
  if (isNonempty(error.indexingRef)) details.indexingRef = error.indexingRef;
  if (isNonempty(error.hint)) details.hint = error.hint;
  return details;
}

function nonemptyValue(value: string | undefined): string | undefined {
  return isNonempty(value) ? value : undefined;
}

function isNonempty(value: string | undefined): value is string {
  return value !== undefined && value.trim().length > 0;
}

function isInvalidArgumentError(error: unknown): error is Error {
  if (!(error instanceof Error)) return false;
  return (
    error.name.startsWith("Invalid") || error.name.startsWith("Unsupported")
  );
}
