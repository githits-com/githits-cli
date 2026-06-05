import type { CodeNavigationService } from "@githits/core-internal";
import { toPkgseerRegistryLowercase } from "@githits/core-internal";
import { z } from "zod";
import { mapCodeNavigationError } from "../shared/code-navigation-error-map.js";
import {
  buildGrepRepoParams,
  GREP_REPO_PATTERN_NOTE,
  GREP_REPO_SYMBOL_FIELDS,
  GREP_REPO_SYMBOL_FIELDS_NOTE,
  type GrepRepoSymbolField,
} from "../shared/grep-repo-request.js";
import { buildGrepRepoSuccessPayload } from "../shared/grep-repo-response.js";
import { renderGrepRepoText } from "../shared/grep-repo-text.js";
import {
  type CodeTargetArg,
  codeTargetSchema,
  resolveCodeTarget,
} from "./code-navigation-shared.js";
import { CODE_GREP_GUARDRAIL } from "./guardrails.js";
import { mcpMappedErrorResult } from "./shared.js";
import { type ToolDefinition, textResult } from "./types.js";

export interface GrepRepoArgs {
  target: CodeTargetArg;
  pattern?: string;
  path?: string;
  path_prefix?: string;
  globs?: string[];
  extensions?: string[];
  pattern_type?: "literal" | "regex";
  case_sensitive?: boolean;
  exclude_doc_files?: boolean;
  exclude_test_files?: boolean;
  context_lines?: number;
  context_lines_before?: number;
  context_lines_after?: number;
  max_matches?: number;
  max_matches_per_file?: number;
  cursor?: string;
  symbol_fields?: GrepRepoSymbolField[];
  wait_timeout_ms?: number;
  format?: "json" | "text" | "text-v1";
}

const schema = {
  target: codeTargetSchema,
  pattern: z.string().optional().describe(GREP_REPO_PATTERN_NOTE),
  path: z
    .string()
    .optional()
    .describe(
      "Exact file path to grep. Shares the same path vocabulary as `code_read`.",
    ),
  path_prefix: z
    .string()
    .optional()
    .describe(
      "Literal directory prefix to scope grep, matching `code_files` / `search` naming.",
    ),
  globs: z
    .array(z.string())
    .optional()
    .describe(
      "Repeatable glob scopes with real glob semantics (e.g. `src/**/*.ts`).",
    ),
  extensions: z
    .array(z.string())
    .optional()
    .describe("Extensions to include, without a leading dot."),
  pattern_type: z.enum(["literal", "regex"]).optional(),
  case_sensitive: z.boolean().optional(),
  exclude_doc_files: z.boolean().optional(),
  exclude_test_files: z.boolean().optional(),
  context_lines: z.number().optional(),
  context_lines_before: z.number().optional(),
  context_lines_after: z.number().optional(),
  max_matches: z.number().optional(),
  max_matches_per_file: z.number().optional(),
  cursor: z.string().optional(),
  symbol_fields: z
    .array(z.enum(GREP_REPO_SYMBOL_FIELDS))
    .optional()
    .describe(GREP_REPO_SYMBOL_FIELDS_NOTE),
  wait_timeout_ms: z.number().optional(),
  format: z
    .enum(["json", "text", "text-v1"])
    .optional()
    .describe(
      'Response format. Default `text-v1` — compact line-oriented output (matches grouped by file with grep -A/-B notation for context). Pass `format: "json"` for the structured envelope. `text` is an alias for `text-v1`. Errors stay JSON-formatted in either mode for now.',
    ),
};

const DESCRIPTION =
  "Deterministic text or regex grep over indexed dependency and repository source files. " +
  'Use this when you know the pattern (literal by default; pass `pattern_type: "regex"` for RE2). ' +
  "Use `search` for discovery instead. " +
  "Whole-target grep is the default — narrow with `path`, `path_prefix`, `globs`, or `extensions` to keep responses small. " +
  "Each match's `filePath` (or text file heading) chains into `code_read.path`; pick a window around `match.line` for `code_read.start_line` / `end_line`. " +
  "When fresh data is not ready within the wait window, responses may include `targetResolution` provenance and immediately-queryable alternatives in error details." +
  `\n\n${CODE_GREP_GUARDRAIL}`;

export function createGrepRepoTool(
  service: CodeNavigationService,
): ToolDefinition<GrepRepoArgs, typeof schema> {
  return {
    name: "code_grep",
    description: DESCRIPTION,
    schema,
    annotations: { readOnlyHint: true },
    handler: async (args) => {
      const target = resolveCodeTarget(args.target);
      if ("content" in target) return target;

      try {
        const build = buildGrepRepoParams({
          target,
          pattern: args.pattern,
          path: args.path,
          pathPrefix: args.path_prefix,
          globs: args.globs,
          extensions: args.extensions,
          patternType: args.pattern_type,
          caseSensitive: args.case_sensitive,
          excludeDocFiles: args.exclude_doc_files,
          excludeTestFiles: args.exclude_test_files,
          contextLines: args.context_lines,
          contextLinesBefore: args.context_lines_before,
          contextLinesAfter: args.context_lines_after,
          maxMatches: args.max_matches,
          maxMatchesPerFile: args.max_matches_per_file,
          cursor: args.cursor,
          symbolFields: args.symbol_fields,
          waitTimeoutMs: args.wait_timeout_ms,
        });
        const result = await service.grepRepo(build.params);
        const payload = buildGrepRepoSuccessPayload(result, {
          registry: target.registry
            ? toPkgseerRegistryLowercase(target.registry)
            : undefined,
          name: target.packageName,
          repoUrl: target.repoUrl,
          gitRef: target.gitRef,
          pattern: build.params.pattern,
          patternType:
            build.params.patternType === "REGEX" ? "regex" : "literal",
          caseSensitive: build.params.caseSensitive ?? false,
          path: args.path,
          pathPrefix: args.path_prefix,
          globs: args.globs,
          extensions: args.extensions,
          contextLines: args.context_lines,
          contextLinesBefore: build.params.contextLinesBefore ?? 0,
          contextLinesAfter: build.params.contextLinesAfter ?? 0,
          maxMatches: build.params.maxMatches ?? 50,
          maxMatchesPerFile: build.params.maxMatchesPerFile,
          cursor: args.cursor,
          symbolFields: build.params.symbolFields,
          excludeDocFiles: build.params.excludeDocFiles,
          excludeTestFiles: build.params.excludeTestFiles,
          explicit: build.explicit,
        });
        if (isTextFormat(args.format)) {
          return textResult(renderGrepRepoText(payload));
        }
        return textResult(JSON.stringify(payload));
      } catch (error) {
        const mapped = mapCodeNavigationError(error);
        return mcpMappedErrorResult(mapped);
      }
    },
  };
}

/**
 * Default response format is text-v1; programmatic callers opt into
 * JSON explicitly via `format: "json"`.
 */
function isTextFormat(format: GrepRepoArgs["format"]): boolean {
  return format === undefined || format === "text" || format === "text-v1";
}
