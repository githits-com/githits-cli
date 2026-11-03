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
import { serviceRequestArgs } from "../shared/service-request-args.js";
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
      `Latest: npm:express (no @ suffix). One release: npm:express@5.2.1. Range: npm:express@4.21.2..5.2.1. Never leave a trailing @. Ranges exclude from and include to: @4.21.2..5.2.1 returns releases after 4.21.2 through 5.2.1. Use @from alone for the starting release's own notes. Open bounds from.. and ..to are accepted. Package-only; repository and site targets are rejected. Registries: ${PKGSEER_REGISTRY_LIST}.`,
    ),
  limit: z
    .number()
    .optional()
    .describe(
      'Do not send limit with @version, @from..to or @from..; those targets select the releases. Valid range call: {"target":"npm:express@4.21.2..5.2.1"}. Only latest or @..to accepts limit (1-50, default 10).',
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
      "Deprecated alias for verbatim:true in text and JSON; overrides body_lines; cannot combine with omit_bodies:true.",
    ),
  body_lines: z
    .number()
    .optional()
    .describe(
      "Deprecated text-only original-note preview cap (1-50); omit for statements. Ignored for JSON, omit_bodies:true, verbatim:true or verbose:true.",
    ),
  format: z
    .enum(["text", "json"])
    .default("text")
    .describe(
      "Omit for text. Use json only when code consumes raw fields or text lacks a required field. JSON includes full statement text and per-item provenance; verbatim:true returns original bodies instead.",
    ),
};

export const DESCRIPTION_BASE: string =
  "Find release notes and changelog history for a package. Default latest mode returns up to ten entries; source ordering may interleave maintained release lines. Pin registry:name@version for one release or @from..to for releases after from through to; omit limit except for latest or @..to. Selected releases without notes return hasChangelog:false; empty selections return no entries. Default text shows parsed statements with available classifications, including unassessed ones, in source order; changes filters them and all matching pages are retrieved. verbatim:true shows original notes and omit_bodies:true only the timeline; both skip classification and ignore changes. Preserve generated-from-commits labels and pending/unavailable status; generated statements are not publisher notes. Notes alone do not establish compatibility.";

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
        const report = await service.packageChangelog(
          {
            ...params,
            includeJsonFields: !textFormat,
          },
          ...serviceRequestArgs(context?.signal),
        );
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
        return mcpMappedErrorResult(mapped, context, args.format, {
          recovery: { syntax: "mcp", tool: "pkg_changelog", args },
        });
      }
    },
  };
}

function isTextFormat(format: PackageChangelogArgs["format"]): boolean {
  return format === undefined || format === "text";
}
