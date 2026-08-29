import {
  AuthenticationError,
  type AvailableRef,
  CLIENT_UPDATE_REQUIRED_REASON,
  ClientUpdateRequiredError,
  CodeDiffError,
  CodeNavigationAccessError,
  CodeNavigationBackendError,
  type CodeNavigationErrorMetadata,
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
} from "@githits/core-internal";
import type {
  MappedError,
  MappedErrorCode,
  MappedErrorDetails,
} from "./mapped-error.js";
import { AuthRequiredError } from "./require-auth.js";
import { mapTermsAcceptanceError } from "./terms-acceptance-error-map.js";

export type {
  MappedError,
  MappedErrorCode,
  MappedErrorDetails,
} from "./mapped-error.js";
export { mapTermsAcceptanceError } from "./terms-acceptance-error-map.js";

/**
 * Classify a thrown error from the code navigation stack into the
 * shared `MappedError` shape used by the CLI JSON envelope and the
 * MCP error payload.
 *
 * Every named error class in `code-navigation-service.ts` and every
 * expected adjacent error (auth, invalid argument) maps to a specific
 * code. Only genuinely unrecognised Errors reach `UNKNOWN` — the
 * table test in `code-navigation-error-map.test.ts` guards that.
 */
export function mapCodeNavigationError(error: unknown): MappedError {
  return classify(error);
}

function classify(error: unknown): MappedError {
  const termsError = mapTermsAcceptanceError(error);
  if (termsError) return termsError;
  if (error instanceof ClientUpdateRequiredError) {
    return buildUpdateRequiredError(error.reason, error.currentVersion);
  }
  if (error instanceof CodeDiffError) {
    return classifyCodeDiffError(error);
  }
  if (error instanceof CodeNavigationVersionNotFoundError) {
    const details: MappedErrorDetails = {};
    preserveBackendMetadata(details, error.metadata);
    if (error.packageName) details.package = error.packageName;
    if (error.requestedVersion) {
      details.requestedVersion = error.requestedVersion;
    }
    if (error.latestIndexed) details.latestIndexed = error.latestIndexed;
    if (error.availableVersions && error.availableVersions.length > 0) {
      details.availableVersions = error.availableVersions;
    }
    return {
      code: "VERSION_NOT_FOUND",
      message: error.message,
      retryable: false,
      details: Object.keys(details).length > 0 ? details : undefined,
    };
  }
  if (error instanceof CodeNavigationTargetNotFoundError) {
    const details: MappedErrorDetails = {};
    preserveBackendMetadata(details, error.metadata);
    if (error.availableVersions && error.availableVersions.length > 0) {
      details.availableVersions = error.availableVersions;
    }
    if (error.repoUrl) details.repoUrl = error.repoUrl;
    if (error.requestedRef) details.requestedRef = error.requestedRef;
    return {
      code: "NOT_FOUND",
      message: error.message,
      retryable: false,
      details: Object.keys(details).length > 0 ? details : undefined,
    };
  }
  if (error instanceof CodeNavigationRefNotFoundError) {
    const details: MappedErrorDetails = {};
    preserveBackendMetadata(details, error.metadata);
    if (error.repoUrl) details.repoUrl = error.repoUrl;
    if (error.requestedRef) details.requestedRef = error.requestedRef;
    if (error.availableRefs && error.availableRefs.length > 0) {
      details.availableRefs = error.availableRefs;
    }
    if (error.suggestedRefs && error.suggestedRefs.length > 0) {
      details.suggestedRefs = error.suggestedRefs;
    }
    return {
      code: "REF_NOT_FOUND",
      message: addRefSuggestions(error.message, error.suggestedRefs),
      retryable: false,
      details: Object.keys(details).length > 0 ? details : undefined,
    };
  }
  if (error instanceof CodeNavigationFileNotFoundError) {
    return {
      code: "FILE_NOT_FOUND",
      message: error.message,
      retryable: false,
      details: error.filePath ? { filePath: error.filePath } : undefined,
    };
  }
  if (error instanceof CodeNavigationIndexingError) {
    const details: MappedErrorDetails = {};
    if (error.indexingRef) details.indexingRef = error.indexingRef;
    if (error.availableVersions && error.availableVersions.length > 0) {
      details.availableVersions = error.availableVersions;
    }
    if (error.availableRefs && error.availableRefs.length > 0) {
      details.availableRefs = error.availableRefs;
    }
    if (error.targetResolution) {
      details.targetResolution = error.targetResolution;
    }
    if (error.indexingEstimate) {
      details.indexingEstimate = error.indexingEstimate;
    }
    if (error.hint) details.hint = error.hint;
    return {
      code: "INDEXING",
      message: error.message,
      retryable: true,
      details: Object.keys(details).length > 0 ? details : undefined,
    };
  }
  if (error instanceof CodeNavigationUnresolvableError) {
    return {
      code: "UNRESOLVABLE",
      message: error.message,
      retryable: false,
    };
  }
  if (
    error instanceof CodeNavigationAccessError ||
    error instanceof CodeNavigationFeatureFlagRequiredError
  ) {
    return {
      code: "ACCESS_DENIED",
      message: error.message,
      retryable: false,
    };
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
  if (error instanceof CodeNavigationNetworkError) {
    return { code: "NETWORK", message: error.message, retryable: true };
  }
  if (error instanceof CodeNavigationValidationError) {
    return {
      code: "INVALID_ARGUMENT",
      message: normalizeBackendMessage(error.message),
      retryable: false,
    };
  }
  if (error instanceof CodeNavigationBackendError) {
    return classifyBackendError(error);
  }
  if (error instanceof CodeNavigationGraphQLError) {
    // Legacy GraphQL errors — service now prefers CodeNavigationBackendError,
    // but anything still throwing this type is a backend-side failure.
    return {
      code: "BACKEND_ERROR",
      message: error.message,
      retryable: false,
      details: error.code ? { graphqlCode: error.code } : undefined,
    };
  }
  if (error instanceof MalformedCodeNavigationResponseError) {
    return {
      code: "PROTOCOL_ERROR",
      message: error.message,
      retryable: false,
    };
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

function classifyCodeDiffError(error: CodeDiffError): MappedError {
  const details: MappedErrorDetails = {};
  const source = error.details;

  if (source?.side !== undefined) details.side = source.side;
  if (source?.publishedVersions !== undefined) {
    details.publishedVersions = source.publishedVersions;
  }
  if (source?.publishedVersionsTruncated !== undefined) {
    details.publishedVersionsTruncated = source.publishedVersionsTruncated;
  }
  if (source?.availableVersions !== undefined) {
    details.availableVersions = source.availableVersions.map((entry) => ({
      ...entry,
    }));
  }
  if (source?.registry !== undefined) details.registry = source.registry;
  if (source?.retryAfterMs !== undefined) {
    details.retryAfterMs = source.retryAfterMs;
  }
  if (source?.stage !== undefined) details.stage = source.stage;
  if (source?.limitKind !== undefined) details.limitKind = source.limitKind;
  if (source?.repoUrl !== undefined) details.repoUrl = source.repoUrl;
  if (source?.gitRef !== undefined) details.gitRef = source.gitRef;
  if (source?.availableRefs !== undefined) {
    details.availableRefs = source.availableRefs.map((entry) => ({ ...entry }));
  }
  if (source?.suggestedRefs !== undefined) {
    details.suggestedRefs = source.suggestedRefs.map((entry) => ({ ...entry }));
  }
  if (source?.refKinds !== undefined) details.refKinds = source.refKinds;
  if (error.partial !== undefined) {
    details.codeDiffResolution = {
      package: error.partial.package,
      from: error.partial.fromResolution,
      to: error.partial.toResolution,
    };
  }

  const build = (
    code: MappedErrorCode,
    defaultRetryable: boolean,
  ): MappedError => ({
    code,
    message: error.message,
    retryable: source?.retryable ?? defaultRetryable,
    details: Object.keys(details).length > 0 ? details : undefined,
  });

  switch (source?.code) {
    case "VALIDATION_ERROR":
      return build("INVALID_ARGUMENT", false);
    case "VERSION_NOT_FOUND":
      return build("VERSION_NOT_FOUND", false);
    case "REF_NOT_FOUND":
    case "AMBIGUOUS_REF":
      return build("REF_NOT_FOUND", false);
    case "REPOSITORY_NOT_FOUND":
    case "PACKAGE_NOT_FOUND":
      return build("NOT_FOUND", false);
    case "TIMEOUT":
      return build("TIMEOUT", true);
    case "RATE_LIMITED":
      return build("RATE_LIMITED", true);
    default:
      return build("BACKEND_ERROR", false);
  }
}

export function buildUpdateRequiredError(
  reason: string = CLIENT_UPDATE_REQUIRED_REASON,
  currentVersion?: string,
): MappedError {
  return {
    code: "UPDATE_REQUIRED",
    message: `Update required: ${reason}`,
    retryable: false,
    details: {
      reason,
      updateCommand: "npm i -g githits@latest",
      ...(currentVersion ? { currentVersion } : {}),
    },
  };
}

/**
 * Dispatch on `CodeNavigationBackendError.graphqlCode` to produce
 * specific user-facing codes when available, otherwise BACKEND_ERROR
 * with the correct retryable default. When the backend provided its own
 * `retryable` hint on the original extensions block, it takes precedence
 * over the default.
 */
function classifyBackendError(error: CodeNavigationBackendError): MappedError {
  const details: MappedErrorDetails = {};
  preserveBackendMetadata(details, error.metadata);
  if (typeof error.status === "number") details.status = error.status;
  if (error.graphqlCode) details.graphqlCode = error.graphqlCode;

  const message = normalizeBackendMessage(error.message);

  const build = (code: MappedErrorCode, defaultRetryable: boolean) => ({
    code,
    message,
    retryable: error.retryable ?? defaultRetryable,
    details: Object.keys(details).length > 0 ? details : undefined,
  });

  switch (error.graphqlCode) {
    case "TIMEOUT":
      return build("TIMEOUT", true);
    case "RATE_LIMITED":
      return build("RATE_LIMITED", true);
    case "REPOSITORY_NOT_FOUND":
      return build("NOT_FOUND", false);
    case "REF_NOT_FOUND":
      return build("REF_NOT_FOUND", false);
    case "FILE_PATH_EXCLUDED":
      return build("FILE_PATH_EXCLUDED", false);
    case "SOURCE_FILE_INVENTORY_UNKNOWN":
      return build("SOURCE_FILE_INVENTORY_UNKNOWN", false);
    case "UPSTREAM_ERROR":
      return build("BACKEND_ERROR", true);
    default:
      return build("BACKEND_ERROR", false);
  }
}

function preserveBackendMetadata(
  details: MappedErrorDetails,
  metadata: CodeNavigationErrorMetadata | undefined,
): void {
  if (!metadata) return;
  if (metadata.hint) details.hint = metadata.hint;
  if (metadata.filePath) details.filePath = metadata.filePath;
  if (metadata.exclusionReason) {
    details.exclusionReason = metadata.exclusionReason;
  }
  if (metadata.availableVersions?.length) {
    details.availableVersions = metadata.availableVersions;
  }
  if (metadata.availableRefs?.length) {
    details.availableRefs = metadata.availableRefs;
  }
  if (metadata.suggestedRefs?.length) {
    details.suggestedRefs = metadata.suggestedRefs;
  }
  if (metadata.targetResolution) {
    details.targetResolution = metadata.targetResolution;
  }
  if (metadata.indexingEstimate) {
    details.indexingEstimate = metadata.indexingEstimate;
  }
}

function addRefSuggestions(
  message: string,
  refs: AvailableRef[] | undefined,
): string {
  if (!refs || refs.length === 0 || /did you mean/i.test(message)) {
    return message;
  }
  const suggestions = refs
    .slice(0, 5)
    .map((entry) => entry.ref)
    .join(", ");
  return `${message} Did you mean ${suggestions}?`;
}

/**
 * Align backend wording with the CLI/MCP docs. The backend labels the
 * required regex pre-filter term as a "literal anchor"; our surfaces
 * call it a "literal substring" to avoid anchor/^$ confusion.
 */
function normalizeBackendMessage(message: string): string {
  return message
    .replace(/extractable literal anchor/g, "extractable literal substring")
    .replace(/at least one literal anchor/g, "at least one literal substring")
    .replace(/literal prefix/g, "literal substring");
}

/**
 * Any Error whose `name` starts with `Invalid` or `Unsupported` is
 * treated as an invalid-argument case. Covers parser errors from
 * `src/shared/package-spec.ts` (`InvalidPackageSpecError`,
 * `UnsupportedRegistryError`, `InvalidArgumentError`) without
 * requiring this module to import them directly, which would
 * introduce a circular dependency.
 */
function isInvalidArgumentError(error: unknown): error is Error {
  if (!(error instanceof Error)) return false;
  return (
    error.name.startsWith("Invalid") || error.name.startsWith("Unsupported")
  );
}
