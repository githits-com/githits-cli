import type { ReadPackageDocParams } from "@githits/core-internal";
import { InvalidPackageSpecError } from "./package-spec.js";
import { validateReadRange } from "./read-request.js";

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

  validateReadRange(input.startLine, input.endLine);
  const { startLine, endLine } = input;

  return {
    params: {
      pageId,
      ...(startLine !== undefined ? { startLine } : {}),
      ...(endLine !== undefined ? { endLine } : {}),
    },
  };
}
