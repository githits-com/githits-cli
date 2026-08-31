import type {
  ResolveTargetCandidate,
  ResolveTargetReference,
  ResolveTargetResult,
} from "@githits/core-internal";
import { colorize, dim, highlight } from "./colors.js";
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
  latestVersionMaliciousStatus?: string;
  latestVersionMaliciousEvidence?: ResolveTargetMaliciousEvidencePayload;
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
  nameSimilarity?: number;
  matchTier?: number;
  score?: number;
}

export interface ResolveTargetMaliciousAdvisoryPayload {
  osvId: string;
  classificationReasons: string[];
}

export interface ResolveTargetMaliciousEvidencePayload {
  advisories: ResolveTargetMaliciousAdvisoryPayload[];
  totalCount: number;
  truncated: boolean;
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
  assign(
    payload,
    "latestVersionMaliciousStatus",
    candidate.latestVersionMaliciousStatus.toLowerCase(),
  );
  if (candidate.latestVersionMaliciousEvidence) {
    payload.latestVersionMaliciousEvidence = {
      advisories: candidate.latestVersionMaliciousEvidence.advisories.map(
        (advisory) => ({
          osvId: advisory.osvId,
          classificationReasons: advisory.classificationReasons.map((reason) =>
            reason.toLowerCase(),
          ),
        }),
      ),
      totalCount: candidate.latestVersionMaliciousEvidence.totalCount,
      truncated: candidate.latestVersionMaliciousEvidence.truncated,
    };
  }
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
  assign(payload, "nameSimilarity", candidate.nameSimilarity);
  assign(payload, "matchTier", candidate.matchTier);
  assign(payload, "score", candidate.score);
  return payload;
}

export interface FormatResolveTargetTerminalOptions {
  name: string;
  query?: string;
  useColors?: boolean;
}

/**
 * Decide whether consumers may offer the best target as a direct next action.
 * Identity must be non-ambiguous uppercase EXACT/HIGH, and the matching full
 * candidate must carry CLEAR or NOT_APPLICABLE malicious-content evidence.
 */
export function isResolveTargetActionable(
  result: Pick<ResolveTargetResult, "ambiguous" | "best" | "candidates">,
): boolean {
  return (
    isResolveTargetIdentityActionable(result) &&
    isLatestVersionMaliciousStatusActionable(
      findResolveTargetBestCandidate(result)?.latestVersionMaliciousStatus,
    )
  );
}

/** Render a compact result with confidence-appropriate follow-up guidance. */
export function formatResolveTargetTerminal(
  result: ResolveTargetResult,
  options: FormatResolveTargetTerminalOptions,
): string {
  if (!result.best) {
    return `No targets found for '${sanitizeTerminalText(options.name)}'.\nCheck the spelling or adjust --registry filters; --query, --prefer-kind, and --intent-hint only rank existing candidates.\n`;
  }
  const useColors = options.useColors ?? false;
  const actionable = isResolveTargetActionable(result);
  const identityActionable = isResolveTargetIdentityActionable(result);
  const bestCandidate = findResolveTargetBestCandidate(result);
  const blockedBest = identityActionable && !actionable;
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
  const hasBlockedReference = candidates.some(
    (candidate) =>
      !isCandidate(candidate) ||
      !isLatestVersionMaliciousStatusActionable(
        candidate.latestVersionMaliciousStatus,
      ),
  );
  lines.push(
    !result.ambiguous && !identityActionable
      ? "Unconfirmed ranked candidates:"
      : "Candidates:",
  );
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
  const evidenceNotes = formatResolveTargetEvidenceNotes(candidates);
  if (evidenceNotes.length > 0) lines.push("", ...evidenceNotes);

  const query = sanitizeTerminalText(options.query?.trim() || "<query>");
  if (blockedBest) {
    if (!bestCandidate) {
      lines.push(
        "",
        formatTerminalWarning(
          "Malicious-content status is unavailable for the best match. Do not use this target.",
          useColors,
        ),
      );
    }
  } else if (result.ambiguous && hasBlockedReference) {
    lines.push(
      "",
      formatTerminalWarning(
        "Some candidates are not actionable. Narrow the result before continuing.",
        useColors,
      ),
    );
  } else if (result.ambiguous) {
    lines.push(
      "",
      `Next after choosing: githits search ${shellQuote(query)} --in ${shellQuote("<target>")}`,
    );
  } else if (actionable) {
    const sourceOption = result.best.kind === "SITE" ? " --source docs" : "";
    lines.push(
      "",
      `Next: githits search ${shellQuote(query)} --in ${shellQuote(sanitizeTerminalText(result.best.canonicalKey))}${sourceOption}`,
    );
  } else if (hasBlockedReference) {
    lines.push(
      "",
      formatTerminalWarning(
        "Some candidates are not actionable. Narrow the result before continuing.",
        useColors,
      ),
    );
  } else {
    lines.push(
      "",
      `Next: narrow the name or filters, or explicitly choose a candidate before running githits search ${shellQuote(query)} --in ${shellQuote("<target>")}`,
    );
  }
  return `${lines.join("\n")}\n`;
}

const KNOWN_CONFIDENCE_VALUES = new Set(["exact", "high", "medium", "low"]);
const KNOWN_KIND_VALUES = new Set(["package", "repository", "site"]);

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
  const codeAvailability = candidate
    ? formatResolveTargetCodeAvailability(candidate)
    : undefined;
  if (codeAvailability) fields.push(codeAvailability);
  const nameSimilarity = formatResolveTargetNameSimilarity(
    candidate?.nameSimilarity,
  );
  if (nameSimilarity) fields.push(nameSimilarity);
  return fields.join(" · ");
}

/** Describe code availability at the candidate identity's actual scope. */
export function formatResolveTargetCodeAvailability(
  candidate: ResolveTargetCandidate,
): string | undefined {
  if (!candidate.codeAvailable) return undefined;
  switch (candidate.kind) {
    case "PACKAGE":
      return "indexed package snapshot";
    case "REPOSITORY":
      return "indexed repository snapshot";
    default:
      return "indexed code snapshot";
  }
}

/** Format the backend's fractional lexical signal as a whole percentage. */
export function formatResolveTargetNameSimilarity(
  value: number | undefined,
): string | undefined {
  return value === undefined
    ? undefined
    : `${Math.round(value * 100)}% name similarity`;
}

/** Explain resolver evidence without implying that either signal is decisive. */
export function formatResolveTargetEvidenceNotes(
  targets: readonly ResolveTargetReference[],
): string[] {
  const candidates = targets.filter(isCandidate);
  const notes: string[] = [];
  if (candidates.some((candidate) => candidate.nameSimilarity !== undefined)) {
    notes.push(
      "Name similarity is coarse lexical support; candidate order follows broader backend policy.",
    );
  }
  if (candidates.some((candidate) => candidate.codeAvailable)) {
    if (
      candidates.some(
        (candidate) => candidate.kind === "PACKAGE" && candidate.codeAvailable,
      )
    ) {
      notes.push(
        "An indexed package snapshot does not establish exact latest-version readiness; code commands do so only when they resolve and serve a commit SHA.",
      );
    }
    if (
      candidates.some(
        (candidate) =>
          candidate.kind === "REPOSITORY" && candidate.codeAvailable,
      )
    ) {
      notes.push(
        "An indexed repository snapshot does not establish exact ref readiness; code commands do so only when they resolve and serve a commit SHA.",
      );
    }
  }
  return notes;
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
  const maliciousWarning = isCandidate(candidate)
    ? formatLatestVersionMaliciousStatus(
        candidate.latestVersionMaliciousStatus,
        candidate.latestVersionMaliciousEvidence,
      )
    : undefined;
  if (maliciousWarning) {
    lines.push(`     ${formatTerminalWarning(maliciousWarning, useColors)}`);
  }
  return lines;
}

/** Return concise warning copy only for a non-actionable backend decision. */
export function formatLatestVersionMaliciousStatus(
  status: string | undefined,
  evidence?: ResolveTargetCandidate["latestVersionMaliciousEvidence"],
): string | undefined {
  switch (status) {
    case "AFFECTED":
      return withMaliciousEvidence(
        "Malicious content affects the latest version",
        "Do not use the latest version. Verify another version against the linked evidence.",
        evidence,
        false,
      );
    case "UNKNOWN":
      return withMaliciousEvidence(
        "Malicious-content status is uncertain",
        "Verify the advisory details before using this version.",
        evidence,
        true,
      );
    case "CLEAR":
    case "NOT_APPLICABLE":
    case undefined:
      return undefined;
    default:
      return `Unrecognized malicious-content status: ${sanitizeTerminalText(status)}. Do not use this target.`;
  }
}

function withMaliciousEvidence(
  message: string,
  guidance: string,
  evidence: ResolveTargetCandidate["latestVersionMaliciousEvidence"],
  includeReasons: boolean,
): string {
  if (!evidence || evidence.advisories.length === 0) {
    return `${message}. ${guidance}`;
  }

  const details = evidence.advisories.map((advisory) => {
    const id = sanitizeTerminalText(advisory.osvId);
    const reasons = includeReasons
      ? formatMaliciousClassificationReasons(advisory.classificationReasons)
      : undefined;
    const label = reasons ? `${id} (${reasons})` : id;
    return `${label}: https://osv.dev/vulnerability/${encodeURIComponent(advisory.osvId)}`;
  });
  const omitted = evidence.totalCount - evidence.advisories.length;
  if (evidence.truncated && omitted > 0) details.push(`+${omitted} more`);
  return `${message} — ${details.join("; ")}. ${guidance}`;
}

const MALICIOUS_CLASSIFICATION_REASON_LABELS: Readonly<Record<string, string>> =
  {
    AFFECTED_VERSION_RANGE_MATCH: "affected range matched",
    MISSING_DISPLAYED_VERSION: "latest version missing",
    INVALID_DISPLAYED_VERSION: "latest version invalid",
    MISSING_AFFECTED_RANGES: "affected ranges missing",
    EMPTY_AFFECTED_RANGES: "affected ranges empty",
    INVALID_AFFECTED_RANGE: "affected range invalid",
  };

function formatMaliciousClassificationReasons(
  reasons: readonly string[],
): string | undefined {
  if (reasons.length === 0) return undefined;
  return reasons
    .map(
      (reason) =>
        MALICIOUS_CLASSIFICATION_REASON_LABELS[reason] ??
        `unrecognized reason ${sanitizeTerminalText(reason)}`,
    )
    .join(", ");
}

function formatTerminalWarning(message: string, useColors: boolean): string {
  return colorize(`Warning: ${message}`, "red", useColors);
}

export function isResolveTargetIdentityActionable(
  result: Pick<ResolveTargetResult, "ambiguous" | "best">,
): boolean {
  return (
    !result.ambiguous &&
    result.best !== undefined &&
    (result.best.confidence === "EXACT" || result.best.confidence === "HIGH")
  );
}

export function isLatestVersionMaliciousStatusActionable(
  status: string | undefined,
): boolean {
  return status === "CLEAR" || status === "NOT_APPLICABLE";
}

export function findResolveTargetBestCandidate(
  result: Pick<ResolveTargetResult, "best" | "candidates">,
): ResolveTargetCandidate | undefined {
  if (!result.best) return undefined;
  const best = result.best;
  return result.candidates.find(
    (candidate) => candidateKey(candidate) === candidateKey(best),
  );
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
  const normalized = sanitizeTerminalText((value ?? "").replace(/\s+/g, " "))
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

export function sanitizeTerminalText(value: string): string {
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
