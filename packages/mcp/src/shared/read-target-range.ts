import type { ReadTarget } from "@githits/core-internal";
import { MCP_READ_MAX_SPAN } from "./code-navigation-defaults.js";
import { renderReadTarget } from "./read-target-text.js";

interface ReadEvidenceRange {
  startLine: number;
  endLine: number;
  matchLine?: number;
}

/** Narrow only explicit path selections; identity and selector remain backend-owned. */
export function capSearchReadTarget(
  action: ReadTarget,
  evidence?: ReadEvidenceRange,
): ReadTarget {
  if (
    action.path === undefined ||
    action.startLine === undefined ||
    action.endLine === undefined ||
    action.endLine - action.startLine + 1 <= MCP_READ_MAX_SPAN
  )
    return action;
  return {
    ...action,
    ...boundLargeReadRange(
      { startLine: action.startLine, endLine: action.endLine },
      evidence,
    ),
  };
}

/** Preserve the remaining served selection; the next response applies its cap. */
export function buildReadContinuationHint(
  action: ReadTarget | null | undefined,
  nextStartLine: number,
  returnedEndLine: number,
): string {
  if (!action) return "Continuation unavailable: missing read target.";
  const continuation: ReadTarget = {
    target: action.target,
    ...(action.path !== undefined ? { path: action.path } : {}),
    startLine: nextStartLine,
    endLine: returnedEndLine,
  };
  return `Continue with ${renderReadTarget(continuation)}.`;
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
