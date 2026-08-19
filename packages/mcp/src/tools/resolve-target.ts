import type {
  ResolveTargetCandidate,
  ResolveTargetReference,
  ResolveTargetResult,
  ResolveTargetService,
} from "@githits/core-internal";
import { PKGSEER_REGISTRY_LIST } from "@githits/core-internal";
import { z } from "zod";
import { formatCompactNumber } from "../shared/format-number.js";
import { mapPackageIntelligenceError } from "../shared/package-intelligence-error-map.js";
import { buildResolveTargetParams } from "../shared/resolve-target-request.js";
import {
  buildResolveTargetSuccessPayload,
  sanitizeTerminalText,
} from "../shared/resolve-target-response.js";
import { mcpMappedErrorResult } from "./shared.js";
import {
  READ_ONLY_TOOL_ANNOTATIONS,
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
  format?: "text-v1" | "text" | "json";
}

const schema: ZodRawShape = {
  name: z
    .string()
    .describe(
      "Human-friendly package or repository name to resolve. Do not use canonical registry:name or github:owner/repo targets.",
    ),
  query: z
    .string()
    .optional()
    .describe(
      "Optional task context used for ranking. Do not include credentials, personal data, private code, or proprietary content.",
    ),
  registries: z
    .array(z.string())
    .optional()
    .describe(
      `Optional registry filter. Accepted registries: ${PKGSEER_REGISTRY_LIST}. An empty list deliberately means no filter.`,
    ),
  preferred_kind: z
    .string()
    .optional()
    .describe(
      "Optional preference: package or repository. An empty string means no preference; other values are rejected as invalid arguments.",
    ),
  intent_hints: z
    .array(z.string())
    .optional()
    .describe(
      "Optional ranking hints. Empty, blank, and duplicate hints are ignored. Do not include credentials, personal data, private code, or proprietary content.",
    ),
  limit: z
    .number()
    .optional()
    .describe("Optional integer candidate limit from 1 through 20."),
  format: z
    .enum(["text-v1", "text", "json"])
    .default("text-v1")
    .describe(
      "Response format. `text-v1` and `text` are compact human-readable guidance; `json` is the structured result for programmatic follow-up.",
    ),
};

export const DESCRIPTION =
  "Experimental, local-only dogfood tool for fuzzy, ambiguous, misspelled, or human-friendly package and repository names when a canonical target is not known. It is not a production-ready or authoritative package/repository lookup. Backend candidate coverage and ranking have known gaps while fixes are in progress: empty results may miss real targets, and ranked candidates may be incomplete or wrong. Treat results as leads, preserve ambiguity, and verify the identity with independent package or repository evidence before relying on it. Do not call for canonical `registry:name` or `github:owner/repo` targets; use those directly with the next MCP tool. The optional `query` and `intent_hints` values leave this machine and must not contain credentials, personal data, private code, or proprietary content. Default `text-v1` (also available as `text`) gives bounded ranked candidates and a precise MCP follow-up; use `json` for the structured result.";

export function createResolveTargetTool(
  service: ResolveTargetService,
): ToolDefinition<ResolveTargetMcpArgs, typeof schema> {
  return {
    name: "resolve_target",
    description: DESCRIPTION,
    schema,
    annotations: READ_ONLY_TOOL_ANNOTATIONS,
    handler: async (args) => {
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
        });
        const result = await service.resolveTarget(params);
        if (textFormat) {
          return textResult(
            formatResolveTargetMcpText(result, {
              name: params.name,
            }),
          );
        }
        return textResult(
          JSON.stringify(buildResolveTargetSuccessPayload(result)),
        );
      } catch (error) {
        return mcpMappedErrorResult(mapPackageIntelligenceError(error));
      }
    },
  };
}

export interface FormatResolveTargetMcpTextOptions {
  name: string;
}

/** Render agent-facing guidance without emitting CLI-specific commands. */
export function formatResolveTargetMcpText(
  result: ResolveTargetResult,
  options: FormatResolveTargetMcpTextOptions,
): string {
  const protectedKeys = new Set(
    result.protectedMatches.map((target) => targetKey(target)),
  );
  const allReferences = dedupeTargets([
    ...result.candidates,
    ...result.protectedMatches,
    ...(result.best ? [result.best] : []),
  ]);
  const references = allReferences.slice(0, 24);
  const omittedReferences = allReferences.slice(references.length);
  const lines: string[] = [];

  if (result.ambiguous) {
    lines.push(
      `Ambiguous: ${formatAmbiguousReason(result.ambiguousReason)} Choose a candidate or narrow the name, query, registry, or preferred kind before continuing.`,
    );
  } else if (result.best) {
    lines.push(`Best match: ${formatReference(result.best)}.`);
  } else {
    lines.push(
      `No targets found for "${sanitizeTerminalText(options.name)}". Try a changed name, query, registry filter, or intent hint; include more context if the name is human-friendly.`,
    );
  }

  if (references.length > 0) {
    lines.push("Candidates:");
    references.forEach((target, index) => {
      lines.push(
        `  ${index + 1}. ${formatReference(target)}${
          protectedKeys.has(targetKey(target))
            ? " · protected exact-name match"
            : ""
        }`,
      );
      const description = isCandidate(target)
        ? compactDescription(target.description)
        : undefined;
      if (description) lines.push(`     ${description}`);
    });
  }

  if (omittedReferences.length > 0) {
    const omittedProtectedMatches = omittedReferences.filter((target) =>
      protectedKeys.has(targetKey(target)),
    ).length;
    const protectedNote = omittedProtectedMatches
      ? `, including ${omittedProtectedMatches} protected exact-name ${omittedProtectedMatches === 1 ? "match" : "matches"}`
      : "";
    lines.push(
      `  ... ${omittedReferences.length} additional candidate ${omittedReferences.length === 1 ? "omitted" : "entries omitted"}${protectedNote}. Use format=json for the complete structured candidate and protected-match lists.`,
    );
  }

  if (result.ambiguous) {
    lines.push(
      "Next: choose the canonical target that matches the user's intent, then pass that exact target to the next MCP tool; do not auto-select a candidate.",
    );
  } else if (result.best) {
    lines.push(
      `Next: pass the canonical target "${sanitizeTerminalText(result.best.canonicalKey)}" to the next MCP tool.`,
    );
  } else {
    lines.push(
      "Next: revise the name or add narrow context before requesting another resolution; no target was invented.",
    );
  }
  return `${lines.join("\n")}\n`;
}

function isTextFormat(format: ResolveTargetMcpArgs["format"]): boolean {
  return format === undefined || format === "text" || format === "text-v1";
}

function formatReference(target: ResolveTargetReference): string {
  const kind = sanitizeTerminalText(target.kind.toLowerCase());
  const confidence = sanitizeTerminalText(target.confidence.toLowerCase());
  const fields = [
    sanitizeTerminalText(target.canonicalKey),
    `[${confidence}; ${kind}]`,
  ];
  if (isCandidate(target)) {
    const evidence = formatEvidence(target);
    if (evidence) fields.push(`· ${evidence}`);
  }
  return fields.join(" ");
}

function formatEvidence(candidate: ResolveTargetCandidate): string {
  const evidence: string[] = [];
  if (candidate.stars !== undefined) {
    evidence.push(`${formatCompactNumber(candidate.stars)} stars`);
  }
  if (candidate.downloadsLastMonth !== undefined) {
    evidence.push(
      `${formatCompactNumber(candidate.downloadsLastMonth)} downloads/mo`,
    );
  } else if (candidate.downloadsTotal !== undefined) {
    evidence.push(`${formatCompactNumber(candidate.downloadsTotal)} downloads`);
  }
  if (candidate.docsAvailable) evidence.push("docs");
  if (candidate.codeAvailable) evidence.push("code");
  return evidence.map((value) => sanitizeTerminalText(value)).join(" · ");
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
  return message
    ? `${message}; multiple candidates remain.`
    : "Multiple candidates remain.";
}

function dedupeTargets(
  targets: ResolveTargetReference[],
): ResolveTargetReference[] {
  const seen = new Set<string>();
  return targets.filter((target) => {
    const key = targetKey(target);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function targetKey(target: ResolveTargetReference): string {
  return `${target.kind}:${target.canonicalKey}`;
}

function isCandidate(
  target: ResolveTargetReference,
): target is ResolveTargetCandidate {
  return Object.hasOwn(target, "docsAvailable");
}
