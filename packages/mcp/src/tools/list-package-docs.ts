import type { PackageIntelligenceService } from "@githits/core-internal";
import { PKGSEER_REGISTRY_LIST } from "@githits/core-internal";
import { z } from "zod";
import { buildListPackageDocsParams } from "../shared/list-package-docs-request.js";
import { buildListPackageDocsSuccessPayload } from "../shared/list-package-docs-response.js";
import { renderListPackageDocsText } from "../shared/list-package-docs-text.js";
import { mapPackageIntelligenceError } from "../shared/package-intelligence-error-map.js";
import { parsePackageSpec } from "../shared/package-spec.js";
import { DOCS_GUARDRAIL } from "./guardrails.js";
import { mcpMappedErrorResult, throwIfCallerCancellation } from "./shared.js";
import {
  OPEN_WORLD_READ_ONLY_TOOL_ANNOTATIONS,
  type ToolDefinition,
  textResult,
  type ZodRawShape,
} from "./types.js";

export interface ListPackageDocsArgs {
  target: string;
  limit?: number;
  after?: string;
  format?: "text" | "json";
}

const schema: ZodRawShape = {
  target: z
    .string()
    .describe(
      `Package registry:name[@version], for example npm:express@5.2.1; omit the version for latest. Go accepts versions with or without v. Registries: ${PKGSEER_REGISTRY_LIST}.`,
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
      "Omit `format` to use token-efficient text when the model reads the result or chooses follow-up tools. Set `json` only when code consumes the raw response instead of the model, or a required field is absent from text.",
    ),
};

const DESCRIPTION =
  "List package documentation targets for follow-up reads. " +
  'Pass them to `read` as the `target`; use `search` with `source: "docs"` for topics. ' +
  "Each entry includes preferred `docsReadTarget`, stable `pageId`, provenance `sourceUrl`, and `sourceKind`; repo-backed entries add exact `repoUrl` / `gitRef` / `filePath` for `read`. " +
  "Historical IDs remain readable." +
  `\n\n${DOCS_GUARDRAIL}`;

export function createListPackageDocsTool(
  service: PackageIntelligenceService,
): ToolDefinition<ListPackageDocsArgs, typeof schema> {
  return {
    name: "docs_list",
    description: DESCRIPTION,
    schema,
    annotations: OPEN_WORLD_READ_ONLY_TOOL_ANNOTATIONS,
    handler: async (args, context) => {
      try {
        const target = parsePackageSpec(args.target.trim());
        const build = buildListPackageDocsParams({
          registry: target.registry,
          packageName: target.name,
          version: target.version,
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
