import { z } from "zod";
import type { GitHitsService } from "../services/githits-service.js";
import { filterLanguages } from "../shared/language-filter.js";
import { withErrorHandling } from "./shared.js";
import { type ToolDefinition, textResult } from "./types.js";

interface SearchLanguageArgs {
  query: string;
}

const schema = {
  query: z
    .string()
    .min(1)
    .describe(
      'Language name or partial name to search for (e.g., "python", "type", "java")',
    ),
};

const DESCRIPTION = `Find the correct language name for \`get_example\` when it is uncertain. Returns up to 5 matching languages by name, display name, or alias.`;

export function createSearchLanguageTool(
  service: GitHitsService,
): ToolDefinition<SearchLanguageArgs, typeof schema> {
  return {
    name: "search_language",
    description: DESCRIPTION,
    schema,
    handler: async (args) => {
      return withErrorHandling("search languages", async () => {
        const allLanguages = await service.getLanguages();
        const result = filterLanguages(allLanguages, args.query);
        return textResult(JSON.stringify(result));
      });
    },
  };
}
