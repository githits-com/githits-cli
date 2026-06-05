import type { PackageDocsList } from "@githits/core-internal";
import { MalformedPackageIntelligenceResponseError } from "@githits/core-internal";
import { colorize, dim } from "./colors.js";
import { lowerDocSourceKind } from "./docs-follow-up.js";
import { toIsoDate } from "./format-date.js";

export interface LeanPackageDocListEntry {
  pageId: string;
  title?: string;
  sourceKind?: "crawled" | "repo";
  sourceUrl?: string;
  repoUrl?: string;
  gitRef?: string;
  requestedRef?: string;
  filePath?: string;
  lastUpdatedAt?: string;
}

export interface LeanPackageDocListFilter {
  limit?: number;
  after?: string;
}

export interface LeanPackageDocsEnvelope {
  registry?: string;
  name?: string;
  version?: string;
  stale?: boolean;
  total?: number;
  hasMore: boolean;
  nextCursor?: string;
  pages: LeanPackageDocListEntry[];
  filter?: LeanPackageDocListFilter;
}

export interface BuildListPackageDocsPayloadOptions {
  limitExplicit: boolean;
  afterExplicit: boolean;
  limit?: number;
  after?: string;
}

export function buildListPackageDocsSuccessPayload(
  result: PackageDocsList,
  options: BuildListPackageDocsPayloadOptions,
): LeanPackageDocsEnvelope {
  const envelope: LeanPackageDocsEnvelope = {
    hasMore: result.pageInfo?.hasNextPage ?? false,
    pages: result.pages.map((page) => {
      assertDocListEntry(page);
      const pageId = page.id as string;
      const lastUpdatedAt = toIsoDate(page.lastUpdatedAt);
      const entry: LeanPackageDocListEntry = { pageId };
      if (page.title) entry.title = page.title;
      const sourceKind = lowerDocSourceKind(page.sourceKind);
      if (sourceKind) entry.sourceKind = sourceKind;
      if (page.sourceUrl) entry.sourceUrl = page.sourceUrl;
      if (page.repoUrl) entry.repoUrl = page.repoUrl;
      if (page.gitRef) entry.gitRef = page.gitRef;
      if (page.requestedRef) entry.requestedRef = page.requestedRef;
      if (page.filePath) entry.filePath = page.filePath;
      if (lastUpdatedAt) entry.lastUpdatedAt = lastUpdatedAt;
      return entry;
    }),
  };

  if (result.registry) envelope.registry = result.registry.toLowerCase();
  if (result.packageName) envelope.name = result.packageName;
  if (result.version) envelope.version = result.version;
  if (typeof result.stale === "boolean") envelope.stale = result.stale;
  if (result.pageInfo?.totalCount !== undefined)
    envelope.total = result.pageInfo.totalCount;
  if (result.pageInfo?.endCursor)
    envelope.nextCursor = result.pageInfo.endCursor;

  const filter: LeanPackageDocListFilter = {};
  if (options.limitExplicit && options.limit !== undefined)
    filter.limit = options.limit;
  if (options.afterExplicit && options.after) filter.after = options.after;
  if (Object.keys(filter).length > 0) envelope.filter = filter;

  return envelope;
}

function assertDocListEntry(page: PackageDocsList["pages"][number]): void {
  if (!page.id) {
    throw new MalformedPackageIntelligenceResponseError(
      "Documentation page list entry missing required id.",
    );
  }

  if (
    page.sourceKind === "REPOSITORY" &&
    (!page.repoUrl || !page.gitRef || !page.filePath)
  ) {
    throw new MalformedPackageIntelligenceResponseError(
      "Repository-backed documentation list entry missing repo locator fields.",
    );
  }
}

export interface FormatListPackageDocsTerminalOptions {
  useColors: boolean;
  verbose?: boolean;
}

export function formatListPackageDocsTerminal(
  envelope: LeanPackageDocsEnvelope,
  options: FormatListPackageDocsTerminalOptions,
): string {
  const lines: string[] = [];
  lines.push(buildSummaryHeader(envelope, options.useColors));
  lines.push("");

  if (envelope.pages.length === 0) {
    lines.push(dim("No documentation pages found.", options.useColors));
    lines.push("");
    return lines.join("\n");
  }

  for (const page of envelope.pages) {
    lines.push(formatPageHeader(page, options.useColors));
    const meta = formatPageMeta(
      page,
      options.useColors,
      options.verbose ?? false,
    );
    if (meta.length > 0) lines.push(...meta);
    lines.push("");
  }

  lines.push(
    dim("Read a page: githits docs read '<pageId>'", options.useColors),
  );
  lines.push("");

  if (envelope.nextCursor) {
    lines.push(dim(`Next cursor: ${envelope.nextCursor}`, options.useColors));
  }
  if (envelope.stale) {
    lines.push(dim("Documentation may be stale.", options.useColors));
  }
  if (envelope.nextCursor || envelope.stale) lines.push("");

  return lines.join("\n");
}

function buildSummaryHeader(
  envelope: LeanPackageDocsEnvelope,
  useColors: boolean,
): string {
  const target =
    envelope.registry && envelope.name
      ? `${envelope.registry}:${envelope.name}${envelope.version ? `@${envelope.version}` : ""}`
      : "package docs";
  const summary = `${target} | ${envelope.pages.length} page${envelope.pages.length === 1 ? "" : "s"}`;
  const suffix = envelope.total !== undefined ? ` of ${envelope.total}` : "";
  return `${colorize(summary, "bold", useColors)}${dim(suffix, useColors)}`;
}

function formatPageHeader(
  page: LeanPackageDocListEntry,
  useColors: boolean,
): string {
  const badge = page.sourceKind === "repo" ? "[repo]" : "[crawled]";
  const title = page.title ?? page.pageId;
  return `${colorize(page.pageId, "bold", useColors)} ${dim(badge, useColors)} - ${title}`;
}

function formatPageMeta(
  page: LeanPackageDocListEntry,
  useColors: boolean,
  verbose: boolean,
): string[] {
  const lines: string[] = [];
  if (page.sourceUrl) {
    lines.push(`  ${dim("source:", useColors)} ${page.sourceUrl}`);
  }
  if (page.filePath) {
    const ref = page.requestedRef ?? page.gitRef;
    lines.push(
      `  ${dim("file:", useColors)} ${page.filePath}${ref ? ` @ ${ref}` : ""}`,
    );
  }
  if (verbose && page.lastUpdatedAt) {
    lines.push(`  ${dim("updated:", useColors)} ${page.lastUpdatedAt}`);
  }
  return lines;
}
