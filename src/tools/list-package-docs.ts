import { z } from "zod";
import type { PackageIntelligenceService } from "../services/index.js";
import { buildListPackageDocsParams } from "../shared/list-package-docs-request.js";
import { buildListPackageDocsSuccessPayload } from "../shared/list-package-docs-response.js";
import { mapPackageIntelligenceError } from "../shared/package-intelligence-error-map.js";
import { errorResult, type ToolDefinition, textResult } from "./types.js";

export interface ListPackageDocsArgs {
  registry: string;
  package_name: string;
  version?: string;
  limit?: number;
  after?: string;
}

const schema = {
  registry: z
    .string()
    .describe(
      "Package registry. One of: npm, pypi, hex, crates, nuget, maven, zig, vcpkg, packagist.",
    ),
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
};

const DESCRIPTION =
  "List mixed package documentation pages from hosted docs and repository-backed docs. " +
  "Every entry includes a stable `pageId`, `sourceKind` (`crawled` or `repo`), and source URL; repo-backed entries also expose `repoUrl` / `gitRef` / `filePath` for exact file reads. " +
  "Pass a returned `pageId` to `docs_read`. Use this to browse before reading a full page.";

export function createListPackageDocsTool(
  service: PackageIntelligenceService,
): ToolDefinition<ListPackageDocsArgs, typeof schema> {
  return {
    name: "docs_list",
    description: DESCRIPTION,
    schema,
    annotations: { readOnlyHint: true },
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
