import { z } from "zod";
import type { PackageIntelligenceService } from "../services/index.js";
import { mapPackageIntelligenceError } from "../shared/package-intelligence-error-map.js";
import { buildPackageVulnerabilitiesParams } from "../shared/package-vulnerabilities-request.js";
import { buildPackageVulnerabilitiesSuccessPayload } from "../shared/package-vulnerabilities-response.js";
import { type ToolDefinition, textResult } from "./types.js";

export interface PackageVulnerabilitiesArgs {
  registry: string;
  package_name: string;
  version?: string;
  min_severity?: string;
  include_withdrawn?: boolean;
}

/**
 * Permissive schema by design — in-handler validation via
 * `buildPackageVulnerabilitiesParams` is the single validation path
 * for both CLI and MCP. Raw Zod errors never surface to agents; the
 * structured `{error, code, retryable}` envelope is returned instead.
 */
const schema = {
  registry: z
    .string()
    .describe(
      "Package registry. Vulnerability data available on npm, pypi, hex, and crates only.",
    ),
  package_name: z
    .string()
    .describe("Package name (scoped names ok: @types/node)."),
  version: z
    .string()
    .optional()
    .describe("Specific version to check. Defaults to latest when omitted."),
  min_severity: z
    .string()
    .optional()
    .describe(
      "Only return advisories at or above this severity (`low`, `medium`, `high`, `critical`; uppercase tolerated). Omit to see all, including null-severity advisories.",
    ),
  include_withdrawn: z
    .boolean()
    .optional()
    .describe("Include retracted advisories (default: false)."),
};

const DESCRIPTION =
  "Check known vulnerabilities for a package on npm, PyPI, Hex, or " +
  "Crates (other registries are not yet supported for vulnerability " +
  "data). Returns a count summary, each advisory with OSV ID, " +
  "severity, affected ranges, and fix versions. Malicious-package advisories surface in a separate " +
  "bucket. Pass `version` to inspect a specific release; otherwise " +
  "the latest is checked. Use `min_severity` to filter to a threshold " +
  "(`low`, `medium`, `high`, `critical`) and `include_withdrawn` to " +
  "also see retracted advisories.";

export function createPackageVulnerabilitiesTool(
  service: PackageIntelligenceService,
): ToolDefinition<PackageVulnerabilitiesArgs, typeof schema> {
  return {
    name: "pkg_vulns",
    description: DESCRIPTION,
    schema,
    annotations: { readOnlyHint: true },
    handler: async (args) => {
      try {
        const { params } = buildPackageVulnerabilitiesParams({
          registry: args.registry,
          packageName: args.package_name,
          version: args.version,
          minSeverity: args.min_severity,
          includeWithdrawn: args.include_withdrawn,
        });
        const report = await service.packageVulnerabilities(params);
        const payload = buildPackageVulnerabilitiesSuccessPayload(report, {
          requestedVersion: args.version,
        });
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
