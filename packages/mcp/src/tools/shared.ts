import { AsyncLocalStorage } from "node:async_hooks";
import { AuthenticationError } from "@githits/core-internal";
import type { MappedError } from "../shared/code-navigation-error-map.js";
import { errorResult, type ToolResult } from "./types.js";

const LOCAL_MCP_AUTH_ACTION =
  "Run `githits login`, or set GITHITS_API_TOKEN, then retry this tool call.";
const SERVER_MCP_AUTH_ACTION =
  "Re-authenticate with `githits login` or update GITHITS_API_TOKEN if set. If this persists, contact support@githits.com.";

export interface McpAuthActionContext {
  authSource: unknown;
  defaultAction: string;
}

export type McpAuthAction =
  | string
  | ((context: McpAuthActionContext) => string);

export interface McpErrorOptions {
  authAction?: McpAuthAction;
}

const mcpErrorOptions = new AsyncLocalStorage<McpErrorOptions>();

export async function withMcpErrorOptions<T>(
  options: McpErrorOptions | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  if (!options?.authAction) return fn();
  return mcpErrorOptions.run(options, fn);
}

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
  /** Number of retry attempts that were made before failing (0 if no retry) */
  retryAttempts?: number;
  /** Suggested delay in milliseconds before retrying (from Retry-After header) */
  retryAfter?: number;
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
    ...(mapped.retryAttempts !== undefined
      ? { retryAttempts: mapped.retryAttempts }
      : {}),
    ...(mapped.retryAfter !== undefined
      ? { retryAfter: mapped.retryAfter }
      : {}),
    ...(mapped.code === "AUTH_REQUIRED"
      ? {
          details: {
            ...(mapped.details ?? {}),
            action: mcpAuthAction(mapped.details?.authSource),
          },
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
    details: {
      ...(payload.details ?? {}),
      action: mcpAuthAction(payload.details?.authSource),
    },
  };
}

function classify(operation: string, error: unknown): ToolErrorEnvelope {
  if (error instanceof AuthenticationError) {
    return {
      error: error.message,
      code: "AUTH_REQUIRED",
      retryable: false,
      details: {
        action: mcpAuthAction(error.source),
        authSource: error.source,
      },
    };
  }
  const message = error instanceof Error ? error.message : "Unknown error";
  return {
    error: `Failed to ${operation}: ${message}`,
    code: "UNKNOWN",
    retryable: false,
  };
}

function mcpAuthAction(authSource: unknown): string {
  const defaultAction =
    authSource === "server" ? SERVER_MCP_AUTH_ACTION : LOCAL_MCP_AUTH_ACTION;
  const configuredAction = mcpErrorOptions.getStore()?.authAction;
  if (!configuredAction) return defaultAction;
  if (typeof configuredAction === "string") return configuredAction;
  return configuredAction({ authSource, defaultAction });
}
