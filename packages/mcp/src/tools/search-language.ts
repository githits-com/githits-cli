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
  format?: "text" | "json";
}

const schema: ZodRawShape = {
  query: z
    .string()
    .min(1)
    .describe(
      'Language name or partial name to search for (e.g., "python", "type", "java")',
    ),
  format: z
    .enum(["text", "json"])
    .default("text")
    .describe(
      "Default `text` is token-efficient. Use `json` only for programmatic follow-up or exact structured details.",
    ),
};

const DESCRIPTION = `Resolve a supported language name or alias for \`get_example\`; use only when forcing that tool's language filter. Do not use this for source search. Returns up to 5 matches. Default \`text\` output is one language per line; use \`format: "json"\` for the structured array.`;

export function createSearchLanguageTool(
  service: GitHitsService,
): ToolDefinition<SearchLanguageArgs, typeof schema> {
  return {
    name: "search_language",
    description: DESCRIPTION,
    schema,
    annotations: READ_ONLY_TOOL_ANNOTATIONS,
    handler: async (args, context) => {
      return withErrorHandling(
        "search languages",
        async () => {
          const result = (await service.searchLanguages(args.query)).map(
            toLanguageMatch,
          );
          if (isTextFormat(args.format)) {
            return textResult(renderLanguageMatches(result));
          }
          return textResult(JSON.stringify(result));
        },
        context,
      );
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
  return format === undefined || format === "text";
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
