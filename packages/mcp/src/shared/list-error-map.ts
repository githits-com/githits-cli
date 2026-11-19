import type { ListParams } from "@githits/core-internal";
import {
  AuthenticationError,
  ClientUpdateRequiredError,
  ListAccessError,
  ListBackendError,
  ListGraphQLError,
  ListNetworkError,
  MalformedListResponseError,
} from "@githits/core-internal";
import { DEFAULT_WAIT_TIMEOUT_MS } from "./code-navigation-defaults.js";
import { buildUpdateRequiredError } from "./code-navigation-error-map.js";
import type {
  MappedError,
  MappedErrorCode,
  MappedErrorDetails,
} from "./mapped-error.js";
import { formatRepositoryTarget } from "./repository-target.js";
import { AuthRequiredError } from "./require-auth.js";
import { mapSessionIdError } from "./session-id-error-map.js";
import { shellQuoteExact } from "./shell-quote.js";
import { mapTermsAcceptanceError } from "./terms-acceptance-error-map.js";
import { mapVersionRefRecovery } from "./version-ref-recovery.js";

export interface ListErrorContext {
  /** True only when the normalized request carried a nonempty `after` cursor. */
  hasAfter: boolean;
}

/** Native scope recovery keeps caller paths literal; the target changes their base. */
export function withListScopeRecovery(
  mapped: MappedError,
  syntax: "cli" | "mcp",
  request: Partial<ListParams> = {},
): MappedError {
  if (
    mapped.code !== "SOURCE_INVENTORY_SCOPE_UNAVAILABLE" ||
    !mapped.details?.repoUrl ||
    !mapped.details.commitSha
  )
    return mapped;
  const target = formatRepositoryTarget(
    mapped.details.repoUrl,
    mapped.details.commitSha,
  );
  const wait =
    request.waitTimeoutMs !== DEFAULT_WAIT_TIMEOUT_MS
      ? request.waitTimeoutMs
      : undefined;
  const retry = {
    target,
    paths: request.paths,
    recursive: request.recursive,
    file_types: request.fileTypes,
    languages: request.languages,
    intents: request.intents,
    limit: request.limit,
    wait_timeout_ms: wait,
    format: request.includeDetailedFields ? "json" : undefined,
  };
  const controls = [
    ...(request.recursive ? ["--recursive"] : []),
    ...(
      [
        ["--file-type", request.fileTypes],
        ["--language", request.languages],
        ["--intent", request.intents],
      ] as const
    ).flatMap(([flag, values]) =>
      (values ?? []).map((value) => `${flag} ${shellQuoteExact(value)}`),
    ),
    ...(request.limit !== undefined ? [`--limit ${request.limit}`] : []),
    ...(wait !== undefined ? [`--wait ${wait}`] : []),
    ...(request.includeDetailedFields ? ["--json"] : []),
    ...(request.includeTargetProvenance === false &&
    !request.includeDetailedFields
      ? ["--silent"]
      : []),
  ];
  const action =
    syntax === "mcp"
      ? `list ${JSON.stringify(retry)}`
      : `githits list ${controls.length ? `${controls.join(" ")} ` : ""}-- ${[target, ...(request.paths ?? [])].map(shellQuoteExact).join(" ")}`;
  return { ...mapped, details: { ...mapped.details, action } };
}

/** Map a unified-list failure into the shared CLI and MCP error envelope. */
export function mapListError(
  error: unknown,
  context?: ListErrorContext,
): MappedError {
  if (error instanceof ListGraphQLError && error.recovery)
    return mapVersionRefRecovery(error.message, error.recovery);
  const sessionError = mapSessionIdError(error);
  if (sessionError) return sessionError;
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
  const details: MappedErrorDetails = { ...error.metadata };
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
    case "PACKAGE_INDEXING":
      return build("INDEXING", true);
    case "VALIDATION_ERROR": {
      return build(
        "INVALID_ARGUMENT",
        false,
        context?.hasAfter
          ? `${error.message} Retry once without \`after\`; if validation still fails, correct the request.`
          : `${error.message} Correct the request and try again.`,
      );
    }
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
  const message =
    "GitHits could not determine which repository files belong to this package.";
  const repoUrl = nonemptyValue(error.repoUrl);
  const commitSha = nonemptyValue(error.commitSha);
  if (repoUrl !== undefined) extraDetails.repoUrl = repoUrl;
  if (commitSha !== undefined) extraDetails.commitSha = commitSha;

  if (repoUrl === undefined || commitSha === undefined) {
    return build(
      "SOURCE_INVENTORY_SCOPE_UNAVAILABLE",
      false,
      message,
      extraDetails,
    );
  }

  return build(
    "SOURCE_INVENTORY_SCOPE_UNAVAILABLE",
    false,
    `${message} Try listing the repository instead; add the package folder prefix to paths if needed.`,
    extraDetails,
  );
}

function graphQLErrorDetails(error: ListGraphQLError): MappedErrorDetails {
  const details: MappedErrorDetails = { ...error.metadata };
  if (isNonempty(error.code)) details.graphqlCode = error.code;
  if (isNonempty(error.indexingRef)) details.indexingRef = error.indexingRef;
  if (isNonempty(error.hint)) details.hint = error.hint;
  if (isNonempty(error.repoUrl)) details.repoUrl = error.repoUrl;
  if (isNonempty(error.commitSha)) details.commitSha = error.commitSha;
  if (error.indexingMetadata?.indexingEstimate)
    details.indexingEstimate = error.indexingMetadata.indexingEstimate;
  if (error.indexingMetadata?.availableVersions)
    details.availableVersions = error.indexingMetadata.availableVersions;
  if (error.indexingMetadata?.package)
    details.package = error.indexingMetadata.package;
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
