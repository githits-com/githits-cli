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
    "Compact target string. Package targets inspect an indexed artifact/manifest root: `npm:react@18.2.0` or `npm:react` for latest release; Swift uses `swift:github.com/<owner>/<repo>` or `swift:gitlab.com/<group>/<project>` and Zig uses `zig:gh/<owner>/<repo>` or `zig:cb/<owner>/<repo>`. Use a public repository target for the full repository or sibling packages: `github:facebook/react`, `codeberg:zigil/decimal`, `gitlab:group/subgroup/project`, or approved full HTTPS URLs (GitHub also accepts `github.com/owner/repo` and HTTP), or any repo form with `#HEAD` / `@HEAD` for a git ref. Output uses canonical `provider:path#ref` form. Codeberg requires owner/repo; GitLab allows nested namespaces. Bare owner/repo, self-hosted URLs, web subpaths, credentials, query strings, empty refs, and mixed suffixes are rejected. Refs may contain / and @.",
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
