import type { CodeNavigationService } from "@githits/core-internal";
import { toPkgseerRegistryLowercase } from "@githits/core-internal";
import { z } from "zod";
import { knownFileIntentList } from "../shared/code-navigation.js";
import { mapCodeNavigationError } from "../shared/code-navigation-error-map.js";
import { buildListFilesParams } from "../shared/list-files-request.js";
import { buildListFilesSuccessPayload } from "../shared/list-files-response.js";
import { renderListFilesText } from "../shared/list-files-text.js";
import {
  type CodeTargetArg,
  codeTargetSchema,
  resolveCodeTarget,
} from "./code-navigation-shared.js";
import { mcpMappedErrorResult } from "./shared.js";
import {
  BOUNDED_WRITE_TOOL_ANNOTATIONS,
  type ToolDefinition,
  textResult,
  type ZodRawShape,
} from "./types.js";

export interface ListFilesArgs {
  target: CodeTargetArg;
  path?: string;
  path_prefix?: string;
  globs?: string[];
  extensions?: string[];
  file_types?: string[];
  languages?: string[];
  file_intent?: string;
  file_intents?: string[];
  exclude_file_intents?: string[];
  exclude_doc_files?: boolean;
  exclude_test_files?: boolean;
  include_hidden?: boolean;
  limit?: number;
  wait_timeout_ms?: number;
  format?: "json" | "text" | "text-v1";
}

const schema: ZodRawShape = {
  target: codeTargetSchema,
  path: z
    .string()
    .optional()
    .describe(
      "Exact target-relative file path to include. When combined with `path_prefix` or `globs`, files matching any selector are returned.",
    ),
  path_prefix: z
    .string()
    .optional()
    .describe(
      "Literal directory prefix to filter by (e.g. `src/` or `lib/parser`). NOT a glob. OR-ed with `path` and `globs` when combined.",
    ),
  globs: z
    .array(z.string())
    .optional()
    .describe(
      "Repeatable glob selectors with real glob semantics (e.g. `src/**/*.ts`). OR-ed with `path` and `path_prefix`.",
    ),
  extensions: z
    .array(z.string())
    .optional()
    .describe("File extensions to include, without a leading dot."),
  file_types: z
    .array(z.string())
    .optional()
    .describe(
      "File type filters to include, matching aigrep file_type values such as `source` or `doc`.",
    ),
  languages: z
    .array(z.string())
    .optional()
    .describe("Language filters to include, matching aigrep language names."),
  file_intent: z
    .string()
    .optional()
    .describe(
      `Single inclusive file-intent filter. Cannot be combined with \`file_intents\`. Valid values: ${knownFileIntentList().join(", ")}.`,
    ),
  file_intents: z
    .array(z.string())
    .optional()
    .describe(
      `Inclusive file-intent filters. Cannot be combined with \`file_intent\`. Valid values: ${knownFileIntentList().join(", ")}.`,
    ),
  exclude_file_intents: z
    .array(z.string())
    .optional()
    .describe(
      `Exclude these file intents after inclusive intent filtering. Valid values: ${knownFileIntentList().join(", ")}.`,
    ),
  exclude_doc_files: z.boolean().optional(),
  exclude_test_files: z.boolean().optional(),
  include_hidden: z.boolean().optional(),
  limit: z
    .number()
    .optional()
    .describe(
      "Max entries to return (1–1000, default 200). Out-of-range values return an `INVALID_ARGUMENT` envelope.",
    ),
  wait_timeout_ms: z
    .number()
    .optional()
    .describe(
      "Max milliseconds to wait for indexing (0-60000, default 20000). On an `INDEXING` error envelope, use `details.indexingEstimate` when present to decide whether to wait longer, or pass an already-indexed version/ref from `details.availableVersions` / `details.availableRefs`; `suggestedRefs` are fuzzy hints and may need indexing first.",
    ),
  format: z
    .enum(["text-v1", "text", "json"])
    .default("text-v1")
    .describe(
      'Response format. Default `text-v1` — compact paths-only listing. Pass `format: "json"` for the structured envelope. `text` is an alias for `text-v1`. Errors stay JSON-formatted in either mode for now.',
    ),
};

const DESCRIPTION =
  "List indexed source files and paths for enumeration, then hand off to " +
  "`code_read` or `code_grep`. First choice for file/path " +
  "enumeration tasks such as files under a directory; use " +
  "`path_prefix` for directory prefixes (e.g. `lib/`) and optional " +
  "`extensions` for language filtering. Use this to discover paths " +
  "before `code_read` (when you don't yet know the path, or it returns " +
  "`FILE_NOT_FOUND`, `FILE_PATH_EXCLUDED`, or " +
  "`SOURCE_FILE_INVENTORY_UNKNOWN`) and to scope `code_grep`. Address " +
  "via `target.registry` + `target.package_name` (package scope) or " +
  "`target.repo_url` + optional `target.git_ref` (repo scope), mutually " +
  "exclusive. Narrow with `path`, `path_prefix`, `globs`, " +
  "`extensions`, `file_types`, `languages`, or file-intent filters. " +
  "JSON envelope shape: `{total, hasMore, files: [{path, name, " +
  "language, fileType, byteSize}], resolution, indexedVersion}`. " +
  "When fresh data is not ready within the wait window, responses may " +
  "include `targetResolution` provenance, `indexingEstimate`, and immediately-queryable " +
  "alternatives. `availableVersions` and `availableRefs` are already " +
  "indexed/queryable; `suggestedRefs` are fuzzy ref hints and may need " +
  "indexing first. On an `INDEXING` error envelope, retry with a longer " +
  "`wait_timeout_ms` or use a version/ref from `details.availableVersions` " +
  "/ `details.availableRefs`.";

export function createListFilesTool(
  service: CodeNavigationService,
): ToolDefinition<ListFilesArgs, typeof schema> {
  return {
    name: "code_files",
    description: DESCRIPTION,
    schema,
    annotations: BOUNDED_WRITE_TOOL_ANNOTATIONS,
    handler: async (args) => {
      const target = resolveCodeTarget(args.target);
      if ("content" in target) return target;

      try {
        const build = buildListFilesParams({
          target,
          path: args.path,
          pathPrefix: args.path_prefix,
          globs: args.globs,
          extensions: args.extensions,
          fileTypes: args.file_types,
          languages: args.languages,
          fileIntent: args.file_intent,
          fileIntents: args.file_intents,
          excludeFileIntents: args.exclude_file_intents,
          excludeDocFiles: args.exclude_doc_files,
          excludeTestFiles: args.exclude_test_files,
          includeHidden: args.include_hidden,
          limit: args.limit,
          waitTimeoutMs: args.wait_timeout_ms,
        });
        const result = await service.listFiles(build.params);
        const payload = buildListFilesSuccessPayload(result, {
          registry: target.registry
            ? toPkgseerRegistryLowercase(target.registry)
            : undefined,
          name: target.packageName,
          repoUrl: target.repoUrl,
          gitRef: target.gitRef,
          path: build.filterEcho.path,
          pathPrefix: build.filterEcho.pathPrefix,
          globs: build.filterEcho.globs,
          extensions: build.filterEcho.extensions,
          fileTypes: build.filterEcho.fileTypes,
          languages: build.filterEcho.languages,
          fileIntent: build.filterEcho.fileIntent,
          fileIntents: build.filterEcho.fileIntents,
          excludeFileIntents: build.filterEcho.excludeFileIntents,
          excludeDocFiles: build.filterEcho.excludeDocFiles,
          excludeTestFiles: build.filterEcho.excludeTestFiles,
          includeHidden: build.filterEcho.includeHidden,
          limit: build.filterEcho.limit,
          explicit: build.explicit,
        });
        if (isTextFormat(args.format)) {
          return textResult(renderListFilesText(payload));
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
function isTextFormat(format: ListFilesArgs["format"]): boolean {
  return format === undefined || format === "text" || format === "text-v1";
}
