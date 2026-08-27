/** Stable message used for service authentication failures. */
export const AUTHENTICATION_REQUIRED_MESSAGE = "Authentication required.";
export const LOCAL_AUTHENTICATION_MISSING_MESSAGE =
  "No local GitHits authentication token found.";
export const SERVER_AUTHENTICATION_REJECTED_MESSAGE =
  "GitHits could not accept the authentication token.";

export type AuthenticationErrorSource = "local" | "server";

/**
 * Error thrown when the API rejects the current authentication token.
 *
 * Hosts add their own recovery guidance when presenting this neutral error.
 */
export class AuthenticationError extends Error {
  readonly source: AuthenticationErrorSource;

  constructor(
    message: string = AUTHENTICATION_REQUIRED_MESSAGE,
    source: AuthenticationErrorSource = "local",
  ) {
    super(message);
    this.name = "AuthenticationError";
    this.source = source;
  }
}

/**
 * Error returned when the API asks the client to retry later.
 *
 * `retryAfterSeconds` is derived from the standard Retry-After response
 * header when it contains either delay-seconds or a future HTTP date.
 */
export class ApiRateLimitError extends Error {
  readonly status = 429;
  readonly retryAfterSeconds: number | undefined;

  constructor(
    message: string = "Request rate limited.",
    retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "ApiRateLimitError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}
