/**
 * Classify errors raised from {@link PackageIntelligenceService} into
 * the shared `MappedError` envelope. Every `PackageIntelligence*Error`
 * subclass maps to a specific `MappedErrorCode`; shared cases
 * (`AuthenticationError`, name-prefixed `Invalid*` / `Unsupported*`)
 * reuse the same mapping rules as
 * {@link mapCodeNavigationError}. Every classified error emits a
 * single debug line under the `pkg-intel` area.
 */

import { ClientUpdateRequiredError } from "../services/client-update-required-error.js";
import { AuthenticationError } from "../services/githits-service.js";
import {
  MalformedPackageIntelligenceResponseError,
  PackageIntelligenceAccessError,
  PackageIntelligenceBackendError,
  PackageIntelligenceChangelogSourceNotFoundError,
  PackageIntelligenceFeatureFlagRequiredError,
  PackageIntelligenceGraphQLError,
  PackageIntelligenceNetworkError,
  PackageIntelligenceTargetNotFoundError,
  PackageIntelligenceValidationError,
  PackageIntelligenceVersionNotFoundError,
} from "../services/package-intelligence-service.js";
import type {
  MappedError,
  MappedErrorCode,
  MappedErrorDetails,
} from "./code-navigation-error-map.js";
import { buildUpdateRequiredError } from "./code-navigation-error-map.js";
import { debugLog } from "./debug-log.js";
import { AuthRequiredError } from "./require-auth.js";

// Re-export for caller convenience — callers of
// `mapPackageIntelligenceError` use the same envelope type as code-nav
// callers, so they import it alongside the classifier.
export type { MappedError, MappedErrorCode, MappedErrorDetails };

/**
 * Map a thrown error from `PackageIntelligenceServiceImpl` into the
 * shared `MappedError` envelope. Unrecognised errors fall to
 * `UNKNOWN`; a table test guards that no named class ever falls
 * through.
 */
export function mapPackageIntelligenceError(error: unknown): MappedError {
  const mapped = classify(error);
  debugLog("pkg-intel", {
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
  if (
    error instanceof PackageIntelligenceTargetNotFoundError ||
    error instanceof PackageIntelligenceChangelogSourceNotFoundError
  ) {
    return {
      code: "NOT_FOUND",
      message: error.message,
      retryable: false,
    };
  }
  if (error instanceof PackageIntelligenceVersionNotFoundError) {
    const details: MappedErrorDetails = {};
    if (error.packageName) details.package = error.packageName;
    if (error.requestedVersion) {
      details.requestedVersion = error.requestedVersion;
    }
    if (error.availableVersions && error.availableVersions.length > 0) {
      // `availableVersions` on this typed error is `string[]` —
      // narrower than the code-nav precedent's `{version, ref}[]`
      // because vulns registries have no ref concept. Match the
      // shared envelope shape by mapping into `{version}` objects.
      details.availableVersions = error.availableVersions.map((version) => ({
        version,
        ref: version,
      }));
    }
    return {
      code: "VERSION_NOT_FOUND",
      message: error.message,
      retryable: false,
      details: Object.keys(details).length > 0 ? details : undefined,
    };
  }
  if (error instanceof PackageIntelligenceValidationError) {
    return {
      code: "INVALID_ARGUMENT",
      message: error.message,
      retryable: false,
    };
  }
  if (
    error instanceof PackageIntelligenceAccessError ||
    error instanceof PackageIntelligenceFeatureFlagRequiredError
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
      details:
        error instanceof AuthenticationError
          ? { action: "Run `githits login`, then retry this tool call." }
          : undefined,
    };
  }
  if (error instanceof PackageIntelligenceNetworkError) {
    return { code: "NETWORK", message: error.message, retryable: true };
  }
  if (error instanceof PackageIntelligenceBackendError) {
    return classifyBackendError(error);
  }
  if (error instanceof PackageIntelligenceGraphQLError) {
    return {
      code: "BACKEND_ERROR",
      message: error.message,
      retryable: false,
      details: error.code ? { graphqlCode: error.code } : undefined,
    };
  }
  if (error instanceof MalformedPackageIntelligenceResponseError) {
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

function classifyBackendError(
  error: PackageIntelligenceBackendError,
): MappedError {
  const details: MappedErrorDetails = {};
  if (typeof error.status === "number") details.status = error.status;
  if (error.graphqlCode) details.graphqlCode = error.graphqlCode;

  const build = (code: MappedErrorCode, defaultRetryable: boolean) => ({
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
    case "UPSTREAM_ERROR":
      return build("BACKEND_ERROR", true);
    default:
      // INTERNAL_ERROR / UNKNOWN_ERROR / any other / undefined all
      // route to a non-retryable backend error.
      return build("BACKEND_ERROR", false);
  }
}

/**
 * Name-prefix rule shared with `mapCodeNavigationError` — callers that
 * raise `InvalidPackageSpecError` / `UnsupportedRegistryError` land on
 * `INVALID_ARGUMENT` without this module importing them directly.
 */
function isInvalidArgumentError(error: unknown): error is Error {
  if (!(error instanceof Error)) return false;
  return (
    error.name.startsWith("Invalid") || error.name.startsWith("Unsupported")
  );
}
