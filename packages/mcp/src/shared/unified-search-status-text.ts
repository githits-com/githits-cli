import type {
  UnifiedSearchStatusCompletedPayload,
  UnifiedSearchStatusIncompletePayload,
  UnifiedSearchStatusResultPayload,
} from "./unified-search-response.js";
import {
  appendDocumentationCorpora,
  appendEmptySearchGuidance,
  appendEvidenceNotice,
  appendEvidenceSearchStatusNextAction,
  appendIncompleteSearchNextAction,
  appendSourceStatusNotes,
  appendUnifiedSearchHits,
  formatProgressTarget,
  noHitsYetMessage,
} from "./unified-search-text.js";

const SEP = " | ";

type StatusPayload =
  | UnifiedSearchStatusCompletedPayload
  | UnifiedSearchStatusIncompletePayload;

export function renderUnifiedSearchStatusText(payload: StatusPayload): string {
  const lines: string[] = [];
  lines.push(buildHeader(payload));

  if (!payload.completed && payload.progress) {
    lines.push(formatProgress(payload.progress));
    if (payload.progress.targets?.length) {
      lines.push("progress targets:");
      for (const target of payload.progress.targets) {
        lines.push(`  - ${formatProgressTarget(target)}`);
      }
    }
  }

  const incompleteWarnings = !payload.completed
    ? Array.from(
        new Set([
          ...(payload.warnings ?? []),
          ...(payload.result?.warnings ?? []),
        ]),
      )
    : [];
  if (incompleteWarnings.length > 0) {
    lines.push("warnings:");
    for (const warning of incompleteWarnings) lines.push(`  - ${warning}`);
  }

  const result = payload.result;
  if (result) {
    appendResult(
      lines,
      result,
      payload.completed,
      payload.completed ? undefined : payload.progress,
      payload.completed ? result.warnings : undefined,
    );
  }

  if (!payload.completed) {
    appendIncompleteSearchNextAction(
      lines,
      payload.progress?.status,
      payload.searchRef,
    );
  } else if (result?.evidenceNotice && payload.searchRef) {
    appendEvidenceSearchStatusNextAction(lines, payload.searchRef);
  }

  return lines.join("\n");
}

function buildHeader(payload: StatusPayload): string {
  const state = payload.completed
    ? "complete"
    : (payload.progress?.status.toLowerCase() ?? "incomplete");
  const parts = [`search_status${SEP}${state}`];
  if (payload.searchRef) parts.push(`searchRef=${payload.searchRef}`);
  return parts.join(SEP);
}

function appendResult(
  lines: string[],
  result: UnifiedSearchStatusResultPayload,
  completed: boolean,
  progress: UnifiedSearchStatusIncompletePayload["progress"] | undefined,
  warnings: string[] | undefined,
): void {
  lines.push("");
  if (warnings && warnings.length > 0) {
    lines.push("warnings:");
    for (const warning of warnings) lines.push(`  - ${warning}`);
    lines.push("");
  }
  if (result.results.length === 0) {
    if (completed) {
      appendSourceStatusNotes(lines, result.sourceStatus);
      appendDocumentationCorpora(lines, result.sourceStatus);
      if (result.sourceStatus?.length) lines.push("");
      appendEmptySearchGuidance(lines, {
        query: result.query,
        showQuery: true,
        sourceStatus: result.sourceStatus,
        evidenceNotice: result.evidenceNotice,
      });
    } else {
      appendSourceStatusNotes(lines, result.sourceStatus);
      appendDocumentationCorpora(lines, result.sourceStatus);
      if (result.sourceStatus?.length) lines.push("");
      lines.push(noHitsYetMessage(progress));
    }
  } else {
    appendUnifiedSearchHits(lines, result.results);
  }
  if (result.hasMore) {
    const nextOffsetHint =
      typeof result.nextOffset === "number"
        ? ` Pass offset=${result.nextOffset} for the next page or limit=N to widen.`
        : " Pass limit=N to widen.";
    lines.push("");
    lines.push(`More hits available.${nextOffsetHint}`);
  }
  if (
    result.results.length > 0 &&
    result.sourceStatus &&
    result.sourceStatus.length > 0
  ) {
    lines.push("");
    appendSourceStatusNotes(lines, result.sourceStatus);
    appendDocumentationCorpora(lines, result.sourceStatus);
  }
  appendEvidenceNotice(lines, result.evidenceNotice);
}

function formatProgress(progress: {
  status: string;
  targetsReady: number;
  targetsTotal: number;
  elapsedMs: number;
}): string {
  return `progress: ${progress.status}, ${progress.targetsReady}/${progress.targetsTotal} targets ready, ${progress.elapsedMs}ms elapsed`;
}
