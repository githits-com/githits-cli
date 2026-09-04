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
  READ_ONLY_TOOL_ANNOTATIONS,
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
  verbose?: boolean;
  format?: "json" | "text" | "text-v1";
}

const packageSchema = z.object({
  registry: z
    .string()
    .describe(`Package registry. Supported: ${PKGSEER_REGISTRY_LIST}.`),
  package_name: z.string().describe("Package name, scoped names ok."),
  current_version: z
    .string()
    .describe(
      "Currently used package version. Go accepts versions with or without its canonical v prefix; tag-style v prefixes are rejected for other registries except Swift.",
    ),
  target_version: z
    .string()
    .describe(
      "Target package version. Go accepts versions with or without its canonical v prefix; tag-style v prefixes are rejected for other registries except Swift.",
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
      "Target version for single-package mode. Go accepts versions with or without its canonical v prefix; tag-style v prefixes are rejected for other registries except Swift.",
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
  verbose: z
    .boolean()
    .optional()
    .describe(
      "Text output only. Include dependency change examples, including transitive version changes.",
    ),
  format: z
    .enum(["text-v1", "text", "json"])
    .default("text-v1")
    .describe(
      "Response format. Default `text-v1`; pass `json` for structured output.",
    ),
};

const DESCRIPTION =
  "Review a package upgrade: vulnerabilities, releases, peers, dependency changes. " +
  "Compares current and target versions using direct vulnerability checks, changelog ranges, target deprecation metadata, peer dependency changes, and optional transitive evidence diffs. " +
  "The tool reports facts only and does not assign risk or decide whether to accept an upgrade. " +
  "Use this instead of inferring acceptability from semver, including patch bumps. " +
  "Accepts either one package via registry/package_name/current_version/" +
  `target_version or batch \`packages[]\` with at most ${PACKAGE_UPGRADE_REVIEW_MAX_PACKAGES} upgrades. ` +
  "Use `pkg_info` for latest health, `pkg_changelog` for release notes, `pkg_vulns` for advisory detail, or `pkg_deps` for dependency graphs." +
  `\n\n${PKG_UPGRADE_REVIEW_GUARDRAIL}`;

export function createPackageUpgradeReviewTool(
  service: PackageIntelligenceService,
): ToolDefinition<PackageUpgradeReviewArgs, typeof schema> {
  return {
    name: "pkg_upgrade_review",
    description: DESCRIPTION,
    schema,
    annotations: READ_ONLY_TOOL_ANNOTATIONS,
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
        });
        const response = await buildPackageUpgradeReview(
          service,
          request.packages,
          request.options,
        );
        if (args.format === "json") return textResult(JSON.stringify(response));
        return textResult(
          formatPackageUpgradeReviewTerminal(response, {
            verbose: args.verbose === true,
          }).trimEnd(),
        );
      } catch (error) {
        throwIfCallerCancellation(error, context?.signal);
        const mapped = mapPackageIntelligenceError(error);
        return mcpMappedErrorResult(mapped, context);
      }
    },
  };
}
