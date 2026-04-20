import { z } from "zod";
import type { PackageIntelligenceService } from "../services/index.js";
import { mapPackageIntelligenceError } from "../shared/package-intelligence-error-map.js";
import { buildPackageSummaryParams } from "../shared/package-summary-request.js";
import { buildPackageSummarySuccessPayload } from "../shared/package-summary-response.js";
import { type ToolDefinition, textResult } from "./types.js";

export interface PackageSummaryArgs {
  registry: string;
  package_name: string;
}

/**
 * Permissive schema by design — validation happens inside the handler
 * via `buildPackageSummaryParams`. That way, malformed input produces
 * the structured `{error, code, retryable}` envelope (same as CLI),
 * rather than a raw Zod error that agents would have to parse
 * separately. See `search_symbols` precedent.
 */
const schema = {
  registry: z
    .string()
    .describe(
      "Package registry. One of: npm, pypi, hex, crates, nuget, maven, zig, vcpkg, packagist.",
    ),
  package_name: z
    .string()
    .describe("Package name (scoped names ok: @types/node)."),
};

const DESCRIPTION =
  "Get a package overview — latest version, license, description, " +
  "repository, downloads, GitHub stars, install command, and a count " +
  "of known vulnerabilities. Use before recommending a package or to " +
  "orient on what a dependency is. Works across npm, PyPI, Hex, " +
  "Crates, NuGet, Maven, Packagist, vcpkg, Zig. Always returns data " +
  "for the latest published version.";

export function createPackageSummaryTool(
  service: PackageIntelligenceService,
): ToolDefinition<PackageSummaryArgs, typeof schema> {
  return {
    name: "package_summary",
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
