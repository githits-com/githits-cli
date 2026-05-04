import { z } from "zod";
import type { GitHitsService } from "../services/githits-service.js";
import { extractSolutionId } from "../shared/extract-solution-id.js";
import { withErrorHandling } from "./shared.js";
import { type ToolDefinition, textResult } from "./types.js";

interface GetExampleArgs {
  query: string;
  language?: string;
  license_mode?: "strict" | "yolo" | "custom";
  format?: "json" | "text" | "text-v1";
}

const schema = {
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
    .describe("License filtering mode: strict (default), yolo, or custom."),
  format: z
    .enum(["json", "text", "text-v1"])
    .optional()
    .describe(
      "Response format. Default `text-v1` returns markdown directly with a trailing `solution_id` line when available. Pass `json` for `{result, solution_id?}`.",
    ),
};

const DESCRIPTION = `Get verified, canonical code examples from global open source.

Default output is markdown, with a trailing \`solution_id: ...\` line when available. Pass \`format: "json"\` for \`{result, solution_id?}\`. Pass \`solution_id\` to \`feedback\` after using or rejecting the example. For searching indexed dependency and repository code/docs, use the unified \`search\` tool instead.`;

export function createGetExampleTool(
  service: GitHitsService,
): ToolDefinition<GetExampleArgs, typeof schema> {
  return {
    name: "get_example",
    description: DESCRIPTION,
    schema,
    handler: async (args) => {
      return withErrorHandling("get example", async () => {
        const markdown = await service.search({
          query: args.query,
          language: args.language,
          licenseMode: args.license_mode,
          includeExplanation: false,
        });
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
      });
    },
  };
}

function isTextFormat(format: GetExampleArgs["format"]): boolean {
  return format === undefined || format === "text" || format === "text-v1";
}
