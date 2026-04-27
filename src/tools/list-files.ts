import { z } from "zod";
import type { CodeNavigationService } from "../services/index.js";
import { mapCodeNavigationError } from "../shared/code-navigation-error-map.js";
import { buildListFilesParams } from "../shared/list-files-request.js";
import { buildListFilesSuccessPayload } from "../shared/list-files-response.js";
import { toPkgseerRegistryLowercase } from "../shared/pkgseer-registry.js";
import {
  type CodeTargetArg,
  codeTargetSchema,
  resolveCodeTarget,
} from "./code-navigation-shared.js";
import { errorResult, type ToolDefinition, textResult } from "./types.js";

export interface ListFilesArgs {
  target: CodeTargetArg;
  path_prefix?: string;
  limit?: number;
  wait_timeout_ms?: number;
}

const schema = {
  target: codeTargetSchema,
  path_prefix: z
    .string()
    .optional()
    .describe(
      "Literal directory prefix to filter by (e.g. `src/` or `lib/parser`). NOT a glob — `*.ts` and similar patterns won't match. Omit to list from the repository root.",
    ),
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
      "Max milliseconds to wait for indexing (0–60000, default 20000). On an `INDEXING` error envelope, retry with a longer timeout or pass a version from `details.availableVersions`.",
    ),
};

const DESCRIPTION =
  "List files in an indexed dependency. Response: " +
  "`{total, hasMore, files: [{path, name, language, fileType, byteSize}], " +
  "resolution, indexedVersion}`. Address via `target.registry` + " +
  "`target.package_name` (package scope) or `target.repo_url` + " +
  "`target.git_ref` (repo scope), mutually exclusive. `path_prefix` " +
  "is a literal directory prefix — it does NOT accept globs " +
  "(`*.ts`) or extension filters. The returned `path` values feed " +
  "directly into `code_read` and help scope `code_grep`. Returns an `INDEXING` " +
  "error envelope when the dependency is being indexed on-demand — " +
  "retry with a longer `wait_timeout_ms` or use a version from " +
  "`details.availableVersions`.";

export function createListFilesTool(
  service: CodeNavigationService,
): ToolDefinition<ListFilesArgs, typeof schema> {
  return {
    name: "code_files",
    description: DESCRIPTION,
    schema,
    annotations: { readOnlyHint: true },
    handler: async (args) => {
      const target = resolveCodeTarget(args.target);
      if ("content" in target) return target;

      try {
        const build = buildListFilesParams({
          target,
          pathPrefix: args.path_prefix,
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
          limitExplicit: build.limitExplicit,
          pathPrefixExplicit: build.pathPrefixExplicit,
          pathPrefix: build.params.pathPrefix,
          limit: build.params.limit,
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
