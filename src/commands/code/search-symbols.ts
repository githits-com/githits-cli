import type { Command } from "commander";
import { createContainer } from "../../container.js";
import type {
  CodeNavigationService,
  SearchSymbolsResult,
  SearchSymbolsResultEntry,
} from "../../services/index.js";
import {
  AuthRequiredError,
  buildSearchSymbolsErrorPayload,
  buildSearchSymbolsParams,
  buildSearchSymbolsSuccessPayload,
  FILE_INTENT_ALL,
  type FileIntentInput,
  InvalidArgumentError,
  knownSymbolCategoryList,
  knownSymbolKindList,
  mapCodeNavigationError,
  normaliseKeywords,
  parsePackageSpec,
  requireAuth,
  type SearchSymbolsSuccessPayload,
  toCodeNavigationRegistry,
  toSearchSymbolsFileIntent,
  toSearchSymbolsKind,
  toSearchSymbolsMatchMode,
  toSymbolCategory,
} from "../../shared/index.js";

export interface SearchSymbolsCommandOptions {
  kind?: string;
  category?: string;
  limit?: string;
  keywords?: string;
  keyword?: string[]; // repeatable
  matchMode?: string;
  file?: string;
  intent?: string;
  wait?: string;
  json?: boolean;
}

export interface SearchSymbolsCommandDependencies {
  codeNavigationService: CodeNavigationService | undefined;
  codeNavigationUrl: string | undefined;
  hasValidToken: boolean;
  mcpUrl: string;
}

/**
 * Core code navigation search command logic.
 */
export async function searchSymbolsAction(
  packageArg: string,
  query: string | undefined,
  options: SearchSymbolsCommandOptions,
  deps: SearchSymbolsCommandDependencies,
): Promise<void> {
  requireAuth(deps);

  try {
    if (!deps.codeNavigationUrl || !deps.codeNavigationService) {
      throw new InvalidArgumentError(
        "Code navigation is not configured for this environment.",
      );
    }

    const keywords = normaliseKeywords(options.keywords, options.keyword);
    if (!query && keywords.length === 0) {
      throw new InvalidArgumentError(
        "Provide a query argument, or pass keywords via --keywords or repeated --keyword.",
      );
    }

    const parsed = parsePackageSpec(packageArg);

    const { params, defaulted } = buildSearchSymbolsParams({
      target: {
        registry: toCodeNavigationRegistry(parsed.registry),
        packageName: parsed.name,
        version: parsed.version,
      },
      query,
      keywords: keywords.length > 0 ? keywords : undefined,
      matchMode: parseMatchMode(options.matchMode),
      kind: parseKind(options.kind),
      category: parseCategory(options.category),
      filePath: options.file,
      limit: parseOptionalInt(options.limit, "--limit", 1, 50),
      fileIntent: parseIntent(options.intent),
      waitTimeoutMs: parseWaitSeconds(options.wait),
    });

    const result = await deps.codeNavigationService.searchSymbols(params);
    const payload = buildSearchSymbolsSuccessPayload(params, defaulted, result);

    if (options.json) {
      console.log(JSON.stringify(payload));
      return;
    }

    console.log(
      formatSearchSymbolsTerminal(
        payload,
        parsed.registry,
        parsed.name,
        parsed.version,
        query,
      ),
    );
  } catch (error) {
    handleSearchSymbolsCommandError(error, options.json ?? false);
  }
}

const SEARCH_SYMBOLS_DESCRIPTION = `Find functions, classes, modules, and doc sections inside an indexed dependency by exact-token search. This is for symbol-shaped inspection, not natural-language example search.

Package spec: <registry>:<name>[@<version>]. Omit the registry to default to
npm. Supported registries: npm, pypi, hex, crates, nuget, maven, zig, vcpkg,
packagist.

Filter by --category (broad: callable, type, module, data, documentation)
or --kind (precise: function, method, class, trait, …). Prefer --category
for most use cases; reach for --kind when you need a specific construct.

Default file intent is production source. Pass --intent all to include tests,
examples, benchmarks, generated files, and other non-production code.

Examples:
  githits code search npm:express middleware
  githits code search npm:express middleware --intent all
  githits code search pypi:requests timeout --category callable --limit 10
  githits code search crates:serde Serialize --kind trait --limit 5
  githits code search npm:@types/node Buffer --file src/ --json
  githits code search npm:express --keywords "router,handler" --match-mode and`;

/**
 * Register the `code search` command. `search-symbols` is kept as an
 * alias for continuity but is not the primary surface.
 */
export function registerCodeSearchSymbolsCommand(program: Command) {
  program
    .command("search <package> [query]")
    .alias("search-symbols")
    .summary("Search indexed package code")
    .description(SEARCH_SYMBOLS_DESCRIPTION)
    .option(
      "--category <category>",
      "Filter by broad symbol category: callable, type, module, data, documentation. Preferred over --kind for most use cases.",
    )
    .option(
      "--kind <kind>",
      "Filter by precise symbol kind (function, method, constructor, getter, setter, class, interface, trait, struct, enum, record, module, namespace, property, event, etc.). Prefer --category for broad filtering.",
    )
    .option("--limit <n>", "Max results (1-50; default: 25)")
    .option(
      "--keywords <words>",
      "Comma-separated keywords (alternative to the query argument)",
    )
    .option(
      "--keyword <word>",
      "Single keyword (repeatable; combines with --keywords)",
      collectRepeatable,
      [] as string[],
    )
    .option(
      "--match-mode <mode>",
      "How to combine keywords: or (any match) or and (all match)",
    )
    .option("--file <prefix>", "Filter to files matching path prefix")
    .option(
      "--intent <intent>",
      "File intent filter (production, test, benchmark, example, generated, fixture, build, vendor, all). Default: production.",
    )
    .option(
      "--wait <seconds>",
      "Max seconds to wait for indexing (0-60; default: 20). Accepts `10` or `10s`. Indexing usually completes within 30 seconds; pass `--wait 60` to block on a first-time request.",
    )
    .option("--json", "Output as JSON")
    .action(
      async (
        packageArg: string,
        query: string | undefined,
        options: SearchSymbolsCommandOptions,
      ) => {
        try {
          const deps = await createContainer();
          await searchSymbolsAction(packageArg, query, options, deps);
        } catch (error) {
          if (error instanceof AuthRequiredError) {
            process.exit(1);
          }
          throw error;
        }
      },
    );
}

function collectRepeatable(value: string, previous: string[]): string[] {
  return [...previous, value];
}

/**
 * Terminal formatter. Uses the DETAILED-mode response fields: every
 * entry leads with `filePath:startLine-endLine  [kind]`, followed by
 * the symbol name (when present) and a 3-line dedented snippet taken
 * from `code`. Preserves indentation — does NOT collapse whitespace.
 */
function formatSearchSymbolsTerminal(
  payload: SearchSymbolsSuccessPayload,
  registry: string,
  packageName: string,
  version: string | undefined,
  query: string | undefined,
): string {
  const lines: string[] = [];

  if (payload.warning) {
    lines.push(`Warning: ${payload.warning}`);
    lines.push("");
  }

  lines.push(formatHeader(payload));
  lines.push("");

  if (payload.results.length === 0) {
    lines.push(
      formatZeroResultMessage(
        query,
        registry,
        packageName,
        version,
        payload.query,
        payload.hint,
      ),
    );
    return lines.join("\n").trimEnd();
  }

  for (const entry of payload.results) {
    lines.push(...formatEntry(entry));
    lines.push("");
  }

  if (payload.hint) {
    lines.push(`Note: ${payload.hint}`);
  }

  return lines.join("\n").trimEnd();
}

function formatHeader(payload: SearchSymbolsSuccessPayload): string {
  // `totalMatches` currently tracks `results.length` on the backend
  // (see backend request B2). Until a real total is available, say
  // "N match(es) (more available)" rather than lying with "of N".
  let summary = `${payload.returnedCount} match(es)`;
  if (payload.hasMore) summary += " (more available)";

  if (payload.version) {
    summary += ` · indexed ${displayVersion(payload.version)}`;
    const requested =
      payload.resolution?.requestedVersion ?? payload.resolution?.requestedRef;
    if (
      requested &&
      !isTrivialRefDifference(requested, payload.version) &&
      !isTrivialRefDifference(requested, payload.resolution?.resolvedRef)
    ) {
      summary += ` (requested ${requested})`;
    }
  }

  return summary;
}

/**
 * Shorten long refs (commit SHAs) to an abbreviated form for display,
 * preserve tag-style versions unchanged.
 */
function displayVersion(version: string): string {
  // 40-char hex is a full SHA; truncate to 7.
  if (/^[0-9a-f]{40}$/i.test(version)) return version.slice(0, 7);
  return version;
}

/**
 * Suppress the "(requested X)" annotation when the only difference
 * between the caller's ref and the resolved/indexed ref is a leading
 * `v` prefix (backend normalisation). Users asking for `2.32.3` who
 * got `v2.32.3` back should not be told they got a different version.
 */
function isTrivialRefDifference(
  requested: string,
  resolved: string | undefined,
): boolean {
  if (!resolved) return false;
  if (requested === resolved) return true;
  const stripV = (v: string) => (v.startsWith("v") ? v.slice(1) : v);
  return stripV(requested) === stripV(resolved);
}

function formatEntry(entry: SearchSymbolsResultEntry): string[] {
  const out: string[] = [];
  const locationParts: string[] = [];

  if (entry.filePath) {
    if (entry.startLine) {
      locationParts.push(
        entry.endLine && entry.endLine !== entry.startLine
          ? `${entry.filePath}:${entry.startLine}-${entry.endLine}`
          : `${entry.filePath}:${entry.startLine}`,
      );
    } else {
      locationParts.push(entry.filePath);
    }
  }

  const kindLabel = resolveKindLabel(entry);
  if (kindLabel) locationParts.push(`[${kindLabel}]`);

  out.push(
    locationParts.length > 0 ? locationParts.join("  ") : "unnamed match",
  );

  if (entry.name) out.push(`  ${entry.name}`);

  const snippet = buildSnippet(entry.code);
  for (const snippetLine of snippet) out.push(snippetLine);

  return out;
}

/**
 * Resolve the bracketed kind label shown at the end of the first
 * per-entry line. The backend populates `kind` for every chunk
 * (handling its own fallback from chunk-level classification to
 * symbol-enrichment kind internally), so the client reads a single
 * source of truth.
 *
 * The literal `"fallback"` label is suppressed — backend emits it
 * for unclassified chunks where no taxonomy hit, and showing it to
 * the user adds noise without signal.
 */
function resolveKindLabel(entry: SearchSymbolsResultEntry): string | undefined {
  if (!entry.kind) return undefined;
  const normalised = entry.kind.toLowerCase();
  if (normalised === "fallback") return undefined;
  return normalised;
}

/**
 * Produce a short, indented, dedented snippet from the `code` field.
 * The backend exposes `preview` in DETAILED mode, but the formatter
 * owns snippet rendering client-side so we can control the truncation
 * length and preserve indentation consistently.
 */
function buildSnippet(code: string | undefined, maxLines = 3): string[] {
  if (!code) return [];

  const raw = code.split("\n");
  // Trim surrounding blank lines to avoid an empty first/last line in
  // the snippet.
  while (raw.length > 0 && raw[0]?.trim() === "") raw.shift();
  while (raw.length > 0 && raw[raw.length - 1]?.trim() === "") raw.pop();
  if (raw.length === 0) return [];

  const indent = commonLeadingIndent(raw);
  const dedented = raw.map((line) => (indent > 0 ? line.slice(indent) : line));
  const truncated = dedented.length > maxLines;
  const selected = dedented.slice(0, maxLines);
  const visible = truncated ? [...selected, "…"] : selected;
  return visible.map((line) => `    ${line}`);
}

function commonLeadingIndent(lines: string[]): number {
  let min = Number.POSITIVE_INFINITY;
  for (const line of lines) {
    if (line.trim() === "") continue;
    const match = line.match(/^(\s*)/);
    const len = match?.[1]?.length ?? 0;
    if (len < min) min = len;
  }
  return Number.isFinite(min) ? min : 0;
}

function formatZeroResultMessage(
  query: string | undefined,
  registry: string,
  packageName: string,
  version: string | undefined,
  echo: SearchSymbolsSuccessPayload["query"],
  serverHint: string | undefined,
): string {
  const target = version
    ? `${registry}:${packageName}@${version}`
    : `${registry}:${packageName}`;
  const queryText = query ? `"${query}"` : "the given keywords";
  const header = `No matches for ${queryText} in ${target}.`;

  // Prefer the server hint when present — the April 2026 backend
  // rewrite made zero-result hints accurate (chunk/file counts,
  // docs-only guidance). Fall back to the client-side suggestion
  // list built from the filters the caller actually applied.
  if (serverHint) {
    return [header, serverHint].join("\n");
  }

  const suggestions: string[] = [];
  if (echo.kind) suggestions.push("drop --kind");
  if (echo.category) suggestions.push("drop --category");
  if (echo.filePath) suggestions.push("broaden or remove --file");
  if (echo.fileIntent !== "all") suggestions.push("try --intent all");
  if (echo.matchMode === "and") suggestions.push("try --match-mode or");
  suggestions.push("try broader keywords");

  return [header, `Try: ${suggestions.join(", ")}.`].join("\n");
}

function handleSearchSymbolsCommandError(error: unknown, json: boolean): never {
  if (json) {
    console.error(JSON.stringify(buildSearchSymbolsErrorPayload(error)));
    process.exit(1);
  }

  const mapped = mapCodeNavigationError(error);
  console.error(`Failed to search symbols: ${mapped.message}`);
  process.exit(1);
}

function parseOptionalInt(
  value: string | undefined,
  optionName: string,
  min: number,
  max: number,
): number | undefined {
  if (value === undefined) return undefined;

  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < min || parsed > max) {
    throw new InvalidArgumentError(
      `${optionName} must be a number between ${min} and ${max}`,
    );
  }

  return parsed;
}

function parseMatchMode(value: string | undefined) {
  if (!value) return undefined;
  const parsed = toSearchSymbolsMatchMode(value.toLowerCase());
  if (!parsed) {
    throw new InvalidArgumentError("--match-mode must be 'or' or 'and'");
  }
  return parsed;
}

function parseKind(value: string | undefined) {
  if (!value) return undefined;
  const parsed = toSearchSymbolsKind(value.toLowerCase());
  if (!parsed) {
    throw new InvalidArgumentError(
      `--kind must be one of ${knownSymbolKindList().join(", ")}`,
    );
  }
  return parsed;
}

function parseCategory(value: string | undefined) {
  if (!value) return undefined;
  const parsed = toSymbolCategory(value.toLowerCase());
  if (!parsed) {
    throw new InvalidArgumentError(
      `--category must be one of ${knownSymbolCategoryList().join(", ")}`,
    );
  }
  return parsed;
}

function parseIntent(value: string | undefined): FileIntentInput {
  if (value === undefined) return undefined;
  const lower = value.toLowerCase();
  if (lower === "all") return FILE_INTENT_ALL;
  const parsed = toSearchSymbolsFileIntent(lower);
  if (!parsed) {
    throw new InvalidArgumentError(
      "--intent must be one of production, test, benchmark, example, generated, fixture, build, vendor, or all",
    );
  }
  return parsed;
}

/**
 * Parse the `--wait` flag as a seconds value, internally converting to
 * milliseconds for the service layer. Accepts `10` or `10s`. Rejects
 * negative values, non-numeric input, and values beyond the 60-second
 * cap.
 */
function parseWaitSeconds(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  const withoutSuffix = trimmed.endsWith("s") ? trimmed.slice(0, -1) : trimmed;
  if (trimmed.endsWith("ms")) {
    throw new InvalidArgumentError(
      "--wait is specified in seconds (e.g. `10` or `10s`), not milliseconds.",
    );
  }
  const parsed = Number.parseInt(withoutSuffix, 10);
  if (
    Number.isNaN(parsed) ||
    parsed < 0 ||
    parsed > 60 ||
    withoutSuffix !== String(parsed)
  ) {
    throw new InvalidArgumentError(
      "--wait must be a number of seconds between 0 and 60 (e.g. `10` or `10s`).",
    );
  }
  return parsed * 1000;
}

// The `SearchSymbolsResult` type is imported above; retained so
// ambient TS modules that reference it through this file still work.
export type { SearchSymbolsResult };
