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
      "Omit when no thread was returned; never pass an empty string. Otherwise reuse the returned thread UUID for follow-ups, without target; name scope changes in the question.",
    ),
  question: z
    .string()
    .min(1)
    .describe(
      "Focused research question about missing information for the task. Sources are included. Do not include credentials, personal data, private code, or proprietary content.",
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
      "Omit for text. Use json only when code consumes raw fields or text lacks a required field.",
    ),
};

export const DESCRIPTION: string = `Research a public repository or package to answer a question with sources. Omit target and thread_id for project identification. If Research returns candidates, retry with the one matching established context as target; never guess. Use pkg_info for registry metadata or repository URLs, package tools for assessments, and read for known symbols. Reuse thread_id for follow-ups; state scope changes. ${RESEARCH_VERIFIED_ANSWER_GUIDANCE} Request an overview only when needed. A rate limit covers all Research questions/targets: wait the returned delay, or use direct retrieval for a specific gap; daily limits wait until reset.`;

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
