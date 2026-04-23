import { type Command, Option } from "commander";
import type {
  CodeNavigationCapability,
  CodeNavigationService,
  UnifiedSearchSource,
} from "../services/code-navigation-service.js";
import {
  getCodeNavigationUrl,
  getEnvApiToken,
  isCodeNavigationCliOverrideEnabled,
} from "../services/config.js";
import {
  buildUnifiedSearchErrorPayload,
  buildUnifiedSearchParams,
  buildUnifiedSearchStatusPayload,
  buildUnifiedSearchSuccessPayload,
  InvalidArgumentError,
  parseUnifiedSearchTargetSpec,
  requireAuth,
  toSearchSymbolsFileIntent,
  toSearchSymbolsKind,
  toSymbolCategory,
} from "../shared/index.js";

export interface SearchCommandOptions {
  in?: string[];
  source?: string[];
  kind?: string;
  category?: string;
  pathPrefix?: string;
  intent?: string;
  public?: boolean;
  name?: string;
  lang?: string;
  limit?: string;
  offset?: string;
  wait?: string;
  json?: boolean;
}

export interface SearchStatusCommandOptions {
  json?: boolean;
}

export interface SearchCommandRegistrationOptions {
  codeNavigationUrl?: string;
  overrideEnabled?: boolean;
  capability?: CodeNavigationCapability;
  envTokenPresent?: boolean;
  expiredStoredAuth?: boolean;
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
  requireAuth(deps);

  try {
    const service = requireSearchService(deps);
    const built = buildUnifiedSearchParams({
      targets: parseTargetSpecs(options.in),
      query,
      sources: parseSources(options.source),
      kind: toSearchSymbolsKind(options.kind),
      category: toSymbolCategory(options.category),
      pathPrefix: options.pathPrefix,
      fileIntent: toSearchSymbolsFileIntent(options.intent),
      publicOnly: options.public,
      name: options.name,
      language: options.lang,
      limit: parseOptionalInt(options.limit, "--limit", 1, 100),
      offset: parseOptionalInt(options.offset, "--offset", 0),
      waitTimeoutMs: parseWaitMs(options.wait),
    });

    const outcome = await service.search(built.params);
    const payload = buildUnifiedSearchSuccessPayload(
      built.params,
      built.rawQuery,
      built.compiledQuery,
      built.defaulted,
      outcome,
    );

    if (options.json) {
      console.log(JSON.stringify(payload));
      return;
    }

    console.log(formatUnifiedSearchTerminal(payload));
  } catch (error) {
    handleSearchError(error, options.json ?? false);
  }
}

export async function searchStatusAction(
  searchRef: string,
  options: SearchStatusCommandOptions,
  deps: SearchCommandDependencies,
): Promise<void> {
  requireAuth(deps);

  try {
    const service = requireSearchService(deps);
    const outcome = await service.searchStatus(searchRef);
    const payload = buildUnifiedSearchStatusPayload(outcome);

    if (options.json) {
      console.log(JSON.stringify(payload));
      return;
    }

    if (!payload.completed) {
      console.log(formatSearchStatusTerminal(payload));
      return;
    }

    console.log(formatSearchStatusCompletedTerminal(payload));
  } catch (error) {
    handleSearchError(error, options.json ?? false);
  }
}

const SEARCH_DESCRIPTION = `Search code, docs, and symbols across indexed dependencies and repositories.

Use repeatable --in targets in package form (npm:express[@version]) or repo form
(https://github.com/org/repo[#ref]). Structured flags are the primary UX; they are
compiled with AND semantics against the raw query. Results are complete-by-default:
if indexing is still in progress, search returns a searchRef instead of partial hits.

Examples:
  githits search "router middleware" --in npm:express
  githits search "handler" --in npm:express --kind function --path-prefix src/
  githits search '"body parser" OR multer' --in npm:express --source docs
  githits search "retry logic" --in npm:got --in npm:ky --source code
  githits search "createServer" --in npm:@types/node --name createServer --lang typescript`;

const SEARCH_STATUS_DESCRIPTION = `Check the status of a unified search started earlier.

Pass the searchRef returned by \

  githits search ...

when the initial request could not complete within the wait window.`;

export function registerSearchCommand(program: Command) {
  program
    .command("search")
    .summary("Search indexed dependency code and docs")
    .description(SEARCH_DESCRIPTION)
    .argument("<query>", "Search query")
    .requiredOption(
      "--in <target>",
      "Search target: registry:name[@version] or https://github.com/org/repo[#ref]",
      collectRepeatable,
      [] as string[],
    )
    .addOption(
      new Option("--source <source>", "Source to search")
        .choices(["docs", "code", "symbol"])
        .argParser((value) => value.toLowerCase())
        .default(undefined),
    )
    .option("--kind <kind>", "Precise symbol kind filter")
    .option("--category <category>", "Broad symbol category filter")
    .option("--path-prefix <prefix>", "Repository path prefix filter")
    .option("--intent <intent>", "File intent filter")
    .option("--public", "Filter to public symbols when supported")
    .option("--name <name>", "Structured name qualifier")
    .option("--lang <language>", "Structured language qualifier")
    .option("--limit <n>", "Max results (1-100)")
    .option("--offset <n>", "Result offset")
    .option(
      "--wait <seconds>",
      "Max seconds to wait before returning a searchRef (0-60; default: 20)",
    )
    .option("--json", "Output as JSON")
    .action(async (query: string, options: SearchCommandOptions) => {
      const deps = await loadContainer();
      await searchAction(query, options, deps);
    });

  program
    .command("search-status")
    .summary("Check status of a prior search")
    .description(SEARCH_STATUS_DESCRIPTION)
    .argument("<search-ref>", "Search reference returned by githits search")
    .option("--json", "Output as JSON")
    .action(async (searchRef: string, options: SearchStatusCommandOptions) => {
      const deps = await loadContainer();
      await searchStatusAction(searchRef, options, deps);
    });
}

export async function registerUnifiedSearchCommands(
  program: Command,
  options: SearchCommandRegistrationOptions = {},
): Promise<void> {
  const codeNavigationUrl = options.codeNavigationUrl ?? getCodeNavigationUrl();
  if (!codeNavigationUrl) {
    return;
  }

  const overrideEnabled =
    options.overrideEnabled ?? isCodeNavigationCliOverrideEnabled();
  const registrationState =
    options.capability !== undefined || options.expiredStoredAuth !== undefined
      ? {
          capability: options.capability ?? "unknown",
          expiredStoredAuth: options.expiredStoredAuth ?? false,
        }
      : await loadStartupCodeNavigationRegistrationState();
  const capability = registrationState.capability;
  const envTokenPresent = options.envTokenPresent ?? Boolean(getEnvApiToken());

  if (
    !overrideEnabled &&
    capability !== "enabled" &&
    !envTokenPresent &&
    !registrationState.expiredStoredAuth
  ) {
    return;
  }

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

async function loadStartupCodeNavigationRegistrationState() {
  const { resolveStartupCodeNavigationRegistrationState } = await import(
    "../container.js"
  );
  return resolveStartupCodeNavigationRegistrationState();
}

function parseTargetSpecs(specs: string[] | undefined) {
  if (!specs || specs.length === 0) {
    throw new InvalidArgumentError("Provide at least one --in target.");
  }
  return specs.map(parseUnifiedSearchTargetSpec);
}

function parseSources(values: string[] | undefined): UnifiedSearchSource[] | undefined {
  if (!values || values.length === 0) return undefined;
  return values.map((value) => {
    switch (value) {
      case "docs":
        return "DOCS";
      case "code":
        return "CODE";
      case "symbol":
        return "SYMBOL";
      default:
        throw new InvalidArgumentError(`Unsupported source '${value}'.`);
    }
  });
}

function parseOptionalInt(
  value: string | undefined,
  flag: string,
  min: number,
  max = Number.MAX_SAFE_INTEGER,
): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new InvalidArgumentError(
      `${flag} must be an integer between ${min} and ${max}.`,
    );
  }
  return parsed;
}

function parseWaitMs(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim().replace(/s$/i, "");
  const seconds = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(seconds) || seconds < 0 || seconds > 60) {
    throw new InvalidArgumentError(
      "--wait must be an integer between 0 and 60 seconds.",
    );
  }
  return seconds * 1000;
}

function collectRepeatable(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function handleSearchError(error: unknown, json: boolean): never {
  const payload = buildUnifiedSearchErrorPayload(error);

  if (json) {
    console.error(JSON.stringify(payload));
  } else {
    console.error(payload.error);
  }
  process.exit(1);
}

function formatUnifiedSearchTerminal(payload: {
  completed: boolean;
  returnedCount: number;
  hasMore: boolean;
  nextOffset?: number;
  results: Array<{
    type: string;
    target: string;
    title?: string;
    summary?: string;
    locator: { filePath?: string; startLine?: number; endLine?: number };
  }>;
  searchRef?: string;
  progress?: { targetsReady?: number; targetsTotal?: number };
  query: { warnings?: string[] };
}): string {
  const lines: string[] = [];

  if (payload.query.warnings && payload.query.warnings.length > 0) {
    for (const warning of payload.query.warnings) {
      lines.push(`Warning: ${warning}`);
    }
    lines.push("");
  }

  if (!payload.completed) {
    return formatSearchStatusTerminal({
      completed: false,
      searchRef: payload.searchRef ?? "",
      progress: payload.progress,
    });
  }

  lines.push(
    `${payload.returnedCount} result(s)${payload.hasMore ? " (more available)" : ""}`,
  );
  lines.push("");

  if (payload.results.length === 0) {
    lines.push("No results.");
    return lines.join("\n");
  }

  for (const entry of payload.results) {
    const location = entry.locator.filePath
      ? entry.locator.startLine
        ? `${entry.locator.filePath}:${entry.locator.startLine}${entry.locator.endLine && entry.locator.endLine !== entry.locator.startLine ? `-${entry.locator.endLine}` : ""}`
        : entry.locator.filePath
      : undefined;
    lines.push(
      `${entry.type} · ${entry.target}${location ? ` · ${location}` : ""}${entry.title ? ` · ${entry.title}` : ""}`,
    );
    if (entry.summary) {
      lines.push(`  ${entry.summary}`);
    }
    lines.push("");
  }

  if (payload.nextOffset !== undefined) {
    lines.push(`Next offset: ${payload.nextOffset}`);
  }

  return lines.join("\n").trimEnd();
}

function formatSearchStatusTerminal(payload: {
  completed: false;
  searchRef: string;
  progress?: { targetsReady?: number; targetsTotal?: number; status?: string };
}): string {
  const lines = ["Search still in progress.", `searchRef: ${payload.searchRef}`];
  if (payload.progress) {
    if (payload.progress.status) {
      lines.push(`status: ${payload.progress.status.toLowerCase()}`);
    }
    if (
      typeof payload.progress.targetsReady === "number" &&
      typeof payload.progress.targetsTotal === "number"
    ) {
      lines.push(
        `targets ready: ${payload.progress.targetsReady}/${payload.progress.targetsTotal}`,
      );
    }
  }
  lines.push("Use `githits search-status <search-ref>` to check again.");
  return lines.join("\n");
}

function formatSearchStatusCompletedTerminal(payload: {
  completed: true;
  searchRef?: string;
  progress?: { status?: string };
  result: {
    query: string;
    queryWarnings: string[];
    returnedCount: number;
    hasMore: boolean;
    nextOffset?: number;
    results: Array<{
      type: string;
      target: string;
      title?: string;
      summary?: string;
      locator: { filePath?: string; startLine?: number; endLine?: number };
    }>;
  };
}): string {
  return formatUnifiedSearchTerminal({
    completed: true,
    returnedCount: payload.result.returnedCount,
    hasMore: payload.result.hasMore,
    nextOffset: payload.result.nextOffset,
    results: payload.result.results,
    searchRef: payload.searchRef,
    progress: payload.progress,
    query: { warnings: payload.result.queryWarnings },
  });
}
