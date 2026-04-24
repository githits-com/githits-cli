import { type Command, Option } from "commander";
import type { CodeNavigationCapability } from "../services/code-navigation-capability.js";
import type {
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
  colorize,
  dim,
  highlight,
  highlightRanges,
  InvalidArgumentError,
  knownSymbolCategoryList,
  knownSymbolKindList,
  parseUnifiedSearchTargetSpec,
  requireAuth,
  shouldUseColors,
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
  allowPartial?: boolean;
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
      allowPartialResults: options.allowPartial,
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
      if (payload.result) {
        console.log(
          formatSearchStatusPartialTerminal({
            ...payload,
            result: payload.result,
          }),
        );
      } else {
        console.log(formatSearchStatusTerminal(payload));
      }
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
compiled with AND semantics against the discovery query. The query supports
implicit AND, uppercase OR, parentheses, unary -, quoted phrases, semantic
qualifiers (kind:, category:, path:, lang:, name:, intent:), and routing
qualifiers (registry:, package:, version:, repo:). Unified search defaults to
production file intent where the backend supports that filter. Results are
complete-by-default: if indexing is still in progress, search returns a
searchRef instead of partial hits unless --allow-partial is passed.

Decision guide:
  githits example ...                canonical cross-project examples
  githits search ...                 indexed dependency/repository search
  githits search --source symbol ... symbol-shaped unified search

Plain output labels:
  docs page   hosted documentation page
  repo doc    documentation-like block from a repository file
  repo code   code block from a repository file
  repo symbol explicit symbol hit from the repository index

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
    .summary("Search indexed dependency and repository code, docs, and symbols")
    .description(SEARCH_DESCRIPTION)
    .argument("<query>", "Search query")
    .requiredOption(
      "--in <target>",
      "Search target: registry:name[@version] or https://github.com/org/repo[#ref]",
      collectRepeatable,
      [] as string[],
    )
    .addOption(
      new Option(
        "--source <source>",
        "Source to search (repeatable; default: auto)",
      )
        .choices(["docs", "code", "symbol"])
        .argParser((value, previous: string[] = []) =>
          collectRepeatable(value.toLowerCase(), previous),
        )
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
    .option("--path-prefix <prefix>", "Repository path prefix filter")
    .addOption(
      new Option(
        "--intent <intent>",
        "File intent filter (default: production)",
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
      "Return available partial results while other sources are still indexing",
    )
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

function parseSources(
  values: string[] | undefined,
): UnifiedSearchSource[] | undefined {
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
    highlights?: {
      title?: Array<readonly [number, number]>;
      summary?: Array<readonly [number, number]>;
    };
    locator: {
      registry?: string;
      packageName?: string;
      version?: string;
      repoUrl?: string;
      gitRef?: string;
      pageId?: string;
      filePath?: string;
      startLine?: number;
      endLine?: number;
    };
  }>;
  searchRef?: string;
  progress?: { targetsReady?: number; targetsTotal?: number };
  query: { warnings?: string[] };
  sourceStatus?: Array<{
    source: string;
    targetLabel: string;
    ignoredFilters: string[];
    incompatibleFilters: string[];
    note?: string;
  }>;
}): string {
  const lines: string[] = [];
  const useColors = shouldUseColors();

  if (payload.query.warnings && payload.query.warnings.length > 0) {
    for (const warning of payload.query.warnings) {
      lines.push(`Warning: ${warning}`);
    }
    lines.push("");
  }

  if (!payload.completed) {
    const statusText = formatSearchStatusTerminal({
      completed: false,
      searchRef: payload.searchRef ?? "",
      progress: payload.progress,
    });
    if (payload.results.length === 0) {
      return statusText;
    }
    lines.push(statusText);
    lines.push("");
    lines.push("Partial results:");
  }

  if (payload.results.length === 0) {
    lines.push("No results.");
    return lines.join("\n");
  }

  lines.push(
    `${highlight(`${payload.returnedCount} result(s)`, useColors)}${payload.hasMore ? dim(" (more available)", useColors) : ""}`,
  );
  lines.push(dim(formatUnifiedSearchTypeSummary(payload.results), useColors));
  lines.push("");

  for (const entry of payload.results) {
    const location = formatUnifiedSearchLocation(entry.locator);
    const header = formatUnifiedSearchHeader(entry, useColors, location);
    lines.push(header);
    if (entry.summary) {
      lines.push(
        ...formatUnifiedSearchSummary(
          entry.summary,
          entry.highlights?.summary,
          useColors,
        ),
      );
    }
    const detailLine = formatUnifiedSearchDetailLine(entry, useColors);
    if (detailLine) {
      lines.push(detailLine);
    }
    lines.push("");
  }

  if (payload.nextOffset !== undefined) {
    lines.push(dim(`Next offset: ${payload.nextOffset}`, useColors));
  }

  const sourceStatusNotes = formatSourceStatusNotes(payload.sourceStatus);
  if (sourceStatusNotes.length > 0) {
    lines.push("");
    lines.push(...sourceStatusNotes);
  }

  return lines.join("\n").trimEnd();
}

function formatSearchStatusTerminal(payload: {
  completed: false;
  searchRef: string;
  progress?: { targetsReady?: number; targetsTotal?: number; status?: string };
}): string {
  const status = payload.progress?.status;
  const lines = [
    formatSearchStatusHeadline(status),
    `searchRef: ${payload.searchRef}`,
  ];
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
  if (status === "TIMEOUT") {
    lines.push(
      "Search timed out before completion. Retry with a longer wait or start a new search.",
    );
    return lines.join("\n");
  }
  if (status === "FAILED") {
    lines.push(
      "Search failed. Start a new search or inspect backend errors if the failure persists.",
    );
    return lines.join("\n");
  }
  lines.push("Use `githits search-status <search-ref>` to check again.");
  return lines.join("\n");
}

function formatSearchStatusHeadline(status: string | undefined): string {
  switch (status) {
    case "TIMEOUT":
      return "Search timed out.";
    case "FAILED":
      return "Search failed.";
    default:
      return "Search still in progress.";
  }
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
    sourceStatus?: Array<{
      source: string;
      targetLabel: string;
      ignoredFilters: string[];
      incompatibleFilters: string[];
      note?: string;
    }>;
    results: Array<{
      type: string;
      target: string;
      title?: string;
      summary?: string;
      highlights?: {
        title?: Array<readonly [number, number]>;
        summary?: Array<readonly [number, number]>;
      };
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
    progress: undefined,
    query: { warnings: payload.result.queryWarnings },
    sourceStatus: payload.result.sourceStatus,
  });
}

function formatSearchStatusPartialTerminal(payload: {
  completed: false;
  searchRef: string;
  progress?: { targetsReady?: number; targetsTotal?: number; status?: string };
  result: {
    queryWarnings: string[];
    returnedCount: number;
    hasMore: boolean;
    nextOffset?: number;
    sourceStatus?: Array<{
      source: string;
      targetLabel: string;
      ignoredFilters: string[];
      incompatibleFilters: string[];
      note?: string;
    }>;
    results: Array<{
      type: string;
      target: string;
      title?: string;
      summary?: string;
      highlights?: {
        title?: Array<readonly [number, number]>;
        summary?: Array<readonly [number, number]>;
      };
      locator: { filePath?: string; startLine?: number; endLine?: number };
    }>;
  };
}): string {
  return formatUnifiedSearchTerminal({
    completed: false,
    returnedCount: payload.result.returnedCount,
    hasMore: payload.result.hasMore,
    nextOffset: payload.result.nextOffset,
    results: payload.result.results,
    searchRef: payload.searchRef,
    progress: payload.progress,
    query: { warnings: payload.result.queryWarnings },
    sourceStatus: payload.result.sourceStatus,
  });
}

function formatSourceStatusNotes(
  sourceStatus:
    | Array<{
        source: string;
        targetLabel: string;
        ignoredFilters: string[];
        incompatibleFilters: string[];
        note?: string;
      }>
    | undefined,
): string[] {
  const useColors = shouldUseColors();
  if (!sourceStatus) {
    return [];
  }

  const lines: string[] = [];
  for (const entry of sourceStatus) {
    const label = `${entry.source.toLowerCase()} on ${entry.targetLabel}`;
    if (entry.ignoredFilters.length > 0) {
      lines.push(
        dim(
          `Note: ${label} ignored filters: ${entry.ignoredFilters.join(", ")}`,
          useColors,
        ),
      );
    }
    if (entry.incompatibleFilters.length > 0) {
      lines.push(
        dim(
          `Note: ${label} incompatible filters: ${entry.incompatibleFilters.join(
            ", ",
          )}`,
          useColors,
        ),
      );
    }
    if (entry.note) {
      lines.push(dim(`Note: ${label}: ${entry.note}`, useColors));
    }
  }

  return lines;
}

function formatUnifiedSearchTypeSummary(
  results: Array<{ type: string }>,
): string {
  const counts = new Map<string, number>();
  for (const result of results) {
    counts.set(result.type, (counts.get(result.type) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .map(([type, count]) => formatUnifiedSearchCountLabel(type, count))
    .join(" · ");
}

function formatUnifiedSearchResultLabel(type: string): string {
  switch (type) {
    case "documentation_page":
      return "docs page";
    case "repository_doc":
      return "repo doc";
    case "repository_code":
      return "repo code";
    case "repository_symbol":
      return "repo symbol";
    default:
      return type.replaceAll("_", " ");
  }
}

function formatUnifiedSearchCountLabel(type: string, count: number): string {
  switch (type) {
    case "documentation_page":
      return `${count} docs page${count === 1 ? "" : "s"}`;
    case "repository_doc":
      return `${count} repo doc${count === 1 ? "" : "s"}`;
    case "repository_code":
      return `${count} repo code hit${count === 1 ? "" : "s"}`;
    case "repository_symbol":
      return `${count} repo symbol${count === 1 ? "" : "s"}`;
    default:
      return `${count} ${formatUnifiedSearchResultLabel(type)}`;
  }
}

function formatUnifiedSearchSummary(
  summary: string,
  ranges: Array<readonly [number, number]> | undefined,
  useColors: boolean,
): string[] {
  const lines = summary.split(/\r\n|\n/);

  // Preserve backend snippets verbatim. We only style spans the backend already
  // computed instead of trimming or rewriting the snippet client-side.
  let offset = 0;
  return lines.map((line) => {
    const lineStart = offset;
    const lineEnd = lineStart + line.length;
    const lineRanges = (ranges ?? [])
      .map(
        ([start, end]) =>
          [Math.max(start, lineStart), Math.min(end, lineEnd)] as const,
      )
      .filter(([start, end]) => end > start)
      .map(([start, end]) => [start - lineStart, end - lineStart] as const);
    const separatorLength = summary.startsWith("\r\n", lineEnd) ? 2 : 1;
    offset = lineEnd + separatorLength;
    return `  ${highlightRanges(line, lineRanges, useColors)}`;
  });
}

function formatUnifiedSearchLocation(locator: {
  filePath?: string;
  startLine?: number;
  endLine?: number;
}): string | undefined {
  if (!locator.filePath) {
    return undefined;
  }

  if (!locator.startLine) {
    return locator.filePath;
  }

  return `${locator.filePath}:${locator.startLine}${locator.endLine && locator.endLine !== locator.startLine ? `-${locator.endLine}` : ""}`;
}

function formatUnifiedSearchHeader(
  entry: {
    target: string;
    type: string;
    highlights?: { title?: Array<readonly [number, number]> };
    locator: {
      filePath?: string;
      startLine?: number;
      endLine?: number;
      pageId?: string;
    };
    title?: string;
  },
  useColors: boolean,
  location: string | undefined,
): string {
  const primary = location ? `${entry.target} ${location}` : entry.target;
  const badge = `[${formatUnifiedSearchResultLabel(entry.type)}]`;
  const title = entry.title
    ? highlightRanges(entry.title, entry.highlights?.title, useColors)
    : undefined;
  return `${highlight(primary, useColors)} ${dim(badge, useColors)}${title ? ` - ${title}` : ""}`;
}

function formatUnifiedSearchDetailLine(
  entry: {
    type: string;
    target: string;
    locator: {
      registry?: string;
      packageName?: string;
      version?: string;
      repoUrl?: string;
      gitRef?: string;
      pageId?: string;
      filePath?: string;
      startLine?: number;
      endLine?: number;
    };
  },
  useColors: boolean,
): string | undefined {
  if (entry.type === "documentation_page") {
    const docHint = entry.locator.pageId
      ? `pageId=${entry.locator.pageId}`
      : entry.target;
    return dim(
      `  Full doc fetch not exposed in CLI yet (${docHint})`,
      useColors,
    );
  }

  return undefined;
}
