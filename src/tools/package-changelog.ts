import { z } from "zod";
import type { PackageIntelligenceService } from "../services/index.js";
import { buildPackageChangelogParams } from "../shared/package-changelog-request.js";
import { buildPackageChangelogSuccessPayload } from "../shared/package-changelog-response.js";
import { mapPackageIntelligenceError } from "../shared/package-intelligence-error-map.js";
import { toPkgseerRegistryLowercase } from "../shared/pkgseer-registry.js";
import { type ToolDefinition, textResult } from "./types.js";

export interface PackageChangelogArgs {
  registry?: string;
  package_name?: string;
  repo_url?: string;
  git_ref?: string;
  from_version?: string;
  to_version?: string;
  limit?: number;
  include_bodies?: boolean;
}

/**
 * Permissive schema — the shared `buildPackageChangelogParams` builder
 * is the single validation path. Raw Zod errors never surface to
 * agents. Matches the pattern established by the other pkg-intel
 * tools (`package_summary`, `package_vulnerabilities`,
 * `package_dependencies`).
 *
 * `package_changelog` is the first pkg-intel MCP tool with dual
 * addressing (`registry` + `package_name` XOR `repo_url`). The
 * underlying `packageChangelog` query is intrinsically repo-level
 * (sources: GitHub Releases / CHANGELOG.md / HexDocs), so exposing
 * `repo_url` isn't a bolt-on — it's a peer addressing mode on the
 * schema. The other pkg-intel tools omit it because their queries
 * are registry-metadata APIs with no repo-URL alternative.
 */
const schema = {
  registry: z
    .string()
    .optional()
    .describe(
      "Package registry (with `package_name`). Mutually exclusive with `repo_url`. Supported: npm, pypi, hex, crates, vcpkg, zig, nuget, maven, packagist.",
    ),
  package_name: z
    .string()
    .optional()
    .describe(
      "Package name (with `registry`). Scoped names ok (`@types/node`). Mutually exclusive with `repo_url`.",
    ),
  repo_url: z
    .string()
    .optional()
    .describe(
      "GitHub repository URL (https://…). Mutually exclusive with `registry` + `package_name`. Use when agents have a repo URL without a registry mapping.",
    ),
  from_version: z
    .string()
    .optional()
    .describe(
      "Start of version range. When set, the response returns every entry between `from_version` and `to_version` (or latest) with no count cap — range mode. Mutually exclusive with `limit`. Tag-style `v`-prefixed inputs are rejected.",
    ),
  to_version: z
    .string()
    .optional()
    .describe(
      "End of range / latest-mode cap. Works in either mode. Defaults to latest on the wire. Tag-style `v`-prefixed inputs are rejected.",
    ),
  limit: z
    .number()
    .optional()
    .describe(
      "Latest-mode cap on entry count (1–50, default 10). Rejected with `INVALID_ARGUMENT` when `from_version` is also set or when out of range.",
    ),
  git_ref: z
    .string()
    .optional()
    .describe(
      "Git branch or tag for CHANGELOG.md source (no effect on GitHub Releases or HexDocs). Defaults to the repository's default branch.",
    ),
  include_bodies: z
    .boolean()
    .optional()
    .describe(
      "When false, each entry in `entries.items[]` omits its `body` field. Default true. Set false when you only need the version / date / URL timeline — drops 10 KB+ per entry on large release notes.",
    ),
};

const DESCRIPTION =
  "Release notes for a package or GitHub repo, newest-first. Default " +
  "latest mode returns the ten most recent entries (`limit` 1–50). " +
  "With `from_version`, returns every entry in the " +
  "`[from_version, to_version]` range (range mode, no count cap). " +
  "Address via `registry` + `package_name` or `repo_url` (mutually " +
  'exclusive). Response: `source` (`"releases"` / `"changelog_file"` ' +
  '/ `"hexdocs"`), `mode` (`"latest"` or `"range"`), ' +
  "`entries: { count, items }` with full markdown bodies. Set " +
  "`include_bodies: false` for a version / date / URL timeline only. " +
  "Supports npm, PyPI, Hex, Crates, vcpkg, Zig, NuGet, Maven, " +
  "Packagist; returns `NOT_FOUND` when a package has no changelog " +
  "source.";

export function createPackageChangelogTool(
  service: PackageIntelligenceService,
): ToolDefinition<PackageChangelogArgs, typeof schema> {
  return {
    name: "pkg_changelog",
    description: DESCRIPTION,
    schema,
    annotations: { readOnlyHint: true },
    handler: async (args) => {
      try {
        const { params, explicitFilterFields } = buildPackageChangelogParams({
          registry: args.registry,
          packageName: args.package_name,
          repoUrl: args.repo_url,
          gitRef: args.git_ref,
          fromVersion: args.from_version,
          toVersion: args.to_version,
          limit: args.limit,
        });
        const report = await service.packageChangelog(params);
        const payload = buildPackageChangelogSuccessPayload(report, {
          registry: params.registry
            ? toPkgseerRegistryLowercase(params.registry)
            : undefined,
          name: params.packageName,
          repoUrl: params.repoUrl,
          mode: params.fromVersion ? "range" : "latest",
          explicitFilterFields,
          includeBodies: args.include_bodies ?? true,
          fromVersion: params.fromVersion,
          toVersion: params.toVersion,
          limit: params.limit,
          gitRef: params.gitRef,
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
