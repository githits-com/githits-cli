import { z } from "zod";
import type { GitHitsService } from "../services/githits-service.js";
import { filterLanguages } from "../shared/language-filter.js";
import { withErrorHandling } from "./shared.js";
import { type ToolDefinition, textResult } from "./types.js";

interface SearchLanguageArgs {
  query: string;
  format?: "json" | "text" | "text-v1";
}

const schema = {
  query: z
    .string()
    .min(1)
    .describe(
      'Language name or partial name to search for (e.g., "python", "type", "java")',
    ),
  format: z
    .enum(["json", "text", "text-v1"])
    .optional()
    .describe(
      "Response format. Default `text-v1` returns one language per line. Pass `json` for the structured array.",
    ),
};

const DESCRIPTION = `Find the correct language name for \`get_example\` when it is uncertain. Returns up to 5 matching languages by name, display name, or alias. Default output is one language per line; pass \`format: "json"\` for the structured array.`;

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
        if (isTextFormat(args.format)) {
          return textResult(renderLanguageMatches(result));
        }
        return textResult(JSON.stringify(result));
      });
    },
  };
}

function isTextFormat(format: SearchLanguageArgs["format"]): boolean {
  return format === undefined || format === "text" || format === "text-v1";
}

function renderLanguageMatches(
  matches: Array<{ name: string; displayName?: string; aliases?: string[] }>,
): string {
  if (matches.length === 0) return "No matching languages.";
  return matches
    .map((match) => {
      const label = match.displayName
        ? `${match.name} (${match.displayName})`
        : match.name;
      const aliases = match.aliases?.length
        ? ` aliases: ${match.aliases.join(", ")}`
        : "";
      return `${label}${aliases}`;
    })
    .join("\n");
}
