import type { ClientHeaderBuilder } from "../shared/request-headers.js";
import { throwIfTermsAcceptanceRequired } from "../shared/terms-acceptance.js";
import { validateServiceUrl } from "./config.js";
import { executeWithTokenRefresh } from "./execute-with-token-refresh.js";
import {
  isTokenRefreshableError,
  parseRetryAfterSeconds,
} from "./githits-service.js";
import {
  type ServiceDiagnostics,
  withServiceDiagnostics,
} from "./runtime-diagnostics.js";
import type { TokenProvider } from "./token-provider.js";

export const AGENTIC_ASK_REQUEST_TIMEOUT_MS = 210_000;
export const AGENTIC_ASK_MAX_RESPONSE_BYTES: number = 4 * 1024 * 1024;

const UUID_V7_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface TargetErrorDetail {
  code: string;
  message: string;
  hint: string;
  reason?: string;
}

interface AgenticAskQuestion {
  question: string;
}

type AgenticAskSubject =
  | { target?: string; threadId?: never }
  | { target?: never; threadId: string };

export type AgenticAskRequest = AgenticAskQuestion &
  AgenticAskSubject & {
    sourceFormat?: "cli" | "mcp" | "url";
  };

export interface AgenticAskRequestOptions {
  signal?: AbortSignal;
}

/** Expected backend envelope; successful JSON is deliberately not runtime-validated. */
export interface AgenticAskResponse {
  display_markdown: string;
  tool_call_id?: string;
  thread_id?: string;
  [key: string]: unknown;
}

export interface AgenticAskService {
  ask(
    request: AgenticAskRequest,
    options?: AgenticAskRequestOptions,
  ): Promise<AgenticAskResponse>;
}

export type AgenticAskHttpErrorCode =
  | "INVALID_TARGET"
  | "THREAD_NOT_FOUND"
  | "AUTH_REQUIRED"
  | "ACCESS_DENIED"
  | "INVALID_REQUEST"
  | "RATE_LIMITED"
  | "EXECUTION_FAILED"
  | "SERVICE_UNAVAILABLE"
  | "TIMEOUT"
  | "HTTP_ERROR";

/** A safe, status-derived failure returned by the Agentic Ask endpoint. */
export class AgenticAskHttpError extends Error {
  readonly retryable: boolean;

  constructor(
    readonly code: AgenticAskHttpErrorCode,
    message: string,
    readonly status: number,
    readonly toolCallId?: string,
    readonly retryAfterSeconds?: number,
    retryable = false,
    readonly threadId?: string,
    readonly targetError: TargetErrorDetail | undefined = undefined,
  ) {
    super(message);
    this.name = "AgenticAskHttpError";
    this.retryable = retryable;
  }
}

export class AgenticAskRequestTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super("Research timed out. Try again.");
    this.name = "AgenticAskRequestTimeoutError";
  }
}

export class AgenticAskConnectionError extends Error {
  constructor(options?: { cause?: unknown }) {
    super(
      "Could not connect to GitHits. Check your connection and try again.",
      {
        cause: options?.cause,
      },
    );
    this.name = "AgenticAskConnectionError";
  }
}

export class MalformedAgenticAskResponseError extends Error {
  constructor(options?: { cause?: unknown }) {
    super("GitHits returned an invalid Research response.", {
      cause: options?.cause,
    });
    this.name = "MalformedAgenticAskResponseError";
  }
}

export class AgenticAskResponseTooLargeError extends Error {
  constructor(readonly maxBytes: number = AGENTIC_ASK_MAX_RESPONSE_BYTES) {
    super("GitHits returned a Research response that was too large.");
    this.name = "AgenticAskResponseTooLargeError";
  }
}

export interface AgenticAskServiceRuntimeOptions {
  clientHeaders?: ClientHeaderBuilder;
  userAgent?: string;
  timeoutMs?: number;
  diagnostics?: ServiceDiagnostics;
}

export class AgenticAskServiceImpl implements AgenticAskService {
  constructor(
    private readonly apiUrl: string,
    private readonly tokenProvider: TokenProvider,
    private readonly fetchFn: typeof fetch = globalThis.fetch,
    private readonly runtime: AgenticAskServiceRuntimeOptions = {},
  ) {}

  async ask(
    request: AgenticAskRequest,
    options?: AgenticAskRequestOptions,
  ): Promise<AgenticAskResponse> {
    return this.askRequest(request, options);
  }

  private async askRequest(
    request: AgenticAskRequest,
    options: AgenticAskRequestOptions = {},
  ): Promise<AgenticAskResponse> {
    return withServiceDiagnostics(
      this.runtime.diagnostics,
      "agentic-ask.request",
      () =>
        withRequestDeadline(
          (signal) =>
            executeWithTokenRefresh({
              getToken: () => this.tokenProvider.getToken(),
              forceRefresh: () => this.tokenProvider.forceRefresh(),
              shouldRefresh: (error) =>
                (error instanceof AgenticAskHttpError &&
                  error.code === "AUTH_REQUIRED") ||
                isTokenRefreshableError(error),
              executeWithToken: (token) =>
                this.executeAsk(token, request, signal),
            }),
          options.signal,
          this.runtime.timeoutMs ?? AGENTIC_ASK_REQUEST_TIMEOUT_MS,
        ),
    );
  }

  private async executeAsk(
    token: string,
    request: AgenticAskRequest,
    signal: AbortSignal,
  ): Promise<AgenticAskResponse> {
    const apiUrl = validateServiceUrl(this.apiUrl, "GITHITS_API_URL");
    let response: Response;
    try {
      response = await this.fetchFn(`${apiUrl.replace(/\/+$/, "")}/ask`, {
        method: "POST",
        headers: {
          ...this.runtime.clientHeaders?.(),
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "User-Agent": this.runtime.userAgent ?? "githits-cli",
        },
        body: JSON.stringify({
          ...(request.target !== undefined
            ? { target: request.target }
            : { thread_id: request.threadId }),
          question: request.question,
          source_format: request.sourceFormat ?? "cli",
        }),
        signal,
      });
    } catch (cause) {
      if (signal.aborted || isAbortError(cause)) throw cause;
      if (cause instanceof TypeError) {
        throw new AgenticAskConnectionError({ cause });
      }
      throw cause;
    }

    const toolCallId = readAgenticAskResponseId(
      response.headers.get("X-GitHits-Tool-Call-Id"),
    );
    const threadId = readAgenticAskResponseId(
      response.headers.get("X-GitHits-Thread-Id"),
    );
    if (!response.ok) {
      let targetError: TargetErrorDetail | undefined;
      if (response.status === 403 || response.status === 400) {
        let body = "";
        try {
          body = await readBoundedResponseBody(
            response,
            response.status === 400 ? 16_384 : AGENTIC_ASK_MAX_RESPONSE_BYTES,
          );
        } catch (cause) {
          if (signal.aborted) throw signal.reason ?? cause;
        }
        if (response.status === 403) throwIfTermsAcceptanceRequired(body);
        else targetError = parseTargetError(body);
      } else {
        await response.body?.cancel().catch(() => undefined);
      }
      throw createHttpError(
        response,
        toolCallId,
        threadId,
        request,
        targetError,
      );
    }

    let body: string;
    try {
      body = await readBoundedResponseBody(response);
    } catch (cause) {
      if (signal.aborted || cause instanceof AgenticAskResponseTooLargeError) {
        throw cause;
      }
      throw new AgenticAskConnectionError({ cause });
    }
    try {
      // The API owns the response contract. Preserve its JSON, including new
      // fields and source shapes, without coupling clients to a schema version.
      return JSON.parse(body) as AgenticAskResponse;
    } catch (cause) {
      throw new MalformedAgenticAskResponseError({ cause });
    }
  }
}

/** Preserve opaque response identifiers; request IDs are validated separately. */
export function readAgenticAskResponseId(
  value: string | null,
): string | undefined {
  return value || undefined;
}

/** Validate and normalize one UUIDv7 thread reference. */
export function normalizeAgenticAskThreadId(
  value: string | null | undefined,
): string | undefined {
  return normalizeUuidV7(value);
}

function normalizeUuidV7(value: string | null | undefined): string | undefined {
  if (!value || value !== value.trim()) return undefined;
  if (value.includes(",") || hasControlCharacters(value)) return undefined;
  return UUID_V7_PATTERN.test(value) ? value.toLowerCase() : undefined;
}

async function readBoundedResponseBody(
  response: Response,
  maxBytes: number = AGENTIC_ASK_MAX_RESPONSE_BYTES,
): Promise<string> {
  const declaredLength = response.headers.get("Content-Length");
  if (isDeclaredBodyTooLarge(declaredLength, maxBytes)) {
    await response.body?.cancel().catch(() => undefined);
    throw new AgenticAskResponseTooLargeError();
  }

  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let totalBytes = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new AgenticAskResponseTooLargeError();
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

function isDeclaredBodyTooLarge(
  value: string | null,
  maxBytes: number,
): boolean {
  if (!value || !/^\d+$/.test(value)) return false;
  try {
    return BigInt(value) > BigInt(maxBytes);
  } catch {
    return false;
  }
}

function parseTargetError(body: string): TargetErrorDetail | undefined {
  try {
    const detail = JSON.parse(body)?.detail;
    // Extract displayable guidance without constraining backend identifiers,
    // message lengths, or additive fields to a client-side schema.
    if (
      !detail ||
      typeof detail.code !== "string" ||
      typeof detail.message !== "string" ||
      typeof detail.hint !== "string"
    )
      return undefined;
    return detail as TargetErrorDetail;
  } catch {
    return undefined;
  }
}

function createHttpError(
  response: Response,
  toolCallId: string | undefined,
  threadId: string | undefined,
  request: AgenticAskRequest,
  targetError?: TargetErrorDetail,
): AgenticAskHttpError {
  const status = response.status;
  switch (status) {
    case 400:
      return new AgenticAskHttpError(
        "INVALID_TARGET",
        targetError
          ? `${targetError.message} ${targetError.hint}`
          : request.target === undefined && request.threadId === undefined
            ? "GitHits could not answer this question for a supported target. Clarify the question or specify a public package or repository."
            : "GitHits could not validate this Research request or its target. Check the question and use a repository such as github:owner/repo@ref or a package such as npm:prisma@version. To correct a follow-up, keep thread_id and name the exact project or version in the question.",
        status,
        toolCallId,
        undefined,
        false,
        threadId,
        targetError,
      );
    case 401:
      return new AgenticAskHttpError(
        "AUTH_REQUIRED",
        "GitHits could not accept the authentication token.",
        status,
        toolCallId,
        undefined,
        false,
        threadId,
      );
    case 403:
      return new AgenticAskHttpError(
        "ACCESS_DENIED",
        "Access to Research is denied.",
        status,
        toolCallId,
        undefined,
        false,
        threadId,
      );
    case 404:
      return new AgenticAskHttpError(
        "THREAD_NOT_FOUND",
        "Research thread was not found.",
        status,
        toolCallId,
        undefined,
        false,
        threadId,
      );
    case 409:
      return new AgenticAskHttpError(
        "INVALID_REQUEST",
        "This Research thread cannot accept another follow-up.",
        status,
        toolCallId,
        undefined,
        false,
        threadId,
      );
    case 422:
      return new AgenticAskHttpError(
        "INVALID_REQUEST",
        "GitHits rejected the Research request.",
        status,
        toolCallId,
        undefined,
        false,
        threadId,
      );
    case 429:
      return new AgenticAskHttpError(
        "RATE_LIMITED",
        "Research is rate limited.",
        status,
        toolCallId,
        parseRetryAfterSeconds(response.headers.get("Retry-After"), Date.now()),
        true,
        threadId,
      );
    case 500:
      return new AgenticAskHttpError(
        "EXECUTION_FAILED",
        "Research failed.",
        status,
        toolCallId,
        undefined,
        false,
        threadId,
      );
    case 503:
      return new AgenticAskHttpError(
        "SERVICE_UNAVAILABLE",
        "Research is temporarily unavailable.",
        status,
        toolCallId,
        undefined,
        true,
        threadId,
      );
    case 504:
      return new AgenticAskHttpError(
        "TIMEOUT",
        "Research timed out.",
        status,
        toolCallId,
        undefined,
        true,
        threadId,
      );
    default:
      return new AgenticAskHttpError(
        "HTTP_ERROR",
        `Research request failed with status ${status}.`,
        status,
        toolCallId,
        undefined,
        status >= 500,
        threadId,
      );
  }
}

async function withRequestDeadline<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  callerSignal: AbortSignal | undefined,
  timeoutMs: number,
): Promise<T> {
  callerSignal?.throwIfAborted();
  const timeoutController = new AbortController();
  const timeoutError = new AgenticAskRequestTimeoutError(timeoutMs);
  const signal = callerSignal
    ? AbortSignal.any([callerSignal, timeoutController.signal])
    : timeoutController.signal;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      timeoutController.abort(timeoutError);
      reject(timeoutError);
    }, timeoutMs);
  });

  try {
    return await Promise.race([operation(signal), timeout]);
  } catch (cause) {
    if (callerSignal?.aborted) {
      throw callerSignal.reason ?? cause;
    }
    if (timeoutController.signal.aborted) throw timeoutError;
    throw cause;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

function hasControlCharacters(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || (codePoint >= 127 && codePoint <= 159);
  });
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
