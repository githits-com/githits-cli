import { z } from "zod";
import type { GitHitsService } from "../services/githits-service.js";
import { extractSolutionId } from "../shared/extract-solution-id.js";
import { withErrorHandling } from "./shared.js";
import { type ToolDefinition, textResult } from "./types.js";

interface GetExampleArgs {
  query: string;
  language?: string;
  license_mode?: "strict" | "yolo" | "custom";
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
};

const DESCRIPTION = `Get verified, canonical code examples from global open source.

Returns JSON \`{result, solution_id?}\`. \`result\` is markdown — render or quote it directly. Pass \`solution_id\` to \`feedback\` after using or rejecting the example. For searching indexed dependency and repository code/docs, use the unified \`search\` tool instead.`;

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
        return textResult(JSON.stringify(payload));
      });
    },
  };
}
