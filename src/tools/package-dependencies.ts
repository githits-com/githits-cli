import { z } from "zod";
import type { PackageIntelligenceService } from "../services/index.js";
import { InvalidPackageSpecError } from "../shared/index.js";
import { buildPackageDependenciesParams } from "../shared/package-dependencies-request.js";
import { buildPackageDependenciesSuccessPayload } from "../shared/package-dependencies-response.js";
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
}

/**
 * Permissive schema — in-handler validation via
 * `buildPackageDependenciesParams` is the single validation path so
 * raw Zod errors never surface to agents.
 *
 * No `include_groups` input. The data-first envelope emits the
 * `groups` block unconditionally when the backend returned
 * `dependencyGroups`, so an `include_groups: true` flag would have no
 * observable effect — and a silently ignored flag would confuse
 * agents.
 */
const schema = {
  registry: z
    .string()
    .describe(
      "Package registry. Dependency data is available on npm, pypi, hex, crates, vcpkg, and zig.",
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
      'Filter the `groups` block server-side by lifecycle phase. Accepts a single value, a comma-separated string (e.g. `"runtime,development"`), or an array of strings. Canonical values: `runtime`, `development`, `build`, `peer`, `optional`. Uppercase is tolerated. When the filter matches nothing the response still includes `groups: { items: [] }` so you can tell an empty-match apart from a registry that has no groups concept.',
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
};

const DESCRIPTION =
  "Analyze a package's dependency graph. The response always includes " +
  "a `runtime` block listing the direct runtime dependencies as " +
  "`{name, version, constraint}` records (the backend resolves each " +
  "constraint to a concrete version for you). It also always includes " +
  "a structured `groups` block whenever the backend returns group " +
  "metadata — one group per lifecycle (`runtime`, `development`, " +
  "`build`, `peer`, `optional`) plus feature-conditional groups for " +
  "registries that have them (PyPI extras, Crates features). Use " +
  "`lifecycle` to filter `groups` server-side. Set " +
  "`include_transitive: true` to add a `transitive` block with the " +
  "full install footprint, conflict detection, and circular-" +
  "dependency flags; layer `include_importers: true` on top when you " +
  "also need per-package provenance. Supports npm, PyPI, Hex, Crates, " +
  "vcpkg, and Zig.";

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
