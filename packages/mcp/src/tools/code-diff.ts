import type { CodeDiffService } from "@githits/core-internal";
import { z } from "zod";
import { formatCodeDiffMcpText } from "../shared/code-diff-mcp-text.js";
import {
  buildCodeDiffMcpParams,
  type CodeDiffMcpTarget,
  type CodeDiffView,
} from "../shared/code-diff-request.js";
import { buildCodeDiffSuccessPayload } from "../shared/code-diff-response.js";
import { mapCodeNavigationError } from "../shared/code-navigation-error-map.js";
import { mcpMappedErrorResult } from "./shared.js";
import {
  READ_ONLY_TOOL_ANNOTATIONS,
  type ToolDefinition,
  textResult,
  type ZodRawShape,
} from "./types.js";

export interface CodeDiffMcpArgs {
  target: CodeDiffMcpTarget;
  from: string;
  to: string;
  view?: CodeDiffView;
  path_glob?: string;
  max_files?: number;
  max_patch_bytes?: number;
  format?: "text-v1" | "text" | "json";
}

const schema: ZodRawShape = {
  target: z
    .unknown()
    .describe(
      "One unversioned compact target string such as `npm:express` or `github:expressjs/express`, or an exact object `{registry, package_name}` / `{repo_url}`. Do not embed a version or ref.",
    ),
  from: z
    .string()
    .describe("Required starting package version or public repository ref."),
  to: z
    .string()
    .describe("Required ending package version or public repository ref."),
  view: z
    .string()
    .optional()
    .describe(
      "Projection: `name-status` (default, bounded inventory), `name-only`, `stat`, or `patch`. `max_patch_bytes` is valid only for `patch`.",
    ),
  path_glob: z
    .string()
    .optional()
    .describe(
      "Optional bounded repository-relative glob. Empty and unsupported pathspec forms return a structured INVALID_ARGUMENT envelope.",
    ),
  max_files: z
    .number()
    .optional()
    .describe("Optional returned-file bound from 1 through 300."),
  max_patch_bytes: z
    .number()
    .optional()
    .describe(
      "Optional aggregate patch-byte bound from 1024 through 2097152; patch view only.",
    ),
  format: z
    .enum(["text-v1", "text", "json"])
    .default("text-v1")
    .describe(
      "Response format. Default `text-v1` is compact MCP-native evidence; `text` is an alias. Use `json` for the complete structured projection.",
    ),
};

export const DESCRIPTION =
  "Use for exact source changes between two explicit package versions or public GitHub refs after the target is already canonical. Pass one unversioned compact target string or exactly one structured package `{registry, package_name}` / repository `{repo_url}` target, plus separate `from` and `to` endpoints; never embed a version or ref in the target. The default `name-status` view is bounded inventory; use `stat` for magnitude or `patch` for content. Empty and identical diffs succeed. Incomplete, filtered, byte-escaped, omitted, or unavailable patch evidence is not authoritative or safely applicable. Raw diffs never prove compatibility or upgrade safety. Do not include credentials, personal data, private code, or proprietary content in inputs.";

export function createCodeDiffTool(
  service: CodeDiffService,
): ToolDefinition<CodeDiffMcpArgs, typeof schema> {
  return {
    name: "code_diff",
    description: DESCRIPTION,
    schema,
    annotations: READ_ONLY_TOOL_ANNOTATIONS,
    handler: async (args) => {
      try {
        const build = buildCodeDiffMcpParams({
          target: args.target,
          from: args.from,
          to: args.to,
          view: args.view ?? "name-status",
          pathGlob: args.path_glob,
          maxFiles: args.max_files,
          maxPatchBytes: args.max_patch_bytes,
        });
        const result = await service.codeDiff(build.params);
        const payload = buildCodeDiffSuccessPayload(result, {
          target: build.params.target,
          view: build.view,
        });
        if (isTextFormat(args.format)) {
          return textResult(formatCodeDiffMcpText(payload));
        }
        return textResult(JSON.stringify(payload));
      } catch (error) {
        return mcpMappedErrorResult(mapCodeNavigationError(error));
      }
    },
  };
}

function isTextFormat(format: CodeDiffMcpArgs["format"]): boolean {
  return format === undefined || format === "text" || format === "text-v1";
}
