/**
 * Base URL configuration for GitHits services.
 *
 * Three separate URLs are needed:
 * - MCP URL: For OAuth discovery (.well-known endpoints) and auth flow
 * - API URL: For REST API calls (search, languages, feedbacks)
 * - Code navigation URL: For indexed package/source calls
 */

export const DEFAULT_MCP_URL = "https://mcp.githits.com";
export const DEFAULT_API_URL = "https://api.githits.com";
export const DEFAULT_CODE_NAV_URL = "https://pkgseer.dev";

export class ServiceUrlConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ServiceUrlConfigError";
  }
}

/**
 * Get the MCP server base URL (for OAuth discovery).
 * Override with GITHITS_MCP_URL environment variable.
 */
export function getMcpUrl(): string {
  return resolveServiceUrl("GITHITS_MCP_URL", DEFAULT_MCP_URL);
}

/**
 * Resolve the MCP URL solely as an auth-storage namespace. This intentionally
 * skips network validation so local diagnostics and credential cleanup remain
 * available when network configuration is malformed.
 */
export function getMcpStorageKeyUrl(): string {
  return process.env.GITHITS_MCP_URL ?? DEFAULT_MCP_URL;
}

/**
 * Get the REST API base URL (for search, languages, feedbacks).
 * Override with GITHITS_API_URL environment variable.
 */
export function getApiUrl(): string {
  return resolveServiceUrl("GITHITS_API_URL", DEFAULT_API_URL);
}

/**
 * Get the code-navigation backend URL. `GITHITS_CODE_NAV_URL` is the
 * supported override; a legacy env var is also accepted for local
 * development parity with older environments but is not publicly
 * documented.
 */
export function getCodeNavigationUrl(): string {
  if (process.env.GITHITS_CODE_NAV_URL !== undefined) {
    return validateServiceUrl(
      process.env.GITHITS_CODE_NAV_URL,
      "GITHITS_CODE_NAV_URL",
    );
  }
  if (process.env.PKGSEER_URL !== undefined) {
    return validateServiceUrl(process.env.PKGSEER_URL, "PKGSEER_URL");
  }

  return DEFAULT_CODE_NAV_URL;
}

/**
 * Enforce TLS for service URLs while retaining exact loopback HTTP endpoints
 * used by local development.
 */
export function validateServiceUrl(value: string, source: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new ServiceUrlConfigError(
      `Invalid ${source}: expected an HTTPS URL or an HTTP loopback URL.`,
    );
  }

  if (parsed.protocol === "https:") return value;
  const hostname = parsed.hostname.replace(/^\[|\]$/g, "");
  const isLoopback =
    hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  if (parsed.protocol === "http:" && isLoopback) return value;

  throw new ServiceUrlConfigError(
    `Invalid ${source}: use HTTPS. Plain HTTP is allowed only for localhost, 127.0.0.1, or [::1].`,
  );
}

function resolveServiceUrl(envName: string, defaultUrl: string): string {
  const override = process.env[envName];
  return override === undefined
    ? defaultUrl
    : validateServiceUrl(override, envName);
}

/**
 * Get API token from environment variable (for CI/automation).
 */
export function getEnvApiToken(): string | undefined {
  return process.env.GITHITS_API_TOKEN;
}
