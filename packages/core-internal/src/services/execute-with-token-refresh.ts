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
   * Optional caller cancellation. Once aborted, the helper rejects with the
   * signal's reason at the next step and never refreshes or retries.
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
  signal?.throwIfAborted();
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
    // Opaque API tokens (including both generations) are re-evaluated
    // server-side and have no local refresh flow; only Supabase JWTs refresh.
    if (isOpaqueApiToken(token) || !options.shouldRefresh(error)) {
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
 * Run a token-provider step so that a caller abort wins over the provider's
 * own failure: once the caller has cancelled, its reason is what surfaces.
 */
async function callerFirst<T>(
  signal: AbortSignal | undefined,
  step: () => Promise<T>,
): Promise<T> {
  try {
    return await step();
  } catch (error) {
    signal?.throwIfAborted();
    throw error;
  }
}

function isOpaqueApiToken(token: string): boolean {
  // Even a malformed new-format key must not switch to a saved OAuth identity.
  return (
    token.startsWith("ghi-") ||
    token.startsWith("gh-proj-") ||
    token.startsWith("sk-githits-")
  );
}
