import type { GrepParams, GrepService } from "@githits/core-internal";
import { z } from "zod";
import { mapGrepError } from "../shared/grep-error-map.js";
import {
  buildGrepParams,
  type GrepRequestTargetInput,
} from "../shared/grep-request.js";
import { projectGrepResult } from "../shared/grep-response.js";
import { formatGrepText } from "../shared/grep-text.js";
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
      "Known package such as `npm:express@5.2.1`, repository such as `github:expressjs/express`, or explicit hosted site such as `site:expressjs.com/en/5x`.",
    ),
  corpus: z
    .enum(["source", "documentation", "all"])
    .optional()
    .describe(
      "Repository files to search: all (default), source, or documentation. Package-selected hosted docs are included independently. Omit for a site target.",
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
      "OR-ed package/repository-relative file scopes. Empty means the whole target. Omit for a site target; a site's path scope belongs in its `site:` target.",
    ),
});

const schema: ZodRawShape = {
  targets: z
    .array(targetSchema)
    .min(1)
    .max(20)
    .describe(
      "One to 20 ordered package, repository, or explicit site targets. Package targets also expand to selected hosted docs. Replay the identical ordered targets and controls with a cursor.",
    ),
  pattern: z
    .string()
    .describe(
      "Known string or RE2 regex, 1-200 UTF-8 bytes. Regex is the default; use pattern_type literal for metacharacters as text. Multi-file regex needs a usable literal anchor.",
    ),
  pattern_type: z
    .enum(["regex", "literal"])
    .optional()
    .describe("Regex (default) or literal substring matching."),
  ignore_case: z
    .boolean()
    .optional()
    .describe(
      "Omit or pass false for case-sensitive matching (default); true uses Unicode-aware case folding.",
    ),
  context_lines_before: z
    .number()
    .int()
    .min(0)
    .max(10)
    .optional()
    .describe("Leading context lines, 0 by default and at most 10."),
  context_lines_after: z
    .number()
    .int()
    .min(0)
    .max(10)
    .optional()
    .describe("Trailing context lines, 0 by default and at most 10."),
  max_matches: z
    .number()
    .int()
    .min(1)
    .max(1000)
    .optional()
    .describe("Global match cap per page, 100 by default (1-1000)."),
  cursor: z
    .string()
    .optional()
    .describe(
      "Opaque continuation from the previous grep page. Replay the same ordered targets, pattern, and controls; empty means page one.",
    ),
  wait_timeout_ms: z
    .number()
    .int()
    .min(0)
    .max(300_000)
    .optional()
    .describe(
      "Target-preparation wait in milliseconds, 0 by default. Continuation does not wait for preparation.",
    ),
  format: z
    .enum(["text", "json"])
    .default("text")
    .describe(
      "Omit for compact readable evidence, exact read guidance, coverage, and continuation. Use json only when code consumes the full result programmatically.",
    ),
};

const DESCRIPTION =
  "Find regex or literal matches across source and documentation. " +
  "Search ordered package, repository, and explicit site targets with exact read actions and continuation. " +
  "Replaces code_grep. Defaults to RE2 regex, case-sensitive matching, zero context, and all indexed repository files; package targets also include selected hosted documentation. " +
  "Use `list` to browse paths, `search` to discover topics, and `read` to open returned locators. " +
  "Results may be partial; follow the returned cursor with identical targets and controls. " +
  "Literal, case-insensitive, source-corpus, file-scope, context, page-size, and preparation-wait controls are explicit. " +
  "Legacy source-only filters are unavailable; `githits code grep` retains them in the CLI." +
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
        const projected = projectGrepResult(await service.grep(params));
        return textResult(
          args.format === "json"
            ? JSON.stringify(projected)
            : formatGrepText(projected, { syntax: "mcp", useColors: false }),
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
        return mcpMappedErrorResult(mapped, context);
      }
    },
  };
}
