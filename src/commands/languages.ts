import type { GitHitsService } from "@githits/core-internal";
import { AuthenticationError } from "@githits/core-internal";
import type { Command } from "commander";
import { createContainer } from "../container.js";
import { colorize, dim, shouldUseColors } from "../shared/colors.js";
import type { LanguageMatch } from "../shared/language-filter.js";
import {
  AuthRequiredError,
  buildAuthRequiredErrorPayload,
  requireAuth,
} from "../shared/require-auth.js";
import {
  buildCliMappedErrorPayload,
  formatMappedErrorForTerminal,
} from "./format-mapped-error.js";

export interface LanguagesOptions {
  json?: boolean;
}

export interface LanguagesDependencies {
  githitsService: GitHitsService;
  hasValidToken: boolean;
  mcpUrl: string;
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
    requireAuth(deps);
  } catch (error) {
    if (options.json && error instanceof AuthRequiredError) {
      console.error(JSON.stringify(buildAuthRequiredErrorPayload(error)));
      process.exit(1);
    }
    throw error;
  }

  try {
    const displayList: LanguageMatch[] = query
      ? await deps.githitsService.searchLanguages(query)
      : (await deps.githitsService.getLanguages()).map(
          ({ name, display_name, aliases }) => ({
            name,
            display_name,
            aliases,
          }),
        );

    const matches = displayList.map(({ name, display_name, aliases }) => ({
      name,
      display_name,
      aliases,
    }));

    if (options.json) {
      console.log(JSON.stringify(matches));
    } else if (query && matches.length === 0) {
      console.log(`No languages matching "${query}".`);
    } else {
      const useColors = shouldUseColors();
      for (const lang of matches) {
        console.log(
          `  ${colorize(lang.name, "cyan", useColors)}  ${dim(lang.display_name, useColors)}`,
        );
      }
    }
  } catch (error) {
    if (error instanceof AuthenticationError) {
      const mapped = {
        code: "AUTH_REQUIRED" as const,
        message: error.message,
        retryable: false,
        details: { authSource: error.source },
      };
      if (options.json) {
        console.error(JSON.stringify(buildCliMappedErrorPayload(mapped)));
      } else {
        console.error(formatMappedErrorForTerminal(mapped));
      }
      process.exit(1);
    }
    console.error(
      `Failed to list languages: ${error instanceof Error ? error.message : error}`,
    );
    process.exit(1);
  }
}

const LANGUAGES_DESCRIPTION = `List supported programming languages.

Without a query, lists all supported languages.
With a query, searches the top 5 backend-ranked matches by name, display name, or alias.

Examples:
  githits languages              List all languages
  githits languages python       Search by name
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
    .argument("[query]", "Search by name, display name, or alias")
    .option("--json", "Output as JSON for piping")
    .action(async (query: string | undefined, options: LanguagesOptions) => {
      const deps = await createContainer();
      await languagesAction(query, options, deps);
    });
}
