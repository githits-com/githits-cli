export interface TokenProvider {
  /** Get a valid token, refreshing proactively or reactively as needed. */
  getToken(): Promise<string | undefined>;

  /** Force a refresh, usually after an authentication failure. */
  forceRefresh(): Promise<string | undefined>;
}
