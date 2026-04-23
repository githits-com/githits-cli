import { z } from "zod";
import type { GitHitsService } from "../services/githits-service.js";
import { withErrorHandling } from "./shared.js";
import { type ToolDefinition, textResult } from "./types.js";

interface GetExampleArgs {
  query: string;
  language: string;
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
    .describe(
      "Programming language. Use search_language first if the exact name is uncertain.",
    ),
  license_mode: z
    .enum(["strict", "yolo", "custom"])
    .optional()
    .describe("License filtering mode: strict (default), yolo, or custom."),
};

const DESCRIPTION = `Get verified, canonical code examples from global open source.

Use this for example retrieval. For searching indexed dependency and repository code/docs,
use the unified \`search\` tool instead.`;

export function createGetExampleTool(
  service: GitHitsService,
): ToolDefinition<GetExampleArgs, typeof schema> {
  return {
    name: "get_example",
    description: DESCRIPTION,
    schema,
    handler: async (args) => {
      return withErrorHandling("get example", async () => {
        const result = await service.search({
          query: args.query,
          language: args.language,
          licenseMode: args.license_mode,
          includeExplanation: false,
        });
        return textResult(result);
      });
    },
  };
}
