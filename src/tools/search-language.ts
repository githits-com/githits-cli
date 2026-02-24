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

const DESCRIPTION = `Search for a programming language supported by GitHits.

Use this tool to find the correct language name before calling the search tool.
Returns up to 5 matching languages.

Args:
    query: Language name or partial name to search for (e.g., "python", "type", "java")

Returns:
    List of matching languages with name and display_name`;

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
        return textResult(JSON.stringify(result, null, 2));
      });
    },
  };
}
