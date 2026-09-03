import {
  AgenticAskConnectionError,
  AgenticAskHttpError,
  AgenticAskRequestTimeoutError,
  AgenticAskResponseTooLargeError,
  AuthenticationError,
  MalformedAgenticAskResponseError,
} from "@githits/core-internal";
import type { MappedError } from "./mapped-error.js";
import { mapTermsAcceptanceError } from "./terms-acceptance-error-map.js";

export interface AgenticAskMappedError {
  mapped: MappedError;
  toolCallId?: string;
  threadId?: string;
}

/** Map transport-neutral Ask failures for both CLI and local MCP surfaces. */
export function mapAgenticAskError(error: unknown): AgenticAskMappedError {
  const termsError = mapTermsAcceptanceError(error);
  if (termsError) return { mapped: termsError };

  if (error instanceof AgenticAskHttpError) {
    return {
      mapped: {
        code: mapHttpErrorCode(error),
        message: error.message,
        retryable: error.retryable,
        details: {
          status: error.status,
          ...(error.retryAfterSeconds !== undefined
            ? { retryAfterSeconds: error.retryAfterSeconds }
            : {}),
          ...(error.code === "AUTH_REQUIRED"
            ? { authSource: "server" as const }
            : {}),
        },
      },
      toolCallId: error.toolCallId,
      threadId: error.threadId,
    };
  }
  if (error instanceof AuthenticationError) {
    return {
      mapped: {
        code: "AUTH_REQUIRED",
        message: error.message,
        retryable: false,
        details: { authSource: error.source },
      },
    };
  }
  if (error instanceof AgenticAskRequestTimeoutError) {
    return {
      mapped: {
        code: "TIMEOUT",
        message: error.message,
        retryable: true,
        details: { timeoutMs: error.timeoutMs },
      },
    };
  }
  if (error instanceof AgenticAskConnectionError) {
    return {
      mapped: { code: "NETWORK", message: error.message, retryable: true },
    };
  }
  if (
    error instanceof MalformedAgenticAskResponseError ||
    error instanceof AgenticAskResponseTooLargeError
  ) {
    return {
      mapped: {
        code: "PROTOCOL_ERROR",
        message: error.message,
        retryable: false,
      },
    };
  }
  return {
    mapped: {
      code: "UNKNOWN",
      message: "Agentic Ask failed unexpectedly.",
      retryable: false,
    },
  };
}

function mapHttpErrorCode(error: AgenticAskHttpError): MappedError["code"] {
  switch (error.code) {
    case "INVALID_TARGET":
    case "INVALID_REQUEST":
      return "INVALID_ARGUMENT";
    case "AUTH_REQUIRED":
      return "AUTH_REQUIRED";
    case "ACCESS_DENIED":
      return "ACCESS_DENIED";
    case "RATE_LIMITED":
      return "RATE_LIMITED";
    case "TIMEOUT":
      return "TIMEOUT";
    case "EXECUTION_FAILED":
    case "SERVICE_UNAVAILABLE":
    case "HTTP_ERROR":
      return "BACKEND_ERROR";
  }
}
