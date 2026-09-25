import {
  DEFAULT_WAIT_TIMEOUT_MS,
  MAX_WAIT_TIMEOUT_MS,
} from "./code-navigation-defaults.js";
import { InvalidPackageSpecError } from "./package-spec.js";

export interface ReadLocator {
  target: string;
  path?: string;
}

/** Normalize the optional file path; preserve target bytes for read classification. */
export function resolveReadLocator(target: string, path?: string): ReadLocator {
  if (typeof target !== "string" || !target.trim()) {
    throw new InvalidPackageSpecError("A nonempty string target is required.");
  }
  if (path !== undefined && typeof path !== "string") {
    throw new InvalidPackageSpecError(
      "path must be an exact file path string.",
    );
  }
  const filePath = path?.trim();
  return filePath ? { target, path: filePath } : { target };
}

/** Validate requested bounds before a cap can hide an invalid explicit end. */
export function validateReadRange(startLine?: number, endLine?: number): void {
  for (const [name, value] of [
    ["start_line", startLine],
    ["end_line", endLine],
  ] as const) {
    if (value !== undefined && (!Number.isInteger(value) || value < 1)) {
      throw new InvalidPackageSpecError(
        `\`${name}\` must be a positive integer (lines are 1-indexed). Got ${value}.`,
      );
    }
  }
  if (startLine !== undefined && endLine !== undefined && startLine > endLine) {
    throw new InvalidPackageSpecError(
      `Line range is reversed: start_line (${startLine}) must be ≤ end_line (${endLine}).`,
    );
  }
}

/** Validate the unified read wait; the backend applies it when relevant. */
export function normalizeReadWaitTimeoutMs(value?: number): number {
  if (value === undefined) return DEFAULT_WAIT_TIMEOUT_MS;
  if (!Number.isInteger(value) || value < 0 || value > MAX_WAIT_TIMEOUT_MS) {
    throw new InvalidPackageSpecError(
      `\`wait_timeout_ms\` must be an integer between 0 and ${MAX_WAIT_TIMEOUT_MS}. Got ${value}.`,
    );
  }
  return value;
}
