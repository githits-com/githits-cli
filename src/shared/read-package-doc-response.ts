import type { PackageDocResult } from "../services/index.js";
import { MalformedPackageIntelligenceResponseError } from "../services/index.js";
import { colorize } from "./colors.js";
import {
  buildDocReadFollowUp,
  buildFileReadFollowUp,
  type DocReadFollowUp,
  type FileReadFollowUp,
  lowerDocSourceKind,
} from "./docs-follow-up.js";
import { toIsoDate } from "./format-date.js";

export interface LeanPackageDocEnvelope {
  registry?: string;
  name?: string;
  version?: string;
  pageId: string;
  title?: string;
  format?: string;
  content?: string;
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
  followUp: DocReadFollowUp;
  readFile?: FileReadFollowUp;
}

export function buildReadPackageDocSuccessPayload(
  result: PackageDocResult,
  requestedPageId: string,
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

  const envelope: LeanPackageDocEnvelope = {
    pageId,
    followUp: buildDocReadFollowUp(pageId) as DocReadFollowUp,
  };

  if (result.registry) envelope.registry = result.registry.toLowerCase();
  if (result.packageName) envelope.name = result.packageName;
  if (result.version) envelope.version = result.version;
  if (result.page?.title) envelope.title = result.page.title;
  if (result.page?.contentFormat) envelope.format = result.page.contentFormat;
  if (result.page?.content !== undefined)
    envelope.content = result.page.content;
  if (result.page?.breadcrumbs && result.page.breadcrumbs.length > 0) {
    envelope.breadcrumbs = result.page.breadcrumbs;
  }
  if (result.page?.linkName) envelope.linkName = result.page.linkName;
  if (result.page?.lastUpdatedAt) {
    envelope.lastUpdatedAt = toIsoDate(result.page.lastUpdatedAt) ?? undefined;
  }
  envelope.sourceKind = lowerDocSourceKind(
    result.page?.sourceKind ?? result.sourceKind,
  );
  if (result.page?.source?.url) envelope.sourceUrl = result.page.source.url;
  if (result.page?.source?.label)
    envelope.sourceLabel = result.page.source.label;
  if (result.page?.repoUrl) envelope.repoUrl = result.page.repoUrl;
  if (result.page?.gitRef) envelope.gitRef = result.page.gitRef;
  if (result.page?.requestedRef)
    envelope.requestedRef = result.page.requestedRef;
  if (result.page?.filePath) envelope.filePath = result.page.filePath;
  if (result.page?.baseUrl) envelope.baseUrl = result.page.baseUrl;
  envelope.readFile = result.page
    ? buildFileReadFollowUp(result.page)
    : undefined;

  return envelope;
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
