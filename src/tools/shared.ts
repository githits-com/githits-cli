import { AuthenticationError } from "../services/githits-service.js";
import type { MappedError } from "../shared/code-navigation-error-map.js";
import { errorResult, type ToolResult } from "./types.js";

const LOCAL_MCP_AUTH_ACTION = "Run `githits login`, then retry this tool call.";

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
  details?: MappedError["details"] | { action: string };
}

interface MappableErrorPayload {
  code: string;
  details?: Record<string, unknown>;
}

export function mcpMappedErrorResult(mapped: MappedError): ToolResult {
  return errorResult(JSON.stringify(buildMcpErrorPayload(mapped)));
}

export function buildMcpErrorPayload(mapped: MappedError): ToolErrorEnvelope {
  return {
    error: mapped.message,
    code: mapped.code,
    retryable: mapped.retryable ?? false,
    ...(mapped.code === "AUTH_REQUIRED"
      ? {
          details: { ...(mapped.details ?? {}), action: LOCAL_MCP_AUTH_ACTION },
        }
      : mapped.details
        ? { details: mapped.details }
        : {}),
  };
}

export function addLocalMcpAuthAction<T extends MappableErrorPayload>(
  payload: T,
): T {
  if (payload.code !== "AUTH_REQUIRED") return payload;
  return {
    ...payload,
    details: { ...(payload.details ?? {}), action: LOCAL_MCP_AUTH_ACTION },
  };
}

function classify(operation: string, error: unknown): ToolErrorEnvelope {
  if (error instanceof AuthenticationError) {
    return {
      error: error.message,
      code: "AUTH_REQUIRED",
      retryable: false,
      details: { action: LOCAL_MCP_AUTH_ACTION },
    };
  }
  const message = error instanceof Error ? error.message : "Unknown error";
  return {
    error: `Failed to ${operation}: ${message}`,
    code: "UNKNOWN",
    retryable: false,
  };
}
