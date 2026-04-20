import { AuthenticationError } from "./githits-service.js";

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
      "Authentication required. Run `githits login` to authenticate.",
    );
  }

  try {
    return await options.executeWithToken(token);
  } catch (error) {
    if (!options.shouldRefresh(error)) {
      throw error;
    }

    const refreshedToken = await options.forceRefresh();
    if (!refreshedToken) {
      throw error;
    }

    return options.executeWithToken(refreshedToken);
  }
}
