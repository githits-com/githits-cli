import type { CodeNavigationTarget } from "@githits/core-internal";
import { z } from "zod";
import { mapCodeNavigationError } from "../shared/code-navigation-error-map.js";
import { parseCodeNavigationTargetSpec } from "../shared/code-navigation-target.js";
import { mcpMappedErrorResult } from "./shared.js";
import type { ToolResult } from "./types.js";

// Re-export the wait-timeout default so callers already importing this
// module keep working; the canonical definition lives in
// src/shared/code-navigation-defaults.ts per the CLI/MCP parity rules.
export { DEFAULT_WAIT_TIMEOUT_MS } from "../shared/code-navigation-defaults.js";

export const codeTargetSchema: z.ZodType<CodeTargetArg> = z
  .string()
  .min(1)
  .describe(
    "Compact package or public-repository target, such as `npm:react@18.2.0`, `github:facebook/react`, or `gitlab:group/project#main`. Package targets inspect an indexed artifact; repository targets cover the full repository.",
  );

export type CodeTargetArg = string;

/**
 * Validates and normalizes a code navigation target.
 *
 * Error results carry a JSON-encoded `{ error, code: "INVALID_ARGUMENT" }`
 * envelope per PARITY-ERROR-ENVELOPE — MCP error text must always be
 * valid JSON regardless of which validation branch fires.
 */
export function resolveCodeTarget(
  target: CodeTargetArg,
): CodeNavigationTarget | ToolResult {
  try {
    return parseCodeNavigationTargetSpec(target);
  } catch (error) {
    return mappedInvalidTargetResult(error);
  }
}

function mappedInvalidTargetResult(error: unknown): ToolResult {
  const mapped = mapCodeNavigationError(error);
  return mcpMappedErrorResult(mapped);
}
