import type { GitHitsService, Language } from "@githits/core-internal";
import { z } from "zod";
import type { LanguageMatch } from "../shared/language-filter.js";
import { withErrorHandling } from "./shared.js";
import {
  READ_ONLY_TOOL_ANNOTATIONS,
  type ToolDefinition,
  textResult,
  type ZodRawShape,
} from "./types.js";

interface SearchLanguageArgs {
  query: string;
  format?: "json" | "text" | "text-v1";
}

const schema: ZodRawShape = {
  query: z
    .string()
    .min(1)
    .describe(
      'Language name or partial name to search for (e.g., "python", "type", "java")',
    ),
  format: z
    .enum(["text-v1", "text", "json"])
    .default("text-v1")
    .describe(
      'Response format. Default `text-v1` returns one language per line. Pass `format: "json"` for the structured array.',
    ),
};

const DESCRIPTION = `Use before \`get_example\` only when you need to force a language and are unsure of GitHits' exact language name. Finds supported language names and aliases; returns up to 5 matches. Default output is one language per line; pass \`format: "json"\` for the structured array.`;

export function createSearchLanguageTool(
  service: GitHitsService,
): ToolDefinition<SearchLanguageArgs, typeof schema> {
  return {
    name: "search_language",
    description: DESCRIPTION,
    schema,
    annotations: READ_ONLY_TOOL_ANNOTATIONS,
    handler: async (args) => {
      return withErrorHandling("search languages", async () => {
        const result = (await service.searchLanguages(args.query)).map(
          toLanguageMatch,
        );
        if (isTextFormat(args.format)) {
          return textResult(renderLanguageMatches(result));
        }
        return textResult(JSON.stringify(result));
      });
    },
  };
}

function toLanguageMatch({
  name,
  display_name,
  aliases,
}: Language): LanguageMatch {
  return { name, display_name, aliases };
}

function isTextFormat(format: SearchLanguageArgs["format"]): boolean {
  return format === undefined || format === "text" || format === "text-v1";
}

function renderLanguageMatches(
  matches: Array<{ name: string; display_name: string; aliases: string[] }>,
): string {
  if (matches.length === 0) return "No matching languages.";
  return matches
    .map((match) => {
      const label = match.display_name
        ? `${match.name} (${match.display_name})`
        : match.name;
      const aliases = match.aliases?.length
        ? ` aliases: ${match.aliases.join(", ")}`
        : "";
      return `${label}${aliases}`;
    })
    .join("\n");
}
