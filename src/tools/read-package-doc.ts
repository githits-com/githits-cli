import { z } from "zod";
import type { PackageIntelligenceService } from "../services/index.js";
import { mapPackageIntelligenceError } from "../shared/package-intelligence-error-map.js";
import { buildReadPackageDocParams } from "../shared/read-package-doc-request.js";
import { buildReadPackageDocSuccessPayload } from "../shared/read-package-doc-response.js";
import { errorResult, type ToolDefinition, textResult } from "./types.js";

export interface ReadPackageDocArgs {
  page_id: string;
}

const schema = {
  page_id: z
    .string()
    .describe(
      "Documentation page ID from list_package_docs or search results. Pass through unchanged; repo-backed IDs are snapshot-pinned.",
    ),
};

const DESCRIPTION =
  "Read a documentation page by page ID. Works for both hosted/crawled docs and repository-backed docs. " +
  "Repo-backed results additionally include exact file follow-up metadata for read_file.";

export function createReadPackageDocTool(
  service: PackageIntelligenceService,
): ToolDefinition<ReadPackageDocArgs, typeof schema> {
  return {
    name: "read_package_doc",
    description: DESCRIPTION,
    schema,
    annotations: { readOnlyHint: true },
    handler: async (args) => {
      try {
        const build = buildReadPackageDocParams({ pageId: args.page_id });
        const result = await service.readPackageDoc(build.params);
        const payload = buildReadPackageDocSuccessPayload(
          result,
          build.params.pageId,
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
