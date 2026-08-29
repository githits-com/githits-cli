import type {
  ResolveTargetReference,
  ResolveTargetResult,
  ResolveTargetTarget,
} from "@githits/core-internal";
import { colorize, dim, highlight } from "./colors.js";
import { formatCompactNumber } from "./format-number.js";
import { formatRepositoryTarget } from "./repository-target.js";
import { shellQuote } from "./shell-quote.js";

export interface ResolveTargetCandidatePayload {
  target: string;
  name?: string;
  kind: string;
  confidence?: string;
  direct: boolean;
  groupKey?: string;
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
  docsPageCount?: number;
  codeFileCount?: number;
  license?: string;
  matchTier?: number;
  score?: number;
  reason?: string;
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
  targetsTruncated: boolean;
}

/** Build the stable, non-duplicating JSON projection used by CLI and MCP. */
export function buildResolveTargetSuccessPayload(
  result: ResolveTargetResult,
): ResolveTargetPayload {
  const candidates = result.targets.map(projectTarget);
  const payload: ResolveTargetPayload = {
    ambiguous: result.ambiguous,
    candidates,
    protectedMatches: dedupeTargets(result.protectedMatches).map(
      (target) => target.canonicalKey,
    ),
    targetsTruncated: result.targetsTruncated,
  };
  if (result.best) payload.best = result.best.canonicalKey;
  if (result.ambiguous) {
    payload.ambiguousReason = result.ambiguousReason.toLowerCase();
  }
  return payload;
}

function projectTarget(
  target: ResolveTargetTarget,
): ResolveTargetCandidatePayload {
  const payload: ResolveTargetCandidatePayload = {
    target: target.canonicalKey,
    kind: target.kind.toLowerCase(),
    direct: target.match !== undefined,
  };
  assign(payload, "confidence", target.match?.confidence.toLowerCase());
  assign(payload, "groupKey", target.groupKey);
  assign(payload, "name", target.displayName);
  assign(payload, "description", target.description);
  assign(payload, "registry", target.registry?.toLowerCase());
  assign(payload, "packageName", target.packageName);
  assign(payload, "latestVersion", target.latestVersion);
  assign(
    payload,
    "latestVersionMaliciousStatus",
    target.latestVersionMaliciousStatus.toLowerCase(),
  );
  if (target.latestVersionMaliciousEvidence) {
    payload.latestVersionMaliciousEvidence = {
      advisories: target.latestVersionMaliciousEvidence.advisories.map(
        (advisory) => ({
          osvId: advisory.osvId,
          classificationReasons: advisory.classificationReasons.map((reason) =>
            reason.toLowerCase(),
          ),
        }),
      ),
      totalCount: target.latestVersionMaliciousEvidence.totalCount,
      truncated: target.latestVersionMaliciousEvidence.truncated,
    };
  }
  assign(payload, "repositoryUrl", target.repositoryUrl);
  assign(payload, "repositoryOwner", target.repositoryOwner);
  assign(payload, "repositoryName", target.repositoryName);
  assign(payload, "stars", target.stars);
  assign(payload, "downloadsLastMonth", target.downloadsLastMonth);
  assign(payload, "downloadsTotal", target.downloadsTotal);
  assign(payload, "documentationUrl", target.documentationUrl);
  assign(payload, "matchedAliases", target.match?.matchedAliases);
  assign(payload, "docsAvailable", target.docsAvailable);
  assign(payload, "codeAvailable", target.codeAvailable);
  assign(payload, "docsPageCount", target.docsPageCount);
  assign(payload, "codeFileCount", target.codeFileCount);
  assign(payload, "license", target.license);
  assign(payload, "matchTier", target.match?.matchTier);
  assign(payload, "score", target.match?.score);
  assign(payload, "reason", target.match?.reason);
  return payload;
}

export interface FormatResolveTargetTerminalOptions {
  name: string;
  query?: string;
  useColors?: boolean;
}

export interface ResolveTargetGroup {
  groupKey?: string;
  targets: ResolveTargetTarget[];
}

/** Preserve backend order while combining only contiguous equal non-null keys. */
export function groupResolveTargets(
  targets: readonly ResolveTargetTarget[],
): ResolveTargetGroup[] {
  const groups: ResolveTargetGroup[] = [];
  for (const target of targets) {
    const previous = groups.at(-1);
    if (
      target.groupKey !== undefined &&
      previous?.groupKey === target.groupKey
    ) {
      previous.targets.push(target);
    } else {
      groups.push({
        ...(target.groupKey !== undefined ? { groupKey: target.groupKey } : {}),
        targets: [target],
      });
    }
  }
  return groups;
}

/**
 * Decide whether consumers may offer the best target as a direct next action.
 * Identity must be non-ambiguous uppercase EXACT/HIGH, and the matching full
 * candidate must carry CLEAR or NOT_APPLICABLE malicious-content evidence.
 */
export function isResolveTargetActionable(
  result: Pick<ResolveTargetResult, "ambiguous" | "best" | "targets">,
): boolean {
  return (
    isResolveTargetIdentityActionable(result) &&
    isLatestVersionMaliciousStatusActionable(
      findResolveTargetBestTarget(result)?.latestVersionMaliciousStatus,
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
  const bestTarget = findResolveTargetBestTarget(result);
  const blockedBest = identityActionable && !actionable;
  const lines: string[] = [];
  if (result.ambiguous) lines.push(ambiguityMessage(result.ambiguousReason));
  const protectedKeys = new Set(result.protectedMatches.map(targetKey));
  const groups = groupResolveTargets(result.targets);
  const hasBlockedDirectTarget = result.targets.some(
    (target) =>
      target.match !== undefined &&
      !isLatestVersionMaliciousStatusActionable(
        target.latestVersionMaliciousStatus,
      ),
  );
  lines.push(
    !result.ambiguous && !identityActionable
      ? "Unconfirmed ranked targets:"
      : "Targets:",
  );
  lines.push(
    ...groups.flatMap((group, index) =>
      formatTerminalGroup(group, index + 1, protectedKeys, useColors),
    ),
  );
  if (result.targetsTruncated) {
    lines.push(
      "",
      dim(
        "Note: Additional related targets were omitted; direct matches are complete.",
        useColors,
      ),
    );
  }

  const query = sanitizeTerminalText(options.query?.trim() || "<query>");
  if (blockedBest) {
    if (!bestTarget) {
      lines.push(
        "",
        formatTerminalWarning(
          "Malicious-content status is unavailable for the best match. Do not use this target.",
          useColors,
        ),
      );
    }
  } else if (result.ambiguous && hasBlockedDirectTarget) {
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
  } else if (hasBlockedDirectTarget) {
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

function formatTerminalTarget(
  target: ResolveTargetTarget,
  useColors: boolean,
): string {
  const kind = target.kind.toLowerCase();
  const knownKind = KNOWN_KIND_VALUES.has(kind) ? kind : "target";
  const identity = highlight(
    sanitizeTerminalText(target.canonicalKey),
    useColors,
  );
  const fields = target.match
    ? [`${identity} [${formatConfidence(target.match.confidence)}]`, knownKind]
    : [identity, `related ${knownKind}`];
  return fields.join(" · ");
}

function formatTerminalGroup(
  group: ResolveTargetGroup,
  groupNumber: number,
  protectedKeys: ReadonlySet<string>,
  useColors: boolean,
): string[] {
  const [lead, ...members] = group.targets;
  if (!lead) return [];
  const hasRepositoryTarget = group.targets.some(
    (target) => target.kind === "REPOSITORY",
  );
  const lines = [
    `  ${groupNumber}. ${formatTerminalTarget(lead, useColors)}${formatProtectedMarker(lead, protectedKeys)}`,
    ...formatTerminalTargetDetails(
      lead,
      "     ",
      hasRepositoryTarget,
      useColors,
    ),
  ];
  let section: "direct" | "related" | undefined;
  for (const member of members) {
    const nextSection = member.match ? "direct" : "related";
    if (nextSection !== section) {
      lines.push(
        nextSection === "direct" ? "     Also matched:" : "     Related:",
      );
      section = nextSection;
    }
    lines.push(
      `       ${formatTerminalTarget(member, useColors)}${formatProtectedMarker(member, protectedKeys)}`,
      ...formatTerminalTargetDetails(
        member,
        "         ",
        hasRepositoryTarget,
        useColors,
      ),
    );
  }
  return lines;
}

function formatProtectedMarker(
  target: ResolveTargetTarget,
  protectedKeys: ReadonlySet<string>,
): string {
  return protectedKeys.has(targetKey(target))
    ? " · protected exact-name match"
    : "";
}

function formatTerminalTargetDetails(
  target: ResolveTargetTarget,
  indent: string,
  hasRepositoryTarget: boolean,
  useColors: boolean,
): string[] {
  const lines: string[] = [];
  const description = compactDescription(target.description);
  if (description) lines.push(`${indent}${dim(description, useColors)}`);
  const evidence = formatResolveTargetEvidence(target, hasRepositoryTarget);
  if (evidence) lines.push(`${indent}${evidence}`);
  const maliciousWarning = formatLatestVersionMaliciousStatus(
    target.latestVersionMaliciousStatus,
    target.latestVersionMaliciousEvidence,
  );
  if (maliciousWarning) {
    lines.push(
      `${indent}${formatTerminalWarning(maliciousWarning, useColors)}`,
    );
  }
  return lines;
}

function formatConfidence(value: string): string {
  const confidence = value.toLowerCase();
  return KNOWN_CONFIDENCE_VALUES.has(confidence) ? confidence : "unknown";
}

export function formatResolveTargetEvidence(
  target: ResolveTargetTarget,
  hasRepositoryTarget: boolean,
): string {
  const fields: string[] = [];
  if (target.stars !== undefined) {
    fields.push(`${formatCompactNumber(target.stars)} stars`);
  }
  if (target.downloadsLastMonth !== undefined) {
    fields.push(
      `${formatCompactNumber(target.downloadsLastMonth)} downloads/mo`,
    );
  } else if (target.downloadsTotal !== undefined) {
    fields.push(`${formatCompactNumber(target.downloadsTotal)} downloads`);
  }
  if (
    target.kind === "PACKAGE" &&
    target.repositoryUrl &&
    !hasRepositoryTarget
  ) {
    fields.push(`repo ${compactRepositoryUrl(target.repositoryUrl)}`);
  }
  if (target.license !== undefined) {
    const license = sanitizeTerminalText(target.license).trim();
    if (license) fields.push(`license ${license}`);
  }
  const docs = formatAvailability(
    "docs",
    "pages",
    target.docsAvailable,
    target.docsPageCount,
    target.kind !== "REPOSITORY",
  );
  if (docs) fields.push(docs);
  const code = formatAvailability(
    "code",
    "files",
    target.codeAvailable,
    target.codeFileCount,
    target.kind !== "SITE",
  );
  if (code) fields.push(code);
  return fields.map(sanitizeTerminalText).join(" · ");
}

function formatAvailability(
  label: "docs" | "code",
  unit: "pages" | "files",
  available: boolean,
  count: number | undefined,
  applicable: boolean,
): string | undefined {
  if (!applicable) return undefined;
  if (count !== undefined && available) {
    return `${label} ${formatCompactNumber(count)} ${unit}`;
  }
  if (count !== undefined && count > 0) {
    return `${label} unavailable (${formatCompactNumber(count)} ${unit} recorded)`;
  }
  return available ? `${label} available` : `no ${label}`;
}

/** Return concise warning copy only for a non-actionable backend decision. */
export function formatLatestVersionMaliciousStatus(
  status: string | undefined,
  evidence?: ResolveTargetTarget["latestVersionMaliciousEvidence"],
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
  evidence: ResolveTargetTarget["latestVersionMaliciousEvidence"],
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

export function findResolveTargetBestTarget(
  result: Pick<ResolveTargetResult, "best" | "targets">,
): ResolveTargetTarget | undefined {
  if (!result.best) return undefined;
  const best = result.best;
  return result.targets.find(
    (target) =>
      target.kind === best.kind && target.canonicalKey === best.canonicalKey,
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
    const key = targetKey(candidate);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function targetKey(
  candidate: Pick<ResolveTargetReference, "kind" | "canonicalKey">,
): string {
  return `${candidate.kind}:${candidate.canonicalKey}`;
}

function assign<Key extends keyof ResolveTargetCandidatePayload>(
  target: ResolveTargetCandidatePayload,
  key: Key,
  value: ResolveTargetCandidatePayload[Key] | undefined,
): void {
  if (value !== undefined) target[key] = value;
}
