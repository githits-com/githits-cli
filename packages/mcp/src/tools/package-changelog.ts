import type { PackageIntelligenceService } from "@githits/core-internal";
import {
  PKGSEER_REGISTRY_LIST,
  toPkgseerRegistryLowercase,
} from "@githits/core-internal";
import { z } from "zod";
import {
  buildPackageChangelogParams,
  resolvePackageChangelogView,
} from "../shared/package-changelog-request.js";
import {
  buildPackageChangelogSuccessPayload,
  formatPackageChangelogTerminal,
} from "../shared/package-changelog-response.js";
import { mapPackageIntelligenceError } from "../shared/package-intelligence-error-map.js";
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
  verbatim?: boolean;
  body_lines?: number;
  format?: "text" | "json";
  changes?: string;
}

/**
 * Strings remain permissive so package parsing and request validation
 * return mapped domain errors. Missing or non-string targets fail SDK validation.
 */
const schema: ZodRawShape = {
  target: z
    .string()
    .describe(
      `Package registry:name[@version|@from..to], for example npm:express@5.2.1; omit the version for latest. Ranges exclude from and include to: @4.21.2..5.2.1 returns releases after 4.21.2 through 5.2.1. Use @from alone for the starting release's own notes. Open bounds from.. and ..to are accepted. Package-only; repository and site targets are rejected. Registries: ${PKGSEER_REGISTRY_LIST}.`,
    ),
  limit: z
    .number()
    .optional()
    .describe(
      "Latest-mode and upper-cap (`@..to`) count (1-50, default 10). Do not pass with exact `@version` or lower-bound range targets (`@from..to`, `@from..`).",
    ),
  changes: z
    .string()
    .optional()
    .describe(
      "Statements: actionable (MUST_ACT, including uncertain), important (actionable + SHOULD_KNOW), or all (default, including no impact identified, too-long and unassessed statements). Filters before pagination. Coverage includes every selected release. Ignored outside the default statement view.",
    ),
  omit_bodies: z
    .boolean()
    .optional()
    .describe(
      "Show only the version/date/URL timeline, skipping parsing and classification. Cannot combine with verbatim:true or verbose:true.",
    ),
  verbatim: z
    .boolean()
    .optional()
    .describe(
      "Show full original notes instead of parsed statements, including bodies in JSON. Skips classification. Cannot combine with omit_bodies:true.",
    ),
  verbose: z
    .boolean()
    .optional()
    .describe(
      "Deprecated alias for verbatim:true, in text and JSON. Overrides body_lines; cannot combine with omit_bodies:true.",
    ),
  body_lines: z
    .number()
    .optional()
    .describe(
      "Deprecated text-only original-note preview request and line cap (1-50). Ignored for format=json, omit_bodies:true, verbatim:true and verbose:true. Omit for the default statement view.",
    ),
  format: z
    .enum(["text", "json"])
    .default("text")
    .describe(
      "Omit `format` to use token-efficient text when the model reads the result or chooses follow-up tools. Set `json` only when code consumes the raw response instead of the model, or a required field is absent from text. JSON includes full statement text and per-item provenance by default; verbatim:true includes original markdown bodies.",
    ),
};

export const DESCRIPTION_BASE: string =
  "Find release notes and changelog history for a package. Default " +
  "latest mode returns up to ten entries; source ordering may interleave maintained release lines. " +
  "Pin `registry:name@version` for one selected release, or `registry:name@from..to` for releases after from through to (from excluded, to included). " +
  "`limit` applies only to latest and upper-cap targets. " +
  "A selected release without notes succeeds with `hasChangelog: false`. " +
  "Empty latest or range selections succeed with no entries. " +
  "Default text shows all parsed statements with available agent classifications, including no-impact and unassessed statements, in source order. `changes` filters statements; all matching pages are retrieved. `verbatim:true` shows original full notes instead; `verbose` is its deprecated alias and `body_lines` requests a legacy original-note preview. `omit_bodies:true` shows only the timeline. Original-note and timeline views skip classification and ignore `changes`.";

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
        const { view, bodyPreviewLines } = resolvePackageChangelogView({
          omitBodies: args.omit_bodies,
          verbatim: args.verbatim,
          verbose: args.verbose,
          bodyLines: args.body_lines,
          json: !textFormat,
        });
        const { params, mode, explicitFilterFields, changes } =
          buildPackageChangelogParams({
            target: args.target,
            limit: args.limit,
            view,
            changes: args.changes,
          });
        const report = await service.packageChangelog({
          ...params,
          includeJsonFields: !textFormat,
        });
        const payload = buildPackageChangelogSuccessPayload(report, {
          registry: toPkgseerRegistryLowercase(params.registry),
          name: params.packageName,
          mode,
          changes,
          explicitFilterFields,
          view,
          fromVersion: params.fromVersion,
          toVersion: params.toVersion,
          limit: params.limit,
          version: params.version,
        });
        if (textFormat) {
          return textResult(
            formatPackageChangelogTerminal(payload, {
              useColors: false,
              bodyPreviewLines,
              fullStatementHint: 'pass format="json" for full text',
              fullBodyHint: "pass verbatim=true for full original notes",
            }).trimEnd(),
          );
        }
        return textResult(JSON.stringify(payload));
      } catch (error) {
        throwIfCallerCancellation(error, context?.signal);
        const mapped = mapPackageIntelligenceError(error);
        return mcpMappedErrorResult(mapped, context, args.format);
      }
    },
  };
}

function isTextFormat(format: PackageChangelogArgs["format"]): boolean {
  return format === undefined || format === "text";
}
