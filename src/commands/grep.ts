import type { GrepService } from "@githits/core-internal";
import {
  buildGrepParams,
  formatGrepText,
  type GrepRequestTargetInput,
  InvalidGrepRequestError,
  isGrepSiteTarget,
  mapGrepError,
  normalizeGrepContextLines,
  projectGrepResult,
  requireAuth,
  sanitizeTerminalText,
  shouldUseColors,
} from "@githits/mcp/internal";
import type { Command } from "commander";
import { createContainer } from "../container.js";
import { recordCliErrorClassification } from "../shared/cli-error-diagnostics.js";
import { type Spinner, startSpinner } from "../shared/spinner.js";
import {
  buildCliMappedErrorPayload,
  formatMappedErrorForTerminal,
} from "./format-mapped-error.js";

export interface GrepCommandOptions {
  fixedStrings?: boolean;
  ignoreCase?: boolean;
  caseSensitive?: boolean;
  afterContext?: string[];
  beforeContext?: string[];
  context?: string[];
  corpus?: string;
  limit?: string;
  cursor?: string;
  wait?: string;
  json?: boolean;
  pathSelectors?: GrepRequestTargetInput["pathSelectors"];
}
export interface GrepCommandDependencies {
  grepService: GrepService;
  hasValidToken: boolean;
  mcpUrl: string;
  createSpinner?: () => Spinner;
}
export type GrepCommandDependenciesFactory =
  () => Promise<GrepCommandDependencies>;

/** Execute one mixed-source page with grep/rg matching defaults. */
export async function grepAction(
  pattern: string,
  targets: string[],
  options: GrepCommandOptions,
  deps: GrepCommandDependencies,
): Promise<void> {
  try {
    requireAuth(deps);
    const context = contextValue(options.context, "--context");
    const before = contextValue(options.beforeContext, "--before-context");
    const after = contextValue(options.afterContext, "--after-context");
    const pathSelectors = options.pathSelectors ?? [];
    const sourceOptions =
      options.corpus !== undefined || pathSelectors.length > 0;
    if (sourceOptions && targets.every(isGrepSiteTarget))
      throw new InvalidGrepRequestError(
        "targets",
        "Source flags require a package or repository operand.",
      );
    const params = buildGrepParams({
      pattern,
      targets: targets.map((target) =>
        isGrepSiteTarget(target)
          ? { target }
          : { target, corpus: options.corpus, pathSelectors },
      ),
      patternType: options.fixedStrings ? "literal" : "regex",
      ignoreCase: options.ignoreCase,
      contextLinesBefore: before ?? context,
      contextLinesAfter: after ?? context,
      maxMatches: numeric(options.limit),
      waitTimeoutMs: numeric(options.wait),
      cursor: options.cursor,
      includeDetailedFields: options.json === true,
    });
    const spinner =
      deps.createSpinner?.() ??
      startSpinner("Searching indexed source and documentation", !options.json);
    const result = await deps.grepService
      .grep(params)
      .finally(() => spinner.stop());
    const projected = projectGrepResult(result);
    if (options.json) console.log(JSON.stringify(projected));
    else
      process.stdout.write(
        `${formatGrepText(projected, { useColors: shouldUseColors(), width: process.stdout.columns || 80, syntax: "cli" })}\n`,
      );
  } catch (error) {
    const mapped = mapGrepError(error);
    if (mapped.code === "INDEXING" && mapped.retryable) {
      mapped.details = {
        ...mapped.details,
        hint: [
          mapped.details?.hint,
          "Retry with --wait <ms> to wait for target preparation (up to 300000 ms).",
        ]
          .filter(Boolean)
          .join("\n"),
      };
    }
    if (error instanceof InvalidGrepRequestError) {
      const label = CLI_FIELDS[error.field];
      if (label) mapped.message = mapped.message.replace(error.field, label);
    }
    recordCliErrorClassification("grep", error, mapped);
    if (options.json)
      console.error(JSON.stringify(buildCliMappedErrorPayload(mapped)));
    else
      console.error(
        formatMappedErrorForTerminal({
          ...mapped,
          message: sanitizeTerminalText(mapped.message),
          details: {
            ...mapped.details,
            ...(mapped.details?.hint
              ? { hint: sanitizeTerminalText(mapped.details.hint) }
              : {}),
          },
        }),
      );
    process.exit(1);
  }
}
const CLI_FIELDS: Record<string, string> = {
  maxMatches: "--limit",
  waitTimeoutMs: "--wait",
  contextLinesBefore: "--before-context",
  contextLinesAfter: "--after-context",
  patternType: "pattern mode",
  ignoreCase: "--ignore-case",
  cursor: "--cursor",
};
function numeric(value: string | undefined): number | undefined {
  return value === undefined
    ? undefined
    : /^\d+$/.test(value.trim())
      ? Number(value)
      : Number.NaN;
}
function contextValue(
  values: string[] | undefined,
  field: string,
): number | undefined {
  return values
    ?.map((value) => normalizeGrepContextLines(numeric(value), field))
    .at(-1);
}
function collect(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

/** Register the top-level grep command without changing legacy code grep. */
export function registerGrepCommand(
  program: Command,
  dependenciesFactory: GrepCommandDependenciesFactory = createContainer,
): Command {
  const command = program
    .command("grep")
    .summary("Find regex or literal matches across source and documentation")
    .description(
      "Search ordered package, repository, and site: targets. Defaults: RE2 regex, case-sensitive, zero context, and all indexed repository files. Package targets also include selected hosted documentation independently of --corpus and path filters. Matching uses indexed content, not local files. Regex supports RE2 and backend anchoring requirements; unsupported or anchorless expressions fail explicitly. -s follows rg (case-sensitive); grep uses -s to suppress errors. Unlike grep/rg -m, --limit is a global page cap. Partial results and exact read actions remain visible. Use -- before a leading-dash pattern.",
    )
    .argument("<pattern>", "RE2 regex, or literal with -F")
    .argument("<targets...>", "Ordered package, repository, or site: operands")
    .option("-F, --fixed-strings", "Match a literal string")
    .option("-i, --ignore-case", "Ignore case (Unicode folding)")
    .option(
      "-s, --case-sensitive",
      "Match case sensitively (rg convention; last case flag wins)",
    )
    .option("-A, --after-context <n>", "Trailing context lines (0-10)", collect)
    .option("-B, --before-context <n>", "Leading context lines (0-10)", collect)
    .option(
      "-C, --context <n>",
      "Context on both sides; -A/-B override their side (0-10)",
      collect,
    )
    .option(
      "--path <path>",
      "Exact source path, applied to every source operand (repeatable)",
    )
    .option("--path-prefix <prefix>", "Source path prefix (repeatable)")
    .option("--glob <glob>", "Source path glob (repeatable)")
    .option(
      "--corpus <corpus>",
      "Repository files: source, documentation, or all (default: all)",
    )
    .option(
      "--limit <n>",
      "Global page match cap (1-1000; backend default: 100)",
    )
    .option(
      "--cursor <cursor>",
      "Continue with the same ordered operands and controls, including unvisited scopes. Hosted pages can change between grep and read.",
    )
    .option("--wait <ms>", "Wait for target preparation (0-300000 ms)")
    .option("--json", "Emit the detailed lossless JSON page")
    .action(
      async (
        pattern: string,
        targets: string[],
        options: GrepCommandOptions,
      ) => {
        await grepAction(
          pattern,
          targets,
          options,
          await dependenciesFactory(),
        );
      },
    );
  command.on("option:case-sensitive", () =>
    command.setOptionValue("ignoreCase", false),
  );
  for (const [name, kind] of [
    ["path", "exact"],
    ["path-prefix", "prefix"],
    ["glob", "glob"],
  ] as const) {
    command.on(`option:${name}`, (value: string) =>
      command.setOptionValue("pathSelectors", [
        ...(command.getOptionValue("pathSelectors") ?? []),
        { kind, value },
      ]),
    );
  }
  return command;
}
