export interface TokenProvider {
  /** Get a valid token, refreshing proactively or reactively as needed. */
  getToken(): Promise<string | undefined>;

  /**
   * Force a refresh, usually after an authentication failure. Providers without
   * a refresh flow return undefined without I/O so callers retain the original error.
   */
  forceRefresh(): Promise<string | undefined>;
}

/** Treat the token as opaque; refresh is a no-op with no I/O. */
export function createStaticTokenProvider(token: string): TokenProvider {
  return {
    getToken: async () => token,
    forceRefresh: async () => undefined,
  };
}
