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
import type {
  UnifiedSearchCompletedPayload,
  UnifiedSearchErrorPayload,
  UnifiedSearchHitPayload,
  UnifiedSearchIncompletePayload,
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

  if (payload.results.length === 0) {
    lines.push(payload.completed ? "No hits." : "No hits yet - indexing.");
  } else {
    appendUnifiedSearchHits(lines, payload.results);
  }

  const trailer = buildTrailer(payload);
  if (trailer.length > 0) {
    lines.push("");
    for (const line of trailer) lines.push(line);
  }

  return lines.join("\n");
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

function buildTrailer(payload: SearchSuccessPayload): string[] {
  const lines: string[] = [];

  if (payload.warnings && payload.warnings.length > 0) {
    lines.push("warnings:");
    for (const warning of payload.warnings) {
      lines.push(`  - ${warning}`);
    }
  }

  if (payload.hasMore) {
    const nextOffsetHint =
      typeof payload.nextOffset === "number"
        ? ` Pass offset=${payload.nextOffset} for the next page or limit=N to widen.`
        : " Pass limit=N to widen.";
    lines.push(`More hits available.${nextOffsetHint}`);
  }

  if (!payload.completed && payload.searchRef) {
    lines.push(
      `Indexing in progress. Call search_status with searchRef=${payload.searchRef} to follow up.`,
    );
  }

  if (payload.sourceStatus && payload.sourceStatus.length > 0) {
    lines.push("source notes:");
    for (const entry of payload.sourceStatus) {
      lines.push(`  - ${formatSourceStatus(entry)}`);
    }
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

export function formatProgressTarget(target: {
  requested?: string;
  resolvedRequested?: string;
  served?: string;
  freshness?: string;
  indexingRef?: string;
  requestedRefKind?: string;
}): string {
  const parts: string[] = [];
  if (target.requested) parts.push(`requested=${target.requested}`);
  if (target.resolvedRequested) parts.push(`fresh=${target.resolvedRequested}`);
  if (target.served) parts.push(`served=${target.served}`);
  if (target.freshness)
    parts.push(`state=${describeFreshness(target.freshness)}`);
  if (target.requestedRefKind) parts.push(`intent=${target.requestedRefKind}`);
  if (target.indexingRef) parts.push(`indexingRef=${target.indexingRef}`);
  return parts.length > 0 ? parts.join(SEP) : "target progress unavailable";
}

export function describeFreshness(value: string): string {
  switch (value) {
    case "PENDING":
    case "INDEXING":
      return "indexing fresh target";
    case "STALE":
      return "served stale evidence";
    case "CURRENT":
    case "INDEXED":
      return "current";
    default:
      return value.toLowerCase();
  }
}

function formatSourceStatus(entry: {
  source: string;
  targetLabel: string;
  indexingStatus?: string;
  codeIndexState?: string;
  ignoredFilters?: string[];
  incompatibleFilters?: string[];
  ignoredQueryFeatures?: string[];
  incompatibleQueryFeatures?: string[];
  note?: string;
}): string {
  const parts: string[] = [`${entry.source} (${entry.targetLabel})`];
  if (entry.indexingStatus) parts.push(`indexing=${entry.indexingStatus}`);
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
  return parts.join(SEP);
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
