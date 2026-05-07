import { z } from "zod";
import type { PackageIntelligenceService } from "../services/index.js";
import { InvalidPackageSpecError } from "../shared/index.js";
import {
  buildPackageDependenciesParams,
  SUPPORTED_DEPS_REGISTRIES_LIST,
} from "../shared/package-dependencies-request.js";
import {
  buildPackageDependenciesSuccessPayload,
  formatPackageDependenciesTerminal,
} from "../shared/package-dependencies-response.js";
import { mapPackageIntelligenceError } from "../shared/package-intelligence-error-map.js";
import { type ToolDefinition, textResult } from "./types.js";

export interface PackageDependenciesArgs {
  registry: string;
  package_name: string;
  version?: string;
  lifecycle?: string | string[];
  include_transitive?: boolean;
  include_importers?: boolean;
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
const schema = {
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
      "Specific version to inspect. Defaults to latest when omitted. Tag-style inputs with a leading `v` (for example `v4.18.0`) are rejected — pass the canonical version (`4.18.0`).",
    ),
  lifecycle: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .describe(
      "Lifecycle breadth. Omit for runtime-only. Use `runtime` for explicit runtime-only, a concrete non-runtime lifecycle (`development`, `build`, `peer`, `optional`) for runtime plus matching groups, or `all` for runtime plus all available groups. Accepts a single value, a comma-separated string, or an array; `all` cannot be combined with other values. Uppercase is tolerated.",
    ),
  include_transitive: z
    .boolean()
    .optional()
    .describe(
      "When true the response gains a `transitive` block with aggregate counts (`edges`, `uniquePackages`), the preprocessed `packages[]` list (each `{name, version}` — the complete install footprint), plus typed `conflicts[]` (`{name, requiredVersions}`) and `circularDependencies[]` (`{cycle: string[]}`) when the backend reported any. Off by default.",
    ),
  include_importers: z
    .boolean()
    .optional()
    .describe(
      "Requires `include_transitive: true`. When true, each entry in `transitive.packages[]` also carries an `importers` array — every upstream package that pulls it in, with that importer's own resolved version and the constraint it declared. Off by default because adding provenance roughly quadruples the envelope size on heavy graphs. Turn on when you need to trace why a specific transitive dep is present.",
    ),
  max_depth: z
    .number()
    .int()
    .min(1)
    .max(10)
    .optional()
    .describe(
      "Cap the transitive traversal at this depth (1–10). Omit to get the backend's full graph. Requires `include_transitive: true` — passing `max_depth` without the transitive flag is rejected with `INVALID_ARGUMENT`.",
    ),
  format: z
    .enum(["json", "text", "text-v1"])
    .optional()
    .describe(
      'Response format. Default `text-v1` — compact dependency listing. Pass `format: "json"` for the structured envelope.',
    ),
};

const DESCRIPTION =
  "Analyze a package's dependency graph. Lists direct runtime " +
  "dependencies with resolved versions; non-runtime groups are " +
  "omitted by default. Use `lifecycle` with a concrete value for " +
  "runtime plus matching groups, or `all` for runtime plus every " +
  "available group. Set `include_transitive: true` to add a " +
  "`transitive` block with the full install footprint, conflict " +
  "detection, and circular-dependency flags; layer " +
  "`include_importers: true` on top when you also need per-package " +
  "provenance. Supports npm, PyPI, Hex, Crates, Zig, vcpkg, RubyGems, " +
  "and Go.";

export function createPackageDependenciesTool(
  service: PackageIntelligenceService,
): ToolDefinition<PackageDependenciesArgs, typeof schema> {
  return {
    name: "pkg_deps",
    description: DESCRIPTION,
    schema,
    annotations: { readOnlyHint: true },
    handler: async (args) => {
      try {
        if (args.max_depth !== undefined && !args.include_transitive) {
          throw new InvalidPackageSpecError(
            "max_depth requires include_transitive: true. Either drop max_depth or set include_transitive.",
          );
        }
        if (args.include_importers && !args.include_transitive) {
          throw new InvalidPackageSpecError(
            "include_importers requires include_transitive: true. Either drop include_importers or set include_transitive.",
          );
        }
        // Always fetch the transitive DAG on the wire — even without
        // `include_transitive` we need it at depth 1 to resolve each
        // direct dep's constraint to a concrete version (surfaced as
        // `runtime.items[].version`). Mirrors the CLI path.
        const wireMaxDepth = args.include_transitive ? args.max_depth : 1;
        const { params, canonicalLifecycles } = buildPackageDependenciesParams({
          registry: args.registry,
          packageName: args.package_name,
          version: args.version,
          includeTransitive: true,
          maxDepth: wireMaxDepth,
          lifecycle: args.lifecycle,
        });
        const report = await service.packageDependencies(params);
        const payload = buildPackageDependenciesSuccessPayload(report, {
          requestedVersion: args.version,
          canonicalLifecycles,
          includeTransitive: args.include_transitive,
          maxDepth: args.max_depth,
          includeImporters: args.include_importers ?? false,
        });
        if (isTextFormat(args.format)) {
          const textLifecycles =
            canonicalLifecycles.length > 0
              ? canonicalLifecycles
              : (["all"] satisfies typeof canonicalLifecycles);
          return textResult(
            formatPackageDependenciesTerminal(report, {
              useColors: false,
              requestedVersion: args.version,
              canonicalLifecycles: textLifecycles,
              includeTransitive: args.include_transitive,
              maxDepth: args.max_depth,
              showGroups:
                canonicalLifecycles.length > 0 &&
                !canonicalLifecycles.every((item) => item === "runtime"),
              hiddenGroupsHint: 'pass lifecycle="all".',
            }).trimEnd(),
          );
        }
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

function isTextFormat(format: PackageDependenciesArgs["format"]): boolean {
  return format === undefined || format === "text" || format === "text-v1";
}
