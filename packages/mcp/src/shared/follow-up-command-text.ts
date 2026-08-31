import { MCP_READ_MAX_SPAN } from "./code-navigation-defaults.js";
import { formatRepositoryTarget } from "./repository-target.js";
import { shellQuote } from "./shell-quote.js";
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
  preferPackageTarget?: boolean;
}

export function buildSearchHitFollowUpCommand(
  hit: UnifiedSearchHitPayload,
  syntax: "mcp" | "cli" = "mcp",
): string {
  const loc = hit.locator;
  if (loc.pageId) {
    return syntax === "cli"
      ? buildCliDocsReadCommand(loc.pageId, loc.startLine, loc.endLine)
      : buildDocsReadCommand(loc.pageId, loc.startLine, loc.endLine);
  }
  const input = buildSearchHitCodeReadInput(hit, syntax);
  if (input) {
    return syntax === "cli"
      ? buildCliCodeReadCommand(input)
      : buildCodeReadCommand(input);
  }
  if (hit.type === "repository_code" || hit.type === "repository_symbol") {
    return "follow-up unavailable: missing filePath";
  }
  if (loc.sourceUrl) return loc.sourceUrl;
  return "";
}

function buildSearchHitCodeReadInput(
  hit: UnifiedSearchHitPayload,
  syntax: "mcp" | "cli",
): CodeReadCommandInput | undefined {
  const loc = hit.locator;
  const definition =
    loc.symbolContext?.relation === "encloses_match"
      ? loc.symbolContext.definitionRange
      : undefined;
  const evidence = loc.evidenceRange;
  const targetFilePath = definition?.filePath ?? loc.filePath;
  const repositoryFilePath =
    definition?.repositoryFilePath ?? loc.repositoryFilePath;
  const startLine =
    definition?.startLine ?? evidence?.startLine ?? loc.startLine;
  const trueEndLine = definition?.endLine ?? evidence?.endLine ?? loc.endLine;
  const endLine =
    syntax === "mcp" &&
    typeof startLine === "number" &&
    typeof trueEndLine === "number" &&
    trueEndLine - startLine + 1 > MCP_READ_MAX_SPAN
      ? startLine + MCP_READ_MAX_SPAN - 1
      : trueEndLine;
  const exactRef = loc.commitSha ?? loc.gitRef;

  if (loc.repoUrl && exactRef && repositoryFilePath) {
    return {
      repoUrl: loc.repoUrl,
      gitRef: exactRef,
      filePath: repositoryFilePath,
      startLine,
      endLine,
    };
  }

  const filePath =
    !isPackageTarget(hit) && repositoryFilePath
      ? repositoryFilePath
      : targetFilePath;
  if (!filePath) return undefined;
  return {
    registry: loc.registry,
    packageName: loc.packageName,
    version: loc.version,
    repoUrl: loc.repoUrl,
    gitRef: exactRef,
    filePath,
    startLine,
    endLine,
    preferPackageTarget: isPackageTarget(hit),
  };
}

function buildCliDocsReadCommand(
  pageId: string,
  startLine?: number,
  endLine?: number,
): string {
  const parts = [`githits docs read ${shellQuote(pageId)}`];
  appendCliRange(parts, startLine, endLine);
  return parts.join(" ");
}

function buildCliCodeReadCommand(input: CodeReadCommandInput): string {
  if (!input.filePath) return "follow-up unavailable: missing filePath";
  const target = buildTargetSpec(input);
  if (!target) return "follow-up unavailable: missing target";

  const parts: string[] = ["githits code read"];
  if (
    input.repoUrl &&
    !(input.preferPackageTarget && input.registry && input.packageName)
  ) {
    parts.push("--repo-url", shellQuote(input.repoUrl));
    if (input.gitRef) parts.push("--git-ref", shellQuote(input.gitRef));
  } else {
    parts.push(shellQuote(target));
  }
  parts.push(shellQuote(input.filePath));
  appendCliRange(parts, input.startLine, input.endLine);
  return parts.join(" ");
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
  if (input.preferPackageTarget && input.registry && input.packageName) {
    return `${input.registry}:${input.packageName}${input.version ? `@${input.version}` : ""}`;
  }
  if (input.repoUrl) {
    return formatRepositoryTarget(input.repoUrl, input.gitRef);
  }
  if (input.registry && input.packageName) {
    return `${input.registry}:${input.packageName}${input.version ? `@${input.version}` : ""}`;
  }
  return undefined;
}

function isPackageTarget(hit: UnifiedSearchHitPayload): boolean {
  const registry = hit.locator.registry;
  const packageName = hit.locator.packageName;
  return Boolean(
    registry &&
      packageName &&
      hit.target.startsWith(`${registry}:${packageName}`),
  );
}

function appendRange(
  parts: string[],
  startLine: number | undefined,
  endLine: number | undefined,
): void {
  if (typeof startLine === "number") parts.push(`start_line=${startLine}`);
  if (typeof endLine === "number") parts.push(`end_line=${endLine}`);
}

function appendCliRange(
  parts: string[],
  startLine: number | undefined,
  endLine: number | undefined,
): void {
  if (typeof startLine !== "number" && typeof endLine !== "number") return;
  parts.push(
    "--lines",
    `${typeof startLine === "number" ? startLine : ""}-${typeof endLine === "number" ? endLine : ""}`,
  );
}

function quote(value: string): string {
  return JSON.stringify(value);
}
