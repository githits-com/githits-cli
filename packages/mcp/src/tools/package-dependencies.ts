import type { PackageIntelligenceService } from "@githits/core-internal";
import { z } from "zod";
import {
  buildPackageDependenciesParams,
  SUPPORTED_DEPS_REGISTRIES_LIST,
} from "../shared/package-dependencies-request.js";
import {
  buildPackageDependenciesSuccessPayload,
  formatPackageDependenciesTerminal,
} from "../shared/package-dependencies-response.js";
import { mapPackageIntelligenceError } from "../shared/package-intelligence-error-map.js";
import { mcpMappedErrorResult, throwIfCallerCancellation } from "./shared.js";
import {
  READ_ONLY_TOOL_ANNOTATIONS,
  type ToolDefinition,
  textResult,
  type ZodRawShape,
} from "./types.js";

export interface PackageDependenciesArgs {
  registry: string;
  package_name: string;
  version?: string;
  lifecycle?: string | string[];
  include_importers?: boolean;
  include_issues?: boolean;
  max_depth?: number;
  format?: "json" | "text" | "text-v1";
}

/**
 * Permissive schema — in-handler validation via
 * `buildPackageDependenciesParams` is the single validation path so
 * raw Zod errors never surface to agents.
 *
 * No `include_groups` input. `lifecycle` is the single breadth knob:
 * omit it for runtime-only, pass a concrete lifecycle for filtered
 * groups, or pass `all` for the full groups view.
 */
const schema: ZodRawShape = {
  registry: z
    .string()
    .describe(
      `Package registry. Dependency data is available on ${SUPPORTED_DEPS_REGISTRIES_LIST}.`,
    ),
  package_name: z
    .string()
    .describe("Package name (scoped names ok: @types/node)."),
  version: z
    .string()
    .optional()
    .describe(
      "Specific version to inspect. Defaults to latest when omitted. Go accepts `v1.2.3` or `1.2.3` and sends canonical `v1.2.3`; tag-style inputs with a leading `v` are rejected for other registries except Swift.",
    ),
  lifecycle: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .describe(
      "Lifecycle breadth. Omit for runtime-only. Use `runtime` for explicit runtime-only, a concrete non-runtime lifecycle (`development`, `build`, `peer`, `optional`) for runtime plus matching groups, or `all` for runtime plus all available groups. Accepts a single value, a comma-separated string, or an array; `all` cannot be combined with other values. Uppercase is tolerated.",
    ),
  include_importers: z
    .boolean()
    .optional()
    .describe(
      "When true, each entry in `transitive.packages[]` also carries an `importers` array — every upstream package that pulls it in, with that importer's own resolved version and the constraint it declared. Off by default because adding provenance roughly quadruples the envelope size on heavy graphs. If `max_depth` is omitted, this also requests the full transitive block.",
    ),
  include_issues: z
    .boolean()
    .optional()
    .describe(
      'When true, computes deprecated, outdated, duplicate, and conflict analysis across the resolved dependency graph. Without `max_depth`, this traverses the full graph; set `max_depth` to bound analysis cost and scope. Off by default; use `format: "json"` for complete issue rows.',
    ),
  max_depth: z
    .number()
    .int()
    .min(1)
    .max(10)
    .optional()
    .describe(
      "Add a `transitive` block and cap traversal at this depth (1-10). Omit for direct dependencies only.",
    ),
  format: z
    .enum(["text-v1", "text", "json"])
    .default("text-v1")
    .describe(
      'Response format. Default `text-v1` — compact dependency listing. Pass `format: "json"` for the structured envelope.',
    ),
};

const DESCRIPTION =
  "Inspect what a package depends on, directly or transitively. Lists direct runtime " +
  "dependencies with resolved versions; non-runtime groups are " +
  "omitted by default. Use `lifecycle` with a concrete value for " +
  "matching dependency groups, or `all` for every available group. " +
  "Runtime group rows include resolved versions when available. " +
  "Pass `max_depth` to add a `transitive` block with the capped " +
  "install footprint, conflict detection, and circular-dependency " +
  "flags; layer `include_importers: true` on top when you also need " +
  "per-package provenance. Supports npm, PyPI, Hex, Crates, Zig, vcpkg, RubyGems, " +
  "Go, and Swift. Use `include_issues: true` for deprecated, outdated, duplicate, " +
  'and conflict analysis across the resolved dependency graph; use `format: "json"` ' +
  "for complete issue rows. Without `max_depth`, issues scan the full graph; " +
  "`max_depth` bounds cost and scope. " +
  "Use `pkg_info` for latest package health, `pkg_vulns` for advisories, or `pkg_upgrade_review` for current-vs-target evidence.";

export function createPackageDependenciesTool(
  service: PackageIntelligenceService,
): ToolDefinition<PackageDependenciesArgs, typeof schema> {
  return {
    name: "pkg_deps",
    description: DESCRIPTION,
    schema,
    annotations: READ_ONLY_TOOL_ANNOTATIONS,
    handler: async (args, context) => {
      try {
        const includeIssues = args.include_issues;
        const includeTransitiveOutput =
          args.max_depth !== undefined || args.include_importers === true;
        // Always fetch the transitive DAG on the wire — even without
        // a transitive output block we need it at depth 1 to resolve each
        // direct dep's constraint to a concrete version (surfaced as
        // `runtime.items[].version`). Mirrors the CLI path.
        const wireMaxDepth =
          includeTransitiveOutput || includeIssues === true
            ? args.max_depth
            : 1;
        const { params, canonicalLifecycles } = buildPackageDependenciesParams({
          registry: args.registry,
          packageName: args.package_name,
          version: args.version,
          includeTransitive: true,
          maxDepth: wireMaxDepth,
          lifecycle: args.lifecycle,
          includeIssues,
        });
        const showGroups =
          canonicalLifecycles.length > 0 &&
          !canonicalLifecycles.every((item) => item === "runtime");
        const textFormat = isTextFormat(args.format);
        const report = await service.packageDependencies({
          ...params,
          includeTransitiveDetails: includeTransitiveOutput,
          includeGroups: showGroups || textFormat,
        });
        if (textFormat) {
          const textLifecycles =
            canonicalLifecycles.length > 0
              ? canonicalLifecycles
              : (["all"] satisfies typeof canonicalLifecycles);
          return textResult(
            formatPackageDependenciesTerminal(report, {
              useColors: false,
              requestedVersion: args.version,
              canonicalLifecycles: textLifecycles,
              includeTransitive: includeTransitiveOutput,
              maxDepth: args.max_depth,
              showGroups,
              hiddenGroupsHint: 'pass lifecycle="all".',
              includeIssues,
              issuesDetailHint:
                'Pass format: "json" for complete issue details.',
            }).trimEnd(),
          );
        }
        const payload = buildPackageDependenciesSuccessPayload(report, {
          requestedVersion: args.version,
          canonicalLifecycles,
          includeTransitive: includeTransitiveOutput,
          maxDepth: args.max_depth,
          includeImporters: args.include_importers ?? false,
          includeIssues,
        });
        return textResult(JSON.stringify(payload));
      } catch (error) {
        throwIfCallerCancellation(error, context?.signal);
        const mapped = mapPackageIntelligenceError(error);
        return mcpMappedErrorResult(mapped, context);
      }
    },
  };
}

function isTextFormat(format: PackageDependenciesArgs["format"]): boolean {
  return format === undefined || format === "text" || format === "text-v1";
}
