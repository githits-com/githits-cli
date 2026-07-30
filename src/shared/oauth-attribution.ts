const CLI_AUTH_UTM_PARAMS = {
  utm_source: "githits-cli",
  utm_medium: "cli",
  utm_campaign: "cli-auth",
} as const;

/**
 * Add stable CLI attribution to the OAuth callback URI.
 *
 * The callback URI is registered and matched as an exact OAuth redirect URI,
 * so these values must remain stable across CLI versions and auth entrypoints.
 */
export function withCliAuthAttribution(callbackUri: string): string {
  const attributedUri = new URL(callbackUri);

  for (const [name, value] of Object.entries(CLI_AUTH_UTM_PARAMS)) {
    attributedUri.searchParams.set(name, value);
  }

  return attributedUri.toString();
}
