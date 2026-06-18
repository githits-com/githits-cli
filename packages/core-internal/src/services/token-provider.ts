export interface TokenProvider {
  /** Get a valid token, refreshing proactively or reactively as needed. */
  getToken(): Promise<string | undefined>;

  /** Force a refresh, usually after an authentication failure. */
  forceRefresh(): Promise<string | undefined>;
}

export function createStaticTokenProvider(token: string): TokenProvider {
  return {
    getToken: async () => token,
    forceRefresh: async () => undefined,
  };
}
