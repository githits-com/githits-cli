import type { MappedError } from "./mapped-error.js";

/**
 * Map the shared session configuration error without importing Node-only
 * header utilities into browser-safe tool error classifiers.
 */
export function mapSessionIdError(error: unknown): MappedError | undefined {
  if (!(error instanceof Error) || error.name !== "SessionIdConfigError")
    return undefined;
  return {
    code: "INVALID_ARGUMENT",
    message: error.message,
    retryable: false,
  };
}
