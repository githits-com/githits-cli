import {
  type AgenticAskMcpResponse,
  type AgenticAskMcpSourceCall,
  type AgenticAskNeedsTargetResponse,
  type AgenticAskService,
  type AgenticAskUrlResponse,
  normalizeAgenticAskThreadId,
} from "@githits/core-internal";
import { z } from "zod";
import { mapAgenticAskError } from "../shared/agentic-ask-error-map.js";
import { formatAgenticAskClarification } from "../shared/agentic-ask-response.js";
import {
  buildMcpErrorPayload,
  throwIfCallerCancellation,
} from "../tools/shared.js";
import {
  errorResult,
  READ_ONLY_TOOL_ANNOTATIONS,
  type ToolDefinition,
  textResult,
  type ZodRawShape,
} from "../tools/types.js";

export interface AgenticAskMcpArgs {
  target?: string;
  thread_id?: string;
  question: string;
  source_format?: "mcp" | "url";
  format?: "text" | "json";
}

const schema: ZodRawShape = {
  target: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Optional canonical public OSS package or repository target, such as npm:express or github:expressjs/express. Omit target and thread_id to identify the target from the question.",
    ),
  thread_id: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Thread UUID returned by an earlier ask call. Cannot be combined with target. Reuse it for follow-ups; name a new project or version in the question to change scope.",
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
    .enum(["text", "json"])
    .default("text")
    .describe(
      "Use `text` (default) for reading and tool follow-ups; it is token-efficient. Use `json` only to parse responses in code or obtain fields absent from text.",
    ),
};

export const DESCRIPTION =
  "Ask a public repository or package question and receive a source-cited answer. Omit target and thread_id to identify the target from the question. If Ask returns candidates, ask the user to select a target before retrying. Supply at most one of target or thread_id. Continue a prior thread by its returned thread_id. Follow-ups can change project, version, or topic; state changes in the question. Sources default to actionable MCP calls; request source_format=url for original upstream URLs.";

export function createLocalAgenticAskTool(
  service: AgenticAskService,
): ToolDefinition<AgenticAskMcpArgs, typeof schema> {
  return {
    name: "ask",
    description: DESCRIPTION,
    schema,
    annotations: READ_ONLY_TOOL_ANNOTATIONS,
    handler: async (args, context) => {
      const subject = resolveMcpAskSubject(args);
      if ("error" in subject) {
        return errorResult(
          JSON.stringify({
            error: subject.error,
            code: "INVALID_ARGUMENT",
            retryable: false,
          }),
        );
      }
      try {
        const requestOptions = context?.signal
          ? { signal: context.signal }
          : undefined;
        const response =
          args.source_format === "url"
            ? await service.ask(
                {
                  ...subject,
                  question: args.question,
                  sourceFormat: "url",
                },
                requestOptions,
              )
            : await service.ask(
                {
                  ...subject,
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
            ...(failure.threadId ? { thread_id: failure.threadId } : {}),
          }),
        );
      }
    },
  };
}

/** Render the validated answer, selected source pointers, and identifiers. */
export function formatAgenticAskMcpText(
  response:
    | AgenticAskMcpResponse
    | AgenticAskUrlResponse
    | AgenticAskNeedsTargetResponse,
): string {
  if ("outcome" in response) {
    return formatAgenticAskClarification(response);
  }
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
  sections.push(
    `Ask run ID: ${response.tool_call_id}\nThread ID: ${response.thread_id}\nUse this thread ID for follow-ups; name a new project or version in the question to change scope.`,
  );
  return `${sections.join("\n\n")}\n`;
}

function formatMcpSourceCall(source: AgenticAskMcpSourceCall): string {
  return `${source.name}(${JSON.stringify(source.arguments)})`;
}

function isTextFormat(format: AgenticAskMcpArgs["format"]): boolean {
  return format === undefined || format === "text";
}

function resolveMcpAskSubject(
  args: AgenticAskMcpArgs,
): { target?: string } | { threadId: string } | { error: string } {
  if (args.target !== undefined && args.thread_id !== undefined) {
    return { error: "Provide at most one of target or thread_id." };
  }
  if (args.target !== undefined) return { target: args.target };
  if (args.thread_id === undefined) return {};

  const threadId = normalizeAgenticAskThreadId(args.thread_id);
  return threadId
    ? { threadId }
    : { error: "thread_id must be one valid thread UUID." };
}
