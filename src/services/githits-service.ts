import { version } from "../../package.json";
import {
  DEFAULT_FETCH_TIMEOUT_MS,
  fetchWithTimeout,
} from "../shared/fetch-timeout.js";
import { buildClientHeaders } from "../shared/request-headers.js";
import { withTelemetrySpan } from "../shared/telemetry.js";

/**
 * Error thrown when the API returns 401 Unauthorized.
 * Used by RefreshingGitHitsService to detect auth failures and trigger token refresh.
 */
export class AuthenticationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthenticationError";
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
 * Language data from the API.
 */
export interface Language {
  id: string;
  name: string;
  display_name: string;
  aliases: string[];
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
 * backend uses the `x-githits-session-id` header from `buildClientHeaders()`
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

/**
 * Service interface for GitHits REST API.
 */
export interface GitHitsService {
  /** Search for code examples. Returns markdown-formatted result. */
  search(params: SearchParams): Promise<string>;

  /** Get all supported languages. */
  getLanguages(): Promise<Language[]>;

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
    private readonly fetchTimeoutMs: number = DEFAULT_FETCH_TIMEOUT_MS,
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
        this.fetchOptions(),
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

  async submitFeedback(params: FeedbackParams): Promise<FeedbackResult> {
    return withTelemetrySpan("githits.feedback.request", async () => {
      // For generic feedback, omit body targets entirely. The backend
      // then uses the valid x-githits-session-id header emitted by
      // buildClientHeaders() as the feedback target.
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
      ...buildClientHeaders(),
      Authorization: `Bearer ${this.token}`,
      "Content-Type": "application/json",
      "User-Agent": `githits-cli/${version}`,
    };
  }

  private fetchOptions(): {
    fetchFn?: typeof fetch;
    timeoutMs: number;
  } {
    return {
      fetchFn: this.fetchFn,
      timeoutMs: this.fetchTimeoutMs,
    };
  }

  private async createError(response: Response): Promise<Error> {
    const status = response.status;
    const body = await response.text().catch(() => "");

    switch (status) {
      case 401:
        return new AuthenticationError(
          "Authentication required. Run `githits login` to authenticate.",
        );
      case 403:
        return new Error("Access denied.");
      case 404:
        return new Error(parseDetail(body) || "Resource not found.");
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
