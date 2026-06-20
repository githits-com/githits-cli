/**
 * Retry utility with exponential backoff and jitter.
 *
 * Provides transport-agnostic retry logic for async operations.
 * Used by fetch-timeout.ts and pkgseer-graphql.ts to add resilience
 * against transient network failures.
 *
 * Scope boundary:
 * - Owns: retry loop, backoff calculation, jitter, error classification
 * - Does NOT own: HTTP logic, token refresh, MCP-specific behavior
 */

import { FetchTimeoutError } from "./fetch-timeout.js";

/**
 * Options for retry behavior.
 */
export interface RetryOptions {
  /** Maximum number of retry attempts (default: 3) */
  maxRetries?: number;
  /** Base delay in milliseconds for exponential backoff (default: 1000) */
  baseDelayMs?: number;
  /** Maximum delay in milliseconds (default: 30000) */
  maxDelayMs?: number;
  /** Whether to add jitter to delay (default: true) */
  jitter?: boolean;
  /** Custom function to determine if error is retryable (default: isRetryableError) */
  retryOn?: (error: unknown) => boolean;
  /** Callback invoked before each retry */
  onRetry?: (attempt: number, error: unknown, delayMs: number) => void;
}

/**
 * Determines if an error is retryable based on error type and properties.
 *
 * Retryable errors:
 * - FetchTimeoutError (network timeout)
 * - PkgseerTransportError (network failure before response)
 * - HTTP 429 (rate limited)
 * - HTTP 5xx (server error)
 *
 * Non-retryable errors:
 * - HTTP 4xx (client error, except 429)
 * - AuthenticationError (handled by token refresh)
 * - Unknown errors
 */
export function isRetryableError(error: unknown): boolean {
  // Network timeout is retryable
  if (error instanceof FetchTimeoutError) {
    return true;
  }

  // PkgseerTransportError (network failure before response) is retryable
  if (error instanceof Error && error.name === "PkgseerTransportError") {
    return true;
  }

  // Check for HTTP status-based errors
  if (error && typeof error === "object" && "status" in error) {
    const status = (error as { status: unknown }).status;
    if (typeof status === "number") {
      // Rate limiting (429) is retryable
      if (status === 429) {
        return true;
      }
      // Server errors (5xx) are retryable
      if (status >= 500 && status < 600) {
        return true;
      }
      // Client errors (4xx except 429) are NOT retryable
      if (status >= 400 && status < 500) {
        return false;
      }
    }
  }

  // Check for error with retryable flag (from backend extensions)
  if (
    error &&
    typeof error === "object" &&
    "retryable" in error &&
    (error as { retryable: unknown }).retryable === true
  ) {
    return true;
  }

  // Default: not retryable
  return false;
}

/**
 * Calculates delay with exponential backoff and optional jitter.
 *
 * @param attempt - Current attempt number (0-based)
 * @param baseDelayMs - Base delay in milliseconds
 * @param maxDelayMs - Maximum delay cap
 * @param jitter - Whether to add randomness
 * @returns Delay in milliseconds
 */
export function calculateDelay(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
  jitter: boolean,
): number {
  // Exponential backoff: baseDelay * 2^attempt
  let delay = baseDelayMs * 2 ** attempt;

  // Add jitter if enabled (full jitter: delay * random(0.5, 1.0))
  if (jitter) {
    delay = delay * (0.5 + Math.random() * 0.5);
  }

  // Cap at maxDelayMs
  return Math.min(delay, maxDelayMs);
}

/**
 * Executes an async function with retry logic and exponential backoff.
 *
 * @param fn - Async function to execute
 * @param options - Retry configuration options
 * @returns Promise resolving to the function's result
 * @throws Last error if all retries fail
 *
 * @example
 * ```typescript
 * const response = await retryWithBackoff(
 *   () => fetch("https://api.example.com/data"),
 *   { maxRetries: 3, baseDelayMs: 1000 }
 * );
 * ```
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const {
    maxRetries = 3,
    baseDelayMs = 1000,
    maxDelayMs = 30_000,
    jitter = true,
    retryOn = isRetryableError,
    onRetry,
  } = options;

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Check if we should retry
      if (!retryOn(error)) {
        throw error;
      }

      // Check if we have retries left
      if (attempt >= maxRetries) {
        throw error;
      }

      // Calculate delay for next attempt
      const delay = calculateDelay(attempt, baseDelayMs, maxDelayMs, jitter);

      // Invoke callback if provided
      if (onRetry) {
        onRetry(attempt + 1, error, delay);
      }

      // Wait before retrying
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  // This should never be reached, but TypeScript needs it
  throw lastError;
}
