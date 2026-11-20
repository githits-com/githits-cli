import {
  AuthenticationError,
  LOCAL_AUTHENTICATION_MISSING_MESSAGE,
} from "./githits-service.js";

export interface ExecuteWithTokenRefreshOptions<T> {
  getToken: () => Promise<string | undefined>;
  forceRefresh: () => Promise<string | undefined>;
  executeWithToken: (token: string) => Promise<T>;
  shouldRefresh: (error: unknown) => boolean;
  /**
   * Optional caller cancellation. Token-provider work may be shared with other
   * callers, so an abort stops this caller's wait without aborting the provider.
   */
  signal?: AbortSignal;
}

/**
 * Executes a token-authenticated operation and retries once after refresh when
 * the caller marks the failure as refreshable.
 */
export async function executeWithTokenRefresh<T>(
  options: ExecuteWithTokenRefreshOptions<T>,
): Promise<T> {
  const { signal } = options;
  const token = await callerFirst(signal, () => options.getToken());
  signal?.throwIfAborted();
  if (!token) {
    throw new AuthenticationError(
      LOCAL_AUTHENTICATION_MISSING_MESSAGE,
      "local",
    );
  }

  try {
    return await options.executeWithToken(token);
  } catch (error) {
    // A cancelled caller no longer wants the result; surface the caller's
    // reason instead of refreshing credentials for a retry.
    signal?.throwIfAborted();
    if (!options.shouldRefresh(error)) {
      throw error;
    }

    const refreshedToken = await callerFirst(signal, () =>
      options.forceRefresh(),
    );
    signal?.throwIfAborted();
    if (!refreshedToken) {
      throw error;
    }

    return options.executeWithToken(refreshedToken);
  }
}

/**
 * Stop waiting for token-provider work when this caller aborts. Promise.race
 * observes a later provider rejection even after the caller has left, while
 * the provider remains free to finish shared refresh work for other callers.
 */
async function callerFirst<T>(
  signal: AbortSignal | undefined,
  step: () => Promise<T>,
): Promise<T> {
  signal?.throwIfAborted();
  if (!signal) return step();

  let rejectOnAbort!: (reason: unknown) => void;
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectOnAbort = reject;
  });
  // A provider may throw synchronously after aborting the signal. Observe the
  // abort promise even if execution never reaches Promise.race.
  void aborted.catch(() => undefined);
  const onAbort = () => rejectOnAbort(signal.reason);
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    return await Promise.race([step(), aborted]);
  } catch (error) {
    signal.throwIfAborted();
    throw error;
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}
