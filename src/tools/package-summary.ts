import { z } from "zod";
import type { PackageIntelligenceService } from "../services/index.js";
import { mapPackageIntelligenceError } from "../shared/package-intelligence-error-map.js";
import { buildPackageSummaryParams } from "../shared/package-summary-request.js";
import {
  buildPackageSummarySuccessPayload,
  formatPackageSummaryTerminal,
} from "../shared/package-summary-response.js";
import { PKGSEER_REGISTRY_LIST } from "../shared/pkgseer-registry.js";
import { type ToolDefinition, textResult } from "./types.js";

export interface PackageSummaryArgs {
  registry: string;
  package_name: string;
  format?: "json" | "text" | "text-v1";
}

/**
 * Permissive schema by design — validation happens inside the handler
 * via `buildPackageSummaryParams`. That way, malformed input produces
 * the structured `{error, code, retryable}` envelope (same as CLI),
 * rather than a raw Zod error that agents would have to parse
 * separately.
 */
const schema = {
  registry: z
    .string()
    .describe(`Package registry. One of: ${PKGSEER_REGISTRY_LIST}.`),
  package_name: z
    .string()
    .describe("Package name (scoped names ok: @types/node)."),
  format: z
    .enum(["json", "text", "text-v1"])
    .optional()
    .describe(
      "Response format. Default `text-v1` is compact for agents. Pass `json` for the structured envelope.",
    ),
};

const DESCRIPTION =
  "Get a package overview — latest version, license, description, " +
  "repository, downloads, GitHub stars, install command, recent " +
  "changes, and a count of known vulnerabilities. Use before " +
  "recommending a package or to orient on what a dependency is. " +
  'Default output is compact text; pass `format: "json"` for the ' +
  "structured envelope. " +
  "Works across npm, PyPI, Hex, Crates, NuGet, Maven, Packagist, " +
  "RubyGems, Go, vcpkg, and Zig. Always returns data for the latest published " +
  "version.";

export function createPackageSummaryTool(
  service: PackageIntelligenceService,
): ToolDefinition<PackageSummaryArgs, typeof schema> {
  return {
    name: "pkg_info",
    description: DESCRIPTION,
    schema,
    annotations: { readOnlyHint: true },
    handler: async (args) => {
      try {
        const { params } = buildPackageSummaryParams({
          registry: args.registry,
          packageName: args.package_name,
        });
        const summary = await service.packageSummary(params);
        const payload = buildPackageSummarySuccessPayload(summary);
        if (isTextFormat(args.format)) {
          return textResult(
            formatPackageSummaryTerminal(summary, {
              useColors: false,
            }).trimEnd(),
          );
        }
        return textResult(JSON.stringify(payload));
      } catch (error) {
        const mapped = mapPackageIntelligenceError(error);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                error: mapped.message,
                code: mapped.code,
                retryable: mapped.retryable ?? false,
                ...(mapped.details ? { details: mapped.details } : {}),
              }),
            },
          ],
          isError: true,
        };
      }
    },
  };
}

function isTextFormat(format: PackageSummaryArgs["format"]): boolean {
  return format === undefined || format === "text" || format === "text-v1";
}
