import type { UnifiedSearchHitPayload } from "./unified-search-response.js";

interface CodeReadCommandInput {
  registry?: string;
  packageName?: string;
  version?: string;
  repoUrl?: string;
  gitRef?: string;
  filePath?: string;
  startLine?: number;
  endLine?: number;
}

export function buildSearchHitFollowUpCommand(
  hit: UnifiedSearchHitPayload,
): string {
  const loc = hit.locator;
  if (loc.pageId) {
    return buildDocsReadCommand(loc.pageId, loc.startLine, loc.endLine);
  }
  if (loc.filePath) {
    return buildCodeReadCommand({
      registry: loc.registry,
      packageName: loc.packageName,
      version: loc.version,
      repoUrl: loc.repoUrl,
      gitRef: loc.gitRef,
      filePath: loc.filePath,
      startLine: loc.startLine,
      endLine: loc.endLine,
    });
  }
  if (hit.type === "repository_code" || hit.type === "repository_symbol") {
    return "follow-up unavailable: missing filePath";
  }
  if (loc.sourceUrl) return loc.sourceUrl;
  return "";
}

export function buildDocsReadCommand(
  pageId: string,
  startLine?: number,
  endLine?: number,
): string {
  const parts = [`docs_read page_id=${quote(pageId)}`];
  appendRange(parts, startLine, endLine);
  return parts.join(" ");
}

export function buildCodeReadCommand(input: CodeReadCommandInput): string {
  if (!input.filePath) return "follow-up unavailable: missing filePath";
  const target = buildTargetSpec(input);
  if (!target) return "follow-up unavailable: missing target";
  const parts = [
    `code_read target=${quote(target)}`,
    `path=${quote(input.filePath)}`,
  ];
  appendRange(parts, input.startLine, input.endLine);
  return parts.join(" ");
}

function buildTargetSpec(input: CodeReadCommandInput): string | undefined {
  if (input.repoUrl) {
    return `${input.repoUrl}#${input.gitRef ?? "HEAD"}`;
  }
  if (input.registry && input.packageName) {
    return `${input.registry}:${input.packageName}${input.version ? `@${input.version}` : ""}`;
  }
  return undefined;
}

function appendRange(
  parts: string[],
  startLine: number | undefined,
  endLine: number | undefined,
): void {
  if (typeof startLine === "number") parts.push(`start_line=${startLine}`);
  if (typeof endLine === "number") parts.push(`end_line=${endLine}`);
}

function quote(value: string): string {
  return JSON.stringify(value);
}
