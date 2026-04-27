import { z } from "zod";
import type { PackageIntelligenceService } from "../services/index.js";
import { mapPackageIntelligenceError } from "../shared/package-intelligence-error-map.js";
import { buildReadPackageDocParams } from "../shared/read-package-doc-request.js";
import { buildReadPackageDocSuccessPayload } from "../shared/read-package-doc-response.js";
import { errorResult, type ToolDefinition, textResult } from "./types.js";

export interface ReadPackageDocArgs {
  page_id: string;
  start_line?: number;
  end_line?: number;
}

const schema = {
  page_id: z
    .string()
    .describe(
      "Documentation page ID from `docs_list` or `search` results. Pass through unchanged; repo-backed IDs are snapshot-pinned.",
    ),
  start_line: z
    .number()
    .optional()
    .describe(
      "Starting line (1-indexed). Omit for the full page. Use with `end_line` to bound how much content the tool returns when a page is large.",
    ),
  end_line: z
    .number()
    .optional()
    .describe(
      "Ending line (inclusive). Omit for end of page. Must be ≥ `start_line` when both are set.",
    ),
};

const DESCRIPTION =
  "Read a documentation page by page ID. Works for both hosted/crawled docs and repository-backed docs. " +
  "Pass `start_line` / `end_line` to fetch only a slice when a page is too long — response carries `totalLines` so you can target the next slice. " +
  "Repo-backed results additionally include exact file follow-up metadata for `code_read`.";

export function createReadPackageDocTool(
  service: PackageIntelligenceService,
): ToolDefinition<ReadPackageDocArgs, typeof schema> {
  return {
    name: "docs_read",
    description: DESCRIPTION,
    schema,
    annotations: { readOnlyHint: true },
    handler: async (args) => {
      try {
        const build = buildReadPackageDocParams({ pageId: args.page_id });
        const result = await service.readPackageDoc(build.params);
        const range =
          args.start_line !== undefined || args.end_line !== undefined
            ? { startLine: args.start_line, endLine: args.end_line }
            : undefined;
        const payload = buildReadPackageDocSuccessPayload(
          result,
          build.params.pageId,
          range,
        );
        return textResult(JSON.stringify(payload));
      } catch (error) {
        const mapped = mapPackageIntelligenceError(error);
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
