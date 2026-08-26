import {
  ApiRateLimitError,
  AuthenticationError,
  FetchTimeoutError,
} from "@githits/core-internal/browser";
import type { MappedError } from "./mapped-error.js";
import { mapTermsAcceptanceError } from "./terms-acceptance-error-map.js";

/**
 * Classify errors from the GitHits API service into the shared envelope used
 * by CLI and MCP callers.
 */
export function mapGitHitsServiceError(
  operation: string,
  error: unknown,
): MappedError {
  const termsError = mapTermsAcceptanceError(error);
  if (termsError) return termsError;
  if (error instanceof AuthenticationError) {
    return {
      code: "AUTH_REQUIRED",
      message: error.message,
      retryable: false,
      details: { authSource: error.source },
    };
  }

  if (error instanceof ApiRateLimitError) {
    return {
      code: "RATE_LIMITED",
      message: error.message,
      retryable: true,
      details: {
        status: error.status,
        ...(error.retryAfterSeconds !== undefined
          ? { retryAfterSeconds: error.retryAfterSeconds }
          : {}),
      },
    };
  }

  if (error instanceof FetchTimeoutError) {
    return {
      code: "TIMEOUT",
      message: operationFailureMessage(operation, error.message),
      retryable: true,
      details: { timeoutMs: error.timeoutMs },
    };
  }

  const message = error instanceof Error ? error.message : "Unknown error";
  return {
    code: "UNKNOWN",
    message: operationFailureMessage(operation, message),
    retryable: false,
  };
}

function operationFailureMessage(operation: string, message: string): string {
  return `Failed to ${operation}: ${message}`;
}
