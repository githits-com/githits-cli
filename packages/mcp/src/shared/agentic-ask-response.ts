import type { AgenticAskNeedsTargetResponse } from "@githits/core-internal";
import { formatResolveTargetCandidates } from "./resolve-target-response.js";
import { sanitizeTerminalText } from "./terminal-text.js";

/** Display a clarification consistently in CLI and MCP without implying an answer. */
export function formatAgenticAskClarification(
  response: AgenticAskNeedsTargetResponse,
): string {
  return `${[
    sanitizeTerminalText(response.message).trim(),
    formatResolveTargetCandidates(response.resolution).trimEnd(),
  ]
    .filter(Boolean)
    .join("\n\n")}\n`;
}
