import type { PackageDocResult } from "@githits/core-internal";
import { MalformedPackageIntelligenceResponseError } from "@githits/core-internal";
import { colorize } from "./colors.js";
import { lowerDocSourceKind } from "./docs-follow-up.js";
import { toIsoDate } from "./format-date.js";

export interface LeanPackageDocEnvelope {
  registry?: string;
  name?: string;
  version?: string;
  pageId: string;
  docsReadTarget: string;
  title?: string;
  format?: string;
  content?: string;
  /** Whole stored page extent, including a trailing empty line. */
  totalLines: number;
  /** Actual absolute page range returned to this caller. */
  startLine?: number;
  endLine?: number;
  /** Indexed section anchor resolved from the requested URL fragment. */
  anchor?: string;
  breadcrumbs?: string[];
  lastUpdatedAt?: string;
  sourceKind?: "crawled" | "repo";
  sourceUrl?: string;
  sourceLabel?: string;
  repoUrl?: string;
  gitRef?: string;
  requestedRef?: string;
  filePath?: string;
  baseUrl?: string;
  hint?: string;
}

export function buildReadPackageDocSuccessPayload(
  result: PackageDocResult,
  requestedPageId: string,
  maxOutputLines?: number,
): LeanPackageDocEnvelope {
  const pageId = result.page?.id;
  if (!pageId) {
    throw new MalformedPackageIntelligenceResponseError(
      `Documentation page '${requestedPageId}' missing required id in response.`,
    );
  }

  const docsReadTarget = result.page?.docsReadTarget;
  if (!docsReadTarget) {
    throw new MalformedPackageIntelligenceResponseError(
      `Documentation page '${requestedPageId}' missing required docsReadTarget in response.`,
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

  const envelope: LeanPackageDocEnvelope = {
    pageId,
    docsReadTarget,
    totalLines: result.contentRange.totalLines,
  };

  if (result.contentRange.startLine !== undefined) {
    envelope.startLine = result.contentRange.startLine;
  }
  if (result.contentRange.endLine !== undefined) {
    envelope.endLine = result.contentRange.endLine;
  }
  if (result.contentRange.anchor) envelope.anchor = result.contentRange.anchor;

  if (result.registry) envelope.registry = result.registry.toLowerCase();
  if (result.packageName) envelope.name = result.packageName;
  if (result.version) envelope.version = result.version;
  if (result.page?.title) envelope.title = result.page.title;
  if (result.page?.contentFormat) envelope.format = result.page.contentFormat;
  if (result.page?.content !== undefined) {
    const limited = limitReturnedContent(
      result.page.content,
      result.contentRange.startLine,
      result.contentRange.endLine,
      maxOutputLines,
      requestedPageId,
    );
    envelope.content = limited.content;
    if (limited.endLine !== undefined) envelope.endLine = limited.endLine;
  }
  if (result.page?.breadcrumbs && result.page.breadcrumbs.length > 0) {
    envelope.breadcrumbs = result.page.breadcrumbs;
  }
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

interface LimitedContent {
  content: string;
  endLine?: number;
}

/**
 * Apply only a caller-owned display cap to the already-selected backend body.
 * Absolute bounds and fragments belong to `getDocPage`; using the backend
 * start coordinate here prevents an absolute range from being applied twice.
 */
function limitReturnedContent(
  content: string,
  startLine: number | undefined,
  endLine: number | undefined,
  maxOutputLines: number | undefined,
  requestedPageId: string,
): LimitedContent {
  if (startLine === undefined || endLine === undefined) {
    if (content.length > 0) {
      throw new MalformedPackageIntelligenceResponseError(
        `Empty documentation page '${requestedPageId}' returned content.`,
      );
    }
    return { content };
  }

  const lines = content.split("\n");
  const expectedLines = endLine - startLine + 1;
  if (lines.length !== expectedLines) {
    throw new MalformedPackageIntelligenceResponseError(
      `Documentation page '${requestedPageId}' content does not match its returned range.`,
    );
  }

  if (maxOutputLines === undefined || lines.length <= maxOutputLines) {
    return { content, endLine };
  }

  return {
    content: lines.slice(0, maxOutputLines).join("\n"),
    endLine: startLine + maxOutputLines - 1,
  };
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
  if (envelope.docsReadTarget !== envelope.pageId) {
    lines.push(`docsReadTarget: ${envelope.docsReadTarget}`);
  }
  lines.push(`pageId: ${envelope.pageId}`);
  if (envelope.sourceUrl && envelope.sourceUrl !== envelope.docsReadTarget) {
    lines.push(`source: ${envelope.sourceUrl}`);
  }
  if (envelope.filePath) {
    const ref = envelope.requestedRef ?? envelope.gitRef;
    lines.push(`file: ${envelope.filePath}${ref ? ` @ ${ref}` : ""}`);
  }
  if (envelope.lastUpdatedAt) lines.push(`updated: ${envelope.lastUpdatedAt}`);
  if (envelope.startLine !== undefined && envelope.endLine !== undefined) {
    lines.push(
      `range: ${envelope.startLine}-${envelope.endLine}/${envelope.totalLines}`,
    );
  } else {
    lines.push(`range: empty/0`);
  }
  if (envelope.anchor) lines.push(`anchor: ${envelope.anchor}`);
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
