import type { z } from "zod";

/**
 * Standard result type for all MCP tools
 */
export type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

/**
 * Tool handler function signature (matches MCP SDK callback)
 */
export type ToolHandler<TArgs> = (
  args: TArgs,
  extra: unknown,
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
