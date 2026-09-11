import type { ReadPackageDocParams } from "@githits/core-internal";
import { InvalidPackageSpecError } from "./package-spec.js";

export interface ReadPackageDocRequestInput {
  pageId: string;
  startLine?: number;
  endLine?: number;
}

export interface ReadPackageDocRequestBuildResult {
  params: ReadPackageDocParams;
}

export function buildReadPackageDocParams(
  input: ReadPackageDocRequestInput,
): ReadPackageDocRequestBuildResult {
  const pageId = input.pageId ?? "";
  if (!pageId.trim()) {
    throw new InvalidPackageSpecError("Page ID is required.");
  }

  const startLine = normaliseLine(input.startLine, "start_line");
  const endLine = normaliseLine(input.endLine, "end_line");
  if (startLine !== undefined && endLine !== undefined && startLine > endLine) {
    throw new InvalidPackageSpecError(
      `Line range is reversed: start_line (${startLine}) must be ≤ end_line (${endLine}).`,
    );
  }

  return {
    params: {
      pageId,
      ...(startLine !== undefined ? { startLine } : {}),
      ...(endLine !== undefined ? { endLine } : {}),
    },
  };
}

function normaliseLine(
  raw: number | undefined,
  name: string,
): number | undefined {
  if (raw === undefined) return undefined;
  if (!Number.isInteger(raw) || raw < 1) {
    throw new InvalidPackageSpecError(
      `\`${name}\` must be a positive integer (lines are 1-indexed). Got ${raw}.`,
    );
  }
  return raw;
}
