/** Verify that a direct resolve handoff names a listed, warning-free candidate. */
export function isResolveDirectTargetUnwarned(
  output: string,
  target: string,
): boolean {
  if (/^Warning:/m.test(output)) return false;

  const escapedTarget = target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const candidatePattern = new RegExp(`^  \\d+\\. ${escapedTarget}(?:\\s|$)`);
  const lines = output.split("\n");
  const candidateIndex = lines.findIndex((line) => candidatePattern.test(line));
  if (candidateIndex < 0) return false;

  for (let index = candidateIndex + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (!line.startsWith("     ")) break;
    if (line.includes("Warning:")) return false;
  }
  return true;
}
