import type {
  ResolveTargetCandidate,
  ResolveTargetReference,
  ResolveTargetResult,
} from "@githits/core-internal";
import { dim, highlight } from "./colors.js";
import { formatCompactNumber } from "./format-number.js";
import { formatRepositoryTarget } from "./repository-target.js";
import { shellQuote } from "./shell-quote.js";

export interface ResolveTargetCandidatePayload {
  target: string;
  name?: string;
  kind: string;
  confidence: string;
  description?: string;
  registry?: string;
  packageName?: string;
  latestVersion?: string;
  repositoryUrl?: string;
  repositoryOwner?: string;
  repositoryName?: string;
  stars?: number;
  downloadsLastMonth?: number;
  downloadsTotal?: number;
  documentationUrl?: string;
  matchedAliases?: string[];
  docsAvailable?: boolean;
  codeAvailable?: boolean;
  matchTier?: number;
  score?: number;
  reason?: string;
}

export interface ResolveTargetPayload {
  best?: string;
  ambiguous: boolean;
  ambiguousReason?: string;
  candidates: ResolveTargetCandidatePayload[];
  protectedMatches: string[];
}

/** Build the stable, non-duplicating JSON projection used by CLI and MCP. */
export function buildResolveTargetSuccessPayload(
  result: ResolveTargetResult,
): ResolveTargetPayload {
  const candidates = dedupeTargets([
    ...result.candidates,
    ...result.protectedMatches,
    ...(result.best ? [result.best] : []),
  ]).map(projectTarget);
  const payload: ResolveTargetPayload = {
    ambiguous: result.ambiguous,
    candidates,
    protectedMatches: dedupeTargets(result.protectedMatches).map(
      (target) => target.canonicalKey,
    ),
  };
  if (result.best) payload.best = result.best.canonicalKey;
  if (result.ambiguous) {
    payload.ambiguousReason = result.ambiguousReason.toLowerCase();
  }
  return payload;
}

function projectTarget(
  target: ResolveTargetReference,
): ResolveTargetCandidatePayload {
  const payload: ResolveTargetCandidatePayload = {
    target: target.canonicalKey,
    kind: target.kind.toLowerCase(),
    confidence: target.confidence.toLowerCase(),
  };
  if (!isCandidate(target)) return payload;
  const candidate = target;
  assign(payload, "name", candidate.displayName);
  assign(payload, "description", candidate.description);
  assign(payload, "registry", candidate.registry?.toLowerCase());
  assign(payload, "packageName", candidate.packageName);
  assign(payload, "latestVersion", candidate.latestVersion);
  assign(payload, "repositoryUrl", candidate.repositoryUrl);
  assign(payload, "repositoryOwner", candidate.repositoryOwner);
  assign(payload, "repositoryName", candidate.repositoryName);
  assign(payload, "stars", candidate.stars);
  assign(payload, "downloadsLastMonth", candidate.downloadsLastMonth);
  assign(payload, "downloadsTotal", candidate.downloadsTotal);
  assign(payload, "documentationUrl", candidate.documentationUrl);
  assign(payload, "matchedAliases", candidate.matchedAliases);
  assign(payload, "docsAvailable", candidate.docsAvailable);
  assign(payload, "codeAvailable", candidate.codeAvailable);
  assign(payload, "matchTier", candidate.matchTier);
  assign(payload, "score", candidate.score);
  assign(payload, "reason", candidate.reason);
  return payload;
}

export interface FormatResolveTargetTerminalOptions {
  name: string;
  query?: string;
  useColors?: boolean;
}

/** Render a compact result with explicit confidence and a copyable follow-up. */
export function formatResolveTargetTerminal(
  result: ResolveTargetResult,
  options: FormatResolveTargetTerminalOptions,
): string {
  if (!result.best) {
    return `No targets found for '${sanitizeTerminalText(options.name)}'.\n`;
  }
  const useColors = options.useColors ?? false;
  const lines: string[] = [];
  if (result.ambiguous) lines.push(ambiguityMessage(result.ambiguousReason));
  const protectedKeys = new Set(
    result.protectedMatches.map((candidate) => candidateKey(candidate)),
  );
  const candidates = dedupeTargets([
    ...result.candidates,
    ...result.protectedMatches,
    result.best,
  ]);
  lines.push("Candidates:");
  lines.push(
    ...candidates.flatMap((candidate, index) =>
      formatCandidateLines(
        candidate,
        index + 1,
        protectedKeys.has(candidateKey(candidate)),
        useColors,
      ),
    ),
  );

  const query = sanitizeTerminalText(options.query?.trim() || "<query>");
  const target = result.ambiguous
    ? "<target>"
    : sanitizeTerminalText(result.best.canonicalKey);
  lines.push(
    "",
    `${result.ambiguous ? "Next after choosing" : "Next"}: githits search ${shellQuote(query)} --in ${shellQuote(target)}`,
  );
  return `${lines.join("\n")}\n`;
}

const KNOWN_CONFIDENCE_VALUES = new Set(["exact", "high", "medium", "low"]);
const KNOWN_KIND_VALUES = new Set(["package", "repository"]);

function formatCandidate(
  target: ResolveTargetReference,
  useColors: boolean,
): string {
  const candidate = isCandidate(target) ? target : undefined;
  const confidence = target.confidence.toLowerCase();
  const kind = target.kind.toLowerCase();
  const fields = [
    `${highlight(sanitizeTerminalText(target.canonicalKey), useColors)} [${
      KNOWN_CONFIDENCE_VALUES.has(confidence) ? confidence : "unknown"
    }]`,
    KNOWN_KIND_VALUES.has(kind) ? kind : "target",
  ];
  if (candidate?.stars !== undefined) {
    fields.push(`${formatCompactNumber(candidate.stars)} stars`);
  }
  if (candidate?.downloadsLastMonth !== undefined) {
    fields.push(
      `${formatCompactNumber(candidate.downloadsLastMonth)} downloads/mo`,
    );
  } else if (candidate?.downloadsTotal !== undefined) {
    fields.push(`${formatCompactNumber(candidate.downloadsTotal)} downloads`);
  }
  if (
    kind === "package" &&
    candidate?.repositoryUrl &&
    candidate.stars === undefined
  ) {
    fields.push(`repo ${compactRepositoryUrl(candidate.repositoryUrl)}`);
  }
  if (candidate?.docsAvailable) fields.push("docs");
  if (candidate?.codeAvailable) fields.push("code");
  return fields.join(" · ");
}

function formatCandidateLines(
  candidate: ResolveTargetReference,
  index: number,
  protectedMatch: boolean,
  useColors: boolean,
): string[] {
  const marker = protectedMatch ? " · protected exact-name match" : "";
  const lines = [
    `  ${index}. ${formatCandidate(candidate, useColors)}${marker}`,
  ];
  const description = compactDescription(
    isCandidate(candidate) ? candidate.description : undefined,
  );
  if (description) lines.push(`     ${dim(description, useColors)}`);
  return lines;
}

function compactRepositoryUrl(value: string): string {
  return sanitizeTerminalText(formatRepositoryTarget(value));
}

function ambiguityMessage(reason: string): string {
  switch (reason) {
    case "DUPLICATE_EXACT_NAME":
      return "Ambiguous: multiple exact package names match; narrow with --registry.";
    case "CLOSE_CANDIDATES":
      return "Ambiguous: top candidates are equally plausible; review before use.";
    case "LOW_CONFIDENCE":
      return "Ambiguous: only low-confidence matches were found; review before use.";
    default:
      return "Ambiguous: review the candidates below before use.";
  }
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

const ESC = String.fromCharCode(0x1b);
// Whole ANSI CSI/OSC/two-byte escape sequences, then any remaining C0/C1/DEL
// control characters that could re-style or spoof the caller's terminal.
const TERMINAL_CONTROL_PATTERN = new RegExp(
  `${ESC}(?:\\[[0-?]*[ -/]*[@-~]|\\][^\\u0007${ESC}]*(?:\\u0007|${ESC}\\\\)?|[@-_])|[\\u0000-\\u001f\\u007f-\\u009f]`,
  "g",
);

function sanitizeTerminalText(value: string): string {
  return value.replace(TERMINAL_CONTROL_PATTERN, "");
}

function dedupeTargets<Target extends ResolveTargetReference>(
  candidates: Target[],
): Target[] {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = candidateKey(candidate);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function candidateKey(candidate: ResolveTargetReference): string {
  return `${candidate.kind}:${candidate.canonicalKey}`;
}

function isCandidate(
  target: ResolveTargetReference,
): target is ResolveTargetCandidate {
  return Object.hasOwn(target, "docsAvailable");
}

function assign<Key extends keyof ResolveTargetCandidatePayload>(
  target: ResolveTargetCandidatePayload,
  key: Key,
  value: ResolveTargetCandidatePayload[Key] | undefined,
): void {
  if (value !== undefined) target[key] = value;
}
