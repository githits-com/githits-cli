import { z } from "zod";
import type {
  CompleteToolAnnotations,
  ToolDefinition,
  ToolExecutionContext,
  ToolResult,
  ZodRawShape,
} from "./types.js";

/** Browser-standard options supplied to a callable tool execution. */
export interface CallableToolExecutionOptions {
  signal?: AbortSignal;
}

/** JSON Schema emitted for a callable tool's input. */
export type CallableToolInputSchema = Record<string, unknown>;

/** Transport-neutral callable representation of a tool definition. */
export interface CallableTool {
  name: string;
  description: string;
  inputSchema: CallableToolInputSchema;
  annotations: CompleteToolAnnotations;
  execute(
    input: unknown,
    options?: CallableToolExecutionOptions,
  ): Promise<ToolResult>;
}

/**
 * Adapt a Zod-backed tool definition to a browser-callable surface.
 *
 * Input is validated and defaulted before the original handler is invoked;
 * only the optional abort signal crosses the callable execution boundary.
 */
export function toCallableTool<TArgs, TSchema extends ZodRawShape>(
  definition: ToolDefinition<TArgs, TSchema>,
): CallableTool {
  const input = z.object(definition.schema);
  const inputSchema = z.toJSONSchema(input, { io: "input" });

  return {
    name: definition.name,
    description: definition.description,
    inputSchema: inputSchema as CallableToolInputSchema,
    annotations: definition.annotations,
    execute: async (value, options) => {
      const args = input.parse(value);
      const context: ToolExecutionContext | undefined = options?.signal
        ? { signal: options.signal }
        : undefined;
      return definition.handler(args as TArgs, context);
    },
  };
}
