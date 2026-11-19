import type { ChangelogStatementCoverage } from "@githits/core-internal";
import { shellQuoteExact } from "./shell-quote.js";
import { sanitizeTerminalText } from "./terminal-text.js";

export const RISK_KIND_LABELS: Record<string, string> = {
  removes_or_renames_api: "removal",
  changes_behavior_or_default: "behavior",
  raises_runtime_or_platform_requirement: "runtime/platform",
  changes_packaging_or_module_format: "packaging/modules",
  deprecates_without_removal: "deprecation",
  security_fix: "security fix",
  notable_change: "notable change",
};

export const INCOMPLETE_CHANGELOG_ANALYSIS =
  "GitHits hasn't checked all the release notes yet.";

const UPSTREAM_NOTES_UNAVAILABLE_TEXT =
  "Upstream release notes aren't available to this request";
export const UPSTREAM_NOTES_UNAVAILABLE = `${UPSTREAM_NOTES_UNAVAILABLE_TEXT}.`;

interface ChangelogRetry {
  cli: string;
  mcp: { tool: "pkg_changelog"; arguments: { target: string } };
}

export interface ChangelogAnalysisNotice {
  version: string;
  kind:
    | "classification_incomplete"
    | "commit_analysis_incomplete"
    | "commit_analysis_unavailable";
  message: string;
  retry?: ChangelogRetry;
}

export function buildChangelogRetry(target: string): ChangelogRetry {
  const operand = /^[\w:@/.-]+$/.test(target)
    ? target
    : shellQuoteExact(target);
  return {
    cli: `githits pkg changelog ${operand}`,
    mcp: { tool: "pkg_changelog", arguments: { target } },
  };
}

/** Explain incomplete analysis using only the coverage returned for each release. */
export function buildChangelogAnalysisNotices(
  coverage: readonly ChangelogStatementCoverage[],
  identity?: string,
): ChangelogAnalysisNotice[] | undefined {
  const notices: ChangelogAnalysisNotice[] = [];
  for (const release of coverage) {
    const { version, generation } = release;
    const incomplete =
      release.status === "NOT_ASSESSED" || release.statementsNotAssessed > 0;
    const retry =
      identity && (incomplete || generation?.status === "PENDING")
        ? buildChangelogRetry(`${identity}@${version}`)
        : undefined;
    if (incomplete)
      notices.push({
        version,
        kind: "classification_incomplete",
        message: INCOMPLETE_CHANGELOG_ANALYSIS,
        retry,
      });
    const reason = generation?.reason ? ` (${generation.reason})` : "";
    if (generation?.status === "PENDING")
      notices.push({
        version,
        kind: "commit_analysis_incomplete",
        message:
          generation.reason === "generating"
            ? "GitHits commit analysis is running."
            : "GitHits didn't finish checking the commits.",
        retry,
      });
    if (generation?.status === "NOT_GENERATED")
      notices.push({
        version,
        kind: "commit_analysis_unavailable",
        message: `Commit-based changelog analysis was unavailable${reason}.`,
      });
  }
  return notices.length ? notices : undefined;
}

export function formatChangelogAnalysisNotice(
  notice: ChangelogAnalysisNotice,
  surface?: "cli" | "mcp",
  noUpstreamNotes = false,
): string[] {
  const notes =
    noUpstreamNotes && notice.kind === "commit_analysis_incomplete"
      ? `${UPSTREAM_NOTES_UNAVAILABLE_TEXT} and `
      : "";
  const lines = [safeRiskText(`${notes}${notice.message}`)];
  if (notice.retry)
    lines.push(
      safeRiskText(
        `Please retry later with ${formatChangelogRetry(notice.retry, surface)}`,
      ),
    );
  return lines;
}

export function formatChangelogRetry(
  retry: ChangelogRetry,
  surface: "cli" | "mcp" = "cli",
): string {
  return surface === "mcp"
    ? `${retry.mcp.tool} ${JSON.stringify(retry.mcp.arguments)}`
    : retry.cli;
}

export function safeRiskText(value: string): string {
  return sanitizeTerminalText(value.replace(/\s+/g, " ")).trim();
}
