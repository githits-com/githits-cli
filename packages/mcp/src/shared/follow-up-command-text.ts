import type { UnifiedSearchSemanticPreferredRead } from "@githits/core-internal";
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
  const preferredRead = hit.repositoryEvidence?.semanticContext?.preferredRead;
  if (preferredRead) {
    const location = semanticReadLocation(preferredRead);
    const source = hit.repositoryEvidence?.focusedSource;
    const range =
      syntax === "mcp" &&
      preferredRead.endLine - preferredRead.startLine + 1 > MCP_READ_MAX_SPAN
        ? boundLargeReadRange(
            preferredRead,
            source
              ? {
                  startLine: source.startLine,
                  endLine: source.endLine,
                  matchLine: source.matchLine ?? undefined,
                }
              : undefined,
          )
        : preferredRead;
    const parts =
      syntax === "cli"
        ? [
            `githits code read ${shellQuote(location.target)} ${shellQuote(location.path)}`,
          ]
        : [
            `code_read target=${quote(location.target)} path=${quote(location.path)}`,
          ];
    if (syntax === "cli") appendCliRange(parts, range.startLine, range.endLine);
    else appendRange(parts, range.startLine, range.endLine);
    return parts.join(" ");
  }
  const loc = hit.locator;
  if (loc.pageId) {
    return syntax === "cli"
      ? buildCliDocsReadCommand(loc.pageId, loc.startLine, loc.endLine)
      : buildDocsReadCommand(loc.pageId, loc.startLine, loc.endLine);
  }
  if (
    (hit.type === "repository_code" || hit.type === "repository_symbol") &&
    loc.repoUrl &&
    !loc.commitSha &&
    !loc.gitRef &&
    !isPackageTarget(hit)
  ) {
    return "follow-up unavailable: missing exact revision";
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

interface SemanticReadLocation {
  target: string;
  path: string;
}

/** Keep display and read actions paired to the backend's attributed snapshot. */
export function semanticReadLocation(
  read: UnifiedSearchSemanticPreferredRead,
): SemanticReadLocation {
  if (read.registry && read.packageName && read.version) {
    return {
      target: `${read.registry.toLowerCase()}:${read.packageName}@${read.version}`,
      path: read.filePath,
    };
  }
  return {
    target: formatRepositoryTarget(read.repoUrl, read.commitSha),
    path: read.repositoryFilePath,
  };
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
  let startLine = definition?.startLine ?? evidence?.startLine ?? loc.startLine;
  const trueEndLine = definition?.endLine ?? evidence?.endLine ?? loc.endLine;
  let endLine = trueEndLine;
  if (
    syntax === "mcp" &&
    typeof startLine === "number" &&
    typeof trueEndLine === "number" &&
    trueEndLine - startLine + 1 > MCP_READ_MAX_SPAN
  ) {
    if (definition) {
      ({ startLine, endLine } = boundLargeReadRange(definition, evidence));
    } else if (evidence) {
      ({ startLine, endLine } = boundLargeReadRange(evidence, evidence));
    } else {
      endLine = startLine + MCP_READ_MAX_SPAN - 1;
    }
  }
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

function boundLargeReadRange(
  bounds: { startLine: number; endLine: number },
  evidence:
    | { startLine: number; endLine: number; matchLine?: number }
    | undefined,
): { startLine: number; endLine: number } {
  const latestStart = bounds.endLine - MCP_READ_MAX_SPAN + 1;
  const evidenceSpan = evidence
    ? evidence.endLine - evidence.startLine + 1
    : undefined;
  if (
    evidence &&
    typeof evidenceSpan === "number" &&
    evidenceSpan <= MCP_READ_MAX_SPAN
  ) {
    const leadingContext = Math.floor((MCP_READ_MAX_SPAN - evidenceSpan) / 2);
    const startLine = Math.min(
      Math.max(bounds.startLine, evidence.startLine - leadingContext),
      latestStart,
    );
    return { startLine, endLine: startLine + MCP_READ_MAX_SPAN - 1 };
  }

  const focusedLine = evidence?.matchLine ?? evidence?.startLine;
  const leadingContext = Math.floor((MCP_READ_MAX_SPAN - 1) / 2);
  const startLine = Math.min(
    Math.max(
      bounds.startLine,
      focusedLine === undefined
        ? bounds.startLine
        : focusedLine - leadingContext,
    ),
    latestStart,
  );
  return {
    startLine,
    endLine: startLine + MCP_READ_MAX_SPAN - 1,
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
