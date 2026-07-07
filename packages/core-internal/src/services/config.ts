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

/**
 * Get the MCP server base URL (for OAuth discovery).
 * Override with GITHITS_MCP_URL environment variable.
 */
export function getMcpUrl(): string {
  return process.env.GITHITS_MCP_URL ?? DEFAULT_MCP_URL;
}

/**
 * Get the REST API base URL (for search, languages, feedbacks).
 * Override with GITHITS_API_URL environment variable.
 */
export function getApiUrl(): string {
  return process.env.GITHITS_API_URL ?? DEFAULT_API_URL;
}

/**
 * Get the code-navigation backend URL. `GITHITS_CODE_NAV_URL` is the
 * supported override; a legacy env var is also accepted for local
 * development parity with older environments but is not publicly
 * documented.
 */
export function getCodeNavigationUrl(): string {
  const explicitUrl =
    process.env.GITHITS_CODE_NAV_URL ?? process.env.PKGSEER_URL;
  if (explicitUrl) {
    return explicitUrl;
  }

  return DEFAULT_CODE_NAV_URL;
}

/**
 * API token from environment variable (for CI/automation).
 */
export function getEnvApiToken(): string | undefined {
  return process.env.GITHITS_API_TOKEN;
}

// ---------------------------------------------------------------------------
// Retry configuration
// ---------------------------------------------------------------------------

export interface RetryConfig {
  /** Maximum number of retry attempts (default: 3) */
  maxRetries: number;
  /** Base delay in milliseconds for exponential backoff (default: 1000) */
  baseDelayMs: number;
  /** Maximum delay in milliseconds (default: 30000) */
  maxDelayMs: number;
  /** Whether to add jitter to delay (default: true) */
  jitter: boolean;
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  jitter: true,
};

/**
 * Get retry configuration with environment variable overrides.
 *
 * Environment variables:
 * - `GITHITS_RETRY_MAX` — maximum retry attempts
 * - `GITHITS_RETRY_BASE_DELAY_MS` — base delay in milliseconds
 * - `GITHITS_RETRY_MAX_DELAY_MS` — maximum delay in milliseconds
 * - `GITHITS_RETRY_JITTER` — enable/disable jitter ("true"/"false")
 */
export function getRetryConfig(): RetryConfig {
  const maxRetries = parseEnvInt(
    process.env.GITHITS_RETRY_MAX,
    DEFAULT_RETRY_CONFIG.maxRetries,
  );
  const baseDelayMs = parseEnvInt(
    process.env.GITHITS_RETRY_BASE_DELAY_MS,
    DEFAULT_RETRY_CONFIG.baseDelayMs,
  );
  const maxDelayMs = parseEnvInt(
    process.env.GITHITS_RETRY_MAX_DELAY_MS,
    DEFAULT_RETRY_CONFIG.maxDelayMs,
  );
  const jitter = parseEnvBool(
    process.env.GITHITS_RETRY_JITTER,
    DEFAULT_RETRY_CONFIG.jitter,
  );

  return { maxRetries, baseDelayMs, maxDelayMs, jitter };
}

function parseEnvInt(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function parseEnvBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return value.toLowerCase() === "true";
}
