import type { GitHitsService } from "@githits/core-internal";
import {
  AuthRequiredError,
  buildAuthRequiredErrorPayload,
  extractSolutionId,
  type McpProgressHook,
  mapGitHitsServiceError,
  requireAuth,
} from "@githits/mcp/internal";
import { type Command, Option } from "commander";
import {
  beginSpinnerProgress,
  createCommandProgress,
} from "../shared/remote-progress.js";
import { type Spinner, startNarrowingSpinner } from "../shared/spinner.js";
import { SPINNER_MESSAGES } from "../shared/spinner-messages.js";
import { sanitizeTerminalMarkdown } from "../shared/terminal-markdown.js";
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
  /** Live backend progress for the interactive spinner. */
  progress?: McpProgressHook;
  createSpinner?: () => Spinner;
}

export async function exampleAction(
  query: string,
  options: ExampleOptions,
  deps: ExampleDependencies,
): Promise<void> {
  try {
    requireAuth(deps);

    const spinner =
      deps.createSpinner?.() ??
      startNarrowingSpinner(SPINNER_MESSAGES.example[0], !options.json);
    const progress = await beginSpinnerProgress(spinner, deps.progress);
    const params = {
      query,
      sourceFormat: "cli" as const,
      language: options.lang,
      licenseMode: options.license,
      includeExplanation: options.explain,
    };
    const result = await (progress
      ? deps.githitsService.search(params, { progress })
      : deps.githitsService.search(params)
    ).finally(() => {
      progress?.end();
      spinner.stop();
    });

    if (options.json) {
      const solutionId = extractSolutionId(result);
      const payload = solutionId
        ? { result, solution_id: solutionId }
        : { result };
      console.log(JSON.stringify(payload));
    } else {
      console.log(sanitizeTerminalMarkdown(result));
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
      "Optional programming language. Omit to infer it. If GitHits cannot match it, the error lists languages to retry with.",
    )
    .addOption(
      new Option(
        "--license <mode>",
        "License filter: strict (default), custom (account blocklist), or yolo (unfiltered)",
      )
        .choices(["strict", "yolo", "custom"])
        .default(undefined),
    )
    .option("--explain", "Include AI-generated explanation")
    .option("--json", "Output as JSON for piping")
    .action(async (query: string, options: ExampleOptions) => {
      const deps = await loadContainer(options);
      const progress = options.json ? undefined : createCommandProgress(deps);
      try {
        await exampleAction(query, options, { ...deps, progress });
      } finally {
        // An open progress socket must not keep the process alive.
        progress?.close();
      }
    });
}

async function loadContainer(options: ExampleOptions) {
  const { createContainer } = await import("../container.js");
  return createContainer({
    openProviderRecovery:
      !options.json && Boolean(process.stdin.isTTY && process.stdout.isTTY),
  });
}
