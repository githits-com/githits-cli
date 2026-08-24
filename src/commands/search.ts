import type {
  CodeNavigationService,
  UnifiedSearchSource,
} from "@githits/core-internal";
import {
  appendDocumentationSources,
  appendEmptySearchGuidance,
  buildUnifiedSearchErrorPayload,
  buildUnifiedSearchParams,
  buildUnifiedSearchStatusPayload,
  buildUnifiedSearchSuccessPayload,
  DEFAULT_WAIT_TIMEOUT_MS,
  dim,
  formatProgressTarget,
  formatSuggestedSiteTargetGuidance,
  highlight,
  highlightMatch,
  highlightRanges,
  InvalidArgumentError,
  isActiveUnifiedSearchSessionStatus,
  knownSymbolCategoryList,
  knownSymbolKindList,
  type LeanTargetResolution,
  MAX_WAIT_TIMEOUT_MS,
  type MappedError,
  parseUnifiedSearchTargetSpec,
  requireAuth,
  shouldUseColors,
  toFileIntent,
  toSymbolCategory,
  toSymbolKind,
  type UnifiedSearchSourceStatusPayload,
  type UnifiedSearchStatusIncompletePayload,
  type UnifiedSearchStatusResultPayload,
} from "@githits/mcp/internal";
import { type Command, Option } from "commander";
import { parseIntCliOption } from "../shared/cli-options.js";
import { startSpinner } from "../shared/spinner.js";
import { SPINNER_MESSAGES } from "../shared/spinner-messages.js";
import { formatIndexingError } from "./code/code-nav-cli-helpers.js";
import { formatMappedErrorForTerminal } from "./format-mapped-error.js";

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
      console.log(JSON.stringify(payload));
      return;
    }

    console.log(
      formatUnifiedSearchTerminal(payload, {
        includeCompletedSearchRefFollowUp: true,
      }),
    );
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
        console.log(formatSearchStatusTerminal(payload, payload.warnings));
      }
      return;
    }

    console.log(formatSearchStatusCompletedTerminal(payload));
  } catch (error) {
    handleSearchError(error, options.json ?? false, "status");
  }
}

const SEARCH_DESCRIPTION = `Search code, docs, and symbols across indexed dependencies, repositories, and documentation sites.

Repeatable --in targets accept explicit package form (registry:name[@version],
for example npm:express[@version]) or repo form (github:org/repo[#ref|@ref],
github.com/org/repo[#ref|@ref], or https://github.com/org/repo[#ref|@ref]),
or an exact documentation site as site:<host[/path]>. Missing or
ambiguous sites may return advisory site targets to retry explicitly.
Output uses canonical github:org/repo#ref formatting. Structured flags are
AND-combined with the query. Complete by default. Active PENDING, INDEXING, or
SEARCHING progress returns a searchRef. Active progress may include
stale-but-serveable evidence. Follow an explicit \`githits search-status\`
action emitted for that active reference or for a completed result with an
evidence notice. DEFERRED, TIMEOUT, and FAILED are terminal; unrecognized
statuses are not polled. Preserve any disclosed evidence, then run a new search
later for a fresher snapshot. Missing or ambiguous sites instead provide
terminal recovery guidance without a searchRef. Use \`githits example\` for
canonical cross-project examples; \`--source symbol\`
here returns symbol-shaped hits.

The query supports implicit AND, uppercase OR, parens, unary -, "phrases",
and qualifiers (kind:, category:, path:, lang:, name:, intent:, registry:,
package:, version:, repo:).

Examples:
  githits search "router middleware" --in npm:express
  githits search "routing" --in site:expressjs.com --source docs
  githits search '"body parser" OR multer' --in npm:express --source docs
  githits search "compose" --in npm:lodash --source code --kind function
  githits search "debounce" --in npm:lodash --source symbol
  githits search "composeArgs" --in npm:lodash --name composeArgs`;

const SEARCH_STATUS_DESCRIPTION = `Check the status of a unified search started earlier.

Pass the searchRef only when githits search explicitly supplies this follow-up,
including for active PENDING, INDEXING, or SEARCHING progress or a completed
result with an evidence notice. This can return progress, interim hits covering
every runnable target/source pair while refresh continues, partial hits from a
serveable subset when the original request used --allow-partial, or final
results. DEFERRED, TIMEOUT, and FAILED are terminal; unrecognized statuses are
not polled. By default the command waits up to 20 seconds for progress before
returning the latest status.`;

export function registerSearchCommand(program: Command) {
  program
    .command("search")
    .summary("Explore repository code, dependencies, docs and symbols")
    .description(SEARCH_DESCRIPTION)
    .argument("<query>", "Search query")
    .requiredOption(
      "--in <target>",
      "Search target: registry:name[@version], github:org/repo[#ref|@ref], github.com/org/repo[#ref|@ref], https://github.com/org/repo[#ref|@ref], or site:<host[/path]>",
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
    .option("--path-prefix <prefix>", "Repository path prefix filter")
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
      "Permit a serveable subset of target/source pairs while others remain unavailable; a searchRef is still returned for continuation",
    )
    .option("--limit <n>", "Max results (1-100, default: 10)")
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
    .summary("Check the status of a previous search")
    .description(SEARCH_STATUS_DESCRIPTION)
    .argument("<search-ref>", "Search reference returned by githits search")
    .option(
      "--wait <seconds>",
      "Max seconds to wait for progress (0-60; default: 20)",
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
  if (value === undefined) return undefined;
  const match = /^(?<seconds>-?\d+)s?$/i.exec(value.trim());
  if (!match?.groups?.seconds) {
    throw new InvalidArgumentError(
      "--wait must be an integer between 0 and 60 seconds.",
    );
  }
  const seconds = parseIntCliOption(
    match.groups.seconds,
    "--wait",
    0,
    MAX_WAIT_TIMEOUT_MS / 1000,
  );
  if (seconds === undefined) return undefined;
  return seconds * 1000;
}

function collectRepeatable(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function handleSearchError(
  error: unknown,
  json: boolean,
  context: "search" | "status" = "search",
): never {
  const payload = buildUnifiedSearchErrorPayload(error);

  if (json) {
    console.error(JSON.stringify(payload));
  } else {
    console.error(formatSearchErrorTerminal(payload, context));
  }
  process.exit(1);
}

function formatSearchErrorTerminal(
  payload: {
    error: string;
    code: string;
    retryable?: boolean;
    details?: Record<string, unknown>;
  },
  context: "search" | "status",
): string {
  const mapped: MappedError = {
    code: payload.code as MappedError["code"],
    message: payload.error,
    retryable: payload.retryable,
    details: payload.details as MappedError["details"],
  };
  if (payload.code === "AUTH_REQUIRED") {
    return formatMappedErrorForTerminal(mapped);
  }
  if (payload.code === "INDEXING") {
    return formatIndexingError(mapped);
  }
  const formatted = formatMappedErrorForTerminal(mapped);
  if (context === "status" && payload.code === "NOT_FOUND") {
    return `${formatted}\n  Search sessions expire; run \`githits search ...\` to start a new one.`;
  }
  return formatted;
}

function formatUnifiedSearchTerminal(
  payload: {
    completed: boolean;
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
        requestedRef?: string;
        pageId?: string;
        sourceKind?: string;
        sourceUrl?: string;
        filePath?: string;
        startLine?: number;
        endLine?: number;
      };
    }>;
    searchRef?: string;
    progress?: SearchProgressForTerminal;
    query: { raw?: string; warnings?: string[] };
    warnings?: string[];
    sourceStatus?: SourceStatusEntry[];
    evidenceNotice?: string;
  },
  options: { includeCompletedSearchRefFollowUp?: boolean } = {},
): string {
  const lines: string[] = [];
  const useColors = shouldUseColors();

  const warnings = payload.warnings ?? payload.query.warnings;
  if (warnings && warnings.length > 0) {
    for (const warning of warnings) {
      lines.push(`Warning: ${warning}`);
    }
    lines.push("");
  }

  const sourceStatusNotes = formatSourceStatusNotes(
    payload.sourceStatus,
    warnings,
    payload.completed,
    payload.progress?.status,
  );
  const documentationSourceNotes = formatDocumentationSourcesTerminal(
    payload.sourceStatus,
    payload.results,
  );
  const evidenceNotes = payload.evidenceNotice
    ? [`Evidence notice: ${payload.evidenceNotice}`]
    : [];
  if (
    options.includeCompletedSearchRefFollowUp &&
    payload.completed &&
    payload.evidenceNotice &&
    payload.searchRef
  ) {
    evidenceNotes.push(
      `next: githits search-status ${payload.searchRef} --wait ${DEFAULT_WAIT_TIMEOUT_MS / 1000}`,
    );
  }
  const provenanceNotes = [...sourceStatusNotes, ...evidenceNotes];
  const emptyResultNotes = [
    ...sourceStatusNotes,
    ...documentationSourceNotes,
    ...evidenceNotes,
  ];

  if (!payload.completed) {
    const statusText = formatSearchStatusTerminal({
      completed: false,
      searchRef: payload.searchRef ?? "",
      progress: payload.progress,
    });
    lines.push(statusText);
    if (payload.results.length === 0) {
      if (emptyResultNotes.length > 0) {
        lines.push("");
        lines.push(...emptyResultNotes);
      }
      return lines.join("\n").trimEnd();
    }
    lines.push("");
    lines.push("Partial results:");
  }

  if (payload.results.length === 0) {
    appendEmptySearchGuidance(lines, {
      sourceStatus: payload.sourceStatus,
      evidenceNotice: payload.evidenceNotice,
      guidanceStyle: "cli",
      fallbackHeadline: "No results.",
    });
    if (emptyResultNotes.length > 0) {
      lines.push("");
      lines.push(...emptyResultNotes);
    }
    return lines.join("\n").trimEnd();
  }

  const { display, duplicatesFolded } = dedupeSearchResultsForDisplay(
    payload.results,
  );

  const baseCount = `${display.length} result${display.length === 1 ? "" : "s"}`;
  const countSuffix = [
    payload.hasMore ? " (more available)" : "",
    duplicatesFolded > 0 ? ` (+${duplicatesFolded} near-duplicate folded)` : "",
  ].join("");
  const typeSummary = formatUnifiedSearchTypeSummary(display);
  lines.push(
    `${highlight(baseCount, useColors)}${dim(countSuffix, useColors)}${typeSummary ? dim(` | ${typeSummary}`, useColors) : ""}`,
  );
  if (documentationSourceNotes.length > 0) {
    lines.push(...documentationSourceNotes);
  }
  lines.push("");

  for (const entry of display) {
    const location = formatUnifiedSearchLocation(entry.locator);
    const header = formatUnifiedSearchHeader(
      entry,
      useColors,
      location,
      payload.query.raw,
    );
    lines.push(header);
    const metadata = formatUnifiedSearchMetadata(entry, useColors);
    if (metadata.length > 0) {
      lines.push(...metadata);
    }
    if (entry.summary) {
      lines.push(
        ...formatUnifiedSearchSummary(
          entry.summary,
          entry.highlights?.summary,
          useColors,
        ),
      );
    }
    lines.push("");
  }

  if (payload.nextOffset !== undefined) {
    lines.push(dim(`Next offset: ${payload.nextOffset}`, useColors));
  }

  if (provenanceNotes.length > 0) {
    lines.push("");
    lines.push(...provenanceNotes);
  }

  return lines.join("\n").trimEnd();
}

function formatSearchStatusTerminal(
  payload: {
    completed: false;
    searchRef: string;
    progress?: SearchProgressForTerminal;
  },
  warnings?: string[],
): string {
  const status = payload.progress?.status;
  const lines: string[] = [];
  if (warnings && warnings.length > 0) {
    for (const warning of warnings) {
      lines.push(`Warning: ${warning}`);
    }
    lines.push("");
  }
  lines.push(formatSearchStatusHeadline(status));
  lines.push(`searchRef: ${payload.searchRef}`);
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
    if (payload.progress.targets && payload.progress.targets.length > 0) {
      lines.push("targets:");
      for (const target of payload.progress.targets) {
        lines.push(`  - ${formatProgressTarget(target)}`);
      }
    }
  }
  if (status === "TIMEOUT") {
    lines.push("This search session is terminal. Start a new search.");
    return lines.join("\n");
  }
  if (status === "DEFERRED") {
    lines.push(
      "Background lifecycle work continues outside this search session.",
    );
    lines.push(
      "Use any disclosed evidence now. Start a new search later for a fresher snapshot.",
    );
    return lines.join("\n");
  }
  if (status === "FAILED") {
    lines.push(
      "Search failed. Start a new search or inspect backend errors if the failure persists.",
    );
    return lines.join("\n");
  }
  if (status !== undefined && !isActiveUnifiedSearchSessionStatus(status)) {
    lines.push("This client does not recognize that status.");
    lines.push("Use any disclosed evidence now. Start a new search later.");
    return lines.join("\n");
  }
  lines.push(
    `next: githits search-status ${payload.searchRef} --wait ${DEFAULT_WAIT_TIMEOUT_MS / 1000}`,
  );
  return lines.join("\n");
}

function formatSearchStatusHeadline(status: string | undefined): string {
  switch (status) {
    case "PENDING":
    case "INDEXING":
    case "SEARCHING":
      return "Indexing/search still in progress.";
    case "DEFERRED":
      return "Search deferred.";
    case "TIMEOUT":
      return "Search timed out.";
    case "FAILED":
      return "Search failed.";
    default:
      return status
        ? `Search status is not recognized: ${status}.`
        : "Search still in progress.";
  }
}

function formatSearchStatusCompletedTerminal(payload: {
  completed: true;
  searchRef?: string;
  result: UnifiedSearchStatusResultPayload;
}): string {
  return formatUnifiedSearchTerminal({
    completed: true,
    hasMore: payload.result.hasMore,
    nextOffset: payload.result.nextOffset,
    results: payload.result.results,
    searchRef: payload.searchRef,
    progress: undefined,
    query: {
      raw: payload.result.query?.raw,
      warnings: payload.result.warnings,
    },
    warnings: payload.result.warnings,
    sourceStatus: payload.result.sourceStatus,
    evidenceNotice: payload.result.evidenceNotice,
  });
}

function formatSearchStatusPartialTerminal(
  payload: UnifiedSearchStatusIncompletePayload & {
    result: UnifiedSearchStatusResultPayload;
  },
): string {
  const warnings = Array.from(
    new Set([...(payload.warnings ?? []), ...(payload.result.warnings ?? [])]),
  );
  return formatUnifiedSearchTerminal({
    completed: false,
    hasMore: payload.result.hasMore,
    nextOffset: payload.result.nextOffset,
    results: payload.result.results,
    searchRef: payload.searchRef,
    progress: payload.progress,
    query: {
      raw: payload.result.query?.raw,
      warnings: payload.result.warnings,
    },
    warnings: warnings.length > 0 ? warnings : undefined,
    sourceStatus: payload.result.sourceStatus,
    evidenceNotice: payload.result.evidenceNotice,
  });
}

type SourceStatusEntry = UnifiedSearchSourceStatusPayload;

interface SearchProgressForTerminal {
  targetsReady?: number;
  targetsTotal?: number;
  status?: string;
  targets?: Array<{
    requested?: string;
    resolvedRequested?: string;
    served?: string;
    freshness?: string;
    indexingRef?: string;
    requestedRefKind?: string;
    targetResolution?: LeanTargetResolution;
    availableVersions?: Array<{ version?: string; ref: string }>;
    availableRefs?: Array<{ version?: string; ref: string }>;
    suggestedRefs?: Array<{ version?: string; ref: string }>;
  }>;
}

function formatSourceStatusNotes(
  sourceStatus: SourceStatusEntry[] | undefined,
  warnings: string[] | undefined,
  completed: boolean,
  sessionStatus: string | undefined,
): string[] {
  const useColors = shouldUseColors();
  if (!sourceStatus) {
    return [];
  }

  const nonActiveIncompleteSession =
    !completed &&
    sessionStatus !== undefined &&
    !isActiveUnifiedSearchSessionStatus(sessionStatus);
  const lines: string[] = [];
  for (const entry of sourceStatus) {
    for (const guidance of formatSuggestedSiteTargetGuidance(entry)) {
      lines.push(dim(`${entry.targetLabel}: ${guidance}`, useColors));
    }
    const warningPrefix = `Source '${entry.source.toLowerCase()}' for ${entry.targetLabel}:`;
    if (warnings?.some((warning) => warning.startsWith(warningPrefix))) {
      continue;
    }
    const label = `${entry.source.toLowerCase()} on ${entry.targetLabel}`;
    if (entry.ignoredFilters && entry.ignoredFilters.length > 0) {
      lines.push(
        dim(
          `Note: ${label} ignored filters: ${entry.ignoredFilters.join(", ")}`,
          useColors,
        ),
      );
    }
    if (entry.incompatibleFilters && entry.incompatibleFilters.length > 0) {
      lines.push(
        dim(
          `Note: ${label} incompatible filters: ${entry.incompatibleFilters.join(", ")}`,
          useColors,
        ),
      );
    }
    if (entry.ignoredQueryFeatures && entry.ignoredQueryFeatures.length > 0) {
      lines.push(
        dim(
          `Note: ${label} ignored query features: ${entry.ignoredQueryFeatures.join(", ")}`,
          useColors,
        ),
      );
    }
    if (
      entry.incompatibleQueryFeatures &&
      entry.incompatibleQueryFeatures.length > 0
    ) {
      lines.push(
        dim(
          `Note: ${label} incompatible query features: ${entry.incompatibleQueryFeatures.join(", ")}`,
          useColors,
        ),
      );
    }
    if (entry.indexingStatus === "INDEXING" && !nonActiveIncompleteSession) {
      lines.push(
        dim(
          completed
            ? `Note: ${label} still indexing.`
            : `Note: ${label} still indexing — re-run with the searchRef for full results.`,
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

function formatDocumentationSourcesTerminal(
  sourceStatus: SourceStatusEntry[] | undefined,
  results: Array<{ target: string }>,
): string[] {
  const lines: string[] = [];
  appendDocumentationSources(lines, sourceStatus, results);
  const useColors = shouldUseColors();
  return lines.map((line) => {
    if (line === "") return line;
    const terminalLine =
      line.startsWith("searched") || line.startsWith("documentation sources")
        ? `${line[0]?.toUpperCase()}${line.slice(1)}`
        : line;
    return dim(terminalLine, useColors);
  });
}

function dedupeSearchResultsForDisplay<
  T extends {
    type: string;
    target: string;
    title?: string;
    summary?: string;
    locator: { pageId?: string; filePath?: string };
  },
>(results: T[]): { display: T[]; duplicatesFolded: number } {
  const seen = new Set<string>();
  const display: T[] = [];
  let duplicatesFolded = 0;
  for (const entry of results) {
    const key = [
      entry.type,
      entry.target,
      entry.title ?? "",
      (entry.summary ?? "").slice(0, 120),
    ].join("");
    const dedupeKey = `${key}\u0001${entry.locator.pageId ?? entry.locator.filePath ?? ""}`;
    if (seen.has(dedupeKey)) {
      duplicatesFolded += 1;
      continue;
    }
    seen.add(dedupeKey);
    display.push(entry);
  }
  return { display, duplicatesFolded };
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
    .join(", ");
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
  sourceUrl?: string;
}): string | undefined {
  if (!locator.filePath) {
    return locator.sourceUrl;
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
      registry?: string;
      packageName?: string;
      sourceKind?: string;
      sourceUrl?: string;
      requestedRef?: string;
      version?: string;
    };
    title?: string;
  },
  useColors: boolean,
  location: string | undefined,
  rawQuery: string | undefined,
): string {
  if (entry.type === "documentation_page") {
    return formatDocumentationPageHeader(entry, useColors);
  }

  const primary = formatUnifiedSearchPrimary(
    entry.type,
    entry.target,
    location,
    rawQuery,
    useColors,
  );
  const badge = `[${formatUnifiedSearchResultLabel(entry.type)}]`;
  const title = entry.title
    ? highlightRanges(entry.title, entry.highlights?.title, useColors)
    : undefined;
  return `${primary} ${dim(badge, useColors)}${title ? ` - ${title}` : ""}`;
}

function formatDocumentationPageHeader(
  entry: {
    target: string;
    highlights?: { title?: Array<readonly [number, number]> };
    locator: {
      pageId?: string;
      registry?: string;
      packageName?: string;
      sourceUrl?: string;
    };
    title?: string;
  },
  useColors: boolean,
): string {
  const pageId = entry.locator.pageId ?? "unknown";
  const title = entry.title
    ? highlightRanges(entry.title, entry.highlights?.title, useColors)
    : "Untitled documentation page";
  const source = entry.locator.sourceUrl
    ? ` - ${formatDisplayUrl(entry.locator.sourceUrl)}`
    : "";
  const target = formatDocsPageTarget(entry.locator, entry.target);
  return `${highlight(pageId, useColors)} ${dim("[docs page]", useColors)}${target ? ` ${dim(target, useColors)}` : ""} - ${title}${dim(source, useColors)}`;
}

function formatDisplayUrl(value: string): string {
  return value.replace(/^https?:\/\//, "");
}

function formatDocsPageTarget(
  locator: {
    registry?: string;
    packageName?: string;
    version?: string;
  },
  fallbackTarget?: string,
): string {
  return locator.registry && locator.packageName
    ? `${locator.registry}:${locator.packageName}`
    : stripVersionFromTarget(fallbackTarget);
}

function stripVersionFromTarget(value: string | undefined): string {
  if (!value) return "";
  const atIndex = value.lastIndexOf("@");
  return atIndex > 0 ? value.slice(0, atIndex) : value;
}

function formatUnifiedSearchPrimary(
  type: string,
  target: string,
  location: string | undefined,
  rawQuery: string | undefined,
  useColors: boolean,
): string {
  const formattedTarget = highlight(target, useColors);
  if (type === "documentation_page" || !location) {
    return formattedTarget;
  }

  return `${formattedTarget} ${formatLocationWithQueryHighlights(
    location,
    rawQuery,
    useColors,
  )}`;
}

function formatLocationWithQueryHighlights(
  location: string,
  rawQuery: string | undefined,
  useColors: boolean,
): string {
  const ranges = buildQueryTermRanges(location, rawQuery);
  if (ranges.length === 0) return highlight(location, useColors);
  if (!useColors) return location;

  let result = "";
  let cursor = 0;
  for (const [start, end] of ranges) {
    if (cursor < start)
      result += highlight(location.slice(cursor, start), true);
    result += highlightMatch(location.slice(start, end), true);
    cursor = end;
  }
  if (cursor < location.length)
    result += highlight(location.slice(cursor), true);
  return result;
}

function buildQueryTermRanges(
  text: string,
  rawQuery: string | undefined,
): Array<readonly [number, number]> {
  const terms = extractQueryHighlightTerms(rawQuery);
  if (terms.length === 0) return [];

  const lowerText = text.toLowerCase();
  const ranges: Array<readonly [number, number]> = [];
  const orderedTerms = [...terms].sort(
    (left, right) => right.length - left.length,
  );
  for (const term of orderedTerms) {
    const lowerTerm = term.toLowerCase();
    let cursor = 0;
    while (cursor < lowerText.length) {
      const start = lowerText.indexOf(lowerTerm, cursor);
      if (start === -1) break;
      const end = start + lowerTerm.length;
      if (!ranges.some((range) => rangesOverlap(range, [start, end]))) {
        ranges.push([start, end]);
      }
      cursor = end;
    }
  }

  return mergeRanges(ranges);
}

function extractQueryHighlightTerms(rawQuery: string | undefined): string[] {
  if (!rawQuery) return [];

  const booleanOperators = new Set(["AND", "OR", "NOT"]);
  const terms = new Set<string>();
  const quotedRanges: Array<readonly [number, number]> = [];
  // Preserve quoted phrases as a single best-effort location term so a phrase
  // query does not degrade into scattered word highlights in paths.
  for (const match of rawQuery.matchAll(/"([^"]+)"/g)) {
    const phrase = match[1];
    if (phrase) {
      addQueryHighlightTerm(phrase, terms, booleanOperators, {
        stripQualifier: false,
      });
    }
    if (typeof match.index === "number") {
      quotedRanges.push([match.index, match.index + match[0].length]);
    }
  }

  for (const match of rawQuery.matchAll(/[A-Za-z0-9_./@:-]+/g)) {
    const index = match.index ?? 0;
    if (quotedRanges.some(([start, end]) => index >= start && index < end)) {
      continue;
    }
    addQueryHighlightTerm(match[0], terms, booleanOperators);
  }

  return Array.from(terms);
}

function addQueryHighlightTerm(
  candidate: string,
  terms: Set<string>,
  booleanOperators: Set<string>,
  options: { stripQualifier: boolean } = { stripQualifier: true },
): void {
  const normalised =
    options.stripQualifier && /^[A-Za-z]+:.+/.test(candidate)
      ? candidate.split(":").slice(1).join(":")
      : candidate;
  const term = normalised.replace(/^[-+]+/, "").replace(/[-+]+$/, "");
  if (term.length < 2) return;
  if (booleanOperators.has(term.toUpperCase())) return;
  terms.add(term);
}

function rangesOverlap(
  left: readonly [number, number],
  right: readonly [number, number],
): boolean {
  return left[0] < right[1] && right[0] < left[1];
}

function mergeRanges(
  ranges: Array<readonly [number, number]>,
): Array<readonly [number, number]> {
  const sorted = ranges
    .filter(([start, end]) => end > start)
    .sort((left, right) => left[0] - right[0] || left[1] - right[1]);
  const merged: Array<readonly [number, number]> = [];
  for (const current of sorted) {
    const previous = merged[merged.length - 1];
    if (!previous || current[0] > previous[1]) {
      merged.push(current);
      continue;
    }
    merged[merged.length - 1] = [
      previous[0],
      Math.max(previous[1], current[1]),
    ];
  }
  return merged;
}

function formatUnifiedSearchMetadata(
  entry: {
    type: string;
    locator: {
      pageId?: string;
      sourceKind?: string;
      sourceUrl?: string;
    };
  },
  _useColors: boolean,
): string[] {
  if (entry.type !== "documentation_page" && entry.type !== "repository_doc") {
    return [];
  }

  const lines: string[] = [];
  if (entry.type === "documentation_page") {
    return lines;
  }

  return lines;
}
