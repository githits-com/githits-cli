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
  include_transitive?: boolean;
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
  include_transitive: z
    .boolean()
    .optional()
    .describe(
      "Opt in to npm-audit-style evidence for vulnerabilities affecting versions resolved in the dependency graph. Adds graph-analysis cost; this is resolved dependency evidence, not package-history scope. min_severity applies to both; advisory_scope and include_withdrawn affect direct rows only, and transitive withdrawn advisories remain excluded.",
    ),
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
      "Use `text` (default) for reading and tool follow-ups; it is token-efficient. Use `json` only to parse responses in code or obtain fields absent from text.",
    ),
};

export const DESCRIPTION_BASE: string =
  "Check current package advisories. Do not trust your memory for vulnerabilities. " +
  "Advisories can be published or revised after training; a cutoff disclaimer is not current evidence. " +
  "Covers pinned releases, latest-version risk, and package security history. " +
  'For package-wide history, omit `version` and pass `advisory_scope:"all"`: `{"registry":"npm","package_name":"next","advisory_scope":"all"}`. ' +
  "Supports npm, PyPI, Hex, Crates, NuGet, Maven, Packagist, RubyGems, Go, and Swift; vcpkg and Zig unsupported. " +
  "Returns counts/details: identifiers and aliases, including CVEs when available, severity, affected ranges, and fixes; malicious advisories are separate. " +
  "Pinned lookup: pass `version`; omit it for latest. " +
  "Default text is capped; `verbose:true` shows all selected rows and identifier aliases (including CVEs), while " +
  '`format:"json"` returns the complete envelope. `min_severity` filters thresholds (`low`, `medium`, `high`, `critical`); `include_withdrawn` includes retracted advisories. ' +
  "Use `include_transitive:true` for npm-audit-style evidence covering vulnerabilities in versions resolved by the dependency graph; this is opt-in because it adds graph-analysis cost and is distinct from package-wide advisory history. `min_severity` applies to direct and transitive rows, while `advisory_scope` and `include_withdrawn` affect direct rows only and transitive withdrawn advisories remain excluded. " +
  "Use `pkg_info` for latest health overview or `pkg_upgrade_review` for current-vs-target upgrade evidence.";

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
          includeTransitive: args.include_transitive,
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
