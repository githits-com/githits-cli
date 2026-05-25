export const DEFAULT_FETCH_TIMEOUT_MS = 30_000;

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
