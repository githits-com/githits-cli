import { type Command, Option } from "commander";
import type { GitHitsService } from "../services/githits-service.js";
import { AuthRequiredError, requireAuth } from "../shared/require-auth.js";

export interface ExampleOptions {
  lang: string;
  license?: "strict" | "yolo" | "custom";
  explain?: boolean;
  json?: boolean;
}

export interface ExampleDependencies {
  githitsService: GitHitsService;
  hasValidToken: boolean;
  mcpUrl: string;
}

export async function exampleAction(
  query: string,
  options: ExampleOptions,
  deps: ExampleDependencies,
): Promise<void> {
  requireAuth(deps);

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
      `Failed to get example: ${error instanceof Error ? error.message : error}`,
    );
    process.exit(1);
  }
}

const EXAMPLE_DESCRIPTION = `Get verified, canonical code examples from global open source.

This is the GitHits example-search surface. For dependency/package/repo source search,
use \

  githits search

instead.

Examples:
  githits example "how to use express middleware" --lang javascript
  githits example "async file reading" -l python --license yolo
  githits example "react hooks patterns" -l typescript --explain
  githits example "react hooks patterns" -l typescript --json`;

export function registerExampleCommand(program: Command) {
  program
    .command("example")
    .summary("Get code examples from global open source")
    .description(EXAMPLE_DESCRIPTION)
    .argument("<query>", "Natural language example-search query")
    .requiredOption("-l, --lang <language>", "Programming language")
    .addOption(
      new Option("--license <mode>", "License filter mode")
        .choices(["strict", "yolo", "custom"])
        .default(undefined),
    )
    .option("--explain", "Include AI-generated explanation")
    .option("--json", "Output as JSON for piping")
    .action(async (query: string, options: ExampleOptions) => {
      try {
        const deps = await loadContainer();
        await exampleAction(query, options, deps);
      } catch (error) {
        if (error instanceof AuthRequiredError) process.exit(1);
        throw error;
      }
    });
}

async function loadContainer() {
  const { createContainer } = await import("../container.js");
  return createContainer();
}
