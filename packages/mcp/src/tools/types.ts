import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import type { z } from "zod";

/** Annotation fields required by OpenAI's MCP marketplace validation. */
export interface CompleteToolAnnotations extends ToolAnnotations {
  readOnlyHint: boolean;
  openWorldHint: boolean;
  destructiveHint: boolean;
}

/** A tool that only retrieves or computes information. */
export const READ_ONLY_TOOL_ANNOTATIONS = {
  readOnlyHint: true,
  openWorldHint: false,
  destructiveHint: false,
} as const satisfies CompleteToolAnnotations;

/** A tool with additive service-side effects that cannot modify external systems. */
export const BOUNDED_WRITE_TOOL_ANNOTATIONS = {
  readOnlyHint: false,
  openWorldHint: false,
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

/** Host-provided execution state shared by MCP and direct tool callers. */
export interface ToolExecutionContext {
  authAction?: McpAuthAction;
  termsRemediation?: ToolTermsRemediation;
  signal?: AbortSignal;
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
