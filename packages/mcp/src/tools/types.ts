import type { ProgressRequest } from "@githits/core-internal";
import type { z } from "zod";

/** Annotation fields required by OpenAI's MCP marketplace validation. */
export interface CompleteToolAnnotations {
  title?: string;
  readOnlyHint: boolean;
  idempotentHint?: boolean;
  openWorldHint: boolean;
  destructiveHint: boolean;
}

/** Read-only operations over a closed domain, such as guidance or a fixed catalog. */
export const READ_ONLY_TOOL_ANNOTATIONS = {
  readOnlyHint: true,
  idempotentHint: true,
  openWorldHint: false,
  destructiveHint: false,
} as const satisfies CompleteToolAnnotations;

/** Public evidence retrieval/computation, including internal caching and preparation. */
export const OPEN_WORLD_READ_ONLY_TOOL_ANNOTATIONS = {
  readOnlyHint: true,
  idempotentHint: true,
  openWorldHint: true,
  destructiveHint: false,
} as const satisfies CompleteToolAnnotations;

/** Additive public-evidence jobs that consume credits and persist user-visible results. */
export const OPEN_WORLD_STATEFUL_TOOL_ANNOTATIONS = {
  readOnlyHint: false,
  idempotentHint: false,
  openWorldHint: true,
  destructiveHint: false,
} as const satisfies CompleteToolAnnotations;

export interface McpAuthActionContext {
  authSource: unknown;
  defaultAction: string;
}

export type McpAuthAction =
  | string
  | ((context: McpAuthActionContext) => string);

/** Host-selected message and action for terms-acceptance failures. */
export interface ToolTermsRemediation {
  message: string;
  action: string;
}

/** One correlated backend call; `end()` must run before the tool returns. */
export interface ToolProgressOperation extends ProgressRequest {
  end(): void;
}

/** Progress already bound to the current MCP request's progress token. */
export interface ToolProgress {
  /**
   * Starts progress for one backend call, showing `initialMessage` until the
   * first live update. Returns `undefined` when progress is unavailable.
   */
  begin(initialMessage?: string): Promise<ToolProgressOperation | undefined>;
}

/** Host-provided execution state shared by MCP and direct tool callers. */
export interface ToolExecutionContext {
  authAction?: McpAuthAction;
  termsRemediation?: ToolTermsRemediation;
  signal?: AbortSignal;
  /** Present only when the host enabled progress and the client asked for it. */
  progress?: ToolProgress;
}

/**
 * Standard result type for all MCP tools
 */
export type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

/** Transport-neutral callable tool handler receiving optional execution context. */
export type ToolHandler<TArgs> = (
  args: TArgs,
  context?: ToolExecutionContext,
) => Promise<ToolResult>;

/**
 * Zod raw shape type (what MCP SDK expects)
 */
export type ZodRawShape = { [k: string]: z.ZodTypeAny };

/**
 * Tool definition with metadata and handler
 */
export interface ToolDefinition<
  TArgs,
  TSchema extends ZodRawShape = ZodRawShape,
> {
  name: string;
  description: string;
  schema: TSchema;
  annotations: CompleteToolAnnotations;
  handler: ToolHandler<TArgs>;
}

/**
 * Helper to create a successful text response
 */
export function textResult(text: string): ToolResult {
  return {
    content: [{ type: "text", text }],
  };
}

/**
 * Helper to create an error response
 */
export function errorResult(message: string): ToolResult {
  return {
    content: [{ type: "text", text: message }],
    isError: true,
  };
}
