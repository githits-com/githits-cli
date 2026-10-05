import type { CodeNavigationTarget } from "@githits/core-internal";
import { z } from "zod";
import { mapCodeNavigationError } from "../shared/code-navigation-error-map.js";
import { parseCodeNavigationTargetSpec } from "../shared/code-navigation-target.js";
import { mcpMappedErrorResult } from "./shared.js";
import type { ToolExecutionContext, ToolResult } from "./types.js";

// Re-export the wait-timeout default so callers already importing this
// module keep working; the canonical definition lives in
// src/shared/code-navigation-defaults.ts per the CLI/MCP parity rules.
export { DEFAULT_WAIT_TIMEOUT_MS } from "../shared/code-navigation-defaults.js";

export const codeTargetSchema: z.ZodType<CodeTargetArg> = z
  .string()
  .min(1)
  .describe(
    "Compact target: `npm:react@version` or `github:facebook/react@ref`. Omit the suffix for the latest package version or repository default branch; a ref may be a branch, tag, or commit. `#` is for semantic fragments. Package targets scope to the package subpath; repository targets cover the full repository.",
  );

export type CodeTargetArg = string;

/** Validate a code target while respecting the caller's error format and remediation. */
export function resolveCodeTarget(
  target: CodeTargetArg,
  context?: ToolExecutionContext,
  format?: "text" | "json",
): CodeNavigationTarget | ToolResult {
  try {
    return parseCodeNavigationTargetSpec(target);
  } catch (error) {
    return mcpMappedErrorResult(mapCodeNavigationError(error), context, format);
  }
}
