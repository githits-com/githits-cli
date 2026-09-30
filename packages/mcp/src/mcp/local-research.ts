import {
  type AgenticAskService,
  normalizeAgenticAskThreadId,
} from "@githits/core-internal";
import { z } from "zod";
import { mapAgenticAskError } from "../shared/agentic-ask-error-map.js";
import { extractAgenticAskDisplay } from "../shared/agentic-ask-response.js";
import {
  isRepositoryTargetSpec,
  LegacyRepositoryRefError,
  parseRepositoryTargetSpec,
} from "../shared/repository-target.js";
import {
  buildMcpErrorPayload,
  throwIfCallerCancellation,
} from "../tools/shared.js";
import {
  errorResult,
  OPEN_WORLD_READ_ONLY_TOOL_ANNOTATIONS,
  type ToolDefinition,
  textResult,
  type ZodRawShape,
} from "../tools/types.js";

export interface LocalResearchMcpArgs {
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
      "Thread UUID returned by an earlier research call. Cannot be combined with target. Reuse it for follow-ups; name a new project or version in the question to change scope.",
    ),
  question: z
    .string()
    .min(1)
    .describe(
      "One research question to answer from indexed public evidence. Do not include credentials, personal data, private code, or proprietary content.",
    ),
  source_format: z
    .enum(["mcp", "url"])
    .default("mcp")
    .describe(
      "Source pointer format. `mcp` returns directly callable read calls; `url` returns original upstream HTTP URLs.",
    ),
  format: z
    .enum(["text", "json"])
    .default("text")
    .describe(
      "Omit `format` to use token-efficient text when the model reads the result or chooses follow-up tools. Set `json` only when code consumes the raw response instead of the model, or a required field is absent from text.",
    ),
};

export const DESCRIPTION =
  "Research a public repository or package to answer a question with sources. Omit target and thread_id to identify the target from the question. If Research returns candidates, ask the user to select a target before retrying. Supply at most one of target or thread_id. Continue a prior thread by its returned thread_id. Follow-ups can change project, version, or topic; state changes in the question. Sources default to actionable MCP calls; request source_format=url for original upstream URLs.";

export function createLocalResearchTool(
  service: AgenticAskService,
): ToolDefinition<LocalResearchMcpArgs, typeof schema> {
  return {
    name: "research",
    description: DESCRIPTION,
    schema,
    annotations: OPEN_WORLD_READ_ONLY_TOOL_ANNOTATIONS,
    handler: async (args, context) => {
      const subject = resolveResearchSubject(args);
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
            ? formatResearchMcpText(response)
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

/** Return complete backend-owned display text without interpreting sections. */
export function formatResearchMcpText(response: unknown): string {
  return extractAgenticAskDisplay(response);
}

function isTextFormat(format: LocalResearchMcpArgs["format"]): boolean {
  return format === undefined || format === "text";
}

function resolveResearchSubject(
  args: LocalResearchMcpArgs,
): { target?: string } | { threadId: string } | { error: string } {
  if (args.target !== undefined && args.thread_id !== undefined) {
    return { error: "Provide at most one of target or thread_id." };
  }
  if (args.target !== undefined) {
    if (isRepositoryTargetSpec(args.target)) {
      try {
        parseRepositoryTargetSpec(args.target);
      } catch (error) {
        if (error instanceof LegacyRepositoryRefError) {
          return { error: error.message };
        }
      }
    }
    return { target: args.target };
  }
  if (args.thread_id === undefined) return {};

  const threadId = normalizeAgenticAskThreadId(args.thread_id);
  return threadId
    ? { threadId }
    : { error: "thread_id must be one valid thread UUID." };
}
