import { z } from "zod";
import type { CodeNavigationService } from "../services/index.js";
import { mapCodeNavigationError } from "../shared/code-navigation-error-map.js";
import {
  buildGrepRepoParams,
  buildGrepRepoSuccessPayload,
  GREP_REPO_PATTERN_NOTE,
} from "../shared/index.js";
import { toPkgseerRegistryLowercase } from "../shared/pkgseer-registry.js";
import {
  type CodeTargetArg,
  codeTargetSchema,
  resolveCodeTarget,
} from "./code-navigation-shared.js";
import { errorResult, type ToolDefinition, textResult } from "./types.js";

export interface GrepRepoArgs {
  target: CodeTargetArg;
  pattern: string;
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
  wait_timeout_ms?: number;
}

const pathSelectorSchema = z.object({
  kind: z.enum(["exact", "prefix", "glob"]),
  value: z.string(),
});

const schema = {
  target: codeTargetSchema,
  pattern: z.string().describe(GREP_REPO_PATTERN_NOTE),
  path: z
    .string()
    .optional()
    .describe(
      "Exact file path to grep. Shares the same path vocabulary as `read_file`.",
    ),
  path_prefix: z
    .string()
    .optional()
    .describe(
      "Literal directory prefix to scope grep, matching `list_files` / `search` naming.",
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
  wait_timeout_ms: z.number().optional(),
};

const DESCRIPTION =
  "Deterministic text grep over indexed dependency and repository source files. " +
  "Use this when you know the text pattern you want; use `search` for discovery. " +
  "Whole-target grep is the default. Narrow with `path`, `path_prefix`, `globs`, or `extensions`. " +
  "Matches chain directly into `read_file` via `matches[].filePath`.";

export function createGrepRepoTool(
  service: CodeNavigationService,
): ToolDefinition<GrepRepoArgs, typeof schema> {
  return {
    name: "grep_repo",
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
          excludeDocFiles: build.params.excludeDocFiles,
          excludeTestFiles: build.params.excludeTestFiles,
          explicit: build.explicit,
        });
        return textResult(JSON.stringify(payload));
      } catch (error) {
        const mapped = mapCodeNavigationError(error);
        return errorResult(
          JSON.stringify({
            error: mapped.message,
            code: mapped.code,
            retryable: mapped.retryable ?? false,
            ...(mapped.details ? { details: mapped.details } : {}),
          }),
        );
      }
    },
  };
}
