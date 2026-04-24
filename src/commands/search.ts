import { type Command, Option } from "commander";
import type { GitHitsService } from "../services/githits-service.js";
import { withAuthenticatedAction } from "./shared.js";

export interface SearchOptions {
  lang: string;
  license?: "strict" | "yolo" | "custom";
  explain?: boolean;
  json?: boolean;
}

export interface SearchDependencies {
  githitsService: GitHitsService;
}

/**
 * Core search logic, separated for testability.
 */
export async function searchAction(
  query: string,
  options: SearchOptions,
  deps: SearchDependencies,
): Promise<void> {
  try {
    const result = await deps.githitsService.search({
      query,
      language: options.lang,
      licenseMode: options.license,
      includeExplanation: options.explain,
    });

    if (options.json) {
      console.log(JSON.stringify({ result }));
    } else {
      console.log(result);
    }
  } catch (error) {
    console.error(
      `Failed to search: ${error instanceof Error ? error.message : error}`,
    );
    process.exit(1);
  }
}

const SEARCH_DESCRIPTION = `Search for code examples from global open source.

Returns verified, canonical code examples matching your query.
Results are returned as markdown by default, or JSON with --json.
Use --explain to include an AI-generated explanation alongside the code.

Examples:
  githits search "how to use express middleware" --lang javascript
  githits search "async file reading" -l python --license yolo
  githits search "react hooks patterns" -l typescript --explain
  githits search "react hooks patterns" -l typescript --json`;

/**
 * Register the search command on the given program.
 * Uses lazy container creation so `--help` doesn't trigger auth.
 */
export function registerSearchCommand(program: Command) {
  program
    .command("search")
    .summary("Search for code examples")
    .description(SEARCH_DESCRIPTION)
    .argument("<query>", "Natural language search query")
    .requiredOption("-l, --lang <language>", "Programming language")
    .addOption(
      new Option("--license <mode>", "License filter mode")
        .choices(["strict", "yolo", "custom"])
        .default(undefined),
    )
    .option("--explain", "Include AI-generated explanation")
    .option("--json", "Output as JSON for piping")
    .action(withAuthenticatedAction(searchAction));
}
