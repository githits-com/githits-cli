import { z } from "zod";
import {
  DEFAULT_FETCH_TIMEOUT_MS,
  fetchWithTimeout,
  isFetchTimeoutError,
} from "../shared/fetch-timeout.js";
import { parseHttpErrorDetail } from "../shared/http-error-detail.js";
import type { ClientHeaderBuilder } from "../shared/request-headers.js";
import { withTelemetrySpan } from "../shared/telemetry.js";
import { validateServiceUrl } from "./config.js";

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

const LANGUAGE_SCHEMA = z.object({
  id: z.string(),
  name: z.string(),
  display_name: z.string(),
  aliases: z.array(z.string()),
  search_priority: z.number().optional(),
});
const LANGUAGES_SCHEMA = z.array(LANGUAGE_SCHEMA);

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
    private readonly fetchTimeoutMs: number = DEFAULT_FETCH_TIMEOUT_MS,
    private readonly runtime: GitHitsServiceRuntimeOptions = {},
  ) {}

  async search(params: SearchParams): Promise<string> {
    return withTelemetrySpan("githits.search.request", async () => {
      const response = await this.request("/search", {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({
          query: params.query,
          language: params.language,
          license_mode: params.licenseMode ?? "strict",
          include_explanation: params.includeExplanation ?? false,
        }),
      });

      if (!response.ok) {
        throw await this.createError(response);
      }

      return response.text();
    });
  }

  async getLanguages(): Promise<Language[]> {
    return withTelemetrySpan("githits.languages.request", async () => {
      const response = await this.request("/languages", {
        headers: this.headers(),
      });

      if (!response.ok) {
        throw await this.createError(response);
      }

      return this.parseLanguages(response);
    });
  }

  async searchLanguages(query: string, limit: number = 5): Promise<Language[]> {
    return withTelemetrySpan("githits.languages.search.request", async () => {
      const params = new URLSearchParams({
        query,
        limit: String(limit),
      });
      const response = await this.request(`/languages?${params.toString()}`, {
        headers: this.headers(),
      });

      if (!response.ok) {
        throw await this.createError(response);
      }

      return this.parseLanguages(response);
    });
  }

  async submitFeedback(params: FeedbackParams): Promise<FeedbackResult> {
    return withTelemetrySpan("githits.feedback.request", async () => {
      // For generic feedback, omit body targets entirely. The backend
      // then uses the valid x-githits-session-id header emitted by
      // the injected client headers as the feedback target.
      const response = await this.request("/feedbacks", {
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
      });

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

  private fetchOptions(): {
    fetchFn?: typeof fetch;
    timeoutMs: number;
  } {
    return {
      fetchFn: this.fetchFn,
      timeoutMs: this.fetchTimeoutMs,
    };
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    const apiUrl = validateServiceUrl(this.apiUrl, "GITHITS_API_URL");
    try {
      return await fetchWithTimeout(
        `${apiUrl.replace(/\/+$/, "")}${path}`,
        init,
        this.fetchOptions(),
      );
    } catch (cause) {
      if (isFetchTimeoutError(cause) || isAbortError(cause)) {
        throw new Error("Request to GitHits timed out. Try again.", { cause });
      }
      if (cause instanceof TypeError) {
        throw new Error(
          "Could not connect to GitHits. Check your connection and GITHITS_API_URL, then try again.",
          { cause },
        );
      }
      throw cause;
    }
  }

  private async parseLanguages(response: Response): Promise<Language[]> {
    let data: unknown;
    try {
      data = await response.json();
    } catch (cause) {
      throw new Error("GitHits returned an invalid languages response.", {
        cause,
      });
    }

    const parsed = LANGUAGES_SCHEMA.safeParse(data);
    if (!parsed.success) {
      throw new Error("GitHits returned an invalid languages response.", {
        cause: parsed.error,
      });
    }
    return parsed.data;
  }

  private async createError(response: Response): Promise<Error> {
    const status = response.status;
    const body = await response.text().catch(() => "");
    const detail = parseHttpErrorDetail(body, ["detail"]);

    switch (status) {
      case 401:
        return new AuthenticationError(
          SERVER_AUTHENTICATION_REJECTED_MESSAGE,
          "server",
        );
      case 403:
        return new Error("Access denied.");
      case 404:
        return new Error(detail || "Resource not found.");
      case 429:
        return new Error("Rate limit exceeded. Try again shortly.");
      default: {
        if (status >= 500) {
          return new Error(
            `Server error (${status}). Try again shortly.${detail ? ` ${detail}` : ""}`,
          );
        }
        return new Error(
          `Request failed with status ${status}.${detail ? ` ${detail}` : ""}`,
        );
      }
    }
  }
}

function isAbortError(error: unknown): error is DOMException {
  return error instanceof Error && error.name === "AbortError";
}
