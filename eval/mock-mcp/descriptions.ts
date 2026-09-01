import { QUICK_START_PREREQUISITE } from "@githits/mcp/internal";

/** Compose the same MCP-session footer as the production server. */
export function composeEvalMcpDescription(
  base: string,
  guardrail: string,
  includeGuardrail: boolean,
): string {
  const description = includeGuardrail ? `${base}\n\n${guardrail}` : base;
  return `${description}\n\n${QUICK_START_PREREQUISITE}`;
}
