import type { PackageIntelligenceService } from "@githits/core-internal";
import { z } from "zod";
import { mapPackageIntelligenceError } from "../shared/package-intelligence-error-map.js";
import { parsePackageSpec } from "../shared/package-spec.js";
import { buildPackageVulnerabilitiesParams } from "../shared/package-vulnerabilities-request.js";
import {
  buildPackageVulnerabilitiesSuccessPayload,
  formatPackageVulnerabilitiesTerminal,
} from "../shared/package-vulnerabilities-response.js";
import { PKG_VULNS_GUARDRAIL } from "./guardrails.js";
import { mcpMappedErrorResult, throwIfCallerCancellation } from "./shared.js";
import {
  OPEN_WORLD_READ_ONLY_TOOL_ANNOTATIONS,
  type ToolDefinition,
  textResult,
  type ZodRawShape,
} from "./types.js";

export interface PackageVulnerabilitiesArgs {
  target: string;
  min_severity?: string;
  advisory_scope?: string;
  include_withdrawn?: boolean;
  include_transitive?: boolean;
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
      "Package registry:name[@version], for example npm:lodash@4.17.20; omit the version for latest. Go accepts versions with or without v; other registries reject v-prefixed git tags except Swift.",
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
      "Opt in to dependency vulnerability evidence for the resolved graph. Adds graph-analysis cost; min_severity and advisory_scope apply to direct and transitive rows, while include_withdrawn affects direct rows only.",
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
      "Omit `format` to use token-efficient text when the model reads the result or chooses follow-up tools. Set `json` only when code consumes the raw response instead of the model, or a required field is absent from text.",
    ),
};

export const DESCRIPTION_BASE: string =
  "Check current package advisories. Do not trust your memory for vulnerabilities. " +
  "Advisories can be published or revised after training; a cutoff disclaimer is not current evidence. " +
  "Covers pinned releases, latest-version risk, and package security history. " +
  'For package-wide history, use an unpinned target and `advisory_scope:"all"`: `{"target":"npm:next","advisory_scope":"all"}`. ' +
  "Supports npm, PyPI, Hex, Crates, NuGet, Maven, Packagist, RubyGems, Go, and Swift; vcpkg and Zig unsupported. " +
  "Returns counts/details: identifiers and aliases, including CVEs when available, severity, affected ranges, and fixes; malicious advisories are separate. " +
  "Default text is capped; `verbose:true` shows all selected rows and identifier aliases (including CVEs). " +
  'For code consuming raw output, `format:"json"` returns the complete envelope. `min_severity` filters thresholds (`low`, `medium`, `high`, `critical`); `include_withdrawn` includes retracted advisories. ' +
  "Use `include_transitive:true` for dependency vulnerability evidence covering the resolved graph; this is opt-in because it adds graph-analysis cost. `min_severity` and `advisory_scope` apply to direct and transitive rows, while `include_withdrawn` affects direct rows only and transitive withdrawn advisories remain excluded. " +
  "Use `pkg_info` for latest health overview or `pkg_upgrade_review` for current-vs-target upgrade evidence.";

export const DESCRIPTION: string = `${DESCRIPTION_BASE}\n\n${PKG_VULNS_GUARDRAIL}`;

export function createPackageVulnerabilitiesTool(
  service: PackageIntelligenceService,
): ToolDefinition<PackageVulnerabilitiesArgs, typeof schema> {
  return {
    name: "pkg_vulns",
    description: DESCRIPTION,
    schema,
    annotations: OPEN_WORLD_READ_ONLY_TOOL_ANNOTATIONS,
    handler: async (args, context) => {
      try {
        const target = parsePackageSpec(args.target.trim());
        const { params: builtParams, filter } =
          buildPackageVulnerabilitiesParams({
            registry: target.registry,
            packageName: target.name,
            version: target.version,
            minSeverity: args.min_severity,
            includeWithdrawn: args.include_withdrawn,
            includeTransitive: args.include_transitive,
            advisoryScope: args.advisory_scope,
          });
        const params = {
          ...builtParams,
          includeTransitiveAdvisoryDetails:
            args.format === "json" ||
            (args.verbose === true &&
              (builtParams.advisoryScope ?? "AFFECTED") !== "AFFECTED"),
        };
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
