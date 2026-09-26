import type { PackageIntelligenceService } from "@githits/core-internal";
import { PKGSEER_REGISTRY_LIST } from "@githits/core-internal";
import { z } from "zod";
import { mapPackageIntelligenceError } from "../shared/package-intelligence-error-map.js";
import {
  InvalidPackageSpecError,
  parsePackageSpec,
} from "../shared/package-spec.js";
import { buildPackageSummaryParams } from "../shared/package-summary-request.js";
import {
  buildPackageSummarySuccessPayload,
  formatPackageSummaryTerminal,
} from "../shared/package-summary-response.js";
import { PKG_INFO_GUARDRAIL } from "./guardrails.js";
import { mcpMappedErrorResult, throwIfCallerCancellation } from "./shared.js";
import {
  OPEN_WORLD_READ_ONLY_TOOL_ANNOTATIONS,
  type ToolDefinition,
  textResult,
  type ZodRawShape,
} from "./types.js";

export interface PackageSummaryArgs {
  target: string;
  verbose?: boolean;
  format?: "text" | "json";
}

/**
 * Strings remain permissive so package parsing and request validation
 * return mapped domain errors. Missing or non-string targets fail SDK validation.
 */
const schema: ZodRawShape = {
  target: z
    .string()
    .describe(
      `Latest-only package registry:name, for example npm:express or npm:@types/node; omit version pins. Registries: ${PKGSEER_REGISTRY_LIST}.`,
    ),
  verbose: z
    .boolean()
    .optional()
    .describe(
      "Text only. Adds GitHub language/topics/last-pushed, published-version count, download refresh date, package-wide advisory history (all versions), and recent changes. Latest affected and package-wide history counts are shown separately. Ignored for format=json.",
    ),
  format: z
    .enum(["text", "json"])
    .default("text")
    .describe(
      "Omit `format` to use token-efficient text when the model reads the result or chooses follow-up tools. Set `json` only when code consumes the raw response instead of the model, or a required field is absent from text. JSON includes `versionCount`, `downloads.refreshedAt`, and `advisoryHistory.total`.",
    ),
};

export const DESCRIPTION_BASE: string =
  "Assess latest package health and adoption: license, downloads, and activity. Provide " +
  "an unpinned package target; this tool always returns latest. " +
  "Default text returns license, description, repository popularity " +
  "(stars/forks/issues and [ARCHIVED] when applicable), downloads, " +
  "publish age, latest affected count, and separate package-wide advisory " +
  "history count, shown separately. Historical counts are not current-version risk. " +
  "Use `verbose: true` for additional health and history details.";

export const DESCRIPTION: string = `${DESCRIPTION_BASE}\n\n${PKG_INFO_GUARDRAIL}`;

export function createPackageSummaryTool(
  service: PackageIntelligenceService,
): ToolDefinition<PackageSummaryArgs, typeof schema> {
  return {
    name: "pkg_info",
    description: DESCRIPTION,
    schema,
    annotations: OPEN_WORLD_READ_ONLY_TOOL_ANNOTATIONS,
    handler: async (args, context) => {
      try {
        const target = parsePackageSpec(args.target.trim());
        if (target.version !== undefined) {
          throw new InvalidPackageSpecError(
            `pkg_info always returns the latest version; omit @${target.version}.`,
          );
        }
        const { params } = buildPackageSummaryParams({
          registry: target.registry,
          packageName: target.name,
        });
        const textFormat = isTextFormat(args.format);
        const summary = await service.packageSummary({
          ...params,
          includeVerboseFields: !textFormat || args.verbose === true,
        });
        const payload = buildPackageSummarySuccessPayload(summary);
        if (textFormat) {
          return textResult(
            formatPackageSummaryTerminal(summary, {
              verbose: args.verbose,
              useColors: false,
            }).trimEnd(),
          );
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

function isTextFormat(format: PackageSummaryArgs["format"]): boolean {
  return format === undefined || format === "text";
}
