import type { PackageIntelligenceService } from "@githits/core-internal";
import { PKGSEER_REGISTRY_LIST } from "@githits/core-internal";
import { z } from "zod";
import { mapPackageIntelligenceError } from "../shared/package-intelligence-error-map.js";
import {
  buildPackageUpgradeReviewRequest,
  PACKAGE_UPGRADE_REVIEW_MAX_PACKAGES,
} from "../shared/package-upgrade-review-request.js";
import {
  buildPackageUpgradeReview,
  formatPackageUpgradeReviewTerminal,
} from "../shared/package-upgrade-review-response.js";
import { PKG_UPGRADE_REVIEW_GUARDRAIL } from "./guardrails.js";
import { mcpMappedErrorResult, throwIfCallerCancellation } from "./shared.js";
import {
  OPEN_WORLD_READ_ONLY_TOOL_ANNOTATIONS,
  type ToolDefinition,
  textResult,
  type ZodRawShape,
} from "./types.js";

export interface PackageUpgradeReviewArgs {
  registry?: string;
  package_name?: string;
  current_version?: string;
  target_version?: string;
  packages?: Array<{
    registry: string;
    package_name: string;
    current_version: string;
    target_version: string;
  }>;
  skip_transitive_security?: boolean;
  include_dependency_issues?: boolean;
  min_severity?: string;
  changes?: string;
  verbose?: boolean;
  format?: "text" | "json";
}

const packageSchema = z.object({
  registry: z
    .string()
    .describe("Registry; see top-level registry for supported values."),
  package_name: z.string().describe("Package name, scoped names ok."),
  current_version: z
    .string()
    .describe(
      "Current version; see top-level current_version for spelling rules.",
    ),
  target_version: z
    .string()
    .describe(
      "Target version; see top-level current_version for spelling rules.",
    ),
});

const schema: ZodRawShape = {
  registry: z
    .string()
    .optional()
    .describe(
      `Package registry for single-package mode. Supported: ${PKGSEER_REGISTRY_LIST}.`,
    ),
  package_name: z
    .string()
    .optional()
    .describe("Package name for single-package mode."),
  current_version: z
    .string()
    .optional()
    .describe(
      "Currently used version for single-package mode. Go accepts versions with or without its canonical v prefix; tag-style v prefixes are rejected for other registries except Swift.",
    ),
  target_version: z
    .string()
    .optional()
    .describe(
      "Target version for single-package mode; spelling rules as current_version.",
    ),
  packages: z
    .array(packageSchema)
    .optional()
    .describe(
      `Batch mode with at most ${PACKAGE_UPGRADE_REVIEW_MAX_PACKAGES} upgrades after blank rows are removed. Mutually exclusive with single-package fields.`,
    ),
  skip_transitive_security: z
    .boolean()
    .optional()
    .describe(
      "When true, skip current-vs-target transitive vulnerability summary diffs. Defaults false, so transitive security evidence is included unless explicitly skipped.",
    ),
  include_dependency_issues: z
    .boolean()
    .optional()
    .describe(
      "When true, diff current vs target transitive deprecated/outdated/duplicate/conflict summaries. Defaults false.",
    ),
  min_severity: z
    .string()
    .optional()
    .describe(
      "Minimum direct-advisory severity: low, medium, high, or critical.",
    ),
  changes: z
    .string()
    .optional()
    .describe(
      "Filter detailed statement quotes only: actionable (MUST_ACT), important (MUST_ACT + SHOULD_KNOW), or all parsed units, including no-impact and unassessed. Omit or pass blank to use focused (MUST_ACT + SHOULD_KNOW + too-long-to-classify (oversize) statements). Whole-range counters and batch ranking do not change.",
    ),
  verbose: z
    .boolean()
    .optional()
    .describe(
      "Text output only. Batches default to triage rows; verbose adds full per-package reports, expands statement quotes up to backend bounds, and expands dependency change examples.",
    ),
  format: z
    .enum(["text", "json"])
    .default("text")
    .describe(
      "Omit for text. Use json only when code consumes raw fields or text lacks a required field. JSON includes selected statement pages, source positions/context and classifier provenance.",
    ),
};

const DESCRIPTION =
  "Review a package upgrade: vulnerabilities, releases, peers, dependency changes. Compares current and target versions, including target deprecation and optional transitive evidence diffs. Reports facts only: classified release-note statements in source order with nearby URLs and coverage, not package-level risk or an accept decision. Use this instead of inferring acceptability from semver, including patch bumps; start assessments here and add pkg_changelog or code_diff only for missing details. Preserve generated-from-commits labels and pending/unavailable status; generated statements are not publisher notes. Batches default to triage rows; verbose expands per-package evidence. Single mode: registry/package_name/current_version/target_version; batch: packages[] (at most " +
  PACKAGE_UPGRADE_REVIEW_MAX_PACKAGES +
  ")." +
  `\n\n${PKG_UPGRADE_REVIEW_GUARDRAIL}`;

export function createPackageUpgradeReviewTool(
  service: PackageIntelligenceService,
): ToolDefinition<PackageUpgradeReviewArgs, typeof schema> {
  return {
    name: "pkg_upgrade_review",
    description: DESCRIPTION,
    schema,
    annotations: OPEN_WORLD_READ_ONLY_TOOL_ANNOTATIONS,
    handler: async (args, context) => {
      try {
        const request = buildPackageUpgradeReviewRequest({
          registry: args.registry,
          packageName: args.package_name,
          currentVersion: args.current_version,
          targetVersion: args.target_version,
          packages: args.packages?.map((pkg) => ({
            registry: pkg.registry,
            packageName: pkg.package_name,
            currentVersion: pkg.current_version,
            targetVersion: pkg.target_version,
          })),
          includeTransitiveSecurity: args.skip_transitive_security !== true,
          includeDependencyIssues: args.include_dependency_issues,
          minSeverity: args.min_severity,
          changes: args.changes,
          format: args.format,
          verbose: args.verbose === true,
        });
        const response = await buildPackageUpgradeReview(
          service,
          request.packages,
          request.options,
          context?.signal,
        );
        if (args.format === "json") return textResult(JSON.stringify(response));
        return textResult(
          formatPackageUpgradeReviewTerminal(response, {
            surface: "mcp",
            verbose: args.verbose === true,
          }).trimEnd(),
        );
      } catch (error) {
        throwIfCallerCancellation(error, context?.signal);
        const mapped = mapPackageIntelligenceError(error);
        return mcpMappedErrorResult(mapped, context, args.format, {
          recovery: { syntax: "mcp", tool: "pkg_upgrade_review", args },
        });
      }
    },
  };
}
