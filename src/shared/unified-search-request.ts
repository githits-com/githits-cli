import type {
  CodeNavigationTarget,
  SearchSymbolsFileIntent,
  SearchSymbolsKind,
  SymbolCategory,
  UnifiedSearchFilters,
  UnifiedSearchParams,
  UnifiedSearchSource,
} from "../services/index.js";
import {
  DEFAULT_WAIT_TIMEOUT_MS,
  SEARCH_SYMBOLS_DEFAULT_FILE_INTENT,
} from "./code-navigation-defaults.js";
import { InvalidArgumentError } from "./package-spec.js";

export interface UnifiedSearchRequestInput {
  target?: CodeNavigationTarget;
  targets?: CodeNavigationTarget[];
  query: string;
  sources?: UnifiedSearchSource[];
  kind?: SearchSymbolsKind;
  category?: SymbolCategory;
  pathPrefix?: string;
  fileIntent?: SearchSymbolsFileIntent;
  publicOnly?: boolean;
  name?: string;
  language?: string;
  allowPartialResults?: boolean;
  limit?: number;
  offset?: number;
  waitTimeoutMs?: number;
}

export interface UnifiedSearchRequestBuildResult {
  params: UnifiedSearchParams;
  rawQuery: string;
  compiledQuery: string;
  defaulted: ReadonlyArray<"fileIntent" | "limit" | "offset" | "waitTimeoutMs">;
}

export function buildUnifiedSearchParams(
  input: UnifiedSearchRequestInput,
): UnifiedSearchRequestBuildResult {
  const targets = resolveTargets(input.target, input.targets);
  const rawQuery = normaliseRequiredQuery(input.query);
  const defaulted: Array<"fileIntent" | "limit" | "offset" | "waitTimeoutMs"> =
    [];

  const limit = resolveNumber(input.limit, 20, "limit", defaulted);
  const offset = resolveNumber(input.offset, 0, "offset", defaulted);
  const waitTimeoutMs = resolveNumber(
    input.waitTimeoutMs,
    DEFAULT_WAIT_TIMEOUT_MS,
    "waitTimeoutMs",
    defaulted,
  );

  const qualifierClauses = buildQualifierClauses({
    name: input.name,
    language: input.language,
  });
  const compiledQuery = compileQuery(rawQuery, qualifierClauses);

  const filters = buildFilters({
    kind: input.kind,
    category: input.category,
    pathPrefix: input.pathPrefix,
    fileIntent: resolveFileIntent(input.fileIntent, defaulted),
    publicOnly: input.publicOnly,
  });

  return {
    params: {
      targets,
      query: compiledQuery,
      sources: input.sources,
      filters,
      allowPartialResults: input.allowPartialResults,
      limit,
      offset,
      waitTimeoutMs,
    },
    rawQuery,
    compiledQuery,
    defaulted,
  };
}

function resolveTargets(
  target: CodeNavigationTarget | undefined,
  targets: CodeNavigationTarget[] | undefined,
): CodeNavigationTarget[] {
  if (target && targets) {
    throw new InvalidArgumentError(
      "Provide either target or targets, not both.",
    );
  }

  const resolved = target ? [target] : (targets ?? []);
  if (resolved.length === 0) {
    throw new InvalidArgumentError("At least one target is required.");
  }

  const deduped: CodeNavigationTarget[] = [];
  const seen = new Set<string>();
  for (const entry of resolved) {
    const key = JSON.stringify(entry);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(entry);
  }

  const hasPackageTarget = deduped.some((entry) => entry.packageName);
  const hasRepoTarget = deduped.some((entry) => entry.repoUrl);
  if (hasPackageTarget && hasRepoTarget) {
    throw new InvalidArgumentError(
      "Do not mix package-scoped and repo-scoped targets in one search.",
    );
  }

  return deduped;
}

function normaliseRequiredQuery(query: string): string {
  const trimmed = query.trim();
  if (trimmed.length === 0) {
    throw new InvalidArgumentError("Query cannot be empty.");
  }
  return trimmed;
}

function resolveNumber(
  value: number | undefined,
  fallback: number,
  field: "limit" | "offset" | "waitTimeoutMs",
  defaulted: Array<"fileIntent" | "limit" | "offset" | "waitTimeoutMs">,
): number {
  if (value === undefined) {
    defaulted.push(field);
    return fallback;
  }
  return value;
}

function resolveFileIntent(
  value: SearchSymbolsFileIntent | undefined,
  defaulted: Array<"fileIntent" | "limit" | "offset" | "waitTimeoutMs">,
): SearchSymbolsFileIntent {
  if (value === undefined) {
    defaulted.push("fileIntent");
    return SEARCH_SYMBOLS_DEFAULT_FILE_INTENT;
  }

  return value;
}

function buildQualifierClauses(input: {
  name?: string;
  language?: string;
}): string[] {
  const clauses: string[] = [];

  if (input.name) {
    clauses.push(`name:${quoteQualifierValue(input.name)}`);
  }
  if (input.language) {
    clauses.push(`lang:${quoteQualifierValue(input.language)}`);
  }

  return clauses;
}

function quoteQualifierValue(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new InvalidArgumentError(
      "Structured qualifier values cannot be empty.",
    );
  }

  if (!needsQuoting(trimmed)) {
    return trimmed;
  }

  return `"${trimmed.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function needsQuoting(value: string): boolean {
  return /\s|[():"]|\bAND\b|\bOR\b|-/.test(value);
}

function compileQuery(rawQuery: string, qualifierClauses: string[]): string {
  if (qualifierClauses.length === 0) {
    return rawQuery;
  }

  return `(${rawQuery}) AND (${qualifierClauses.join(" AND ")})`;
}

function buildFilters(input: {
  kind?: SearchSymbolsKind;
  category?: SymbolCategory;
  pathPrefix?: string;
  fileIntent?: SearchSymbolsFileIntent;
  publicOnly?: boolean;
}): UnifiedSearchFilters | undefined {
  const filters: UnifiedSearchFilters = {};

  if (input.kind) filters.kind = input.kind;
  if (input.category) filters.category = input.category;
  if (input.pathPrefix) filters.pathPrefix = input.pathPrefix;
  if (input.fileIntent) filters.fileIntent = input.fileIntent;
  if (typeof input.publicOnly === "boolean") {
    filters.publicOnly = input.publicOnly;
  }

  return Object.keys(filters).length > 0 ? filters : undefined;
}
