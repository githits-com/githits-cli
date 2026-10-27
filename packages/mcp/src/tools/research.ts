import type { AgenticAskService } from "@githits/core-internal";
import { normalizeAgenticAskThreadId } from "@githits/core-internal/browser";
import { z } from "zod";
import { mapAgenticAskError } from "../shared/agentic-ask-error-map.js";
import { extractAgenticAskDisplay } from "../shared/agentic-ask-response.js";
import {
  isRepositoryTargetSpec,
  LegacyRepositoryRefError,
  parseRepositoryTargetSpec,
} from "../shared/repository-target.js";
import { RESEARCH_VERIFIED_ANSWER_GUIDANCE } from "../shared/research-guidance.js";
import { sanitizeTerminalText } from "../shared/terminal-text.js";
import {
  buildMcpErrorPayload,
  mcpMappedErrorResult,
  throwIfCallerCancellation,
} from "./shared.js";
import {
  errorResult,
  OPEN_WORLD_STATEFUL_TOOL_ANNOTATIONS,
  type ToolDefinition,
  textResult,
  type ZodRawShape,
} from "./types.js";

export interface ResearchMcpArgs {
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
      "Optional canonical open-source package or repository target, such as npm:express or github:expressjs/express. Never a docs site (site:): research covers the project's code and docs. Omit target and thread_id to identify the target from the question.",
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
      "One research question to answer from indexed public evidence, asked directly; sources are always included. Do not include credentials, personal data, private code, or proprietary content.",
    ),
  source_format: z
    .enum(["mcp", "url"])
    .default("mcp")
    .describe(
      "Source pointer format. `mcp` returns read calls for opening a source only when needed; `url` returns original upstream HTTP URLs.",
    ),
  format: z
    .enum(["text", "json"])
    .default("text")
    .describe(
      "Omit `format` to use token-efficient text when the model reads the result or chooses follow-up tools. Set `json` only when code consumes the raw response instead of the model, or a required field is absent from text.",
    ),
};

export const DESCRIPTION: string = `Research a public repository or package to answer a question with sources. Omit target and thread_id to identify the target from the question. If Research returns candidates, retry with the one matching the question's project as target. Supply at most one of target or thread_id. Continue a prior thread by its returned thread_id. Follow-ups can change project, version, or topic; state changes in the question. ${RESEARCH_VERIFIED_ANSWER_GUIDANCE} Sources default to MCP read calls; request source_format=url for original upstream URLs.`;

export function createResearchTool(
  service: AgenticAskService,
): ToolDefinition<ResearchMcpArgs, typeof schema> {
  return {
    name: "research",
    description: DESCRIPTION,
    schema,
    annotations: OPEN_WORLD_STATEFUL_TOOL_ANNOTATIONS,
    handler: async (args, context) => {
      const subject = resolveResearchSubject(args);
      if ("error" in subject) {
        return mcpMappedErrorResult(
          {
            message: subject.error,
            code: "INVALID_ARGUMENT",
            retryable: false,
          },
          context,
          args.format,
        );
      }
      // Shown until the first live update, which the first call of a process
      // can miss while the progress connection is still opening.
      const progress = await context?.progress?.begin(
        openingResearchMessage(
          "target" in subject ? subject.target : undefined,
        ),
      );
      try {
        const requestOptions =
          context?.signal || progress
            ? {
                ...(context?.signal ? { signal: context.signal } : {}),
                ...(progress ? { progress } : {}),
              }
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
        if (isTextFormat(args.format)) {
          const result = mcpMappedErrorResult(
            failure.mapped,
            context,
            args.format,
          );
          const locators = [
            failure.threadId
              ? `Thread: ${sanitizeTerminalText(failure.threadId)}`
              : undefined,
            failure.toolCallId
              ? `Tool call: ${sanitizeTerminalText(failure.toolCallId)}`
              : undefined,
          ].filter(Boolean);
          const content = result.content[0];
          if (content?.type === "text" && locators.length)
            content.text += `\n\n${locators.join("\n")}`;
          return result;
        }
        return errorResult(
          JSON.stringify({
            ...buildMcpErrorPayload(failure.mapped, context),
            ...(failure.toolCallId ? { tool_call_id: failure.toolCallId } : {}),
            ...(failure.threadId ? { thread_id: failure.threadId } : {}),
          }),
        );
      } finally {
        progress?.end();
      }
    },
  };
}

/** Return complete backend-owned display text without interpreting sections. */
export function formatResearchMcpText(response: unknown): string {
  return extractAgenticAskDisplay(response);
}

function isTextFormat(format: ResearchMcpArgs["format"]): boolean {
  return format === undefined || format === "text";
}

function resolveResearchSubject(
  args: ResearchMcpArgs,
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

/** Mirrors the backend's first research stage for a plain target. */
export function openingResearchMessage(target: string | undefined): string {
  return target && /^[A-Za-z0-9][A-Za-z0-9@/._:+#~-]{0,79}$/.test(target)
    ? `Resolving ${target}…`
    : "Researching…";
}
