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
import { mcpMappedErrorResult, throwIfCallerCancellation } from "./shared.js";
import {
  OPEN_WORLD_READ_ONLY_TOOL_ANNOTATIONS,
  type ToolDefinition,
  textResult,
  type ZodRawShape,
} from "./types.js";

export interface PackageChangelogArgs {
  target: string;
  limit?: number;
  omit_bodies?: boolean;
  verbose?: boolean;
  body_lines?: number;
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
      `Package registry:name, optional @version or @from..to interval, for example npm:express@5.2.1. Registries: ${PKGSEER_REGISTRY_LIST}.`,
    ),
  limit: z
    .number()
    .optional()
    .describe(
      "Latest-mode and upper-cap entry count (1-50, default 10). Rejected with `INVALID_ARGUMENT` for a single-release or lower-bound range target.",
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
    .enum(["text", "json"])
    .default("text")
    .describe(
      "Omit `format` to use token-efficient text when the model reads the result or chooses follow-up tools. Set `json` only when code consumes the raw response instead of the model, or a required field is absent from text. JSON includes full markdown bodies.",
    ),
};

export const DESCRIPTION_BASE: string =
  "Find release notes and changelog history for a package. Default " +
  "latest mode returns up to ten entries; source ordering may interleave maintained release lines. " +
  "Pass `target` as `registry:name` for latest, `registry:name@version` for one selected release, " +
  "or `registry:name@from..to` for a closed interval. Open bounds `from..` and `..to` are accepted. " +
  "`limit` applies only to latest and upper-cap targets. " +
  "A selected release without notes succeeds with `hasChangelog: false`. " +
  "Empty latest or range selections succeed with no entries. " +
  "Entries include markdown body previews. Example: " +
  '`{"target":"npm:express@5.2.1"}`. ' +
  "Text output previews 10 body lines by default; use `body_lines` " +
  "to tune the preview or `verbose:true` for full text bodies. " +
  "Supports npm, PyPI, Hex, Crates, NuGet, Maven, Zig, vcpkg, Packagist, RubyGems, Go, and Swift.";

export const DESCRIPTION: string = `${DESCRIPTION_BASE}\n\n${PKG_CHANGELOG_GUARDRAIL}`;

export function createPackageChangelogTool(
  service: PackageIntelligenceService,
): ToolDefinition<PackageChangelogArgs, typeof schema> {
  return {
    name: "pkg_changelog",
    description: DESCRIPTION,
    schema,
    annotations: OPEN_WORLD_READ_ONLY_TOOL_ANNOTATIONS,
    handler: async (args, context) => {
      try {
        const textFormat = isTextFormat(args.format);
        const bodyPreviewLines = textFormat
          ? validateTextOptions(args)
          : undefined;
        const { params, mode, explicitFilterFields } =
          buildPackageChangelogParams({
            target: args.target,
            limit: args.limit,
            includeBodies: args.omit_bodies !== true,
          });
        const report = await service.packageChangelog(params);
        const payload = buildPackageChangelogSuccessPayload(report, {
          registry: toPkgseerRegistryLowercase(params.registry),
          name: params.packageName,
          mode,
          explicitFilterFields,
          includeBodies: args.omit_bodies !== true,
          fromVersion: params.fromVersion,
          toVersion: params.toVersion,
          limit: params.limit,
          version: params.version,
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
        throwIfCallerCancellation(error, context?.signal);
        const mapped = mapPackageIntelligenceError(error);
        return mcpMappedErrorResult(mapped, context);
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
  return format === undefined || format === "text";
}
