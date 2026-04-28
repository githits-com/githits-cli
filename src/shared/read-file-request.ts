/**
 * Shared request builder for the `read_file` tool. CLI and MCP
 * normalise inputs here so the two surfaces cannot diverge on
 * line-range validation or wait-timeout handling.
 */

import type {
  CodeNavigationTarget,
  ReadFileParams,
} from "../services/index.js";
import { DEFAULT_WAIT_TIMEOUT_MS } from "./code-navigation-defaults.js";
import { InvalidPackageSpecError } from "./package-spec.js";

const WAIT_MIN = 0;
const WAIT_MAX = 60_000;

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

export function buildReadFileParams(
  input: ReadFileRequestInput,
): ReadFileRequestBuildResult {
  const filePath = input.filePath?.trim() ?? "";
  if (!filePath) {
    throw new InvalidPackageSpecError(
      "`file_path` is required — pass the path to the file within the package or repo.",
    );
  }

  const startLine = normaliseLine(input.startLine, "start_line");
  const endLine = normaliseLine(input.endLine, "end_line");
  if (startLine !== undefined && endLine !== undefined && startLine > endLine) {
    throw new InvalidPackageSpecError(
      `Line range is reversed: start_line (${startLine}) must be ≤ end_line (${endLine}).`,
    );
  }

  const waitTimeoutMs = normaliseWaitTimeoutMs(input.waitTimeoutMs);

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

function normaliseWaitTimeoutMs(raw: number | undefined): number {
  if (raw === undefined) return DEFAULT_WAIT_TIMEOUT_MS;
  if (!Number.isInteger(raw) || raw < WAIT_MIN || raw > WAIT_MAX) {
    throw new InvalidPackageSpecError(
      `\`wait_timeout_ms\` must be an integer between ${WAIT_MIN} and ${WAIT_MAX}. Got ${raw}.`,
    );
  }
  return raw;
}
