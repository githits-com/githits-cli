import type {
  AgenticAskMcpResponse,
  AgenticAskMcpSourceCall,
  AgenticAskService,
} from "@githits/core-internal";
import { z } from "zod";
import { mapAgenticAskError } from "../shared/agentic-ask-error-map.js";
import {
  buildMcpErrorPayload,
  throwIfCallerCancellation,
} from "../tools/shared.js";
import {
  BOUNDED_WRITE_TOOL_ANNOTATIONS,
  errorResult,
  type ToolDefinition,
  textResult,
  type ZodRawShape,
} from "../tools/types.js";

export interface AgenticAskMcpArgs {
  target: string;
  question: string;
  format?: "text-v1" | "text" | "json";
}

const schema: ZodRawShape = {
  target: z
    .string()
    .min(1)
    .describe(
      "One canonical public OSS package or GitHub repository target, such as npm:express or github:expressjs/express.",
    ),
  question: z
    .string()
    .min(1)
    .describe(
      "One question to answer from indexed public evidence. Do not include credentials, personal data, private code, or proprietary content.",
    ),
  format: z
    .enum(["text-v1", "text", "json"])
    .default("text-v1")
    .describe(
      "Response format. `text-v1` and `text` return the answer followed by directly callable MCP sources and the Ask run ID; `json` returns the validated backend MCP envelope.",
    ),
};

export const DESCRIPTION =
  "Ask one grounded question about a canonical public package or repository target. Experimental local tool that uses the backend-controlled prompt, model, budgets, and evidence validation. Each call is retained for replay and evaluation. Sources are backend-built MCP calls in deterministic order; model usage is not returned.";

export function createLocalAgenticAskTool(
  service: AgenticAskService,
): ToolDefinition<AgenticAskMcpArgs, typeof schema> {
  return {
    name: "ask",
    description: DESCRIPTION,
    schema,
    annotations: BOUNDED_WRITE_TOOL_ANNOTATIONS,
    handler: async (args, context) => {
      try {
        const response = await service.ask(
          {
            target: args.target,
            question: args.question,
            sourceFormat: "mcp",
          },
          context?.signal ? { signal: context.signal } : undefined,
        );
        return textResult(
          isTextFormat(args.format)
            ? formatAgenticAskMcpText(response)
            : JSON.stringify(response),
        );
      } catch (error) {
        throwIfCallerCancellation(error, context?.signal);
        const failure = mapAgenticAskError(error);
        return errorResult(
          JSON.stringify({
            ...buildMcpErrorPayload(failure.mapped, context),
            ...(failure.toolCallId ? { tool_call_id: failure.toolCallId } : {}),
          }),
        );
      }
    },
  };
}

/** Render the validated answer, source calls, and replay identifier. */
export function formatAgenticAskMcpText(
  response: AgenticAskMcpResponse,
): string {
  const sections = [response.answer_markdown.trim()];
  if (response.sources.length > 0) {
    sections.push(
      [
        "Sources:",
        ...response.sources.map(
          (source, index) => `  ${index + 1}. ${formatMcpSourceCall(source)}`,
        ),
      ].join("\n"),
    );
  }
  sections.push(`Ask run ID: ${response.tool_call_id}`);
  return `${sections.join("\n\n")}\n`;
}

function formatMcpSourceCall(source: AgenticAskMcpSourceCall): string {
  return `${source.name}(${JSON.stringify(source.arguments)})`;
}

function isTextFormat(format: AgenticAskMcpArgs["format"]): boolean {
  return format === undefined || format === "text" || format === "text-v1";
}
