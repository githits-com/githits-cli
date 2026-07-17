import type { PackageIntelligenceService } from "@githits/core-internal";
import { PKGSEER_REGISTRY_LIST } from "@githits/core-internal";
import { z } from "zod";
import { buildListPackageDocsParams } from "../shared/list-package-docs-request.js";
import { buildListPackageDocsSuccessPayload } from "../shared/list-package-docs-response.js";
import { renderListPackageDocsText } from "../shared/list-package-docs-text.js";
import { mapPackageIntelligenceError } from "../shared/package-intelligence-error-map.js";
import { DOCS_GUARDRAIL } from "./guardrails.js";
import { mcpMappedErrorResult } from "./shared.js";
import {
  BOUNDED_WRITE_TOOL_ANNOTATIONS,
  type ToolDefinition,
  textResult,
  type ZodRawShape,
} from "./types.js";

export interface ListPackageDocsArgs {
  registry: string;
  package_name: string;
  version?: string;
  limit?: number;
  after?: string;
  format?: "json" | "text" | "text-v1";
}

const schema: ZodRawShape = {
  registry: z
    .string()
    .describe(`Package registry. One of: ${PKGSEER_REGISTRY_LIST}.`),
  package_name: z
    .string()
    .describe("Package name (scoped names ok: @types/node)."),
  version: z.string().optional().describe("Optional package version."),
  limit: z
    .number()
    .optional()
    .describe("Max pages to return (1-500, default 100)."),
  after: z
    .string()
    .optional()
    .describe("Pagination cursor from a prior response."),
  format: z
    .enum(["text-v1", "text", "json"])
    .default("text-v1")
    .describe(
      'Response format. Default `text-v1` — compact page list with ready-to-call `docs_read` follow-ups. Pass `format: "json"` for the structured envelope.',
    ),
};

const DESCRIPTION =
  "List mixed package documentation pages from hosted docs and repository-backed docs. " +
  'This browses available pages; for topic search, use `search` with `source: "docs"` and pass the returned `pageId` to `docs_read`. ' +
  "Every entry includes a stable `pageId`, `sourceKind` (`crawled` or `repo`), and source URL; repo-backed entries also expose `repoUrl` / `gitRef` / `filePath` for exact file reads. " +
  "Pass a returned `pageId` to `docs_read`. Use this to browse before reading a full page." +
  `\n\n${DOCS_GUARDRAIL}`;

export function createListPackageDocsTool(
  service: PackageIntelligenceService,
): ToolDefinition<ListPackageDocsArgs, typeof schema> {
  return {
    name: "docs_list",
    description: DESCRIPTION,
    schema,
    annotations: BOUNDED_WRITE_TOOL_ANNOTATIONS,
    handler: async (args) => {
      try {
        const build = buildListPackageDocsParams({
          registry: args.registry,
          packageName: args.package_name,
          version: args.version,
          limit: args.limit,
          after: args.after,
        });
        const result = await service.listPackageDocs(build.params);
        const payload = buildListPackageDocsSuccessPayload(result, {
          limitExplicit: build.limitExplicit,
          afterExplicit: build.afterExplicit,
          limit: build.params.limit,
          after: build.params.after,
        });
        if (isTextFormat(args.format)) {
          return textResult(renderListPackageDocsText(payload));
        }
        return textResult(JSON.stringify(payload));
      } catch (error) {
        const mapped = mapPackageIntelligenceError(error);
        return mcpMappedErrorResult(mapped);
      }
    },
  };
}

function isTextFormat(format: ListPackageDocsArgs["format"]): boolean {
  return format === undefined || format === "text" || format === "text-v1";
}
