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
import { parsePackageSpec } from "../shared/package-spec.js";
import { mcpMappedErrorResult, throwIfCallerCancellation } from "./shared.js";
import {
  OPEN_WORLD_READ_ONLY_TOOL_ANNOTATIONS,
  type ToolDefinition,
  textResult,
  type ZodRawShape,
} from "./types.js";

export interface PackageDependenciesArgs {
  target: string;
  lifecycle?: string | string[];
  include_importers?: boolean;
  include_issues?: boolean;
  max_depth?: number;
  format?: "text" | "json";
}

/**
 * Strings remain permissive so package parsing and request validation
 * return mapped domain errors. Missing or non-string targets fail SDK validation.
 *
 * No `include_groups` input. `lifecycle` is the single breadth knob:
 * omit it for runtime-only, pass a concrete lifecycle for filtered
 * groups, or pass `all` for the full groups view.
 */
const schema: ZodRawShape = {
  target: z
    .string()
    .describe(
      "Package registry:name[@version], for example npm:express@5.2.1; omit the version for latest. Go accepts versions with or without v; other registries reject v-prefixed git tags except Swift.",
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
      "When true, computes deprecated, outdated, duplicate, and conflict analysis across the resolved dependency graph. Without `max_depth`, this traverses the full graph; set `max_depth` to bound analysis cost and scope. Off by default; JSON exposes complete issue rows for direct code consumption.",
    ),
  max_depth: z
    .number()
    .int()
    .min(1)
    .max(10)
    .optional()
    .describe(
      "Add a `transitive` block and cap traversal at this depth (1-10). Omit for direct output unless `include_importers` is true; `include_issues` can still analyze the full graph.",
    ),
  format: z
    .enum(["text", "json"])
    .default("text")
    .describe(
      "Omit `format` to use token-efficient text when the model reads the result or chooses follow-up tools. Set `json` only when code consumes the raw response instead of the model, or a required field is absent from text. JSON includes complete issue rows.",
    ),
};

const DESCRIPTION =
  "Inspect what a package depends on, directly or transitively. Lists direct runtime " +
  "dependencies with resolved versions; non-runtime groups are omitted by default. " +
  "Opt into transitive footprint, per-package provenance, or issue analysis with " +
  "the corresponding fields; full-graph analysis is not local application lockfile " +
  "or reachability evidence. Supports " +
  `${SUPPORTED_DEPS_REGISTRIES_LIST}.`;

export function createPackageDependenciesTool(
  service: PackageIntelligenceService,
): ToolDefinition<PackageDependenciesArgs, typeof schema> {
  return {
    name: "pkg_deps",
    description: DESCRIPTION,
    schema,
    annotations: OPEN_WORLD_READ_ONLY_TOOL_ANNOTATIONS,
    handler: async (args, context) => {
      try {
        const target = parsePackageSpec(args.target.trim());
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
          registry: target.registry,
          packageName: target.name,
          version: target.version,
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
              requestedVersion: params.version,
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
          requestedVersion: params.version,
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
  return format === undefined || format === "text";
}
