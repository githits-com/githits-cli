import type {
  UnifiedSearchStatusCompletedPayload,
  UnifiedSearchStatusIncompletePayload,
  UnifiedSearchStatusResultPayload,
} from "./unified-search-response.js";
import {
  appendDocumentationSources,
  appendEmptySearchGuidance,
  appendEvidenceNotice,
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

  const trailer: string[] = [];
  if (result?.hasMore) {
    const nextOffsetHint =
      typeof result.nextOffset === "number"
        ? ` Pass offset=${result.nextOffset} for the next page or limit=N to widen.`
        : " Pass limit=N to widen.";
    trailer.push(`More hits available.${nextOffsetHint}`);
  }
  if (result?.results.length) {
    appendSourceStatusNotes(trailer, result.sourceStatus);
  }
  if (result) appendEvidenceNotice(trailer, result.evidenceNotice);
  if (!payload.completed) {
    appendIncompleteSearchNextAction(
      trailer,
      payload.progress?.status,
      payload.searchRef,
    );
  }
  if (trailer.length > 0) {
    if (
      (result?.results.length || result?.hasMore) &&
      lines[lines.length - 1] !== ""
    ) {
      lines.push("");
    }
    lines.push(...trailer);
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
      const sourceDetailsStart = lines.length;
      appendSourceStatusNotes(lines, result.sourceStatus);
      appendDocumentationSources(lines, result.sourceStatus, result.results);
      if (lines.length > sourceDetailsStart) lines.push("");
      appendEmptySearchGuidance(lines, {
        query: result.query,
        showQuery: true,
        sourceStatus: result.sourceStatus,
        evidenceNotice: result.evidenceNotice,
      });
    } else {
      const sourceDetailsStart = lines.length;
      appendSourceStatusNotes(lines, result.sourceStatus);
      appendDocumentationSources(lines, result.sourceStatus, result.results);
      if (lines.length > sourceDetailsStart) lines.push("");
      lines.push(noHitsYetMessage(progress));
    }
  } else {
    appendDocumentationSources(lines, result.sourceStatus, result.results);
    if (lines[lines.length - 1] !== "") lines.push("");
    appendUnifiedSearchHits(lines, result.results);
  }
}

function formatProgress(progress: {
  status: string;
  targetsReady: number;
  targetsTotal: number;
  elapsedMs: number;
}): string {
  return `progress: ${progress.status}, ${progress.targetsReady}/${progress.targetsTotal} targets ready, ${progress.elapsedMs}ms elapsed`;
}
