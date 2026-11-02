const RECOVERY_URLS = new Set([
  "https://app.githits.com/auth/reauth",
  "https://dev.githits.com/auth/reauth",
]);

/** Provider sign-in is separate from refreshing the GitHits session. */
export class ProviderReauthenticationRequiredError extends Error {
  readonly code = "REAUTH_REQUIRED";
  readonly reauthUrl: string | undefined;

  constructor(reauthUrl?: string) {
    super("Please sign in again to continue.");
    this.name = "ProviderReauthenticationRequiredError";
    this.reauthUrl =
      reauthUrl && RECOVERY_URLS.has(reauthUrl) ? reauthUrl : undefined;
  }
}

/** Called only for HTTP 401 responses from the GitHits backend. */
export function throwIfProviderReauthenticationRequired(body: string): void {
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return;
  }
  if (!payload || typeof payload !== "object" || !("code" in payload)) return;
  if (payload.code !== "REAUTH_REQUIRED") return;
  throw new ProviderReauthenticationRequiredError(
    "reauth_url" in payload && typeof payload.reauth_url === "string"
      ? payload.reauth_url
      : undefined,
  );
}
