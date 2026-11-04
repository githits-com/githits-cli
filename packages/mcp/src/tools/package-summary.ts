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
import { serviceRequestArgs } from "../shared/service-request-args.js";
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
      `Unversioned package registry:name, for example npm:express or npm:@types/node; omit version pins. Registries: ${PKGSEER_REGISTRY_LIST}.`,
    ),
  verbose: z
    .boolean()
    .optional()
    .describe(
      "Text only. Adds GitHub language/topics/last-pushed, published-version count, download refresh date, package-wide advisory history (all versions), and recent changes. Selected-release affected and package-wide history counts are shown separately. Ignored for format=json.",
    ),
  format: z
    .enum(["text", "json"])
    .default("text")
    .describe(
      "Omit for text. Use json only when code consumes raw fields or text lacks a required field. JSON adds latestVersion, latestVersionPublishedAt, registryLatestDifference, versionCount, downloads.refreshedAt, advisoryHistory.total.",
    ),
};

export const DESCRIPTION_BASE: string =
  "Assess package health and adoption: license, downloads, and activity. Provide " +
  "an unpinned package target; this tool describes the default selected release and explains a skipped registry latest. " +
  "Registry and source Git repository URLs, when reported, do not establish binary provenance or current availability. Default text returns these URLs, license, description, repository popularity " +
  "(stars/forks/issues and [ARCHIVED] when applicable), downloads, " +
  "publish age, selected-release affected count, and separate package-wide advisory " +
  "history count. Historical counts are not current-version risk. " +
  "Use `verbose: true` for additional health and history details. Use metadata directly; missing fields are unknown. The selected release and retrieval time do not prove registry freshness or historical release facts.";

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
            `pkg_info returns the default selected release; omit @${target.version}.`,
          );
        }
        const { params } = buildPackageSummaryParams({
          registry: target.registry,
          packageName: target.name,
        });
        const textFormat = isTextFormat(args.format);
        const summary = await service.packageSummary(
          {
            ...params,
            includeVerboseFields: !textFormat || args.verbose === true,
          },
          ...serviceRequestArgs(context?.signal),
        );
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
        return mcpMappedErrorResult(mapped, context, args.format, {
          recovery: { syntax: "mcp", tool: "pkg_info", args },
        });
      }
    },
  };
}

function isTextFormat(format: PackageSummaryArgs["format"]): boolean {
  return format === undefined || format === "text";
}
