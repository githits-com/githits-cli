import {
  type MappedError,
  mapCodeNavigationError,
  mapListError,
  mapPackageIntelligenceError,
} from "@githits/mcp/internal";
import { debugLog } from "./debug-log.js";

export type CliErrorDiagnosticsArea = "code-nav" | "list" | "pkg-intel";

/**
 * Classify an error for a CLI command and retain the existing opt-in
 * classification event without making the shared MCP mapper host-aware.
 */
export function mapCodeNavigationErrorForCli(error: unknown): MappedError {
  const mapped = mapCodeNavigationError(error);
  recordCliErrorClassification("code-nav", error, mapped);
  return mapped;
}

/** Classify a package-intelligence error and emit its CLI-only debug event. */
export function mapPackageIntelligenceErrorForCli(error: unknown): MappedError {
  const mapped = mapPackageIntelligenceError(error);
  recordCliErrorClassification("pkg-intel", error, mapped);
  return mapped;
}

/** Classify a unified-list failure and emit its CLI-only debug event. */
export function mapListErrorForCli(
  error: unknown,
  context?: Parameters<typeof mapListError>[1],
): MappedError {
  const mapped = mapListError(error, context);
  recordCliErrorClassification("list", error, mapped);
  return mapped;
}

/** Emit the PII-safe classification event for a previously-built payload. */
export function recordCliErrorClassification(
  area: CliErrorDiagnosticsArea,
  error: unknown,
  mapped: { code: string; details?: object },
): void {
  debugLog(area, {
    event: "error-classified",
    code: mapped.code,
    errorName: error instanceof Error ? error.name : typeof error,
    detailKeys: mapped.details ? Object.keys(mapped.details) : [],
  });
}
