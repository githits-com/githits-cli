import { AuthenticationError } from "../services/githits-service.js";
import { errorResult, type ToolResult } from "./types.js";

/**
 * Wraps a tool handler with the shared structured `{error, code,
 * retryable}` error envelope. Used by always-on tools (`get_example`,
 * `search_language`, `feedback`) so agents can branch on `code`
 * uniformly with code-navigation tools instead of text-parsing.
 */
export async function withErrorHandling<T>(
  operation: string,
  fn: () => Promise<T>,
): Promise<T | ToolResult> {
  try {
    return await fn();
  } catch (error) {
    return errorResult(JSON.stringify(classify(operation, error)));
  }
}

interface ToolErrorEnvelope {
  error: string;
  code: string;
  retryable: boolean;
}

function classify(operation: string, error: unknown): ToolErrorEnvelope {
  if (error instanceof AuthenticationError) {
    return {
      error: error.message,
      code: "UNAUTHENTICATED",
      retryable: false,
    };
  }
  const message = error instanceof Error ? error.message : "Unknown error";
  return {
    error: `Failed to ${operation}: ${message}`,
    code: "UNKNOWN",
    retryable: false,
  };
}
