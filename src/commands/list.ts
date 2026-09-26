import type { ListService } from "@githits/core-internal";
import {
  buildListParams,
  formatListText,
  projectListResult,
  requireAuth,
  sanitizeTerminalText,
  shouldUseColors,
} from "@githits/mcp/internal";
import type { Command } from "commander";
import { createContainer } from "../container.js";
import { mapListErrorForCli } from "../shared/cli-error-diagnostics.js";
import type { Spinner } from "../shared/spinner.js";
import { startSpinner } from "../shared/spinner.js";
import { SPINNER_MESSAGES } from "../shared/spinner-messages.js";
import {
  buildCliMappedErrorPayload,
  formatMappedErrorForTerminal,
} from "./format-mapped-error.js";

export interface ListCommandOptions {
  recursive?: boolean;
  fileType?: string[];
  language?: string[];
  intent?: string[];
  limit?: string;
  after?: string;
  wait?: string;
  verbose?: boolean;
  json?: boolean;
}

export interface ListCommandDependencies {
  listService: ListService;
  hasValidToken: boolean;
  mcpUrl: string;
  createSpinner?: () => Spinner;
}

/** List a single package, repository, or documentation-site inventory. */
export async function listAction(
  target: string,
  paths: string[] | undefined,
  options: ListCommandOptions,
  deps: ListCommandDependencies,
): Promise<void> {
  try {
    requireAuth(deps);
    const params = buildListParams({
      target,
      paths,
      recursive: options.recursive,
      fileTypes: options.fileType,
      languages: options.language,
      intents: options.intent,
      limit: parseNumericOption(options.limit),
      after: options.after,
      waitTimeoutMs: parseNumericOption(options.wait),
      includeDetailedFields: options.json === true || options.verbose === true,
    });
    const spinner =
      deps.createSpinner?.() ??
      startSpinner(SPINNER_MESSAGES.list, !options.json);
    const result = await deps.listService
      .list(params)
      .finally(() => spinner.stop());
    const projected = projectListResult(result);

    if (options.json) {
      console.log(JSON.stringify(projected));
    } else {
      process.stdout.write(
        formatListText(projected, params, {
          surface: "cli",
          verbose: options.verbose === true,
          useColors: shouldUseColors(),
          width: process.stdout.columns,
        }),
      );
    }
  } catch (error) {
    handleListError(
      error,
      options.json === true,
      hasNonemptyAfter(options.after),
    );
  }
}

function parseNumericOption(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  return /^\d+$/.test(raw.trim()) ? Number(raw) : Number.NaN;
}

function hasNonemptyAfter(after: string | undefined): boolean {
  return after !== undefined && after.trim().length > 0;
}

function handleListError(
  error: unknown,
  json: boolean,
  hasAfter: boolean,
): never {
  const mapped = mapListErrorForCli(error, { hasAfter });
  if (json) {
    console.error(JSON.stringify(buildCliMappedErrorPayload(mapped)));
  } else {
    const safeMapped = {
      ...mapped,
      message: sanitizeTerminalText(mapped.message),
      ...(mapped.details?.hint
        ? {
            details: {
              ...mapped.details,
              hint: sanitizeTerminalText(mapped.details.hint),
            },
          }
        : {}),
    };
    console.error(formatMappedErrorForTerminal(safeMapped));
  }
  process.exit(1);
}

function collectOption(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

export function registerListCommand(program: Command): Command {
  return program
    .command("list")
    .summary("List files and documentation in a target")
    .description(
      "List the files and documentation entries for one package, repository, or hosted site. Package and repository targets stay within their source inventory; use site:<host[/path]> for hosted documentation. Pass paths as literals or globs, and add --recursive to traverse matched directories. Use returned actions and cursors unchanged.",
    )
    .argument("<target>", "Package, repository, or site target")
    .argument("[paths...]", "Literal path selectors or glob patterns")
    .option("-R, --recursive", "Traverse matched directories recursively")
    .option(
      "--file-type <type>",
      "Filter by file type (repeatable)",
      collectOption,
    )
    .option(
      "--language <language>",
      "Filter by language (repeatable)",
      collectOption,
    )
    .option(
      "--intent <intent>",
      "Filter by file intent (repeatable)",
      collectOption,
    )
    .option("--limit <n>", "Maximum entries to return (1-500)")
    .option("--after <cursor>", "Continue from a prior opaque cursor")
    .option("--wait <ms>", "Wait for source indexing (0-300000 ms)")
    .option("-v, --verbose", "Show detailed source and resolution metadata")
    .option("--json", "Emit the lossless JSON result")
    .action(
      async (
        target: string,
        paths: string[] | undefined,
        options: ListCommandOptions,
      ) => {
        const deps = await createContainer();
        await listAction(target, paths, options, deps);
      },
    );
}
