import { InvalidPackageSpecError } from "./package-spec.js";

export interface LineRange {
  startLine?: number;
  endLine?: number;
}

/** Maximum line number accepted by GraphQL's signed 32-bit `Int` scalar. */
export const MAX_READ_LINE: number = 2_147_483_647;

/**
 * Parse CLI `--lines` as a positive decimal line or range: `N`, `N-M`, `N-`,
 * or `-M`. Every written bound must fit GraphQL's positive `Int` range.
 */
export function parseLinesOption(raw: string): LineRange {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new InvalidPackageSpecError(
      "--lines: use N, N-M, N-, or -M (positive integers).",
    );
  }

  const dashIndex = trimmed.indexOf("-");
  if (dashIndex < 0) {
    const line = parsePositiveReadLine(trimmed, "--lines line");
    return { startLine: line, endLine: line };
  }

  const startRaw = trimmed.slice(0, dashIndex).trim();
  const endRaw = trimmed.slice(dashIndex + 1).trim();

  if (startRaw.length === 0 && endRaw.length === 0) {
    throw new InvalidPackageSpecError(
      "--lines: use N, N-M, N-, or -M (positive integers).",
    );
  }

  const startLine =
    startRaw.length > 0
      ? parsePositiveReadLine(startRaw, "--lines start")
      : undefined;
  const endLine =
    endRaw.length > 0
      ? parsePositiveReadLine(endRaw, "--lines end")
      : undefined;

  if (startLine !== undefined && endLine !== undefined && startLine > endLine) {
    throw new InvalidPackageSpecError(
      `--lines range is reversed: ${startLine} > ${endLine}.`,
    );
  }

  return { startLine, endLine };
}

/** Validate a positive GraphQL Int line bound, preserving raw overflow input in errors. */
export function parsePositiveReadLine(raw: string, label: string): number {
  if (!/^\d+$/.test(raw)) {
    throw new InvalidPackageSpecError(
      `${label}: positive integer required. Got '${raw}'.`,
    );
  }
  const parsed = Number.parseInt(raw, 10);
  if (parsed < 1) {
    throw new InvalidPackageSpecError(`${label}: minimum 1. Got '${raw}'.`);
  }
  if (parsed > MAX_READ_LINE) {
    throw new InvalidPackageSpecError(
      `${label}: maximum ${MAX_READ_LINE}. Got '${raw}'.`,
    );
  }
  return parsed;
}
