import {
  isRetryableError,
  type RetryOptions,
  retryWithBackoff,
} from "./retry.js";

export const DEFAULT_FETCH_TIMEOUT_MS = 120_000;

export class FetchTimeoutError extends Error {
  readonly timeoutMs: number;

  constructor(timeoutMs: number, options?: { cause?: unknown }) {
    super(`Request timed out after ${timeoutMs}ms.`, options);
    this.name = "FetchTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

export interface FetchWithTimeoutOptions {
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}

/**
 * Options for retry-enabled fetch with timeout.
 */
export interface RetryFetchOptions extends FetchWithTimeoutOptions {
  /** Maximum number of retry attempts (default: 3) */
  maxRetries?: number;
  /** Base delay in milliseconds for exponential backoff (default: 1000) */
  baseDelayMs?: number;
  /** Maximum delay in milliseconds (default: 30000) */
  maxDelayMs?: number;
  /** Whether to add jitter to delay (default: true) */
  jitter?: boolean;
  /** Whether the request is idempotent (safe to retry, default: true) */
  idempotent?: boolean;
  /** Custom function to determine if error is retryable */
  retryOn?: (error: unknown) => boolean;
  /** Callback invoked before each retry */
  onRetry?: (attempt: number, error: unknown, delayMs: number) => void;
}

export async function fetchWithTimeout(
  input: Parameters<typeof fetch>[0],
  init: RequestInit = {},
  options: FetchWithTimeoutOptions = {},
): Promise<Response> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = init.signal
    ? AbortSignal.any([init.signal, timeoutSignal])
    : timeoutSignal;
  const fetchFn = options.fetchFn ?? globalThis.fetch;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new FetchTimeoutError(timeoutMs));
    }, timeoutMs);
  });

  try {
    return await Promise.race([fetchFn(input, { ...init, signal }), timeout]);
  } catch (cause) {
    if (cause instanceof FetchTimeoutError) throw cause;
    if (timeoutSignal.aborted && !init.signal?.aborted) {
      throw new FetchTimeoutError(timeoutMs, { cause });
    }
    throw cause;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

export function isFetchTimeoutError(
  error: unknown,
): error is FetchTimeoutError {
  return error instanceof FetchTimeoutError;
}

/**
 * Executes a fetch request with timeout and retry logic.
 *
 * Wraps fetchWithTimeout with exponential backoff retry for transient failures.
 * Only retries if the request is idempotent (default: true).
 *
 * @param input - URL or Request object
 * @param init - Request options
 * @param options - Fetch and retry configuration
 * @returns Promise resolving to the Response
 * @throws Last error if all retries fail or if error is non-retryable
 *
 * @example
 * ```typescript
 * const response = await retryFetchWithTimeout(
 *   "https://api.example.com/data",
 *   { method: "POST", body: JSON.stringify({ query: "test" }) },
 *   { maxRetries: 3, baseDelayMs: 1000 }
 * );
 * ```
 */
export async function retryFetchWithTimeout(
  input: Parameters<typeof fetch>[0],
  init: RequestInit = {},
  options: RetryFetchOptions = {},
): Promise<Response> {
  const {
    maxRetries = 3,
    baseDelayMs = 1000,
    maxDelayMs = 30_000,
    jitter = true,
    idempotent = true,
    retryOn = isRetryableError,
    onRetry,
    ...fetchOptions
  } = options;

  // If not idempotent, don't retry
  if (!idempotent) {
    return fetchWithTimeout(input, init, fetchOptions);
  }

  return retryWithBackoff(() => fetchWithTimeout(input, init, fetchOptions), {
    maxRetries,
    baseDelayMs,
    maxDelayMs,
    jitter,
    retryOn,
    onRetry,
  });
}
