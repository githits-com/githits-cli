import type {
  CodeNavigationTarget,
  FileIntent,
  SymbolCategory,
  SymbolKind,
  UnifiedSearchFilters,
  UnifiedSearchParams,
  UnifiedSearchSource,
} from "../services/index.js";
import { DEFAULT_WAIT_TIMEOUT_MS } from "./code-navigation-defaults.js";
import { InvalidArgumentError } from "./package-spec.js";

export const DEFAULT_UNIFIED_SEARCH_LIMIT = 10;

export interface UnifiedSearchRequestInput {
  target?: CodeNavigationTarget;
  targets?: CodeNavigationTarget[];
  query: string;
  sources?: UnifiedSearchSource[];
  kind?: SymbolKind;
  category?: SymbolCategory;
  pathPrefix?: string;
  fileIntent?: FileIntent;
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
}

export function buildUnifiedSearchParams(
  input: UnifiedSearchRequestInput,
): UnifiedSearchRequestBuildResult {
  const targets = resolveTargets(input.target, input.targets);
  const rawQuery = normaliseRequiredQuery(input.query);

  const limit = input.limit ?? DEFAULT_UNIFIED_SEARCH_LIMIT;
  const offset = input.offset ?? 0;
  const waitTimeoutMs = input.waitTimeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;

  const qualifierClauses = buildQualifierClauses({
    name: input.name,
    language: input.language,
  });
  const compiledQuery = compileQuery(rawQuery, qualifierClauses);

  const filters = buildFilters({
    kind: input.kind,
    category: input.category,
    pathPrefix: input.pathPrefix,
    fileIntent: input.fileIntent,
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
  kind?: SymbolKind;
  category?: SymbolCategory;
  pathPrefix?: string;
  fileIntent?: FileIntent;
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
