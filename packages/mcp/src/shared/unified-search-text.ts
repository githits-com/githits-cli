/**
 * Line-oriented text renderer for unified `search` MCP responses.
 *
 * Designed for agent context efficiency: roughly 3-5 lines per hit
 * and no JSON scaffolding. This is the tool's default response
 * format — programmatic / parity callers opt into the structured
 * JSON envelope by passing `format: "json"`.
 *
 * ASCII-only output — separators tokenize cleanly across BPE
 * variants, and there are no Unicode characters that require
 * client-side escaping.
 *
 * Format is a public contract — locked with snapshot-style tests in
 * `unified-search-text.test.ts`. Update the spec in
 * `docs/implementation/tools.md` when changing the format.
 */

import { buildSearchHitFollowUpCommand } from "./follow-up-command-text.js";
import { isHealthySearchLifecycleState } from "./search-lifecycle.js";
import {
  buildResolutionFromRetryCandidates,
  buildTargetResolutionNotes,
  formatTargetResolutionIdentity,
  type LeanTargetResolution,
} from "./target-resolution.js";
import type {
  UnifiedSearchCompletedPayload,
  UnifiedSearchErrorPayload,
  UnifiedSearchHitPayload,
  UnifiedSearchIncompletePayload,
  UnifiedSearchQueryEcho,
} from "./unified-search-response.js";

const SUMMARY_WRAP_WIDTH = 76;
const SEP = " | ";

type SearchSuccessPayload =
  | UnifiedSearchCompletedPayload
  | UnifiedSearchIncompletePayload;

/** Render a successful unified-search payload as line-oriented text. */
export function renderUnifiedSearchSuccess(
  payload: SearchSuccessPayload,
): string {
  const lines: string[] = [];
  lines.push(buildHeader(payload));
  lines.push("");

  const completedEmpty = payload.completed && payload.results.length === 0;
  if (completedEmpty) {
    appendWarnings(lines, payload.warnings);
    appendSourceStatusNotes(lines, payload.sourceStatus);
    if (lines[lines.length - 1] !== "") lines.push("");
    appendEmptySearchGuidance(lines, {
      query: payload.query,
      sourceStatus: payload.sourceStatus,
    });
  } else if (payload.results.length === 0) {
    lines.push(
      noHitsYetMessage("progress" in payload ? payload.progress : undefined),
    );
  } else {
    appendUnifiedSearchHits(lines, payload.results);
  }

  const trailer = buildTrailer(payload, {
    includeWarnings: !completedEmpty,
    includeSourceStatus: !completedEmpty,
  });
  if (trailer.length > 0) {
    lines.push("");
    for (const line of trailer) lines.push(line);
  }

  return lines.join("\n");
}

function noHitsYetMessage(
  progress: UnifiedSearchIncompletePayload["progress"],
): string {
  const status = progress?.status;
  if (status === "TIMEOUT") return "No hits yet - timed out waiting.";
  if (status === "FAILED") return "No hits - search failed.";
  if (status === "SEARCHING") return "No hits yet - searching.";
  return "No hits yet - indexing.";
}

/** Render an error envelope as compact text. */
export function renderUnifiedSearchError(
  payload: UnifiedSearchErrorPayload,
): string {
  const lines: string[] = [];
  const header = `search${SEP}ERROR${SEP}code=${payload.code}${
    payload.retryable ? `${SEP}retryable` : ""
  }`;
  lines.push(header);
  lines.push(payload.error);

  if (payload.details && Object.keys(payload.details).length > 0) {
    lines.push("");
    lines.push("details:");
    for (const [key, value] of Object.entries(payload.details)) {
      lines.push(`  ${key}: ${formatDetailValue(value)}`);
    }
  }
  return lines.join("\n");
}

function buildHeader(payload: SearchSuccessPayload): string {
  const count = payload.results.length;
  const status = payload.completed
    ? `${count} hit${count === 1 ? "" : "s"}`
    : `${count} partial`;
  const parts = [`search${SEP}${status}`];
  parts.push(`query=${quote(payload.query.raw)}`);
  if (!payload.completed) {
    parts.push(`searchRef=${payload.searchRef}`);
  }
  return parts.join(SEP);
}

export function appendUnifiedSearchHits(
  lines: string[],
  hits: UnifiedSearchHitPayload[],
): void {
  hits.forEach((hit, idx) => {
    if (idx > 0) lines.push("");
    appendHit(lines, idx + 1, hit);
  });
}

function appendHit(
  lines: string[],
  index: number,
  hit: UnifiedSearchHitPayload,
): void {
  const headerParts: string[] = [formatHitPrimary(hit), shortType(hit.type)];
  lines.push(`[${index}] ${headerParts.join("  ")}`);

  const locator = buildLocatorLine(hit);
  if (locator) lines.push(`    ${locator}`);

  // Title is suppressed when it's literally the locator we just
  // printed; the response builder already drops `qualifiedPath` when
  // it equals `title`, so we don't double-check that here.
  if (hit.title && hit.title !== hit.locator.filePath) {
    lines.push(`    ${hit.title}`);
  }

  if (hit.summary) {
    for (const wrapped of wrapText(hit.summary, SUMMARY_WRAP_WIDTH)) {
      lines.push(`    ${wrapped}`);
    }
  }
}

function formatHitPrimary(hit: UnifiedSearchHitPayload): string {
  const loc = hit.locator;
  if (hit.type === "documentation_page" && loc.pageId) {
    const target = formatDocsPageTarget(loc, hit.target);
    return target ? `${loc.pageId} ${target}` : loc.pageId;
  }
  if (hit.type === "repository_doc" && loc.filePath) {
    return `${hit.target} ${loc.filePath}${formatLineRange(loc.startLine, loc.endLine)}`;
  }
  return hit.target;
}

function formatDocsPageTarget(
  locator: {
    registry?: string;
    packageName?: string;
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

/**
 * Compact, agent-friendly type label.
 *
 * Backend types are uppercase enum-style; the JSON envelope already
 * lowercases them. Text mode further compacts to a single token so a
 * reader can scan the third column quickly.
 */
function shortType(type: string): string {
  switch (type) {
    case "repository_code":
      return "code";
    case "repository_symbol":
      return "symbol";
    case "documentation_page":
      return "docs";
    case "repository_doc":
      return "repo-docs";
    default:
      return type;
  }
}

function buildLocatorLine(hit: UnifiedSearchHitPayload): string {
  const loc = hit.locator;
  const followUp = buildSearchHitFollowUpCommand(hit);
  if (followUp) {
    const tail: string[] = [];
    if (loc.qualifiedPath) tail.push(loc.qualifiedPath);
    if (loc.kind) tail.push(loc.kind);
    return tail.length > 0 ? `${followUp}  ${tail.join(SEP)}` : followUp;
  }
  if (loc.filePath) {
    let line = `${loc.filePath}${formatLineRange(loc.startLine, loc.endLine)}`;
    const tail: string[] = [];
    if (loc.qualifiedPath) tail.push(loc.qualifiedPath);
    if (loc.kind) tail.push(loc.kind);
    if (tail.length > 0) line += `  ${tail.join(SEP)}`;
    return line;
  }
  if (loc.pageId) return `pageId: ${loc.pageId}`;
  if (loc.sourceUrl) return loc.sourceUrl;
  return "";
}

function formatLineRange(start?: number, end?: number): string {
  if (typeof start !== "number") return "";
  if (typeof end !== "number" || end === start) return `:${start}`;
  return `:${start}-${end}`;
}

function buildTrailer(
  payload: SearchSuccessPayload,
  options: { includeWarnings: boolean; includeSourceStatus: boolean },
): string[] {
  const lines: string[] = [];

  if (options.includeWarnings) appendWarnings(lines, payload.warnings);

  if (payload.hasMore) {
    const nextOffsetHint =
      typeof payload.nextOffset === "number"
        ? ` Pass offset=${payload.nextOffset} for the next page or limit=N to widen.`
        : " Pass limit=N to widen.";
    lines.push(`More hits available.${nextOffsetHint}`);
  }

  if (!payload.completed && payload.searchRef) {
    const status = payload.progress?.status;
    const action =
      status === "TIMEOUT"
        ? "Search timed out waiting for fresh data."
        : status === "FAILED"
          ? "Search failed before completion."
          : status === "SEARCHING"
            ? "Search in progress."
            : "Indexing in progress.";
    if (payload.progress) {
      lines.push(
        `progress: ${payload.progress.targetsReady}/${payload.progress.targetsTotal} targets ready.`,
      );
    }
    lines.push(`${action} Do not repeat search.`);
    lines.push(
      `Call search_status with search_ref=${JSON.stringify(payload.searchRef)}.`,
    );
  }

  if (options.includeSourceStatus) {
    appendSourceStatusNotes(lines, payload.sourceStatus);
  }

  const progress = "progress" in payload ? payload.progress : undefined;
  if (progress?.targets?.length) {
    lines.push("progress targets:");
    for (const target of progress.targets) {
      lines.push(`  - ${formatProgressTarget(target)}`);
    }
  }

  return lines;
}

function appendWarnings(lines: string[], warnings: string[] | undefined): void {
  if (!warnings || warnings.length === 0) return;
  lines.push("warnings:");
  for (const warning of warnings) lines.push(`  - ${warning}`);
}

export function appendSourceStatusNotes(
  lines: string[],
  sourceStatus:
    | UnifiedSearchCompletedPayload["sourceStatus"]
    | UnifiedSearchIncompletePayload["sourceStatus"],
): void {
  if (!sourceStatus || sourceStatus.length === 0) return;
  lines.push("source notes:");
  for (const entry of sourceStatus) {
    lines.push(`  - ${formatSourceStatus(entry)}`);
  }
}

export function appendEmptySearchGuidance(
  lines: string[],
  options: {
    query?: UnifiedSearchQueryEcho;
    showQuery?: boolean;
    sourceStatus?: UnifiedSearchCompletedPayload["sourceStatus"];
  },
): void {
  if (options.showQuery && options.query?.raw) {
    lines.push(`query=${quote(options.query.raw)}`);
  }
  lines.push(formatEmptySearchHeadline(options.sourceStatus));
  lines.push("Do not repeat this search unchanged.");
  if (hasIndexingSource(options.sourceStatus)) {
    const hasAlternatives = options.sourceStatus?.some(
      (entry) =>
        Boolean(entry.targetResolution?.availableVersions.length) ||
        Boolean(entry.targetResolution?.availableRefs.length),
    );
    lines.push(
      hasAlternatives
        ? 'next: query an indexed version/ref labelled "queryable now", or rerun with a larger wait_timeout_ms to wait for indexing.'
        : "next: rerun with a larger wait_timeout_ms to wait for indexing.",
    );
    return;
  }

  const pivots = ["shorten or broaden the query"];
  if (hasRestrictiveSearchFilters(options.query)) {
    pivots.push("remove restrictive filters");
  }
  if (!options.query?.sources?.includes("symbol")) {
    pivots.push('use source="symbol" for an exact API/entity name');
  }
  if (!isStandaloneSiteSearch(options.sourceStatus)) {
    pivots.push("use code_grep for a known literal or regex");
  }
  lines.push(`next: ${pivots.join("; ")}.`);
}

function hasIndexingSource(
  sourceStatus: UnifiedSearchCompletedPayload["sourceStatus"],
): boolean {
  return Boolean(
    sourceStatus?.some(
      (entry) =>
        entry.targetResolution?.freshness === "indexing" ||
        entry.indexingStatus === "INDEXING" ||
        entry.codeIndexState === "INDEXING",
    ),
  );
}

function hasRestrictiveSearchFilters(
  query: UnifiedSearchQueryEcho | undefined,
): boolean {
  const filters = query?.filters;
  return Boolean(
    filters?.kind ||
      filters?.category ||
      filters?.pathPrefix ||
      filters?.fileIntent ||
      filters?.publicOnly === true ||
      (query?.raw &&
        /(?:^|\s)(?:kind|category|path|lang|name|intent):/i.test(query.raw)),
  );
}

function isStandaloneSiteSearch(
  sourceStatus: UnifiedSearchCompletedPayload["sourceStatus"],
): boolean {
  return Boolean(
    sourceStatus?.length &&
      sourceStatus.every((entry) => {
        const resolution = entry.targetResolution;
        return Boolean(
          entry.targetLabel.startsWith("site:") ||
            resolution?.requested?.site ||
            resolution?.resolvedRequested?.site ||
            resolution?.served?.site,
        );
      }),
  );
}

function formatEmptySearchHeadline(
  sourceStatus: UnifiedSearchCompletedPayload["sourceStatus"],
): string {
  if (!sourceStatus || sourceStatus.length === 0) return "No hits.";
  if (sourceStatus.length > 1) {
    const sources = Array.from(
      new Set(sourceStatus.map((entry) => entry.source)),
    ).join(", ");
    return `No hits across ${sources} sources.`;
  }

  const entry = sourceStatus[0];
  if (!entry) return "No hits.";
  const served =
    entry.servedTarget ??
    formatTargetResolutionIdentity(entry.targetResolution?.served) ??
    entry.targetLabel;
  const requested =
    entry.requestedTarget ??
    formatTargetResolutionIdentity(entry.targetResolution?.requested);
  // STALE is headline-worthy provenance even when it is not warning-worthy.
  const unhealthyIndexState = [entry.indexingStatus, entry.codeIndexState].find(
    (state) => state && !isHealthySearchLifecycleState(state),
  );
  const freshness =
    unhealthyIndexState ??
    entry.targetResolution?.freshness ??
    entry.codeIndexState ??
    entry.indexingStatus;
  const context: string[] = [];
  if (requested && requested !== served) context.push(`requested ${requested}`);
  if (freshness) context.push(describeFreshness(freshness));
  const suffix = context.length > 0 ? ` (${context.join("; ")})` : "";
  return `No hits for ${entry.source} on ${served}${suffix}.`;
}

export function formatProgressTarget(target: {
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
}): string {
  const parts: string[] = [];
  if (target.requested) parts.push(`requested=${target.requested}`);
  if (target.resolvedRequested) parts.push(`fresh=${target.resolvedRequested}`);
  if (target.served) parts.push(`served=${target.served}`);
  if (target.freshness)
    parts.push(`state=${describeFreshness(target.freshness)}`);
  if (target.requestedRefKind) parts.push(`intent=${target.requestedRefKind}`);
  if (target.indexingRef) parts.push(`indexingRef=${target.indexingRef}`);
  for (const note of buildTargetResolutionNotes(
    target.targetResolution ?? buildResolutionFromRetryCandidates(target),
  )) {
    parts.push(note);
  }
  return parts.length > 0 ? parts.join(SEP) : "target progress unavailable";
}

export function describeFreshness(value: string): string {
  switch (value) {
    case "PENDING":
      return "pending";
    case "INDEXING":
      return "indexing";
    case "STALE":
      return "previous-snapshot";
    case "CURRENT":
    case "INDEXED":
      return "current";
    default:
      return value.toLowerCase();
  }
}

export function formatSourceStatus(entry: {
  source: string;
  targetLabel: string;
  requestedTarget?: string;
  freshTarget?: string;
  servedTarget?: string;
  targetResolution?: LeanTargetResolution;
  indexingStatus?: string;
  codeIndexState?: string;
  resultCount?: number;
  ignoredFilters?: string[];
  incompatibleFilters?: string[];
  ignoredQueryFeatures?: string[];
  incompatibleQueryFeatures?: string[];
  note?: string;
}): string {
  const terminalReason = terminalLifecycleReason(entry);
  if (terminalReason) {
    return `${entry.source} (${entry.targetLabel})${SEP}${terminalReason}`;
  }

  const parts: string[] = [`${entry.source} (${entry.targetLabel})`];
  if (entry.requestedTarget) parts.push(`requested=${entry.requestedTarget}`);
  if (entry.freshTarget) parts.push(`fresh=${entry.freshTarget}`);
  if (entry.servedTarget && entry.servedTarget !== entry.targetLabel) {
    parts.push(`served=${entry.servedTarget}`);
  }
  if (typeof entry.resultCount === "number") {
    parts.push(`results=${entry.resultCount}`);
  }
  if (entry.indexingStatus) parts.push(`indexState=${entry.indexingStatus}`);
  if (entry.codeIndexState) parts.push(`codeIndex=${entry.codeIndexState}`);
  if (entry.ignoredFilters?.length) {
    parts.push(`ignored=${entry.ignoredFilters.join(",")}`);
  }
  if (entry.incompatibleFilters?.length) {
    parts.push(`incompatible=${entry.incompatibleFilters.join(",")}`);
  }
  if (entry.ignoredQueryFeatures?.length) {
    parts.push(`ignoredQuery=${entry.ignoredQueryFeatures.join(",")}`);
  }
  if (entry.incompatibleQueryFeatures?.length) {
    parts.push(
      `incompatibleQuery=${entry.incompatibleQueryFeatures.join(",")}`,
    );
  }
  if (entry.note) parts.push(entry.note);
  for (const note of buildTargetResolutionNotes(entry.targetResolution)) {
    parts.push(note);
  }
  return parts.join(SEP);
}

function terminalLifecycleReason(entry: {
  indexingStatus?: string;
  codeIndexState?: string;
  note?: string;
}): string | undefined {
  const states = Array.from(
    new Set([entry.indexingStatus, entry.codeIndexState].filter(Boolean)),
  ) as string[];
  const terminalStates = states.filter(
    (state) =>
      !isHealthySearchLifecycleState(state) &&
      state !== "INDEXING" &&
      state !== "STALE",
  );
  if (terminalStates.length === 0) return undefined;
  const status = terminalStates.join("/");
  return entry.note ? `${entry.note} (${status})` : `status ${status}`;
}

function quote(value: string): string {
  // Use single quotes when the value already contains a double quote;
  // agents read either form. JSON-escape would be over-engineering for
  // a header.
  return value.includes('"') ? `'${value}'` : `"${value}"`;
}

function formatDetailValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  return JSON.stringify(value);
}

function wrapText(text: string, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split(/\n/)) {
    if (paragraph.length === 0) {
      lines.push("");
      continue;
    }
    let remaining = paragraph.trim();
    while (remaining.length > width) {
      let breakAt = remaining.lastIndexOf(" ", width);
      if (breakAt <= 0) breakAt = width;
      lines.push(remaining.slice(0, breakAt).trimEnd());
      remaining = remaining.slice(breakAt).trimStart();
    }
    if (remaining.length > 0) lines.push(remaining);
  }
  return lines;
}
