import type { PackageIntelligenceService } from "@githits/core-internal";
import { PKGSEER_REGISTRY_LIST } from "@githits/core-internal";
import { z } from "zod";
import { buildListPackageDocsParams } from "../shared/list-package-docs-request.js";
import { buildListPackageDocsSuccessPayload } from "../shared/list-package-docs-response.js";
import { renderListPackageDocsText } from "../shared/list-package-docs-text.js";
import { mapPackageIntelligenceError } from "../shared/package-intelligence-error-map.js";
import { DOCS_GUARDRAIL } from "./guardrails.js";
import { mcpMappedErrorResult, throwIfCallerCancellation } from "./shared.js";
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
  format?: "text" | "json";
}

const schema: ZodRawShape = {
  registry: z
    .string()
    .describe(`Package registry. One of: ${PKGSEER_REGISTRY_LIST}.`),
  package_name: z
    .string()
    .describe("Package name (scoped names ok: @types/node)."),
  version: z
    .string()
    .optional()
    .describe(
      "Optional exact package version. Go accepts either v-prefixed or unprefixed versions.",
    ),
  limit: z
    .number()
    .optional()
    .describe("Max pages to return (1-500, default 100)."),
  after: z
    .string()
    .optional()
    .describe("Pagination cursor from a prior response."),
  format: z
    .enum(["text", "json"])
    .default("text")
    .describe(
      "Default `text` is token-efficient. Use `json` only for programmatic follow-up or exact structured details.",
    ),
};

const DESCRIPTION =
  "List package documentation pages and hand off to `docs_read`; use `search` for topic discovery. " +
  'This browses hosted and repository-backed pages. For topic search, use `search` with `source: "docs"`. ' +
  "Every entry includes a stable `pageId`, `sourceKind` (`crawled` or `repo`), and source URL; repo-backed entries also expose `repoUrl` / `gitRef` / `filePath` for exact file reads. " +
  "Pass a returned `pageId` to `docs_read`, or repo-backed file metadata to `code_read`." +
  `\n\n${DOCS_GUARDRAIL}`;

export function createListPackageDocsTool(
  service: PackageIntelligenceService,
): ToolDefinition<ListPackageDocsArgs, typeof schema> {
  return {
    name: "docs_list",
    description: DESCRIPTION,
    schema,
    annotations: BOUNDED_WRITE_TOOL_ANNOTATIONS,
    handler: async (args, context) => {
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
        throwIfCallerCancellation(error, context?.signal);
        const mapped = mapPackageIntelligenceError(error);
        return mcpMappedErrorResult(mapped, context);
      }
    },
  };
}

function isTextFormat(format: ListPackageDocsArgs["format"]): boolean {
  return format === undefined || format === "text";
}
