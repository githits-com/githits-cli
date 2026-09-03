import type { PackageIntelligenceService } from "@githits/core-internal";
import { PKGSEER_REGISTRY_LIST } from "@githits/core-internal";
import { z } from "zod";
import { mapPackageIntelligenceError } from "../shared/package-intelligence-error-map.js";
import { buildPackageSummaryParams } from "../shared/package-summary-request.js";
import {
  buildPackageSummarySuccessPayload,
  formatPackageSummaryTerminal,
} from "../shared/package-summary-response.js";
import { PKG_INFO_GUARDRAIL } from "./guardrails.js";
import { mcpMappedErrorResult, throwIfCallerCancellation } from "./shared.js";
import {
  READ_ONLY_TOOL_ANNOTATIONS,
  type ToolDefinition,
  textResult,
  type ZodRawShape,
} from "./types.js";

export interface PackageSummaryArgs {
  registry: string;
  package_name: string;
  verbose?: boolean;
  format?: "json" | "text" | "text-v1";
}

/**
 * Permissive schema by design — validation happens inside the handler
 * via `buildPackageSummaryParams`. That way, malformed input produces
 * the structured `{error, code, retryable}` envelope (same as CLI),
 * rather than a raw Zod error that agents would have to parse
 * separately.
 */
const schema: ZodRawShape = {
  registry: z
    .string()
    .describe(`Package registry. One of: ${PKGSEER_REGISTRY_LIST}.`),
  package_name: z
    .string()
    .describe("Package name (scoped names ok: @types/node)."),
  verbose: z
    .boolean()
    .optional()
    .describe(
      "Text only. Adds GitHub language/topics/last-pushed, published-version count, download refresh date, package-wide advisory history (all versions), and recent changes. Latest affected and package-wide history counts are shown separately. Ignored for format=json.",
    ),
  format: z
    .enum(["text-v1", "text", "json"])
    .default("text-v1")
    .describe(
      'Response format. Default `text-v1` — compact package overview. Pass `format: "json"` for structured fields including `versionCount`, `downloads.refreshedAt`, and `advisoryHistory.total`.',
    ),
};

export const DESCRIPTION_BASE: string =
  "Assess latest package health and adoption: license, downloads, and activity. Provide " +
  "`registry` and `package_name` (for example `npm` + `express`). " +
  "Default text returns license, description, repository popularity " +
  "(stars/forks/issues and [ARCHIVED] when applicable), downloads, " +
  "publish age, latest affected count, and separate package-wide advisory " +
  "history count. These counts are shown separately. Set `verbose: true` for " +
  "GitHub language/topics/last-pushed, " +
  "published-version count, download refresh date, package-wide advisory " +
  "history (all versions), " +
  'and recent changes. Pass `format: "json"` for structured fields ' +
  "including `versionCount`, `downloads.refreshedAt`, and " +
  "`advisoryHistory.total`. Use " +
  '`pkg_vulns` for version-specific vulnerability details, or pass `advisory_scope: "all"` for package-wide history; use `pkg_deps` for the dependency graph, `pkg_changelog` for release evidence, or `pkg_upgrade_review` for current-vs-target comparison.';

export const DESCRIPTION: string = `${DESCRIPTION_BASE}\n\n${PKG_INFO_GUARDRAIL}`;

export function createPackageSummaryTool(
  service: PackageIntelligenceService,
): ToolDefinition<PackageSummaryArgs, typeof schema> {
  return {
    name: "pkg_info",
    description: DESCRIPTION,
    schema,
    annotations: READ_ONLY_TOOL_ANNOTATIONS,
    handler: async (args, context) => {
      try {
        const { params } = buildPackageSummaryParams({
          registry: args.registry,
          packageName: args.package_name,
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
  return format === undefined || format === "text" || format === "text-v1";
}
