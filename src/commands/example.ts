import type { GitHitsService } from "@githits/core-internal";
import {
  AuthRequiredError,
  buildAuthRequiredErrorPayload,
  extractSolutionId,
  mapGitHitsServiceError,
  requireAuth,
} from "@githits/mcp/internal";
import { type Command, Option } from "commander";
import { startSpinner } from "../shared/spinner.js";
import { SPINNER_MESSAGES } from "../shared/spinner-messages.js";
import {
  buildCliMappedErrorPayload,
  formatMappedErrorForTerminal,
} from "./format-mapped-error.js";

export interface ExampleOptions {
  lang?: string;
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
  try {
    requireAuth(deps);

    const spinner = startSpinner(SPINNER_MESSAGES.example, !options.json);
    const result = await deps.githitsService
      .search({
        query,
        language: options.lang,
        licenseMode: options.license,
        includeExplanation: options.explain,
      })
      .finally(() => spinner.stop());

    if (options.json) {
      const solutionId = extractSolutionId(result);
      const payload = solutionId
        ? { result, solution_id: solutionId }
        : { result };
      console.log(JSON.stringify(payload));
    } else {
      console.log(result);
    }
  } catch (error) {
    if (error instanceof AuthRequiredError) {
      if (options.json) {
        console.error(JSON.stringify(buildAuthRequiredErrorPayload(error)));
        process.exit(1);
      }
      throw error;
    }
    const mapped = mapGitHitsServiceError("get example", error);
    if (options.json) {
      console.error(JSON.stringify(buildCliMappedErrorPayload(mapped)));
    } else {
      console.error(formatMappedErrorForTerminal(mapped));
    }
    process.exit(1);
  }
}

const EXAMPLE_DESCRIPTION = `Find source-cited examples from real open-source projects.

For dependency, package, or repository source search, use \`githits search\` instead.

Examples:
  githits example "how to use express middleware"
  githits example "how to use express middleware" --lang javascript
  githits example "async file reading" -l python --license yolo
  githits example "react hooks patterns" -l typescript --explain
  githits example "react hooks patterns" -l typescript --json`;

export function registerExampleCommand(program: Command) {
  program
    .command("example")
    .summary("Find real-world implementations from open-source code")
    .description(EXAMPLE_DESCRIPTION)
    .argument("<query>", "Natural language example-search query")
    .option(
      "-l, --lang <language>",
      "Optional programming language; omitted values are inferred by GitHits",
    )
    .addOption(
      new Option("--license <mode>", "License filter mode")
        .choices(["strict", "yolo", "custom"])
        .default(undefined),
    )
    .option("--explain", "Include AI-generated explanation")
    .option("--json", "Output as JSON for piping")
    .action(async (query: string, options: ExampleOptions) => {
      const deps = await loadContainer();
      await exampleAction(query, options, deps);
    });
}

async function loadContainer() {
  const { createContainer } = await import("../container.js");
  return createContainer();
}
