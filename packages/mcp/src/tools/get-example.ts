import type { ProgressRequest } from "@githits/core-internal";
import { z } from "zod";
import { extractSolutionId } from "../shared/extract-solution-id.js";
import { GET_EXAMPLE_GUARDRAIL } from "./guardrails.js";
import { withErrorHandling } from "./shared.js";
import {
  OPEN_WORLD_STATEFUL_TOOL_ANNOTATIONS,
  type ToolDefinition,
  textResult,
  type ZodRawShape,
} from "./types.js";

export interface GetExampleInput {
  query: string;
  language?: string;
  license_mode?: "strict" | "yolo" | "custom";
  format?: "text" | "json";
}

/** Search parameters required by the browser-callable example tool. */
export interface GetExampleSearchParams {
  query: string;
  /** Source read syntax requested by the calling surface. */
  sourceFormat?: "cli" | "mcp" | "url";
  language?: string;
  licenseMode?: "strict" | "yolo" | "custom";
  includeExplanation?: boolean;
}

/** Browser-standard request controls for example search. */
export interface GetExampleRequestOptions {
  signal?: AbortSignal;
  /** Optional best-effort progress correlation; never changes the result. */
  progress?: ProgressRequest;
}

/** Minimal injected service contract used by the example tool. */
export interface GetExampleService {
  search(
    params: GetExampleSearchParams,
    options?: GetExampleRequestOptions,
  ): Promise<string>;
}

const schema: ZodRawShape = {
  query: z
    .string()
    .min(1)
    .describe("Natural-language query describing the code example you need."),
  language: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Optional programming language. Omit to infer it. If GitHits cannot match it, retry with a suggested language from the error, or omit this field.",
    ),
  license_mode: z
    .enum(["strict", "yolo", "custom"])
    .optional()
    .describe(
      "License filtering: `strict` (default) excludes copyleft or undeclared licenses; `custom` uses your account blocklist; `yolo` disables filtering and may return incompatible licenses.",
    ),
  format: z
    .enum(["text", "json"])
    .default("text")
    .describe(
      "Omit `format` to use token-efficient text when the model reads the result or chooses follow-up tools. Set `json` only when code consumes the raw response instead of the model, or a required field is absent from text.",
    ),
};

const DESCRIPTION = `Find code examples from projects across open source. Use when no single target is the answer: usage patterns, unfamiliar errors, multi-library combinations, or when target-scoped search came up short. Examples come from many unrelated projects; check version-sensitive code against the target's docs or source.

Default output is markdown with source repository provenance and generated references, plus a trailing \`solution_id: ...\` when available. JSON returns \`{result, solution_id?}\`.

${GET_EXAMPLE_GUARDRAIL}`;

export function createGetExampleTool(
  service: GetExampleService,
): ToolDefinition<GetExampleInput, typeof schema> {
  return {
    name: "get_example",
    description: DESCRIPTION,
    schema,
    annotations: OPEN_WORLD_STATEFUL_TOOL_ANNOTATIONS,
    handler: async (args, context) => {
      return withErrorHandling(
        "get example",
        async () => {
          const searchParams: GetExampleSearchParams = {
            query: args.query,
            sourceFormat: "mcp",
            language: args.language,
            licenseMode: args.license_mode,
            includeExplanation: false,
          };
          // Mirrors the backend's first example stage until live updates arrive.
          const progress = await context?.progress?.begin(
            "Searching source code and docs…",
          );
          let markdown: string;
          try {
            markdown =
              context?.signal || progress
                ? await service.search(searchParams, {
                    ...(context?.signal ? { signal: context.signal } : {}),
                    ...(progress ? { progress } : {}),
                  })
                : await service.search(searchParams);
          } finally {
            progress?.end();
          }
          const solutionId = extractSolutionId(markdown);
          const payload = solutionId
            ? { result: markdown, solution_id: solutionId }
            : { result: markdown };
          if (isTextFormat(args.format)) {
            return textResult(
              solutionId
                ? `${markdown.trimEnd()}\n\nsolution_id: ${solutionId}`
                : markdown,
            );
          }
          return textResult(JSON.stringify(payload));
        },
        context,
        args.format,
      );
    },
  };
}

function isTextFormat(format: GetExampleInput["format"]): boolean {
  return format === undefined || format === "text";
}
