import type { PackageIntelligenceService } from "@githits/core-internal";
import { z } from "zod";
import { mapPackageIntelligenceError } from "../shared/package-intelligence-error-map.js";
import { buildPackageVulnerabilitiesParams } from "../shared/package-vulnerabilities-request.js";
import {
  buildPackageVulnerabilitiesSuccessPayload,
  formatPackageVulnerabilitiesTerminal,
} from "../shared/package-vulnerabilities-response.js";
import { PKG_VULNS_GUARDRAIL } from "./guardrails.js";
import { mcpMappedErrorResult, throwIfCallerCancellation } from "./shared.js";
import {
  READ_ONLY_TOOL_ANNOTATIONS,
  type ToolDefinition,
  textResult,
  type ZodRawShape,
} from "./types.js";

export interface PackageVulnerabilitiesArgs {
  registry: string;
  package_name: string;
  version?: string;
  min_severity?: string;
  advisory_scope?: string;
  include_withdrawn?: boolean;
  verbose?: boolean;
  format?: "text" | "json";
}

/**
 * Permissive schema by design — in-handler validation via
 * `buildPackageVulnerabilitiesParams` is the single validation path
 * for both CLI and MCP. Raw Zod errors never surface to agents; the
 * structured `{error, code, retryable}` envelope is returned instead.
 */
const schema: ZodRawShape = {
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
      "Specific version to check. Defaults to latest when omitted. Go accepts versions with or without its canonical `v` prefix; tag-style `v` prefixes are rejected for other registries except Swift.",
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
    .enum(["text", "json"])
    .default("text")
    .describe(
      "Default `text` is token-efficient. Use `json` only for programmatic follow-up or exact structured details.",
    ),
};

export const DESCRIPTION_BASE: string =
  "Check current package advisories. Do not trust your memory for vulnerabilities. " +
  "Advisories can be published or revised after training; a cutoff disclaimer is not current evidence. " +
  "Covers pinned releases, latest-version risk, and vague questions about vulnerability volume or a package's security track record. " +
  'For package-wide questions, omit `version` and pass `advisory_scope:"all"`: `{"registry":"npm","package_name":"next","advisory_scope":"all"}`. ' +
  "Supports npm, PyPI, Hex, " +
  "Crates, NuGet, Maven, Packagist, RubyGems, Go, and Swift (vcpkg and Zig " +
  "are not supported for vulnerability data). Returns a count summary and advisory details: identifiers and aliases, including CVEs when available, " +
  "severity, affected ranges, and fix versions. Malicious-package " +
  "advisories surface in a separate bucket. Pinned lookup: " +
  '`{"registry":"npm","package_name":"lodash","version":"4.17.20","min_severity":"high"}`. ' +
  "Pass `version` to inspect a pinned release; omit it for latest. Default text is capped for " +
  "readability; use `verbose:true` for all selected advisory rows and identifier aliases (including CVEs), or " +
  '`format:"json"` for the complete envelope. Use ' +
  "`min_severity` to filter to a threshold (`low`, `medium`, `high`, " +
  "`critical`) and `include_withdrawn` to also see retracted " +
  'advisories. Use `advisory_scope:"non_affecting"` to list ' +
  "historical advisories that do not affect the inspected version. " +
  "Use `pkg_info` for a latest-version health overview or `pkg_upgrade_review` for current-vs-target upgrade evidence.";

export const DESCRIPTION: string = `${DESCRIPTION_BASE}\n\n${PKG_VULNS_GUARDRAIL}`;

export function createPackageVulnerabilitiesTool(
  service: PackageIntelligenceService,
): ToolDefinition<PackageVulnerabilitiesArgs, typeof schema> {
  return {
    name: "pkg_vulns",
    description: DESCRIPTION,
    schema,
    annotations: READ_ONLY_TOOL_ANNOTATIONS,
    handler: async (args, context) => {
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
          requestedVersion: params.version,
          filter,
        });
        if (isTextFormat(args.format)) {
          return textResult(
            formatPackageVulnerabilitiesTerminal(report, {
              useColors: false,
              requestedVersion: params.version,
              filter,
              verbose: args.verbose,
              surface: "mcp",
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

function isTextFormat(format: PackageVulnerabilitiesArgs["format"]): boolean {
  return format === undefined || format === "text";
}
