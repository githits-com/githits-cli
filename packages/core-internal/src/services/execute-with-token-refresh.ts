import {
  AuthenticationError,
  LOCAL_AUTHENTICATION_MISSING_MESSAGE,
} from "./githits-service.js";

export interface ExecuteWithTokenRefreshOptions<T> {
  getToken: () => Promise<string | undefined>;
  forceRefresh: () => Promise<string | undefined>;
  executeWithToken: (token: string) => Promise<T>;
  shouldRefresh: (error: unknown) => boolean;
}

/**
 * Executes a token-authenticated operation and retries once after refresh when
 * the caller marks the failure as refreshable.
 */
export async function executeWithTokenRefresh<T>(
  options: ExecuteWithTokenRefreshOptions<T>,
): Promise<T> {
  const token = await options.getToken();
  if (!token) {
    throw new AuthenticationError(
      LOCAL_AUTHENTICATION_MISSING_MESSAGE,
      "local",
    );
  }

  try {
    return await options.executeWithToken(token);
  } catch (error) {
    // Opaque ghi-* credentials are re-evaluated server-side and have no local
    // refresh flow. Do not invoke the provider's refresh hook for them.
    if (token.startsWith("ghi-") || !options.shouldRefresh(error)) {
      throw error;
    }

    const refreshedToken = await options.forceRefresh();
    if (!refreshedToken) {
      throw error;
    }

    return options.executeWithToken(refreshedToken);
  }
}
