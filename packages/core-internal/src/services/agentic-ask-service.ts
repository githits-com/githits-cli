import { z } from "zod";
import type { ClientHeaderBuilder } from "../shared/request-headers.js";
import { throwIfTermsAcceptanceRequired } from "../shared/terms-acceptance.js";
import { validateServiceUrl } from "./config.js";
import { executeWithTokenRefresh } from "./execute-with-token-refresh.js";
import { parseRetryAfterSeconds } from "./githits-service.js";
import {
  type ServiceDiagnostics,
  withServiceDiagnostics,
} from "./runtime-diagnostics.js";
import type { TokenProvider } from "./token-provider.js";

export const AGENTIC_ASK_REQUEST_TIMEOUT_MS = 210_000;
export const AGENTIC_ASK_MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

const UUID_V7_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const sourceLineRangeSchema = z.string().regex(/^\d+-\d+$/);

const cliSourceArgumentsSchema = z.union([
  z.tuple([
    z.literal("githits@latest"),
    z.literal("code"),
    z.literal("read"),
    z.literal("--lines"),
    sourceLineRangeSchema,
    z.literal("--"),
    z.string().min(1),
    z.string().min(1),
  ]),
  z.tuple([
    z.literal("githits@latest"),
    z.literal("docs"),
    z.literal("read"),
    z.literal("--lines"),
    sourceLineRangeSchema,
    z.literal("--"),
    z.string().min(1),
  ]),
]);

const cliSourceCallSchema = z.object({
  command: z.literal("npx"),
  arguments: cliSourceArgumentsSchema,
});

const cliResponseSchema = z.object({
  source_format: z.literal("cli"),
  tool_call_id: z.string().regex(UUID_V7_PATTERN),
  answer_markdown: z.string().min(1),
  sources: z.array(cliSourceCallSchema),
});

export interface AgenticAskRequest {
  target: string;
  question: string;
}

export interface AgenticAskRequestOptions {
  signal?: AbortSignal;
}

export interface AgenticAskCliSourceCall {
  command: "npx";
  arguments:
    | [
        "githits@latest",
        "code",
        "read",
        "--lines",
        string,
        "--",
        string,
        string,
      ]
    | ["githits@latest", "docs", "read", "--lines", string, "--", string];
}

export interface AgenticAskCliResponse {
  source_format: "cli";
  tool_call_id: string;
  answer_markdown: string;
  sources: AgenticAskCliSourceCall[];
}

export interface AgenticAskService {
  ask(
    request: AgenticAskRequest,
    options?: AgenticAskRequestOptions,
  ): Promise<AgenticAskCliResponse>;
}

export type AgenticAskHttpErrorCode =
  | "INVALID_TARGET"
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
  ) {
    super(message);
    this.name = "AgenticAskHttpError";
    this.retryable = retryable;
  }
}

export class AgenticAskRequestTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super("Agentic Ask timed out. Try again.");
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
    super("GitHits returned an invalid Agentic Ask response.", {
      cause: options?.cause,
    });
    this.name = "MalformedAgenticAskResponseError";
  }
}

export class AgenticAskResponseTooLargeError extends Error {
  constructor(readonly maxBytes: number = AGENTIC_ASK_MAX_RESPONSE_BYTES) {
    super("GitHits returned an Agentic Ask response that was too large.");
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
    options: AgenticAskRequestOptions = {},
  ): Promise<AgenticAskCliResponse> {
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
                error instanceof AgenticAskHttpError &&
                error.code === "AUTH_REQUIRED",
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
  ): Promise<AgenticAskCliResponse> {
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
          target: request.target,
          question: request.question,
          source_format: "cli",
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

    const toolCallId = parseAgenticAskToolCallId(
      response.headers.get("X-GitHits-Tool-Call-Id"),
    );
    if (!response.ok) {
      if (response.status === 403) {
        let body = "";
        try {
          body = await readBoundedResponseBody(response);
        } catch (cause) {
          if (signal.aborted) throw signal.reason ?? cause;
        }
        throwIfTermsAcceptanceRequired(body);
      } else {
        await response.body?.cancel().catch(() => undefined);
      }
      throw createHttpError(response, toolCallId);
    }

    const body = await readBoundedResponseBody(response);
    let raw: unknown;
    try {
      raw = JSON.parse(body);
    } catch (cause) {
      throw new MalformedAgenticAskResponseError({ cause });
    }

    const parsed = cliResponseSchema.safeParse(raw);
    if (!parsed.success) {
      throw new MalformedAgenticAskResponseError({ cause: parsed.error });
    }
    return parsed.data;
  }
}

/** Accept exactly one UUIDv7 header value; ambiguous or unsafe values are dropped. */
export function parseAgenticAskToolCallId(
  value: string | null,
): string | undefined {
  if (!value || value !== value.trim()) return undefined;
  if (value.includes(",") || hasControlCharacters(value)) return undefined;
  return UUID_V7_PATTERN.test(value) ? value.toLowerCase() : undefined;
}

async function readBoundedResponseBody(response: Response): Promise<string> {
  const declaredLength = response.headers.get("Content-Length");
  if (isDeclaredBodyTooLarge(declaredLength)) {
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
      if (totalBytes > AGENTIC_ASK_MAX_RESPONSE_BYTES) {
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

function isDeclaredBodyTooLarge(value: string | null): boolean {
  if (!value || !/^\d+$/.test(value)) return false;
  try {
    return BigInt(value) > BigInt(AGENTIC_ASK_MAX_RESPONSE_BYTES);
  } catch {
    return false;
  }
}

function createHttpError(
  response: Response,
  toolCallId: string | undefined,
): AgenticAskHttpError {
  const status = response.status;
  switch (status) {
    case 400:
      return new AgenticAskHttpError(
        "INVALID_TARGET",
        "GitHits rejected the Agentic Ask target.",
        status,
        toolCallId,
      );
    case 401:
      return new AgenticAskHttpError(
        "AUTH_REQUIRED",
        "GitHits could not accept the authentication token.",
        status,
        toolCallId,
      );
    case 403:
      return new AgenticAskHttpError(
        "ACCESS_DENIED",
        "Access to Agentic Ask is denied.",
        status,
        toolCallId,
      );
    case 422:
      return new AgenticAskHttpError(
        "INVALID_REQUEST",
        "GitHits rejected the Agentic Ask request.",
        status,
        toolCallId,
      );
    case 429:
      return new AgenticAskHttpError(
        "RATE_LIMITED",
        "Agentic Ask is rate limited.",
        status,
        toolCallId,
        parseRetryAfterSeconds(response.headers.get("Retry-After"), Date.now()),
        true,
      );
    case 500:
      return new AgenticAskHttpError(
        "EXECUTION_FAILED",
        "Agentic Ask failed.",
        status,
        toolCallId,
      );
    case 503:
      return new AgenticAskHttpError(
        "SERVICE_UNAVAILABLE",
        "Agentic Ask is temporarily unavailable.",
        status,
        toolCallId,
        undefined,
        true,
      );
    case 504:
      return new AgenticAskHttpError(
        "TIMEOUT",
        "Agentic Ask timed out.",
        status,
        toolCallId,
        undefined,
        true,
      );
    default:
      return new AgenticAskHttpError(
        "HTTP_ERROR",
        `Agentic Ask request failed with status ${status}.`,
        status,
        toolCallId,
        undefined,
        status >= 500,
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
