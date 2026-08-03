import type {
  ResolveTargetCandidate,
  ResolveTargetResult,
} from "@githits/core-internal";
import { colorize, dim, highlight } from "./colors.js";
import { formatCompactNumber } from "./format-number.js";
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
  const candidates = dedupeCandidates([
    ...result.candidates,
    ...result.protectedMatches,
    ...(result.best ? [result.best] : []),
  ]).map(projectCandidate);
  const payload: ResolveTargetPayload = {
    ambiguous: result.ambiguous,
    candidates,
    protectedMatches: dedupeCandidates(result.protectedMatches).map(
      (candidate) => candidate.canonicalKey,
    ),
  };
  if (result.best) payload.best = result.best.canonicalKey;
  if (result.ambiguous) {
    payload.ambiguousReason = result.ambiguousReason.toLowerCase();
  }
  return payload;
}

function projectCandidate(
  candidate: ResolveTargetCandidate,
): ResolveTargetCandidatePayload {
  const payload: ResolveTargetCandidatePayload = {
    target: candidate.canonicalKey,
    kind: candidate.kind.toLowerCase(),
    confidence: candidate.confidence.toLowerCase(),
  };
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
  if (!result.best) return `No targets found for '${options.name}'.\n`;
  const useColors = options.useColors ?? false;
  const lines: string[] = [];
  if (result.ambiguous) lines.push(ambiguityMessage(result.ambiguousReason));

  const bestLabel =
    !result.ambiguous && ["EXACT", "HIGH"].includes(result.best.confidence)
      ? "Best"
      : "Top";
  lines.push(
    `${colorize(`${bestLabel}:`, "green", useColors)} ${formatCandidate(result.best, useColors, true)}`,
  );
  const description = compactDescription(result.best.description);
  if (description) lines.push(`  ${dim(description, useColors)}`);

  const bestKey = candidateKey(result.best);
  const protectedMatches = dedupeCandidates(result.protectedMatches).filter(
    (candidate) => candidateKey(candidate) !== bestKey,
  );
  if (protectedMatches.length > 0) {
    lines.push("", "Protected exact-name matches:");
    lines.push(
      ...protectedMatches.map(
        (candidate) => `  ${formatCandidate(candidate, useColors, false)}`,
      ),
    );
  }

  const protectedKeys = new Set(
    result.protectedMatches.map((candidate) => candidateKey(candidate)),
  );
  const alternatives = dedupeCandidates(result.candidates).filter(
    (candidate) => {
      const key = candidateKey(candidate);
      return key !== bestKey && !protectedKeys.has(key);
    },
  );
  if (alternatives.length > 0) {
    lines.push("", "Also consider:");
    lines.push(
      ...alternatives.map(
        (candidate) => `  ${formatCandidate(candidate, useColors, false)}`,
      ),
    );
  }

  const query = options.query?.trim() || "<query>";
  lines.push(
    "",
    `Next: githits search ${shellQuote(query)} --in ${shellQuote(result.best.canonicalKey)}`,
  );
  return `${lines.join("\n")}\n`;
}

function formatCandidate(
  candidate: ResolveTargetCandidate,
  useColors: boolean,
  detailed: boolean,
): string {
  const fields = [
    `${highlight(candidate.canonicalKey, useColors)} [${candidate.confidence.toLowerCase()}]`,
    candidate.kind.toLowerCase(),
  ];
  if (detailed && candidate.stars !== undefined) {
    fields.push(`${formatCompactNumber(candidate.stars)} stars`);
  }
  if (detailed && candidate.downloadsLastMonth !== undefined) {
    fields.push(
      `${formatCompactNumber(candidate.downloadsLastMonth)} downloads/mo`,
    );
  }
  if (detailed && candidate.docsAvailable) fields.push("docs");
  if (detailed && candidate.codeAvailable) fields.push("code");
  return fields.join(" · ");
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
      return `Ambiguous: resolver reported ${reason.toLowerCase()}; review before use.`;
  }
}

function compactDescription(value: string | undefined): string | undefined {
  const normalized = value?.replace(/\s+/g, " ").trim();
  if (!normalized) return undefined;
  return normalized.length > 120
    ? `${normalized.slice(0, 117).trimEnd()}...`
    : normalized;
}

function dedupeCandidates(
  candidates: ResolveTargetCandidate[],
): ResolveTargetCandidate[] {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = candidateKey(candidate);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function candidateKey(candidate: ResolveTargetCandidate): string {
  return `${candidate.kind}:${candidate.canonicalKey}`;
}

function assign<Key extends keyof ResolveTargetCandidatePayload>(
  target: ResolveTargetCandidatePayload,
  key: Key,
  value: ResolveTargetCandidatePayload[Key] | undefined,
): void {
  if (value !== undefined) target[key] = value;
}
