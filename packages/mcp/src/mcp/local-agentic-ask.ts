import type {
  AgenticAskMcpResponse,
  AgenticAskMcpSourceCall,
  AgenticAskService,
  AgenticAskUrlResponse,
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
  source_format?: "mcp" | "url";
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
  source_format: z
    .enum(["mcp", "url"])
    .default("mcp")
    .describe(
      "Source pointer format. `mcp` returns directly callable code_read/docs_read calls; `url` returns original upstream HTTP URLs.",
    ),
  format: z
    .enum(["text-v1", "text", "json"])
    .default("text-v1")
    .describe(
      "Response format. `text-v1` and `text` return the answer followed by the selected source pointers and Ask run ID; `json` returns the validated backend envelope.",
    ),
};

export const DESCRIPTION =
  "Ask one grounded question about a canonical public package or repository target. Experimental local tool that uses the backend-controlled prompt, model, budgets, and evidence validation. Each call is retained for replay and evaluation. Sources default to backend-built MCP calls in deterministic order; request source_format=url for original upstream URLs. Model usage is not returned.";

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
        const requestOptions = context?.signal
          ? { signal: context.signal }
          : undefined;
        const response =
          args.source_format === "url"
            ? await service.ask(
                {
                  target: args.target,
                  question: args.question,
                  sourceFormat: "url",
                },
                requestOptions,
              )
            : await service.ask(
                {
                  target: args.target,
                  question: args.question,
                  sourceFormat: "mcp",
                },
                requestOptions,
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

/** Render the validated answer, selected source pointers, and replay ID. */
export function formatAgenticAskMcpText(
  response: AgenticAskMcpResponse | AgenticAskUrlResponse,
): string {
  const sections = [response.answer_markdown.trim()];
  if (response.sources.length > 0) {
    const sourceLines =
      response.source_format === "url"
        ? response.sources.map(
            (source, index) => `  ${index + 1}. ${source.url}`,
          )
        : response.sources.map(
            (source, index) => `  ${index + 1}. ${formatMcpSourceCall(source)}`,
          );
    sections.push(["Sources:", ...sourceLines].join("\n"));
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
