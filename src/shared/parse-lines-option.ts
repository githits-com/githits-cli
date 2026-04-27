import { InvalidPackageSpecError } from "./package-spec.js";

export interface LineRange {
  startLine?: number;
  endLine?: number;
}

/**
 * Parse the CLI `--lines` concise form. Grammar:
 *  `"N-M"` → start=N, end=M (both integers)
 *  `"N-"`  → start=N, end=EOF
 *  `"-M"`  → start=1, end=M
 * Single-line `"N"` is rejected so callers fall through to `--start`.
 */
export function parseLinesOption(raw: string): LineRange {
  const trimmed = raw.trim();
  const dashIndex = trimmed.indexOf("-");
  if (dashIndex < 0) {
    throw new InvalidPackageSpecError(
      `--lines expects a range like \`10-40\`, \`10-\`, or \`-40\`. Single-line form isn't accepted — use --start ${trimmed}.`,
    );
  }

  const startRaw = trimmed.slice(0, dashIndex).trim();
  const endRaw = trimmed.slice(dashIndex + 1).trim();

  if (startRaw.length === 0 && endRaw.length === 0) {
    throw new InvalidPackageSpecError(
      "--lines requires at least one bound. Use `10-40`, `10-` for open end, or `-40` for open start.",
    );
  }

  const startLine =
    startRaw.length > 0
      ? requirePositiveInteger(startRaw, "--lines start")
      : undefined;
  const endLine =
    endRaw.length > 0
      ? requirePositiveInteger(endRaw, "--lines end")
      : undefined;

  if (startLine !== undefined && endLine !== undefined && startLine > endLine) {
    throw new InvalidPackageSpecError(
      `--lines range is reversed: ${startLine} > ${endLine}.`,
    );
  }

  if (startLine === undefined && endLine !== undefined) {
    return { startLine: 1, endLine };
  }
  return { startLine, endLine };
}

function requirePositiveInteger(raw: string, label: string): number {
  if (!/^\d+$/.test(raw)) {
    throw new InvalidPackageSpecError(
      `${label} must be a positive integer. Got '${raw}'.`,
    );
  }
  const parsed = Number.parseInt(raw, 10);
  if (parsed < 1) {
    throw new InvalidPackageSpecError(
      `${label} must be ≥ 1 (lines are 1-indexed). Got ${parsed}.`,
    );
  }
  return parsed;
}
