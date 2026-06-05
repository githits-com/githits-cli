import type { PackageIntelligenceService } from "@githits/core-internal";
import {
  PKGSEER_REGISTRY_LIST,
  toPkgseerRegistryLowercase,
} from "@githits/core-internal";
import { z } from "zod";
import { buildPackageChangelogParams } from "../shared/package-changelog-request.js";
import {
  buildPackageChangelogSuccessPayload,
  formatPackageChangelogTerminal,
} from "../shared/package-changelog-response.js";
import { mapPackageIntelligenceError } from "../shared/package-intelligence-error-map.js";
import { InvalidPackageSpecError } from "../shared/package-spec.js";
import { PKG_CHANGELOG_GUARDRAIL } from "./guardrails.js";
import { mcpMappedErrorResult } from "./shared.js";
import { type ToolDefinition, textResult } from "./types.js";

export interface PackageChangelogArgs {
  registry?: string;
  package_name?: string;
  repo_url?: string;
  git_ref?: string;
  from_version?: string;
  to_version?: string;
  limit?: number;
  omit_bodies?: boolean;
  verbose?: boolean;
  body_lines?: number;
  format?: "json" | "text" | "text-v1";
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
      `Package registry (with \`package_name\`). Mutually exclusive with \`repo_url\`. Supported: ${PKGSEER_REGISTRY_LIST}.`,
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
      "Start of version range. When set, the response returns every entry between `from_version` and `to_version` (or latest) with no count cap — range mode. Mutually exclusive with `limit`. Tag-style `v`-prefixed inputs are rejected except for Swift.",
    ),
  to_version: z
    .string()
    .optional()
    .describe(
      "End of range / latest-mode cap. Works in either mode. Defaults to latest on the wire. Tag-style `v`-prefixed inputs are rejected except for Swift.",
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
  omit_bodies: z
    .boolean()
    .optional()
    .describe(
      "When true, each entry in `entries.items[]` omits its `body` field. Default false. Use when you only need the version / date / URL timeline — drops 10 KB+ per entry on large release notes.",
    ),
  verbose: z
    .boolean()
    .optional()
    .describe(
      "Text output only. Show full body previews. Mutually exclusive with omit_bodies:true and body_lines.",
    ),
  body_lines: z
    .number()
    .optional()
    .describe(
      "Text output only. Number of body lines to preview per entry (1-50, default 10). Ignored for format=json and omit_bodies:true. Mutually exclusive with verbose:true.",
    ),
  format: z
    .enum(["json", "text", "text-v1"])
    .optional()
    .describe(
      'Response format. Default `text-v1` — compact entry timeline with body previews. Pass `format: "json"` for the structured envelope with full markdown bodies.',
    ),
};

export const DESCRIPTION =
  "Use when the user asks what changed in a package, wants release notes, or needs changelog evidence for a manual upgrade review. Release notes for a package or GitHub repo, newest-first. Default " +
  "latest mode returns the ten most recent entries (`limit` 1–50). " +
  "With `from_version`, returns every entry in the " +
  "`[from_version, to_version]` range (range mode, no count cap). " +
  "Address via `registry` + `package_name` or `repo_url` (mutually " +
  'exclusive). Response includes optional `source` (`"releases"` / ' +
  '`"changelog_file"` / `"hexdocs"`) when a concrete changelog source ' +
  'exists, `mode` (`"latest"` or `"range"`), and entries with ' +
  "markdown body previews. Example: " +
  '`{"registry":"npm","package_name":"express","limit":2}`. ' +
  "Text output previews 10 body lines by default; use `body_lines` " +
  "to tune the preview or `verbose:true` for full text bodies. Set " +
  "`omit_bodies: true` for a version / date / URL timeline only; " +
  'pass `format: "json"` for the complete structured envelope. ' +
  "Package-version entries without changelog " +
  "text succeed with `source` omitted; no-source plus no entries " +
  "returns `NOT_FOUND`. Supports npm, PyPI, Hex, Crates, NuGet, " +
  "Maven, Zig, vcpkg, Packagist, RubyGems, Go, and Swift." +
  `\n\n${PKG_CHANGELOG_GUARDRAIL}`;

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
        const textFormat = isTextFormat(args.format);
        const bodyPreviewLines = textFormat
          ? validateTextOptions(args)
          : undefined;
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
          includeBodies: args.omit_bodies !== true,
          fromVersion: params.fromVersion,
          toVersion: params.toVersion,
          limit: params.limit,
          gitRef: params.gitRef,
        });
        if (textFormat) {
          return textResult(
            formatPackageChangelogTerminal(payload, {
              useColors: false,
              verbose: args.verbose ?? false,
              bodyPreviewLines,
              fullBodyHint:
                'pass verbose=true, body_lines=<n>, or format="json" for full bodies',
            }).trimEnd(),
          );
        }
        return textResult(JSON.stringify(payload));
      } catch (error) {
        const mapped = mapPackageIntelligenceError(error);
        return mcpMappedErrorResult(mapped);
      }
    },
  };
}

function validateTextOptions(args: PackageChangelogArgs): number | undefined {
  if (args.omit_bodies === true && args.verbose === true) {
    throw new InvalidPackageSpecError(
      "verbose:true conflicts with omit_bodies:true because bodies are omitted. Drop one of the two options.",
    );
  }
  if (args.verbose === true && args.body_lines !== undefined) {
    throw new InvalidPackageSpecError(
      "body_lines conflicts with verbose:true because verbose already shows full bodies. Drop one of the two options.",
    );
  }
  if (args.body_lines === undefined) return undefined;
  if (
    !Number.isInteger(args.body_lines) ||
    args.body_lines < 1 ||
    args.body_lines > 50
  ) {
    throw new InvalidPackageSpecError(
      `body_lines must be an integer between 1 and 50. Got ${args.body_lines}.`,
    );
  }
  return args.body_lines;
}

function isTextFormat(format: PackageChangelogArgs["format"]): boolean {
  return format === undefined || format === "text" || format === "text-v1";
}
