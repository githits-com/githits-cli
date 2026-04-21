import { z } from "zod";
import type { CodeNavigationService } from "../services/index.js";
import { mapCodeNavigationError } from "../shared/code-navigation-error-map.js";
import { toPkgseerRegistryLowercase } from "../shared/pkgseer-registry.js";
import { buildReadFileParams } from "../shared/read-file-request.js";
import { buildReadFileSuccessPayload } from "../shared/read-file-response.js";
import {
  type CodeTargetArg,
  codeTargetSchema,
  resolveCodeTarget,
} from "./code-navigation-shared.js";
import { errorResult, type ToolDefinition, textResult } from "./types.js";

export interface ReadFileArgs {
  target: CodeTargetArg;
  path: string;
  start_line?: number;
  end_line?: number;
  wait_timeout_ms?: number;
}

const schema = {
  target: codeTargetSchema,
  path: z
    .string()
    .describe(
      "Path to the file. Package addressing: package-relative. Repo addressing: repo-relative. This is the same `path` key that `list_files` emits for each entry, so the `list_files` → `read_file` chain needs no renaming.",
    ),
  start_line: z
    .number()
    .optional()
    .describe("Starting line (1-indexed). Omit for the full file from line 1."),
  end_line: z
    .number()
    .optional()
    .describe(
      "Ending line (inclusive). Omit for end of file. Must be ≥ `start_line` when both are set.",
    ),
  wait_timeout_ms: z
    .number()
    .optional()
    .describe(
      "Max milliseconds to wait for indexing (0–60000, default 20000). On an `INDEXING` error envelope, retry with a longer timeout or pass a version from `details.availableVersions`.",
    ),
};

const DESCRIPTION =
  "Read a file from an indexed dependency. Default returns the full " +
  "file; use `start_line` / `end_line` for a bounded range. Response: " +
  "`{path, language, totalLines, startLine, endLine, content, " +
  "isBinary}`. Binary files set `isBinary: true` and omit `content` — " +
  "agents branch on the flag rather than checking null. Pass the same " +
  "`path` emitted by `list_files`. Address via " +
  "`target.registry` + `target.package_name` (package scope) or " +
  "`target.repo_url` + `target.git_ref` (repo scope), mutually " +
  "exclusive. On `INDEXING` retry with a longer `wait_timeout_ms` " +
  "(note: `fetchCodeContext` doesn't emit `availableVersions` in " +
  "details, only `indexingRef`). When the path doesn't resolve the " +
  "response is a `NOT_FOUND` (or `FILE_NOT_FOUND`) error — call " +
  "`list_files` to discover the actual paths.";

export function createReadFileTool(
  service: CodeNavigationService,
): ToolDefinition<ReadFileArgs, typeof schema> {
  return {
    name: "read_file",
    description: DESCRIPTION,
    schema,
    annotations: { readOnlyHint: true },
    handler: async (args) => {
      const target = resolveCodeTarget(args.target);
      if ("content" in target) return target;

      try {
        const build = buildReadFileParams({
          target,
          filePath: args.path,
          startLine: args.start_line,
          endLine: args.end_line,
          waitTimeoutMs: args.wait_timeout_ms,
        });
        const result = await service.readFile(build.params);
        const payload = buildReadFileSuccessPayload(result, {
          registry: target.registry
            ? toPkgseerRegistryLowercase(target.registry)
            : undefined,
          name: target.packageName,
          repoUrl: target.repoUrl,
          gitRef: target.gitRef,
          requestedFilePath: build.params.filePath,
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
