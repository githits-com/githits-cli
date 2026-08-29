/** Verify that a direct resolve handoff names a listed, warning-free target. */
export function isResolveDirectTargetUnwarned(
  output: string,
  target: string,
): boolean {
  if (/^Warning:/m.test(output)) return false;

  const escapedTarget = target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const candidatePattern = new RegExp(
    `^(?: {2}\\d+\\. | {7})${escapedTarget}(?:\\s|$)`,
  );
  const lines = output.split("\n");
  const candidateIndex = lines.findIndex((line) => candidatePattern.test(line));
  if (candidateIndex < 0) return false;
  const candidateLine = lines[candidateIndex] ?? "";
  const nested = candidateLine.startsWith("       ");
  if (
    candidateLine.includes(" · related ") ||
    candidateLine.includes("[related;")
  ) {
    return false;
  }
  const detailIndent = nested ? "         " : "     ";

  for (let index = candidateIndex + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (line.trim() === "Also matched:" || line.trim() === "Related:") break;
    if (!line.startsWith(detailIndent)) break;
    if (line.includes("Warning:")) return false;
  }
  return true;
}
