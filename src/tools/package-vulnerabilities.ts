import { z } from "zod";
import type { PackageIntelligenceService } from "../services/index.js";
import { mapPackageIntelligenceError } from "../shared/package-intelligence-error-map.js";
import { buildPackageVulnerabilitiesParams } from "../shared/package-vulnerabilities-request.js";
import {
  buildPackageVulnerabilitiesSuccessPayload,
  formatPackageVulnerabilitiesTerminal,
} from "../shared/package-vulnerabilities-response.js";
import { PKG_VULNS_GUARDRAIL } from "./guardrails.js";
import { mcpMappedErrorResult } from "./shared.js";
import { type ToolDefinition, textResult } from "./types.js";

export interface PackageVulnerabilitiesArgs {
  registry: string;
  package_name: string;
  version?: string;
  min_severity?: string;
  advisory_scope?: string;
  include_withdrawn?: boolean;
  verbose?: boolean;
  format?: "json" | "text" | "text-v1";
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
      "Package registry. Vulnerability data is available for npm, pypi, hex, crates, nuget, maven, packagist, rubygems, go, and swift; unavailable for vcpkg and zig.",
    ),
  package_name: z
    .string()
    .describe("Package name (scoped names ok: @types/node)."),
  version: z
    .string()
    .optional()
    .describe(
      "Specific version to check. Defaults to latest when omitted. Tag-style `v`-prefixed inputs are rejected except for Swift.",
    ),
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
  advisory_scope: z
    .string()
    .optional()
    .describe(
      "Advisory rows to return: `affected` (default), `non_affecting` for historical advisories that do not affect the inspected version, or `all` for both affected and historical advisories. Counts always include affected/non-affecting/all totals.",
    ),
  verbose: z
    .boolean()
    .optional()
    .describe(
      "Text output only. Show every advisory and full detail rows; format=json always returns the complete structured envelope.",
    ),
  format: z
    .enum(["json", "text", "text-v1"])
    .optional()
    .describe(
      'Response format. Default `text-v1` — compact advisory summary. Pass `format: "json"` for the structured envelope.',
    ),
};

export const DESCRIPTION =
  "Use when the user asks whether a package or pinned version has known vulnerabilities, advisories, CVEs, malware, affected ranges, or fix versions. Check known vulnerabilities for a package on npm, PyPI, Hex, " +
  "Crates, NuGet, Maven, Packagist, RubyGems, Go, or Swift (vcpkg and Zig " +
  "are not supported for vulnerability data). Returns a count summary, each advisory with OSV ID, " +
  "severity, affected ranges, and fix versions. Malicious-package " +
  "advisories surface in a separate bucket. Example: " +
  '`{"registry":"npm","package_name":"lodash","version":"4.17.20","min_severity":"high"}`. ' +
  "Pass `version` to inspect " +
  "a pinned release; omit it for latest. Default text is capped for " +
  "readability; use `verbose:true` for all selected advisory rows or " +
  '`format:"json"` for the complete envelope. Use ' +
  "`min_severity` to filter to a threshold (`low`, `medium`, `high`, " +
  "`critical`) and `include_withdrawn` to also see retracted " +
  'advisories. Use `advisory_scope:"non_affecting"` to list ' +
  "historical advisories that do not affect the inspected version, or " +
  '`advisory_scope:"all"` to list affected and historical advisories together.' +
  `\n\n${PKG_VULNS_GUARDRAIL}`;

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
        const { params, filter } = buildPackageVulnerabilitiesParams({
          registry: args.registry,
          packageName: args.package_name,
          version: args.version,
          minSeverity: args.min_severity,
          includeWithdrawn: args.include_withdrawn,
          advisoryScope: args.advisory_scope,
        });
        const report = await service.packageVulnerabilities(params);
        const payload = buildPackageVulnerabilitiesSuccessPayload(report, {
          requestedVersion: args.version,
          filter,
        });
        if (isTextFormat(args.format)) {
          return textResult(
            formatPackageVulnerabilitiesTerminal(report, {
              useColors: false,
              requestedVersion: args.version,
              filter,
              verbose: args.verbose,
              surface: "mcp",
            }).trimEnd(),
          );
        }
        return textResult(JSON.stringify(payload));
      } catch (error) {
        const mapped = mapPackageIntelligenceError(error);
        return mcpMappedErrorResult(mapped);
      }
    },
  };
}

function isTextFormat(format: PackageVulnerabilitiesArgs["format"]): boolean {
  return format === undefined || format === "text" || format === "text-v1";
}
