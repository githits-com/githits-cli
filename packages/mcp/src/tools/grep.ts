import type { GrepParams, GrepService } from "@githits/core-internal";
import { z } from "zod";
import { DEFAULT_WAIT_TIMEOUT_MS } from "../shared/code-navigation-defaults.js";
import { mapGrepError } from "../shared/grep-error-map.js";
import {
  buildGrepParams,
  type GrepRequestTargetInput,
} from "../shared/grep-request.js";
import { projectGrepResult } from "../shared/grep-response.js";
import { formatGrepText } from "../shared/grep-text.js";
import { serviceRequestArgs } from "../shared/service-request-args.js";
import { CODE_GREP_GUARDRAIL } from "./guardrails.js";
import { mcpMappedErrorResult, throwIfCallerCancellation } from "./shared.js";
import {
  OPEN_WORLD_READ_ONLY_TOOL_ANNOTATIONS,
  type ToolDefinition,
  textResult,
  type ZodRawShape,
} from "./types.js";

export interface GrepArgs {
  targets: Array<{
    target: string;
    corpus?: "source" | "documentation" | "all";
    path_selectors?: Array<{
      kind: "exact" | "prefix" | "glob";
      value: string;
    }>;
  }>;
  pattern: string;
  pattern_type?: "regex" | "literal";
  ignore_case?: boolean;
  context_lines_before?: number;
  context_lines_after?: number;
  max_matches?: number;
  cursor?: string;
  wait_timeout_ms?: number;
  format?: "text" | "json";
}

const targetSchema = z.object({
  target: z
    .string()
    .describe(
      "Package `npm:express@5.2.1`, repository `github:expressjs/express@v5.2.1` or `launchpad:~owner/+git/repo@ref` (`lp:PROJECT` also accepted), or hosted docs `site:expressjs.com/en/5x`.",
    ),
  corpus: z
    .enum(["source", "documentation", "all"])
    .optional()
    .describe(
      "Filters repository files (default all); selected hosted docs are unaffected. Omit for sites.",
    ),
  path_selectors: z
    .array(
      z.object({
        kind: z.enum(["exact", "prefix", "glob"]),
        value: z.string(),
      }),
    )
    .optional()
    .describe(
      "OR-ed file scopes relative to the package/repository root. Empty applies no path filter; corpus still applies. Hosted docs are unaffected; omit for sites.",
    ),
});

const schema: ZodRawShape = {
  targets: z
    .array(targetSchema)
    .min(1)
    .max(20)
    .describe("One to 20 ordered package, repository, or site targets."),
  pattern: z
    .string()
    .describe(
      "RE2 regex by default, or exact text with pattern_type literal (1-200 UTF-8 bytes). Prefer literal identifiers. A pipe means alternation; escaping it matches a literal pipe. No lookaround/backreferences. Content-index regex needs literal text; a single exact-file route accepts anchorless regex. A path selector alone does not guarantee that route.",
    ),
  pattern_type: z
    .enum(["regex", "literal"])
    .optional()
    .describe(
      "Regex by default; select literal for identifiers/text when regex structure is unnecessary.",
    ),
  ignore_case: z
    .boolean()
    .optional()
    .describe(
      "true ignores case with Unicode folding; false (default) is case-sensitive.",
    ),
  context_lines_before: z
    .number()
    .int()
    .min(0)
    .max(10)
    .optional()
    .describe("Lines before each match (0-10; default 0)."),
  context_lines_after: z
    .number()
    .int()
    .min(0)
    .max(10)
    .optional()
    .describe("Lines after each match (0-10; default 0)."),
  max_matches: z
    .number()
    .int()
    .min(1)
    .max(1000)
    .optional()
    .describe(
      "Maximum occurrences across all scopes on this page (default 100).",
    ),
  cursor: z
    .string()
    .optional()
    .describe(
      "Copy the complete returned cursor unchanged. Keep the entire targets array (including corpus/path_selectors), pattern/type, case mode, context counts and max_matches unchanged. To change them, omit cursor and start a new request. Empty starts page one. Hosted pages can change before read.",
    ),
  wait_timeout_ms: z
    .number()
    .int()
    .min(0)
    .max(300_000)
    .optional()
    .describe(
      `First-page preparation wait in milliseconds (default ${DEFAULT_WAIT_TIMEOUT_MS}). Continuation never waits.`,
    ),
  format: z
    .enum(["text", "json"])
    .default("text")
    .describe(
      "Omit for text: grouped matches, read locators, and coverage. Use json only when code consumes raw hit and scope fields.",
    ),
};

const DESCRIPTION =
  `Find regex or literal matches across source and documentation. Search ordered package, repository, and site targets for occurrences and call sites. Read known definitions with selector first; use literal grep for unresolved identifiers, search for concepts. Context is capped at 10 lines per side; read for larger sections once located. Package targets include selected hosted docs independently of source filters. Text includes read locators; counts cover one page. Preserve ordered targets, matching controls, and coverage limits when continuing.` +
  `\n\n${CODE_GREP_GUARDRAIL}`;

/** One mixed-source MCP page using the same semantics as the top-level CLI. */
export function createGrepTool(
  service: GrepService,
): ToolDefinition<GrepArgs, typeof schema> {
  return {
    name: "grep",
    description: DESCRIPTION,
    schema,
    annotations: OPEN_WORLD_READ_ONLY_TOOL_ANNOTATIONS,
    handler: async (args, context) => {
      try {
        const params: GrepParams = buildGrepParams({
          targets: args.targets.map(
            (entry): GrepRequestTargetInput => ({
              target: entry.target,
              corpus: entry.corpus,
              pathSelectors: entry.path_selectors,
            }),
          ),
          pattern: args.pattern,
          patternType: args.pattern_type,
          ignoreCase: args.ignore_case,
          contextLinesBefore: args.context_lines_before,
          contextLinesAfter: args.context_lines_after,
          maxMatches: args.max_matches,
          cursor: args.cursor,
          waitTimeoutMs: args.wait_timeout_ms,
          includeDetailedFields: args.format === "json",
        });
        const result = await service.grep(
          params,
          ...serviceRequestArgs(context?.signal),
        );
        const projected = projectGrepResult(result);
        return textResult(
          args.format === "json"
            ? JSON.stringify(projected)
            : formatGrepText(result, {
                syntax: "mcp",
                useColors: false,
                requestedTargets: params.targets.map((target) => target.target),
              }),
        );
      } catch (error) {
        throwIfCallerCancellation(error, context?.signal);
        const mapped = mapGrepError(error);
        if (mapped.code === "INDEXING" && mapped.retryable) {
          mapped.details = {
            ...mapped.details,
            action:
              "Retry grep with the same targets, pattern, and other controls; set wait_timeout_ms (up to 300000) to wait for target preparation.",
          };
        }
        return mcpMappedErrorResult(mapped, context, args.format, {
          recovery: { syntax: "mcp", tool: "grep", args },
        });
      }
    },
  };
}
