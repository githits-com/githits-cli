/**
 * Base URL configuration for GitHits services.
 *
 * Two separate URLs are needed:
 * - MCP URL: For OAuth discovery (.well-known endpoints) and auth flow
 * - API URL: For REST API calls (search, languages, feedbacks)
 */

const DEFAULT_MCP_URL = "https://mcp.githits.com";
const DEFAULT_API_URL = "https://api.githits.com";

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
 * Get API token from environment variable (for CI/automation).
 */
export function getEnvApiToken(): string | undefined {
  return process.env.GITHITS_API_TOKEN;
}
