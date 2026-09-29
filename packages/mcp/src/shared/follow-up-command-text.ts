import { capSearchReadTarget } from "./read-target-range.js";
import { renderReadTarget } from "./read-target-text.js";
import type { UnifiedSearchHitPresentation } from "./unified-search-response.js";

/** Target-only command used by the CLI docs-inventory smoke assertion. */
export function buildCliDocsReadCommand(target: string): string {
  return renderReadTarget({ target }, "cli");
}
/** Render the backend action; locator metadata only explains unavailable actions. */
export function buildSearchHitFollowUpCommand(
  hit: UnifiedSearchHitPresentation,
  syntax: "mcp" | "cli" = "mcp",
): string {
  const action = hit.readTarget;
  if (action) {
    const matched = hit.repositoryEvidence?.matchedSource;
    const evidence = hit.repositoryEvidence?.semanticContext
      ? matched
        ? {
            startLine: matched.startLine,
            endLine: matched.endLine,
            matchLine: matched.matchLine ?? undefined,
          }
        : undefined
      : hit.locator.evidenceRange;
    return renderReadTarget(
      syntax === "mcp" ? capSearchReadTarget(action, evidence) : action,
      syntax,
    );
  }
  const loc = hit.locator;
  const code =
    hit.type === "repository_code" || hit.type === "repository_symbol";
  if (code && loc.repoUrl && !loc.commitSha && !isPackageTarget(hit))
    return "follow-up unavailable: missing exact revision";
  if (code && !loc.filePath && !loc.repositoryFilePath)
    return "follow-up unavailable: missing filePath";
  return "follow-up unavailable: missing read target";
}

function isPackageTarget(hit: UnifiedSearchHitPresentation): boolean {
  const registry = hit.locator.registry;
  const packageName = hit.locator.packageName;
  return Boolean(
    registry &&
      packageName &&
      hit.target.startsWith(`${registry}:${packageName}`),
  );
}
