import {
  AuthenticationError,
  type AuthenticationErrorSource,
  type AvailableRef,
  type AvailableVersion,
  CLIENT_UPDATE_REQUIRED_REASON,
  ClientUpdateRequiredError,
  CodeNavigationAccessError,
  CodeNavigationBackendError,
  CodeNavigationFeatureFlagRequiredError,
  CodeNavigationFileNotFoundError,
  CodeNavigationGraphQLError,
  CodeNavigationIndexingError,
  CodeNavigationNetworkError,
  CodeNavigationTargetNotFoundError,
  CodeNavigationUnresolvableError,
  CodeNavigationValidationError,
  CodeNavigationVersionNotFoundError,
  debugLog,
  MalformedCodeNavigationResponseError,
  type TargetResolution,
} from "@githits/core-internal";
import { AuthRequiredError } from "./require-auth.js";

export type MappedErrorCode =
  | "NOT_FOUND"
  | "FILE_NOT_FOUND"
  | "REF_NOT_FOUND"
  | "VERSION_NOT_FOUND"
  | "INDEXING"
  | "UNRESOLVABLE"
  | "ACCESS_DENIED"
  | "AUTH_REQUIRED"
  | "NETWORK"
  | "INVALID_ARGUMENT"
  | "BACKEND_ERROR"
  | "TIMEOUT"
  | "RATE_LIMITED"
  | "PROTOCOL_ERROR"
  | "UPDATE_REQUIRED"
  | "UNKNOWN";

export interface MappedErrorDetails {
  action?: string;
  availableVersions?: AvailableVersion[];
  availableRefs?: AvailableRef[];
  targetResolution?: TargetResolution;
  indexingRef?: string;
  status?: number;
  graphqlCode?: string;
  /**
   * Populated on `VERSION_NOT_FOUND` from the backend's
   * `extensions.latest_indexed` — the newest version that is
   * actually indexed, suitable as the first recovery suggestion.
   */
  latestIndexed?: string;
  /** The version the caller asked for (for `VERSION_NOT_FOUND`). */
  requestedVersion?: string;
  /** Fully-qualified package identifier (for `VERSION_NOT_FOUND`). */
  package?: string;
  /** The file path the caller asked for (for `FILE_NOT_FOUND`). */
  filePath?: string;
  /** Installed CLI version when an update is required. */
  currentVersion?: string;
  /** Suggested package-manager command when an update is required. */
  updateCommand?: string;
  /** Human-readable update reason. */
  reason?: string;
  /** Whether auth failed before making a request or after backend rejection. */
  authSource?: AuthenticationErrorSource;
}

export interface MappedError {
  code: MappedErrorCode;
  message: string;
  /**
   * Whether the caller can retry the same request successfully.
   * Sourced from the backend's `extensions.retryable` when present
   * (April 2026 contract); otherwise a per-code default. Agents and
   * automation use this directly without maintaining their own
   * retryability tables.
   */
  retryable?: boolean;
  details?: MappedErrorDetails;
}

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
  const mapped = classify(error);
  // Emit a single debug line per classification when GITHITS_DEBUG is
  // scoped to "code-nav" (or "*"). PII policy: carry the `code`,
  // error constructor name, and detail *keys* — never the message
  // text (which can echo user-supplied query content on some
  // backend error paths) and never response bodies.
  debugLog("code-nav", {
    event: "error-classified",
    code: mapped.code,
    errorName: error instanceof Error ? error.name : typeof error,
    detailKeys: mapped.details ? Object.keys(mapped.details) : [],
  });
  return mapped;
}

function classify(error: unknown): MappedError {
  if (error instanceof ClientUpdateRequiredError) {
    return buildUpdateRequiredError(error.reason, error.currentVersion);
  }
  if (error instanceof CodeNavigationVersionNotFoundError) {
    const details: MappedErrorDetails = {};
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
    return {
      code: "NOT_FOUND",
      message: error.message,
      retryable: false,
      details: error.availableVersions
        ? { availableVersions: error.availableVersions }
        : undefined,
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
    case "REF_NOT_FOUND":
      return build("REF_NOT_FOUND", false);
    case "UPSTREAM_ERROR":
      return build("BACKEND_ERROR", true);
    default:
      return build("BACKEND_ERROR", false);
  }
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
