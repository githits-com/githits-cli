import type { PackageDocResult } from "../services/index.js";
import { MalformedPackageIntelligenceResponseError } from "../services/index.js";
import { colorize } from "./colors.js";
import { lowerDocSourceKind } from "./docs-follow-up.js";
import { toIsoDate } from "./format-date.js";
import type { LineRange } from "./parse-lines-option.js";

export interface LeanPackageDocEnvelope {
  registry?: string;
  name?: string;
  version?: string;
  pageId: string;
  title?: string;
  format?: string;
  content?: string;
  /** Total lines in the source page; present whenever a `content` slice
   *  was applied or the source content was non-empty. */
  totalLines?: number;
  /** Set when caller scoped output to a line range. */
  startLine?: number;
  endLine?: number;
  breadcrumbs?: string[];
  linkName?: string;
  lastUpdatedAt?: string;
  sourceKind?: "crawled" | "repo";
  sourceUrl?: string;
  sourceLabel?: string;
  repoUrl?: string;
  gitRef?: string;
  requestedRef?: string;
  filePath?: string;
  baseUrl?: string;
}

export function buildReadPackageDocSuccessPayload(
  result: PackageDocResult,
  requestedPageId: string,
  range?: LineRange,
): LeanPackageDocEnvelope {
  const pageId = result.page?.id;
  if (!pageId) {
    throw new MalformedPackageIntelligenceResponseError(
      `Documentation page '${requestedPageId}' missing required id in response.`,
    );
  }

  if (
    (result.page?.sourceKind ?? result.sourceKind) === "REPOSITORY" &&
    (!result.page?.repoUrl || !result.page?.gitRef || !result.page?.filePath)
  ) {
    throw new MalformedPackageIntelligenceResponseError(
      `Repository-backed documentation page '${pageId}' missing repo locator fields.`,
    );
  }

  const envelope: LeanPackageDocEnvelope = { pageId };

  if (result.registry) envelope.registry = result.registry.toLowerCase();
  if (result.packageName) envelope.name = result.packageName;
  if (result.version) envelope.version = result.version;
  if (result.page?.title) envelope.title = result.page.title;
  if (result.page?.contentFormat) envelope.format = result.page.contentFormat;
  if (result.page?.content !== undefined) {
    const sliced = sliceContent(result.page.content, range);
    envelope.content = sliced.content;
    if (sliced.totalLines !== undefined)
      envelope.totalLines = sliced.totalLines;
    if (sliced.startLine !== undefined) envelope.startLine = sliced.startLine;
    if (sliced.endLine !== undefined) envelope.endLine = sliced.endLine;
  }
  if (result.page?.breadcrumbs && result.page.breadcrumbs.length > 0) {
    envelope.breadcrumbs = result.page.breadcrumbs;
  }
  if (result.page?.linkName) envelope.linkName = result.page.linkName;
  if (result.page?.lastUpdatedAt) {
    envelope.lastUpdatedAt = toIsoDate(result.page.lastUpdatedAt) ?? undefined;
  }
  const sourceKind = lowerDocSourceKind(
    result.page?.sourceKind ?? result.sourceKind,
  );
  if (sourceKind) envelope.sourceKind = sourceKind;
  if (result.page?.source?.url) envelope.sourceUrl = result.page.source.url;
  if (result.page?.source?.label)
    envelope.sourceLabel = result.page.source.label;
  if (result.page?.repoUrl) envelope.repoUrl = result.page.repoUrl;
  if (result.page?.gitRef) envelope.gitRef = result.page.gitRef;
  if (result.page?.requestedRef)
    envelope.requestedRef = result.page.requestedRef;
  if (result.page?.filePath) envelope.filePath = result.page.filePath;
  if (result.page?.baseUrl) envelope.baseUrl = result.page.baseUrl;

  return envelope;
}

interface SlicedContent {
  content: string;
  totalLines?: number;
  startLine?: number;
  endLine?: number;
}

/**
 * Apply a 1-indexed inclusive line range to the doc body. Backend
 * `fetchPackageDoc` does not accept startLine/endLine yet, so the
 * slicing happens client-side. When no range is given, the body is
 * returned untouched and only `totalLines` is reported (handy for
 * agents deciding whether to fetch a range on a follow-up call).
 */
function sliceContent(
  content: string,
  range: LineRange | undefined,
): SlicedContent {
  if (content.length === 0) {
    return { content };
  }

  // Strip a single trailing newline so totalLines reflects "lines of
  // text", not "split positions". The original trailing newline is
  // preserved on the unsliced full body.
  const trimmed = content.endsWith("\n") ? content.slice(0, -1) : content;
  const lines = trimmed.split("\n");
  const totalLines = lines.length;

  if (
    !range ||
    (range.startLine === undefined && range.endLine === undefined)
  ) {
    return { content, totalLines };
  }

  const startLine = Math.max(1, range.startLine ?? 1);
  const endLine = Math.min(totalLines, range.endLine ?? totalLines);

  if (startLine > totalLines) {
    return { content: "", totalLines, startLine, endLine: startLine - 1 };
  }

  const sliced = lines.slice(startLine - 1, endLine).join("\n");
  return { content: sliced, totalLines, startLine, endLine };
}

export interface FormatReadPackageDocTerminalOptions {
  useColors: boolean;
  verbose?: boolean;
}

export function formatReadPackageDocTerminal(
  envelope: LeanPackageDocEnvelope,
  options: FormatReadPackageDocTerminalOptions,
): string {
  if (!(options.verbose ?? false)) {
    return envelope.content ?? "";
  }

  const lines: string[] = [];
  lines.push(buildHeader(envelope, options.useColors));
  lines.push(`pageId: ${envelope.pageId}`);
  if (envelope.sourceUrl) lines.push(`source: ${envelope.sourceUrl}`);
  if (envelope.filePath) {
    const ref = envelope.requestedRef ?? envelope.gitRef;
    lines.push(`file: ${envelope.filePath}${ref ? ` @ ${ref}` : ""}`);
  }
  if (envelope.lastUpdatedAt) lines.push(`updated: ${envelope.lastUpdatedAt}`);
  if (envelope.breadcrumbs && envelope.breadcrumbs.length > 0) {
    lines.push(`breadcrumbs: ${envelope.breadcrumbs.join(" > ")}`);
  }
  lines.push("");
  if (envelope.content) lines.push(envelope.content);
  return `${lines.join("\n")}\n`;
}

function buildHeader(
  envelope: LeanPackageDocEnvelope,
  useColors: boolean,
): string {
  const badge = envelope.sourceKind === "repo" ? "[repo]" : "[crawled]";
  const title = envelope.title ?? envelope.pageId;
  const prefix =
    envelope.registry && envelope.name
      ? `${envelope.registry}:${envelope.name}${envelope.version ? `@${envelope.version}` : ""}`
      : "documentation";
  return `${colorize(`${prefix} ${badge}`, "bold", useColors)}${title ? ` - ${title}` : ""}`;
}
