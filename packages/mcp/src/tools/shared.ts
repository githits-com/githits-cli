import { mapGitHitsServiceError } from "../shared/githits-service-error-map.js";
import type { MappedError } from "../shared/mapped-error.js";
import {
  errorResult,
  type McpAuthAction,
  type McpAuthActionContext,
  type ToolExecutionContext,
  type ToolResult,
} from "./types.js";

const LOCAL_MCP_AUTH_ACTION =
  "Run `githits login`, or set GITHITS_API_TOKEN, then retry this tool call.";
const SERVER_MCP_AUTH_ACTION =
  "Re-authenticate with `githits login` or update GITHITS_API_TOKEN if set. If this persists, contact support@githits.com.";

export type {
  McpAuthAction,
  McpAuthActionContext,
  ToolExecutionContext,
  ToolTermsRemediation,
} from "./types.js";

/**
 * Wraps a tool handler with the shared structured `{error, code,
 * retryable}` error envelope. Used by always-on tools (`get_example`,
 * `search_language`, `feedback`) so agents can branch on `code`
 * uniformly with code-navigation tools instead of text-parsing.
 */
export async function withErrorHandling<T>(
  operation: string,
  fn: () => Promise<T>,
  context?: ToolExecutionContext,
): Promise<T | ToolResult> {
  try {
    return await fn();
  } catch (error) {
    throwIfCallerCancellation(error, context?.signal);
    return mcpMappedErrorResult(
      mapGitHitsServiceError(operation, error),
      context,
    );
  }
}

interface ToolErrorEnvelope {
  error: string;
  code: string;
  retryable: boolean;
  details?: MappedError["details"] | { action: string };
}

interface MappableErrorPayload {
  error: string;
  code: string;
  details?: Record<string, unknown>;
}

export function mcpMappedErrorResult(
  mapped: MappedError,
  context?: ToolExecutionContext,
): ToolResult {
  return errorResult(JSON.stringify(buildMcpErrorPayload(mapped, context)));
}

export function buildMcpErrorPayload(
  mapped: MappedError,
  context?: ToolExecutionContext,
): ToolErrorEnvelope {
  const termsRemediation = getTermsRemediation(mapped, context);
  return {
    error: termsRemediation?.message ?? mapped.message,
    code: mapped.code,
    retryable: mapped.retryable ?? false,
    ...(mapped.code === "AUTH_REQUIRED" || termsRemediation
      ? {
          details: {
            ...(termsRemediation
              ? {
                  action: termsRemediation.action,
                  ...(mapped.details ?? {}),
                }
              : {
                  ...(mapped.details ?? {}),
                  action: mcpAuthAction(mapped.details?.authSource, context),
                }),
          },
        }
      : mapped.details
        ? { details: mapped.details }
        : {}),
  };
}

export function addLocalMcpAuthAction<T extends MappableErrorPayload>(
  payload: T,
  context?: ToolExecutionContext,
): T {
  const termsRemediation =
    payload.code === "TERMS_ACCEPTANCE_REQUIRED"
      ? getTermsRemediation(payload as unknown as MappedError, context)
      : undefined;
  if (payload.code !== "AUTH_REQUIRED" && !termsRemediation) return payload;
  return {
    ...payload,
    details: {
      ...(termsRemediation
        ? {
            action: termsRemediation.action,
            ...(payload.details ?? {}),
          }
        : {
            ...(payload.details ?? {}),
            action: mcpAuthAction(payload.details?.authSource, context),
          }),
    },
    ...(termsRemediation ? { error: termsRemediation.message } : {}),
  };
}

function mcpAuthAction(
  authSource: unknown,
  context?: ToolExecutionContext,
): string {
  const defaultAction =
    authSource === "server" ? SERVER_MCP_AUTH_ACTION : LOCAL_MCP_AUTH_ACTION;
  const configuredAction = context?.authAction;
  if (!configuredAction) return defaultAction;
  if (typeof configuredAction === "string") return configuredAction;
  return configuredAction({ authSource, defaultAction });
}

function getTermsRemediation(
  mapped: MappedError,
  context?: ToolExecutionContext,
): ToolExecutionContext["termsRemediation"] {
  if (mapped.code !== "TERMS_ACCEPTANCE_REQUIRED") return undefined;
  if (context?.termsRemediation) return context.termsRemediation;
  const acceptanceUrl = mapped.details?.acceptanceUrl;
  if (!acceptanceUrl) return undefined;
  return {
    message: `Terms acceptance required. Review and accept the current terms at ${acceptanceUrl}, then retry.`,
    action: acceptanceUrl,
  };
}

export function throwIfCallerCancellation(
  error: unknown,
  signal: AbortSignal | undefined,
): void {
  if (signal?.aborted && (error === signal.reason || isAbortError(error))) {
    throw error;
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
