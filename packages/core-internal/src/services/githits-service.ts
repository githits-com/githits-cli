import {
  DEFAULT_FETCH_TIMEOUT_MS,
  fetchWithTimeout,
} from "../shared/fetch-timeout.js";
import type { ClientHeaderBuilder } from "../shared/request-headers.js";
import { withTelemetrySpan } from "../shared/telemetry.js";

const DEFAULT_EXAMPLE_REQUEST_TIMEOUT_MS = 240_000;

/**
 * Neutral auth-required message for service/core errors. Surface layers append
 * CLI- or MCP-specific recovery guidance when presenting the error.
 */
export const AUTHENTICATION_REQUIRED_MESSAGE = "Authentication required.";
export const LOCAL_AUTHENTICATION_MISSING_MESSAGE =
  "No local GitHits authentication token found.";
export const SERVER_AUTHENTICATION_REJECTED_MESSAGE =
  "GitHits could not accept the authentication token.";

export type AuthenticationErrorSource = "local" | "server";

/**
 * Error thrown when the API returns 401 Unauthorized.
 * Used by RefreshingGitHitsService to detect auth failures and trigger token refresh.
 */
export class AuthenticationError extends Error {
  readonly source: AuthenticationErrorSource;

  constructor(
    message: string = AUTHENTICATION_REQUIRED_MESSAGE,
    source: AuthenticationErrorSource = "local",
  ) {
    super(message);
    this.name = "AuthenticationError";
    this.source = source;
  }
}

/**
 * Error returned when the REST API asks the client to retry later.
 *
 * `retryAfterSeconds` is derived from the standard Retry-After response
 * header when it contains either delay-seconds or a future HTTP date.
 */
export class ApiRateLimitError extends Error {
  readonly status = 429;
  readonly retryAfterSeconds: number | undefined;

  constructor(
    message: string = "Request rate limited.",
    retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "ApiRateLimitError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/**
 * Extract human-readable detail from a JSON error response body.
 * FastAPI returns `{"detail": "..."}` for HTTPException responses.
 */
function parseDetail(body: string): string | undefined {
  if (!body) return undefined;
  try {
    const parsed = JSON.parse(body);
    if (typeof parsed.detail === "string") return parsed.detail;
  } catch {
    // Not JSON — return raw body
    return body;
  }
  return undefined;
}

/**
 * Parse an HTTP Retry-After value into a non-negative delay in seconds.
 * HTTP-date delays round up so callers never retry before the stated time.
 */
function parseRetryAfterSeconds(
  value: string | null,
  nowMs: number,
): number | undefined {
  const normalized = value?.trim();
  if (!normalized) return undefined;

  if (/^\d+$/.test(normalized)) {
    const delaySeconds = Number(normalized);
    return Number.isSafeInteger(delaySeconds) ? delaySeconds : undefined;
  }

  // Numeric-looking values that are not delay-seconds must not be
  // reinterpreted by Date.parse as implementation-specific dates.
  if (/^[+-]?\d+(?:\.\d+)?$/.test(normalized)) return undefined;

  // Date.parse accepts formats outside HTTP-date, including ISO dates.
  // Restrict parsing to the three wire formats HTTP clients must accept.
  const isHttpDate =
    /^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(
      normalized,
    ) ||
    /^[A-Z][a-z]+, \d{2}-[A-Z][a-z]{2}-\d{2} \d{2}:\d{2}:\d{2} GMT$/.test(
      normalized,
    ) ||
    /^[A-Z][a-z]{2} [A-Z][a-z]{2} [ \d]\d \d{2}:\d{2}:\d{2} \d{4}$/.test(
      normalized,
    );
  if (!isHttpDate) return undefined;

  const retryAtMs = Date.parse(normalized);
  if (!Number.isFinite(retryAtMs)) return undefined;

  const delayMs = retryAtMs - nowMs;
  if (delayMs < 0) return undefined;

  const delaySeconds = Math.ceil(delayMs / 1_000);
  return Number.isSafeInteger(delaySeconds) ? delaySeconds : undefined;
}

/**
 * Language data from the API.
 */
export interface Language {
  id: string;
  name: string;
  display_name: string;
  aliases: string[];
  search_priority?: number;
}

/**
 * Parameters for search API call.
 */
export interface SearchParams {
  query: string;
  language?: string;
  licenseMode?: "strict" | "yolo" | "custom";
  includeExplanation?: boolean;
}

/**
 * Parameters for feedback API call.
 *
 * Feedback can target an example, a solution, or the current CLI/MCP
 * session. When neither `exampleId` nor `solutionId` is present, the
 * backend uses the `x-githits-session-id` header from injected client headers
 * to create generic session feedback.
 */
export interface FeedbackParams {
  exampleId?: string;
  solutionId?: string;
  accepted: boolean;
  feedbackText?: string;
  toolName?: string;
}

/**
 * Feedback response from the API.
 */
export interface FeedbackResult {
  success: boolean;
  message: string;
}

export interface GitHitsServiceRuntimeOptions {
  clientHeaders?: ClientHeaderBuilder;
  userAgent?: string;
}

/**
 * Service interface for GitHits REST API.
 */
export interface GitHitsService {
  /** Search for code examples. Returns markdown-formatted result. */
  search(params: SearchParams): Promise<string>;

  /** Get all supported languages. */
  getLanguages(): Promise<Language[]>;

  /** Search supported languages using backend-ranked matching. */
  searchLanguages(query: string, limit?: number): Promise<Language[]>;

  /** Submit feedback on a result or the current GitHits session. */
  submitFeedback(params: FeedbackParams): Promise<FeedbackResult>;
}

/**
 * Production implementation of GitHitsService.
 */
export class GitHitsServiceImpl implements GitHitsService {
  constructor(
    private readonly apiUrl: string,
    private readonly token: string,
    private readonly fetchFn?: typeof fetch,
    private readonly fetchTimeoutMs: number | undefined = undefined,
    private readonly runtime: GitHitsServiceRuntimeOptions = {},
  ) {}

  async search(params: SearchParams): Promise<string> {
    return withTelemetrySpan("githits.search.request", async () => {
      const response = await fetchWithTimeout(
        `${this.apiUrl}/search`,
        {
          method: "POST",
          headers: this.headers(),
          body: JSON.stringify({
            query: params.query,
            language: params.language,
            license_mode: params.licenseMode ?? "strict",
            include_explanation: params.includeExplanation ?? false,
          }),
        },
        this.fetchOptions(DEFAULT_EXAMPLE_REQUEST_TIMEOUT_MS),
      );

      if (!response.ok) {
        throw await this.createError(response);
      }

      return response.text();
    });
  }

  async getLanguages(): Promise<Language[]> {
    return withTelemetrySpan("githits.languages.request", async () => {
      const response = await fetchWithTimeout(
        `${this.apiUrl}/languages`,
        {
          headers: this.headers(),
        },
        this.fetchOptions(),
      );

      if (!response.ok) {
        throw await this.createError(response);
      }

      return response.json() as Promise<Language[]>;
    });
  }

  async searchLanguages(query: string, limit: number = 5): Promise<Language[]> {
    return withTelemetrySpan("githits.languages.search.request", async () => {
      const params = new URLSearchParams({
        query,
        limit: String(limit),
      });
      const response = await fetchWithTimeout(
        `${this.apiUrl}/languages?${params.toString()}`,
        {
          headers: this.headers(),
        },
        this.fetchOptions(),
      );

      if (!response.ok) {
        throw await this.createError(response);
      }

      return response.json() as Promise<Language[]>;
    });
  }

  async submitFeedback(params: FeedbackParams): Promise<FeedbackResult> {
    return withTelemetrySpan("githits.feedback.request", async () => {
      // For generic feedback, omit body targets entirely. The backend
      // then uses the valid x-githits-session-id header emitted by
      // the injected client headers as the feedback target.
      const response = await fetchWithTimeout(
        `${this.apiUrl}/feedbacks`,
        {
          method: "POST",
          headers: this.headers(),
          body: JSON.stringify({
            ...(params.exampleId !== undefined && {
              example_id: params.exampleId,
            }),
            ...(params.solutionId !== undefined && {
              solution_id: params.solutionId,
            }),
            accepted: params.accepted,
            feedback_text: params.feedbackText ?? null,
            ...(params.toolName !== undefined && {
              tool_name: params.toolName,
            }),
          }),
        },
        this.fetchOptions(),
      );

      if (!response.ok) {
        throw await this.createError(response);
      }

      return { success: true, message: "Feedback submitted successfully" };
    });
  }

  private headers(): Record<string, string> {
    return {
      ...this.runtime.clientHeaders?.(),
      Authorization: `Bearer ${this.token}`,
      "Content-Type": "application/json",
      "User-Agent": this.runtime.userAgent ?? "githits-cli",
    };
  }

  private fetchOptions(defaultTimeoutMs: number = DEFAULT_FETCH_TIMEOUT_MS): {
    fetchFn?: typeof fetch;
    timeoutMs: number;
  } {
    return {
      fetchFn: this.fetchFn,
      timeoutMs: this.fetchTimeoutMs ?? defaultTimeoutMs,
    };
  }

  private async createError(response: Response): Promise<Error> {
    const status = response.status;
    const body = await response.text().catch(() => "");

    switch (status) {
      case 401:
        return new AuthenticationError(
          SERVER_AUTHENTICATION_REJECTED_MESSAGE,
          "server",
        );
      case 403:
        return new Error("Access denied.");
      case 404:
        return new Error(parseDetail(body) || "Resource not found.");
      case 429:
        return new ApiRateLimitError(
          undefined,
          parseRetryAfterSeconds(
            response.headers.get("Retry-After"),
            Date.now(),
          ),
        );
      default: {
        if (status >= 500) {
          const detail = body ? `: ${body}` : "";
          return new Error(`Server error (${status})${detail}`);
        }
        return new Error(body || `Request failed with status ${status}`);
      }
    }
  }
}
