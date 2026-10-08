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
    return await Promise.race([
      fetchFn(input, { ...init, signal }).then<Response | T>((response) =>
        consumeResponse ? consumeResponse(response) : response,
      ),
      timeout,
    ]);
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
