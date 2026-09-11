/**
 * Shared request builder for the `read_file` tool. CLI and MCP
 * normalise inputs here so the two surfaces cannot diverge on
 * line-range validation or wait-timeout handling.
 */

import type {
  CodeNavigationTarget,
  ReadFileParams,
} from "@githits/core-internal";
import { InvalidPackageSpecError } from "./package-spec.js";
import {
  normalizeReadWaitTimeoutMs,
  validateReadRange,
} from "./read-request.js";

export interface ReadFileRequestInput {
  target: CodeNavigationTarget;
  filePath: string;
  startLine?: number;
  endLine?: number;
  waitTimeoutMs?: number;
}

export interface ReadFileRequestBuildResult {
  params: ReadFileParams;
}

// CLI rewrites MCP identifiers from these errors, including the raw reversed-range
// labels; keep them stable with src/commands/code/read.ts or update its tests.
export function buildReadFileParams(
  input: ReadFileRequestInput,
): ReadFileRequestBuildResult {
  const filePath = input.filePath?.trim() ?? "";
  if (!filePath) {
    throw new InvalidPackageSpecError(
      "`file_path` is required — pass the path to the file within the package or repo.",
    );
  }
  if (filePath.endsWith("/")) {
    throw new InvalidPackageSpecError(
      `\`file_path\` must be an exact file path, not a directory prefix. Use \`code_files\` with \`path_prefix: ${JSON.stringify(filePath)}\` to list files, then pass an emitted \`path\` to \`read\`.`,
    );
  }

  validateReadRange(input.startLine, input.endLine);
  const { startLine, endLine } = input;
  const waitTimeoutMs = normalizeReadWaitTimeoutMs(input.waitTimeoutMs);

  return {
    params: {
      target: input.target,
      filePath,
      startLine,
      endLine,
      waitTimeoutMs,
    },
  };
}
