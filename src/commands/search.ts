import type {
  CodeNavigationService,
  UnifiedSearchSource,
} from "@githits/core-internal";
import {
  buildUnifiedSearchErrorPayload,
  buildUnifiedSearchParams,
  buildUnifiedSearchStatusPayload,
  buildUnifiedSearchSuccessPayload,
  DEFAULT_WAIT_TIMEOUT_MS,
  InvalidArgumentError,
  knownSymbolCategoryList,
  knownSymbolKindList,
  MAX_DISCOVERY_WAIT_TIMEOUT_MS,
  type MappedError,
  parseUnifiedSearchTargetSpec,
  projectUnifiedSearchStatusPayload,
  projectUnifiedSearchSuccessPayload,
  renderUnifiedSearchStatusText,
  renderUnifiedSearchSuccess,
  requireAuth,
  shouldUseColors,
  toFileIntent,
  toSymbolCategory,
  toSymbolKind,
  type UnifiedSearchErrorPayload,
  type UnifiedSearchTextOptions,
  withIndexingRetryAction,
  withVersionRefRecovery,
} from "@githits/mcp/internal";
import { type Command, Option } from "commander";
import { recordCliErrorClassification } from "../shared/cli-error-diagnostics.js";
import { parseIntCliOption } from "../shared/cli-options.js";
import { startSpinner } from "../shared/spinner.js";
import { SPINNER_MESSAGES } from "../shared/spinner-messages.js";
import { formatIndexingError } from "./code/code-nav-cli-helpers.js";
import {
  buildCliMappedErrorPayload,
  formatMappedErrorForTerminal,
} from "./format-mapped-error.js";

export interface SearchCommandOptions {
  in?: string[];
  source?: string;
  kind?: string;
  category?: string;
  pathPrefix?: string;
  intent?: string;
  public?: boolean;
  name?: string;
  lang?: string;
  allowPartial?: boolean;
  limit?: string;
  offset?: string;
  wait?: string;
  json?: boolean;
}

export interface SearchStatusCommandOptions {
  wait?: string;
  json?: boolean;
}

export interface SearchCommandDependencies {
  codeNavigationService: CodeNavigationService | undefined;
  codeNavigationUrl: string | undefined;
  hasValidToken: boolean;
  mcpUrl: string;
}

// Back-compat type alias for tests and nearby imports during the surface rename.
export type SearchDependencies = SearchCommandDependencies;

export async function searchAction(
  query: string,
  options: SearchCommandOptions,
  deps: SearchCommandDependencies,
): Promise<void> {
  try {
    requireAuth(deps);
  } catch (error) {
    if (options.json) handleSearchError(error, true);
    throw error;
  }

  try {
    const service = requireSearchService(deps);
    const built = buildUnifiedSearchParams({
      targets: parseTargetSpecs(options.in),
      query,
      sources: parseSources(options.source),
      kind: toSymbolKind(options.kind),
      category: toSymbolCategory(options.category),
      pathPrefix: options.pathPrefix,
      fileIntent: toFileIntent(options.intent),
      publicOnly: options.public,
      name: options.name,
      language: options.lang,
      allowPartialResults: options.allowPartial,
      limit: parseOptionalInt(options.limit, "--limit", 1, 100),
      offset: parseOptionalInt(options.offset, "--offset", 0),
      waitTimeoutMs: parseWaitMs(options.wait),
    });

    const spinner = startSpinner(SPINNER_MESSAGES.search, !options.json);
    const outcome = await service
      .search(built.params)
      .finally(() => spinner.stop());
    const payload = buildUnifiedSearchSuccessPayload(
      built.params,
      built.rawQuery,
      built.compiledQuery,
      outcome,
    );

    if (options.json) {
      console.log(JSON.stringify(projectUnifiedSearchSuccessPayload(payload)));
      return;
    }

    console.log(renderUnifiedSearchSuccess(payload, cliSearchTextOptions()));
  } catch (error) {
    handleSearchError(error, options.json ?? false);
  }
}

export async function searchStatusAction(
  searchRef: string,
  options: SearchStatusCommandOptions,
  deps: SearchCommandDependencies,
): Promise<void> {
  try {
    requireAuth(deps);
  } catch (error) {
    if (options.json) handleSearchError(error, true, "status");
    throw error;
  }

  try {
    const service = requireSearchService(deps);
    const outcome = await service.searchStatus(
      searchRef,
      parseWaitMs(options.wait) ?? DEFAULT_WAIT_TIMEOUT_MS,
    );
    const payload = buildUnifiedSearchStatusPayload(outcome);

    if (options.json) {
      console.log(JSON.stringify(projectUnifiedSearchStatusPayload(payload)));
      return;
    }

    console.log(renderUnifiedSearchStatusText(payload, cliSearchTextOptions()));
  } catch (error) {
    handleSearchError(error, options.json ?? false, "status");
  }
}

const SEARCH_DESCRIPTION = `Search code, docs, and symbols across indexed dependencies, repositories, and documentation sites.

Read known symbols with githits read <target> --selector <name>. Search for missing locations; omit redundant target/version terms. Use sufficient results directly; otherwise replay the returned read action, including selector and bounds. Use a known location before repeating discovery.

Repeat --in for multiple targets. Packages use registry:name[@version] (for example npm:express); public repositories use github:owner/repo[@ref], another supported provider, or a supported repository URL. Swift: swift:github.com/<owner>/<repo>; Zig: zig:gh/<owner>/<repo>. Also Launchpad (lp:PROJECT, launchpad:~owner/+git/repo) and full HTTPS *.googlesource.com URLs. Packages cover an artifact/manifest root, not full repositories or sibling packages. Use site:<host[/path]> for hosted docs; suggested sites require an explicit choice. Repository refs use @; # selects a symbol/heading.

Use visible hits while indexing continues. Follow an emitted search-status action only for active progress when updated results matter; do not repeat search to poll. Terminal or unrecognized statuses are not polled; follow recovery guidance.

Preserve docs locators. Hosted docs are mutable; repository docs address snapshots. On githits read, --lines overrides heading selection with a page-relative range. Use githits example for examples from other projects.

Queries support implicit AND, uppercase OR, parens, unary -, "phrases", and qualifiers (kind:, category:, path:, lang:, name:, intent:, registry:, package:, version:, repo:). Structured flags are AND-combined with the query; inspect qualifier warnings.

Examples:
  githits search "router middleware" --in npm:express
  githits search "routing" --in site:expressjs.com --source docs
  githits search "composeArgs" --in npm:lodash --source symbol`;

const SEARCH_STATUS_DESCRIPTION = `Check the status of a unified search started earlier.

Pass the searchRef when githits search explicitly supplies this follow-up for
active PENDING, INDEXING, or SEARCHING progress and updated results matter.
Visible hits can be used for lookup now. This can return progress, usable hits
while background work continues, partial hits from a serveable subset when the
original request allowed partial results (the default), or final results. COMPLETED, DEFERRED,
TIMEOUT, and FAILED are terminal; unrecognized statuses are not polled. Follow
the rendered new-search action instead. By default the command waits up to 30
seconds for progress before returning the latest status.`;

export function registerSearchCommand(program: Command) {
  program
    .command("search")
    .summary("Explore repository code, dependencies, docs and symbols")
    .description(SEARCH_DESCRIPTION)
    .argument("<query>", "Search query")
    .requiredOption(
      "--in <target>",
      "Package, repository, or site target (repeatable; see addressing above)",
      collectRepeatable,
      [] as string[],
    )
    .addOption(
      new Option(
        "--source <source>",
        "Restrict results to docs, code, or symbol; omit to let GitHits select the best sources",
      )
        .choices(["docs", "code", "symbol"])
        .argParser((value, previous: string | undefined) => {
          if (previous !== undefined) {
            throw new InvalidArgumentError(
              "Pass --source at most once; omit it to let GitHits select the best sources.",
            );
          }
          return value.toLowerCase();
        })
        .default(undefined),
    )
    .addOption(
      new Option("--kind <kind>", "Precise symbol kind filter").choices([
        ...knownSymbolKindList(),
      ]),
    )
    .addOption(
      new Option(
        "--category <category>",
        "Broad symbol category filter",
      ).choices([...knownSymbolCategoryList()]),
    )
    .option(
      "--path-prefix <prefix>",
      "Code-only path prefix; omit for docs, symbols, and site-only searches",
    )
    .addOption(
      new Option(
        "--intent <intent>",
        "File intent filter (omit to search across all intents)",
      ).choices([
        "production",
        "test",
        "benchmark",
        "example",
        "generated",
        "fixture",
        "build",
        "vendor",
      ]),
    )
    .option("--public", "Filter to public symbols when supported")
    .option("--name <name>", "Structured name qualifier")
    .option("--lang <language>", "Structured language qualifier")
    .option(
      "--allow-partial",
      "Return a serveable subset while other target/source pairs prepare (default); a searchRef is still returned for continuation",
      true,
    )
    .option(
      "--no-allow-partial",
      "Wait for all runnable target/source pairs before returning hits",
    )
    .option("--limit <n>", "Max results (1-100, default: 10)")
    .option("--offset <n>", "Result offset")
    .option(
      "--wait <ms>",
      `Max milliseconds to wait before returning a searchRef (0-${MAX_DISCOVERY_WAIT_TIMEOUT_MS}; default: ${DEFAULT_WAIT_TIMEOUT_MS})`,
    )
    .option("--json", "Output as JSON")
    .action(async (query: string, options: SearchCommandOptions) => {
      const deps = await loadContainer();
      await searchAction(query, options, deps);
    });

  program
    .command("search-status")
    .summary("Check the status of a previous search")
    .description(SEARCH_STATUS_DESCRIPTION)
    .argument("<search-ref>", "Search reference returned by githits search")
    .option(
      "--wait <ms>",
      `Max milliseconds to wait for progress (0-${MAX_DISCOVERY_WAIT_TIMEOUT_MS}; default: ${DEFAULT_WAIT_TIMEOUT_MS})`,
    )
    .option("--json", "Output as JSON")
    .action(async (searchRef: string, options: SearchStatusCommandOptions) => {
      const deps = await loadContainer();
      await searchStatusAction(searchRef, options, deps);
    });
}

export async function registerUnifiedSearchCommands(
  program: Command,
): Promise<void> {
  registerSearchCommand(program);
}

function requireSearchService(
  deps: SearchCommandDependencies,
): CodeNavigationService {
  if (!deps.codeNavigationUrl || !deps.codeNavigationService) {
    throw new InvalidArgumentError(
      "Unified search is not configured for this environment.",
    );
  }

  return deps.codeNavigationService;
}

async function loadContainer() {
  const { createContainer } = await import("../container.js");
  return createContainer();
}

function parseTargetSpecs(specs: string[] | undefined) {
  if (!specs || specs.length === 0) {
    throw new InvalidArgumentError("Provide at least one --in target.");
  }
  return specs.map(parseUnifiedSearchTargetSpec);
}

function parseSources(
  value: string | undefined,
): UnifiedSearchSource[] | undefined {
  if (!value) return undefined;
  switch (value) {
    case "docs":
      return ["DOCS"];
    case "code":
      return ["CODE"];
    case "symbol":
      return ["SYMBOL"];
    default:
      throw new InvalidArgumentError(`Unsupported source '${value}'.`);
  }
}

function parseOptionalInt(
  value: string | undefined,
  flag: string,
  min: number,
  max = Number.MAX_SAFE_INTEGER,
): number | undefined {
  return parseIntCliOption(value, flag, min, max);
}

function parseWaitMs(value: string | undefined): number | undefined {
  return parseIntCliOption(value, "--wait", 0, MAX_DISCOVERY_WAIT_TIMEOUT_MS);
}

function collectRepeatable(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function handleSearchError(
  error: unknown,
  json: boolean,
  context: "search" | "status" = "search",
): never {
  const basePayload = applyCliTermsRemediation(
    buildUnifiedSearchErrorPayload(error),
  );
  const mapped = withVersionRefRecovery(
    withIndexingRetryAction(toMappedError(basePayload), "search", "cli", {
      maxWaitMs: MAX_DISCOVERY_WAIT_TIMEOUT_MS,
    }),
    { syntax: "cli", argv: process.argv.slice(2) },
  );
  const payload = {
    ...basePayload,
    ...(mapped.details
      ? { details: mapped.details as Record<string, unknown> }
      : {}),
  };
  recordCliErrorClassification("code-nav", error, payload);

  if (json) {
    console.error(JSON.stringify(payload));
  } else {
    console.error(formatSearchErrorTerminal(payload, context));
  }
  process.exit(1);
}

function applyCliTermsRemediation(
  payload: UnifiedSearchErrorPayload,
): UnifiedSearchErrorPayload {
  if (payload.code !== "TERMS_ACCEPTANCE_REQUIRED") return payload;
  const formatted = buildCliMappedErrorPayload(toMappedError(payload));
  return {
    error: formatted.error,
    code: formatted.code,
    retryable: formatted.retryable,
    details: formatted.details as Record<string, unknown> | undefined,
  };
}

function toMappedError(payload: UnifiedSearchErrorPayload): MappedError {
  return {
    code: payload.code as MappedError["code"],
    message: payload.error,
    retryable: payload.retryable,
    details: payload.details as MappedError["details"],
  };
}

function formatSearchErrorTerminal(
  payload: UnifiedSearchErrorPayload,
  context: "search" | "status",
): string {
  const mapped = toMappedError(payload);
  if (payload.code === "AUTH_REQUIRED") {
    return formatMappedErrorForTerminal(mapped);
  }
  if (payload.code === "INDEXING") {
    return formatIndexingError(mapped, {
      operation: "search",
      maxWaitMs: MAX_DISCOVERY_WAIT_TIMEOUT_MS,
    });
  }
  const formatted = formatMappedErrorForTerminal(mapped);
  if (context === "status" && payload.code === "NOT_FOUND") {
    return `${formatted}\n  Search sessions expire; run \`githits search ...\` to start a new one.`;
  }
  return formatted;
}

function cliSearchTextOptions(): UnifiedSearchTextOptions {
  return {
    useColors: shouldUseColors(),
    actionSyntax: "cli",
    width: process.stdout.columns,
  };
}
