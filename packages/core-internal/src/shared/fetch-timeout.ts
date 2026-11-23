export const DEFAULT_FETCH_TIMEOUT_MS = 120_000;

/** Preparation waits shared by CLI/MCP adapters and direct service callers. */
export const DEFAULT_WAIT_TIMEOUT_MS = 30_000;

/** Allow the backend to return results or progress after its preparation wait. */
export function indexingRequestTimeoutMs(waitTimeoutMs: number): number {
  return Math.max(DEFAULT_FETCH_TIMEOUT_MS, waitTimeoutMs + 30_000);
}

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

export function fetchWithTimeout<T>(
  input: Parameters<typeof fetch>[0],
  init: RequestInit,
  options: FetchWithTimeoutOptions,
  consumeResponse: (response: Response) => Promise<T>,
): Promise<T>;
export function fetchWithTimeout(
  input: Parameters<typeof fetch>[0],
  init?: RequestInit,
  options?: FetchWithTimeoutOptions,
): Promise<Response>;
/** Consume an optional response body within the original request deadline. */
export async function fetchWithTimeout<T>(
  input: Parameters<typeof fetch>[0],
  init: RequestInit = {},
  options: FetchWithTimeoutOptions = {},
  consumeResponse?: (response: Response) => Promise<T>,
): Promise<Response | T> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
  const callerSignal = init.signal;
  callerSignal?.throwIfAborted();

  const deadline = new AbortController();
  const signal = callerSignal
    ? AbortSignal.any([callerSignal, deadline.signal])
    : deadline.signal;
  const fetchFn = options.fetchFn ?? globalThis.fetch;

  // Keep the process alive until the deadline even when fetch has no active handles.
  const timeoutId = setTimeout(() => {
    deadline.abort(
      new DOMException(
        "The operation was aborted due to timeout",
        "TimeoutError",
      ),
    );
  }, timeoutMs);

  let onAbort!: () => void;
  const cancellation = new Promise<never>((_, reject) => {
    onAbort = () => {
      const cause = signal.reason;
      reject(
        deadline.signal.aborted && cause === deadline.signal.reason
          ? new FetchTimeoutError(timeoutMs, { cause })
          : cause,
      );
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });

  try {
    const operation = Promise.resolve()
      .then(() => {
        signal.throwIfAborted();
        return fetchFn(input, { ...init, signal });
      })
      .then<Response | T>((response) =>
        consumeResponse ? consumeResponse(response) : response,
      );

    return await Promise.race([operation, cancellation]);
  } finally {
    clearTimeout(timeoutId);
    signal.removeEventListener("abort", onAbort);
  }
}

export function isFetchTimeoutError(
  error: unknown,
): error is FetchTimeoutError {
  return error instanceof FetchTimeoutError;
}
