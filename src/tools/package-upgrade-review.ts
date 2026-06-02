import { z } from "zod";
import type { PackageIntelligenceService } from "../services/index.js";
import {
  buildPackageUpgradeReview,
  buildPackageUpgradeReviewRequest,
  formatPackageUpgradeReviewTerminal,
  mapPackageIntelligenceError,
} from "../shared/index.js";
import { PKGSEER_REGISTRY_LIST } from "../shared/pkgseer-registry.js";
import { type ToolDefinition, textResult } from "./types.js";

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
      "Currently used package version. Tag-style v-prefixes are rejected except for Swift.",
    ),
  target_version: z
    .string()
    .describe(
      "Target package version. Tag-style v-prefixes are rejected except for Swift.",
    ),
});

const schema = {
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
      "Currently used version for single-package mode. Tag-style v-prefixes are rejected except for Swift.",
    ),
  target_version: z
    .string()
    .optional()
    .describe(
      "Target version for single-package mode. Tag-style v-prefixes are rejected except for Swift.",
    ),
  packages: z
    .array(packageSchema)
    .optional()
    .describe("Batch mode. Mutually exclusive with single-package fields."),
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
    .enum(["json", "text", "text-v1"])
    .optional()
    .describe(
      "Response format. Default `text-v1`; pass `json` for structured output.",
    ),
};

const DESCRIPTION =
  "Use when the user asks whether to accept, assess, review, or investigate a dependency update from one version to another. Report package-upgrade evidence by comparing current and target versions with " +
  "direct vulnerability checks, changelog range evidence, target deprecation " +
  "metadata, peer dependency changes, and optional transitive evidence diffs. " +
  "The tool reports facts only and does not assign risk or decide whether to accept an upgrade. " +
  "Use this instead of inferring acceptability from semver, including patch bumps. " +
  "Accepts either one package via registry/package_name/current_version/" +
  "target_version or batch `packages[]`. Batch execution is capped internally " +
  "to avoid flooding the package-intelligence backend.";

export function createPackageUpgradeReviewTool(
  service: PackageIntelligenceService,
): ToolDefinition<PackageUpgradeReviewArgs, typeof schema> {
  return {
    name: "pkg_upgrade_review",
    description: DESCRIPTION,
    schema,
    annotations: { readOnlyHint: true },
    handler: async (args) => {
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
