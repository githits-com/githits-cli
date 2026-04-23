import { z } from "zod";
import type { CodeNavigationService } from "../services/index.js";
import { mapCodeNavigationError } from "../shared/code-navigation-error-map.js";
import {
  buildGrepFileParams,
  GREP_PATTERN_SEMANTICS_NOTE,
} from "../shared/grep-file-request.js";
import { buildGrepFileSuccessPayload } from "../shared/grep-file-response.js";
import { toPkgseerRegistryLowercase } from "../shared/pkgseer-registry.js";
import {
  type CodeTargetArg,
  codeTargetSchema,
  resolveCodeTarget,
} from "./code-navigation-shared.js";
import { errorResult, type ToolDefinition, textResult } from "./types.js";

export interface GrepFileArgs {
  target: CodeTargetArg;
  path: string;
  pattern: string;
  context_lines?: number;
  max_matches?: number;
  wait_timeout_ms?: number;
}

const schema = {
  target: codeTargetSchema,
  path: z
    .string()
    .describe(
      "Path to the file to search. Package addressing: package-relative. Repo addressing: repo-relative.",
    ),
  pattern: z
    .string()
    .describe(
      `${GREP_PATTERN_SEMANTICS_NOTE} For symbol-shaped searches prefer unified \`search\` with \`sources:["symbol"]\`.`,
    ),
  context_lines: z
    .number()
    .optional()
    .describe(
      "Lines of context before and after each match (0–10, default 0 — matches only). Set explicitly when you need surrounding lines; nearby matches with overlapping context are returned unmerged (each match carries its own `contextBefore` / `contextAfter`).",
    ),
  max_matches: z
    .number()
    .optional()
    .describe("Max matches to return (1–200, default 50)."),
  wait_timeout_ms: z
    .number()
    .optional()
    .describe(
      "Max milliseconds to wait for indexing (0–60000, default 20000). On an `INDEXING` error envelope, retry with a longer timeout or pass a version from `details.availableVersions`.",
    ),
};

const DESCRIPTION =
  "Search within a single file for a case-insensitive substring " +
  "(not regex). Returns matches only by default — pass " +
  "`context_lines` for surrounding lines (0–10, default 0). " +
  `${GREP_PATTERN_SEMANTICS_NOTE} ` +
  "Response: `{pattern, path, totalMatches, hasMore, matches: " +
  "[{lineNumber, lineContent, contextBefore, contextAfter}], " +
  "language, totalLines}`. The `path` field matches `list_files`' " +
  "entry `path` and `read_file`'s `path` input, so chaining tools " +
  "needs no renames. Address via `target.registry` + " +
  "`target.package_name` (package scope) or `target.repo_url` + " +
  "`target.git_ref` (repo scope), mutually exclusive. For " +
  'symbol-shaped searches prefer unified `search` with `sources:["symbol"]`. When the path ' +
  "doesn't resolve the response is a `NOT_FOUND` (or " +
  "`FILE_NOT_FOUND`) error — call `list_files` to check the " +
  "actual paths.";

export function createGrepFileTool(
  service: CodeNavigationService,
): ToolDefinition<GrepFileArgs, typeof schema> {
  return {
    name: "grep_file",
    description: DESCRIPTION,
    schema,
    annotations: { readOnlyHint: true },
    handler: async (args) => {
      const target = resolveCodeTarget(args.target);
      if ("content" in target) return target;

      try {
        const build = buildGrepFileParams({
          target,
          path: args.path,
          pattern: args.pattern,
          contextLines: args.context_lines,
          maxMatches: args.max_matches,
          waitTimeoutMs: args.wait_timeout_ms,
        });
        const result = await service.grepFile(build.params);
        const payload = buildGrepFileSuccessPayload(result, {
          registry: target.registry
            ? toPkgseerRegistryLowercase(target.registry)
            : undefined,
          name: target.packageName,
          repoUrl: target.repoUrl,
          gitRef: target.gitRef,
          pattern: build.params.pattern,
          path: build.params.path,
          contextLinesExplicit: build.contextLinesExplicit,
          maxMatchesExplicit: build.maxMatchesExplicit,
          contextLines: build.params.contextLines ?? 0,
          maxMatches: build.params.maxMatches ?? 50,
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
