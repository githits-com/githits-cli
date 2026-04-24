import type { Command } from "commander";
import type { GitHitsService } from "../services/githits-service.js";
import { colorize, dim, shouldUseColors } from "../shared/colors.js";
import {
  filterLanguages,
  type LanguageMatch,
} from "../shared/language-filter.js";
import { withAuthenticatedAction } from "./shared.js";

export interface LanguagesOptions {
  json?: boolean;
}

export interface LanguagesDependencies {
  githitsService: GitHitsService;
}

/**
 * Core languages logic, separated for testability.
 */
export async function languagesAction(
  query: string | undefined,
  options: LanguagesOptions,
  deps: LanguagesDependencies,
): Promise<void> {
  try {
    const allLanguages = await deps.githitsService.getLanguages();

    const displayList: LanguageMatch[] = query
      ? filterLanguages(allLanguages, query)
      : allLanguages.map(({ name, display_name }) => ({ name, display_name }));

    if (options.json) {
      console.log(JSON.stringify(displayList));
    } else if (query && displayList.length === 0) {
      console.log(`No languages matching "${query}".`);
    } else {
      const useColors = shouldUseColors();
      for (const lang of displayList) {
        console.log(
          `  ${colorize(lang.name, "cyan", useColors)}  ${dim(lang.display_name, useColors)}`,
        );
      }
    }
  } catch (error) {
    console.error(
      `Failed to list languages: ${error instanceof Error ? error.message : error}`,
    );
    process.exit(1);
  }
}

const LANGUAGES_DESCRIPTION = `List supported programming languages.

Without a query, lists all supported languages.
With a query, filters to the top 5 matches by name, display name, or alias.

Examples:
  githits languages              List all languages
  githits languages python       Filter by name
  githits languages type --json  JSON output for piping`;

/**
 * Register the languages command on the given program.
 * Uses lazy container creation so `--help` doesn't trigger auth.
 */
export function registerLanguagesCommand(program: Command) {
  program
    .command("languages")
    .summary("List supported programming languages")
    .description(LANGUAGES_DESCRIPTION)
    .argument("[query]", "Filter by name, display name, or alias")
    .option("--json", "Output as JSON for piping")
    .action(withAuthenticatedAction(languagesAction));
}
