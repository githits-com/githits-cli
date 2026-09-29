import type { ReadTarget } from "@githits/core-internal";
import { shellQuote } from "./shell-quote.js";

/** Render opaque backend arguments using the caller's command syntax. */
export function renderReadTarget(
  action: ReadTarget,
  syntax: "mcp" | "cli" = "mcp",
): string {
  return syntax === "cli"
    ? renderCliReadTarget(action)
    : renderMcpReadTarget(action);
}

function renderMcpReadTarget(action: ReadTarget): string {
  const parts = [`read target=${JSON.stringify(action.target)}`];
  if (action.path !== undefined) {
    parts.push(`path=${JSON.stringify(action.path)}`);
  }
  if (action.selector !== undefined) {
    parts.push(`selector=${JSON.stringify(action.selector)}`);
  }
  if (action.startLine !== undefined) {
    parts.push(`start_line=${action.startLine}`);
  }
  if (action.endLine !== undefined) {
    parts.push(`end_line=${action.endLine}`);
  }
  return parts.join(" ");
}

function renderCliReadTarget(action: ReadTarget): string {
  const parts = [`githits read ${shellQuote(action.target)}`];
  const pathNeedsTerminator = action.path?.startsWith("-") === true;
  if (action.path !== undefined && !pathNeedsTerminator) {
    parts.push(shellQuote(action.path));
  }
  if (action.selector !== undefined) {
    parts.push("--selector", shellQuote(action.selector));
  }
  if (action.startLine !== undefined || action.endLine !== undefined) {
    parts.push("--lines", `${action.startLine ?? ""}-${action.endLine ?? ""}`);
  }
  if (action.path !== undefined && pathNeedsTerminator) {
    parts.push("--", shellQuote(action.path));
  }
  return parts.join(" ");
}
