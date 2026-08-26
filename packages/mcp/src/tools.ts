import {
  ApiRateLimitError as CoreApiRateLimitError,
  AuthenticationError as CoreAuthenticationError,
  FetchTimeoutError as CoreFetchTimeoutError,
  TermsAcceptanceRequiredError as CoreTermsAcceptanceRequiredError,
} from "@githits/core-internal/browser";

interface AuthenticationErrorInstance extends Error {
  readonly source: "local" | "server";
}

interface AuthenticationErrorConstructor {
  new (
    message?: string,
    source?: "local" | "server",
  ): AuthenticationErrorInstance;
}

interface ApiRateLimitErrorInstance extends Error {
  readonly status: 429;
  readonly retryAfterSeconds: number | undefined;
}

interface ApiRateLimitErrorConstructor {
  new (message?: string, retryAfterSeconds?: number): ApiRateLimitErrorInstance;
}

interface FetchTimeoutErrorInstance extends Error {
  readonly timeoutMs: number;
}

interface FetchTimeoutErrorConstructor {
  new (
    timeoutMs: number,
    options?: { cause?: unknown },
  ): FetchTimeoutErrorInstance;
}

interface TermsAcceptanceRequiredErrorInstance extends Error {
  readonly code: "TERMS_ACCEPTANCE_REQUIRED";
  readonly termsUrl: string;
  readonly acceptanceUrl: string;
}

interface TermsAcceptanceRequiredErrorConstructor {
  new (remediation?: {
    termsUrl?: string;
    acceptanceUrl?: string;
  }): TermsAcceptanceRequiredErrorInstance;
}

/** Authentication failure raised by a GitHits service. */
export const AuthenticationError: AuthenticationErrorConstructor =
  CoreAuthenticationError;
/** Rate-limit failure raised by a GitHits service. */
export const ApiRateLimitError: ApiRateLimitErrorConstructor =
  CoreApiRateLimitError;
/** Request deadline failure raised by a GitHits service. */
export const FetchTimeoutError: FetchTimeoutErrorConstructor =
  CoreFetchTimeoutError;
/** Terms gate raised by a GitHits service. */
export const TermsAcceptanceRequiredError: TermsAcceptanceRequiredErrorConstructor =
  CoreTermsAcceptanceRequiredError;

export {
  type CallableTool,
  type CallableToolExecutionOptions,
  type CallableToolInputSchema,
  toCallableTool,
} from "./tools/callable.js";
export {
  createGetExampleTool,
  type GetExampleInput,
  type GetExampleRequestOptions,
  type GetExampleSearchParams,
  type GetExampleService,
} from "./tools/get-example.js";
export type { CompleteToolAnnotations, ToolResult } from "./tools/types.js";
