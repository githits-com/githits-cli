import type { ReadPackageDocParams } from "@githits/core-internal";
import { InvalidPackageSpecError } from "./package-spec.js";

export interface ReadPackageDocRequestInput {
  pageId: string;
}

export interface ReadPackageDocRequestBuildResult {
  params: ReadPackageDocParams;
}

export function buildReadPackageDocParams(
  input: ReadPackageDocRequestInput,
): ReadPackageDocRequestBuildResult {
  const pageId = input.pageId?.trim() ?? "";
  if (!pageId) {
    throw new InvalidPackageSpecError("Page ID is required.");
  }

  return {
    params: { pageId },
  };
}
