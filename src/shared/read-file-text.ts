import type { LeanReadFileEnvelope } from "./read-file-response.js";

const SEP = " | ";

export function renderReadFileText(envelope: LeanReadFileEnvelope): string {
  const lines: string[] = [];
  lines.push(buildHeader(envelope));
  lines.push("");

  if (envelope.isBinary) {
    lines.push("Binary file - cannot display as text.");
  } else if (envelope.content) {
    appendNumberedContent(lines, envelope.content, envelope.startLine ?? 1);
  } else {
    lines.push("(no content returned)");
  }

  if (envelope.hint) {
    lines.push("");
    lines.push(`hint: ${envelope.hint}`);
  }
  return lines.join("\n");
}

function buildHeader(envelope: LeanReadFileEnvelope): string {
  const parts = [`code_read${SEP}${envelope.path}`];
  if (envelope.language) parts.push(envelope.language);
  const range = buildRange(envelope);
  if (range) parts.push(range);
  return parts.join(SEP);
}

function buildRange(envelope: LeanReadFileEnvelope): string | undefined {
  if (envelope.startLine !== undefined && envelope.endLine !== undefined) {
    return envelope.totalLines !== undefined
      ? `lines ${envelope.startLine}-${envelope.endLine}/${envelope.totalLines}`
      : `lines ${envelope.startLine}-${envelope.endLine}`;
  }
  if (envelope.totalLines !== undefined) return `${envelope.totalLines} lines`;
  return undefined;
}

function appendNumberedContent(
  lines: string[],
  content: string,
  startLine: number,
): void {
  const bodyLines = content.split("\n");
  if (bodyLines.length > 0 && bodyLines[bodyLines.length - 1] === "") {
    bodyLines.pop();
  }
  const endLine = startLine + bodyLines.length - 1;
  const width = String(endLine).length;
  for (let i = 0; i < bodyLines.length; i += 1) {
    lines.push(
      `${String(startLine + i).padStart(width, " ")}  ${bodyLines[i]}`,
    );
  }
}
