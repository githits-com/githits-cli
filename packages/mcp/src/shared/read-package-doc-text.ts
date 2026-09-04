import type { LeanPackageDocEnvelope } from "./read-package-doc-response.js";

const SEP = " | ";

export function renderReadPackageDocText(
  envelope: LeanPackageDocEnvelope,
): string {
  const lines: string[] = [];
  lines.push(buildHeader(envelope));
  if (envelope.sourceUrl) lines.push(`source: ${envelope.sourceUrl}`);
  if (envelope.filePath) {
    const ref = envelope.gitRef;
    lines.push(`file: ${envelope.filePath}${ref ? ` @ ${ref}` : ""}`);
  }
  lines.push("");
  if (envelope.content) lines.push(envelope.content);
  if (envelope.hint) {
    lines.push("");
    lines.push(`hint: ${envelope.hint}`);
  }
  return lines.join("\n");
}

function buildHeader(envelope: LeanPackageDocEnvelope): string {
  const parts = [`docs_read${SEP}${envelope.docsReadTarget}`];
  if (envelope.title) parts.push(envelope.title);
  const range = buildRange(envelope);
  if (range) parts.push(range);
  return parts.join(SEP);
}

function buildRange(envelope: LeanPackageDocEnvelope): string | undefined {
  if (envelope.startLine !== undefined && envelope.endLine !== undefined) {
    return envelope.totalLines !== undefined
      ? `lines ${envelope.startLine}-${envelope.endLine}/${envelope.totalLines}`
      : `lines ${envelope.startLine}-${envelope.endLine}`;
  }
  if (envelope.totalLines !== undefined) return `${envelope.totalLines} lines`;
  return undefined;
}
