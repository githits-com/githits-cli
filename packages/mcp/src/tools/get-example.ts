import type { GitHitsService } from "@githits/core-internal";
import { z } from "zod";
import { extractSolutionId } from "../shared/extract-solution-id.js";
import { GET_EXAMPLE_GUARDRAIL } from "./guardrails.js";
import { withErrorHandling } from "./shared.js";
import {
  BOUNDED_WRITE_TOOL_ANNOTATIONS,
  type ToolDefinition,
  textResult,
  type ZodRawShape,
} from "./types.js";

interface GetExampleArgs {
  query: string;
  language?: string;
  license_mode?: "strict" | "yolo" | "custom";
  format?: "json" | "text" | "text-v1";
}

const schema: ZodRawShape = {
  query: z
    .string()
    .min(1)
    .describe(
      "Natural-language example-search query for canonical code examples.",
    ),
  language: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Optional programming language. If omitted, GitHits tries to infer it automatically. Use search_language first only when you need to force a specific language and the exact name is uncertain.",
    ),
  license_mode: z
    .enum(["strict", "yolo", "custom"])
    .optional()
    .describe(
      "License filtering: `strict` (default) excludes copyleft or undeclared licenses; `custom` uses your account blocklist; `yolo` disables filtering and may return incompatible licenses.",
    ),
  format: z
    .enum(["text-v1", "text", "json"])
    .default("text-v1")
    .describe(
      'Response format. Default `text-v1` returns markdown directly with source repository provenance when available and a trailing `solution_id` line when available. Pass `format: "json"` for `{result, solution_id?}`.',
    ),
};

const DESCRIPTION = `Find canonical cross-project examples when no single target is the answer, or target-scoped search came up short. Best for broad usage patterns, real-world API snippets, unfamiliar errors, and multi-library combinations. For a specific known package or repository, use \`search\`, \`docs_read\`, \`code_read\`, or \`code_grep\` instead. Verify version-sensitive examples against the target's docs or source.

Default output is markdown, with source repository provenance and a trailing \`solution_id: ...\` when available. When presenting an example, report source repositories/citations from GitHits' generated references/provenance section; they are core evidence. Pass \`format: "json"\` for \`{result, solution_id?}\`, and pass \`solution_id\` to \`feedback\` after using or rejecting the example. Use \`search_language\` only to resolve a language name for this tool.

${GET_EXAMPLE_GUARDRAIL}`;

export function createGetExampleTool(
  service: GitHitsService,
): ToolDefinition<GetExampleArgs, typeof schema> {
  return {
    name: "get_example",
    description: DESCRIPTION,
    schema,
    annotations: BOUNDED_WRITE_TOOL_ANNOTATIONS,
    handler: async (args, context) => {
      return withErrorHandling(
        "get example",
        async () => {
          const searchParams = {
            query: args.query,
            language: args.language,
            licenseMode: args.license_mode,
            includeExplanation: false,
          };
          const markdown = context?.signal
            ? await service.search(searchParams, { signal: context.signal })
            : await service.search(searchParams);
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
      );
    },
  };
}

function isTextFormat(format: GetExampleArgs["format"]): boolean {
  return format === undefined || format === "text" || format === "text-v1";
}
