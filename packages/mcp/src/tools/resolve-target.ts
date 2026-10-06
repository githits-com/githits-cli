import type {
  ResolveTargetReference,
  ResolveTargetResult,
  ResolveTargetService,
  ResolveTargetTarget,
} from "@githits/core-internal";
import { PKGSEER_REGISTRY_LIST } from "@githits/core-internal/browser";
import { z } from "zod";
import { mapPackageIntelligenceError } from "../shared/package-intelligence-error-map.js";
import { buildResolveTargetParams } from "../shared/resolve-target-request.js";
import {
  buildResolveTargetEvidencePlan,
  buildResolveTargetSuccessPayload,
  findResolveTargetBestTarget,
  formatLatestVersionMaliciousStatus,
  formatResolveTargetEvidence,
  formatResolveTargetEvidenceNotes,
  groupResolveTargets,
  isLatestVersionMaliciousStatusActionable,
  isResolveTargetActionable,
  isResolveTargetIdentityActionable,
  type ResolveTargetEvidenceOptions,
} from "../shared/resolve-target-response.js";
import { sanitizeTerminalText } from "../shared/terminal-text.js";
import { mcpMappedErrorResult, throwIfCallerCancellation } from "./shared.js";
import {
  OPEN_WORLD_READ_ONLY_TOOL_ANNOTATIONS,
  type ToolDefinition,
  textResult,
  type ZodRawShape,
} from "./types.js";

export interface ResolveTargetMcpArgs {
  name: string;
  query?: string;
  registries?: string[];
  preferred_kind?: string;
  intent_hints?: string[];
  limit?: number;
  verbose?: boolean;
  format?: "text" | "json";
}

const schema: ZodRawShape = {
  name: z
    .string()
    .describe(
      "Human-friendly package, repository, or standalone documentation-site name to resolve. Do not use canonical registry:name, github:owner/repo, codeberg:owner/repo, gitlab:group/subgroup/project, or site:<host[/path]> targets.",
    ),
  query: z
    .string()
    .optional()
    .describe(
      "Optional task context used to rank retrieved candidates and does not expand candidate retrieval. Do not include credentials, personal data, private code, or proprietary content.",
    ),
  registries: z
    .array(z.string())
    .optional()
    .describe(
      `Optional registry filter that constrains package candidates only; repository and site candidates remain eligible. Accepted registries: ${PKGSEER_REGISTRY_LIST}. An empty list deliberately means no filter.`,
    ),
  preferred_kind: z
    .string()
    .optional()
    .describe(
      "Optional preference: package, repository, or site. An empty string means no preference; other values are rejected as invalid arguments.",
    ),
  intent_hints: z
    .array(z.string())
    .optional()
    .describe(
      "Optional hints that rank retrieved candidates and do not expand candidate retrieval. Empty, blank, and duplicate hints are ignored. Do not include credentials, personal data, private code, or proprietary content.",
    ),
  limit: z
    .number()
    .optional()
    .describe("Optional integer candidate limit from 1 through 20."),
  verbose: z
    .boolean()
    .optional()
    .describe(
      "When true, text output includes coarse lexical name-similarity evidence. Default false. JSON always includes available numeric similarity.",
    ),
  format: z
    .enum(["text", "json"])
    .default("text")
    .describe(
      "Omit `format` to use token-efficient text when the model reads the result or chooses follow-up tools. Set `json` only when code consumes the raw response instead of the model, or a required field is absent from text.",
    ),
};

export const DESCRIPTION =
  'Find canonical package, repo, or docs targets for vague or misspelled names. Use known canonical targets directly. Only a non-ambiguous EXACT or HIGH best with CLEAR or NOT_APPLICABLE malicious-content status permits direct continuation; other or missing statuses are non-actionable. CLEAR is not a vulnerability-free claim. MEDIUM and LOW require narrowing or an explicit choice; never auto-select an ambiguous result. A selected `site:` is docs-only: use `list` or `search` with `source: "docs"`, then reuse returned read locators. Inputs leave this machine; public OSS only.';

export function createResolveTargetTool(
  service: ResolveTargetService,
): ToolDefinition<ResolveTargetMcpArgs, typeof schema> {
  return {
    name: "resolve_target",
    description: DESCRIPTION,
    schema,
    annotations: OPEN_WORLD_READ_ONLY_TOOL_ANNOTATIONS,
    handler: async (args, context) => {
      try {
        const textFormat = isTextFormat(args.format);
        const params = buildResolveTargetParams({
          name: args.name,
          query: args.query,
          registries: args.registries,
          preferKind: args.preferred_kind,
          intentHints: args.intent_hints,
          limit: args.limit,
          includeDetailedFields: !textFormat,
          includeNameSimilarity: args.verbose === true || !textFormat,
        });
        const result = await service.resolveTarget(params);
        if (textFormat) {
          return textResult(
            formatResolveTargetMcpText(result, {
              name: params.name,
              verbose: args.verbose,
            }),
          );
        }
        return textResult(
          JSON.stringify(buildResolveTargetSuccessPayload(result)),
        );
      } catch (error) {
        throwIfCallerCancellation(error, context?.signal);
        return mcpMappedErrorResult(
          mapPackageIntelligenceError(error),
          context,
          args.format,
        );
      }
    },
  };
}

export interface FormatResolveTargetMcpTextOptions {
  name: string;
  verbose?: boolean;
}

/** Render agent-facing guidance without emitting CLI-specific commands. */
export function formatResolveTargetMcpText(
  result: ResolveTargetResult,
  options: FormatResolveTargetMcpTextOptions,
): string {
  const actionable = isResolveTargetActionable(result);
  const identityActionable = isResolveTargetIdentityActionable(result);
  const bestTarget = findResolveTargetBestTarget(result);
  const blockedBest = identityActionable && !actionable;
  const protectedKeys = new Set(
    result.protectedMatches.map((target) => targetKey(target)),
  );
  const hasBlockedDirectTarget = result.targets.some(
    (target) =>
      target.match !== undefined &&
      !isLatestVersionMaliciousStatusActionable(
        target.latestVersionMaliciousStatus,
      ),
  );
  const groups = groupResolveTargets(result.targets);
  const lines: string[] = [];

  if (result.ambiguous) {
    lines.push(`Ambiguous: ${formatAmbiguousReason(result.ambiguousReason)}`);
  } else if (actionable && result.best) {
    lines.push(`Best match: ${formatReference(result.best)}.`);
  } else if (blockedBest && result.best) {
    lines.push(`Best identity match: ${formatReference(result.best)}.`);
  } else if (!result.best) {
    lines.push(`No targets found for "${sanitizeTerminalText(options.name)}".`);
  }

  if (groups.length > 0) {
    lines.push("Targets:");
    groups.forEach((group, index) => {
      lines.push(
        ...formatMcpGroup(
          group.targets,
          index + 1,
          protectedKeys,
          options.verbose === true,
        ),
      );
    });
  }

  if (result.targetsTruncated) {
    lines.push(
      "Note: Additional related targets were omitted; direct matches are complete.",
    );
  }
  lines.push(
    ...formatResolveTargetEvidenceNotes(
      result.targets,
      options.verbose === true,
    ),
  );

  if (blockedBest) {
    if (!bestTarget) {
      lines.push(
        "Warning: Malicious-content status is unavailable for the best match. Do not use this target.",
      );
    }
  } else if (result.ambiguous && hasBlockedDirectTarget) {
    lines.push(
      "Warning: Some candidates are not actionable. Narrow the result before continuing.",
    );
  } else if (result.ambiguous) {
    lines.push(
      "Next: narrow the name or explicitly choose a candidate; pass its exact canonical target to the next MCP tool, never auto-select.",
    );
  } else if (actionable && result.best) {
    const target = sanitizeTerminalText(result.best.canonicalKey);
    lines.push(
      result.best.kind === "SITE"
        ? `Next: call search with target "${target}" and source "docs", then call read for relevant results.`
        : `Next: pass the canonical target "${target}" to the next MCP tool.`,
    );
  } else if (result.best && hasBlockedDirectTarget) {
    lines.push(
      "Warning: Some candidates are not actionable. Narrow the result before continuing.",
    );
  } else if (result.best) {
    lines.push(
      "Next: narrow the name or filters, or explicitly choose a candidate; never auto-select the best match.",
    );
  } else {
    lines.push(
      "Next: check spelling or registry filters; query, preferred kind, and intent hints only rank existing candidates.",
    );
  }
  return `${lines.join("\n")}\n`;
}

function isTextFormat(format: ResolveTargetMcpArgs["format"]): boolean {
  return format === undefined || format === "text";
}

function formatReference(target: ResolveTargetReference): string {
  const kind = sanitizeTerminalText(target.kind.toLowerCase());
  const confidence = sanitizeTerminalText(target.confidence.toLowerCase());
  return [
    sanitizeTerminalText(target.canonicalKey),
    `[${confidence}; ${kind}]`,
  ].join(" ");
}

function formatMcpGroup(
  targets: ResolveTargetTarget[],
  groupNumber: number,
  protectedKeys: ReadonlySet<string>,
  includeNameSimilarity: boolean,
): string[] {
  const [lead, ...members] = targets;
  if (!lead) return [];
  const evidencePlan = buildResolveTargetEvidencePlan(
    targets,
    includeNameSimilarity,
  );
  const lines = [
    `  ${groupNumber}. ${formatMcpTargetLine(lead, evidencePlan(lead), protectedKeys)}`,
    ...formatMcpTargetDetails(lead, "     "),
  ];
  if (members.length > 0) lines.push("     Related targets:");
  for (const member of members) {
    lines.push(
      `       ${formatMcpTargetLine(member, evidencePlan(member), protectedKeys)}`,
      ...formatMcpTargetDetails(member, "         "),
    );
  }
  return lines;
}

function formatMcpTargetLine(
  target: ResolveTargetTarget,
  evidenceOptions: ResolveTargetEvidenceOptions,
  protectedKeys: ReadonlySet<string>,
): string {
  const evidence = formatResolveTargetEvidence(target, evidenceOptions);
  return `${formatMcpTarget(target)}${formatProtectedMarker(target, protectedKeys)}${evidence ? ` · ${evidence}` : ""}`;
}

function formatMcpTarget(target: ResolveTargetTarget): string {
  const kind = sanitizeTerminalText(target.kind.toLowerCase());
  const relationship = target.match
    ? sanitizeTerminalText(target.match.confidence.toLowerCase())
    : "related";
  return `${sanitizeTerminalText(target.canonicalKey)} [${relationship}; ${kind}]`;
}

function formatProtectedMarker(
  target: ResolveTargetTarget,
  protectedKeys: ReadonlySet<string>,
): string {
  return protectedKeys.has(targetKey(target))
    ? " · protected exact-name match"
    : "";
}

function formatMcpTargetDetails(
  target: ResolveTargetTarget,
  indent: string,
): string[] {
  const lines: string[] = [];
  const description = compactDescription(target.description);
  if (description) lines.push(`${indent}${description}`);
  const maliciousWarning = formatLatestVersionMaliciousStatus(
    target.latestVersionMaliciousStatus,
    target.latestVersionMaliciousEvidence,
  );
  if (maliciousWarning) lines.push(`${indent}Warning: ${maliciousWarning}`);
  return lines;
}

function compactDescription(value: string | undefined): string | undefined {
  const normalized = sanitizeTerminalText(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return undefined;
  return normalized.length > 240
    ? `${normalized.slice(0, 237).trimEnd()}...`
    : normalized;
}

function formatAmbiguousReason(reason: string): string {
  const message = sanitizeTerminalText(
    reason.toLowerCase().replaceAll("_", " "),
  );
  return message ? `${message}.` : "review identity before use.";
}

function targetKey(
  target: Pick<ResolveTargetReference, "kind" | "canonicalKey">,
): string {
  return `${target.kind}:${target.canonicalKey}`;
}
