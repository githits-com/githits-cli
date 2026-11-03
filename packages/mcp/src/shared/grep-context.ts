import { InvalidPackageSpecError } from "./package-spec.js";

export const GREP_CONTEXT_MAX = 10;

/** Present only when effective requested context exceeds the backend ceiling. */
export interface GrepContextClamping {
  requestedBefore: number;
  requestedAfter: number;
  effectiveBefore: number;
  effectiveAfter: number;
}

export interface ResolvedGrepContext {
  contextLinesBefore: number;
  contextLinesAfter: number;
  contextClamping?: GrepContextClamping;
}

/** Validate supplied values before option precedence can hide invalid input. */
export function normalizeGrepContextValue(
  value: number | undefined,
  field: string,
  displayValue: string = String(value),
): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new InvalidPackageSpecError(
      `${field}: nonnegative safe integer required. Got ${displayValue}.`,
    );
  }
  return value;
}

/** Cap validated sides after caller-specific option precedence is resolved. */
export function resolveGrepContext(
  requestedBefore: number = 0,
  requestedAfter: number = 0,
): ResolvedGrepContext {
  const contextLinesBefore = Math.min(requestedBefore, GREP_CONTEXT_MAX);
  const contextLinesAfter = Math.min(requestedAfter, GREP_CONTEXT_MAX);
  return {
    contextLinesBefore,
    contextLinesAfter,
    ...(requestedBefore > contextLinesBefore ||
    requestedAfter > contextLinesAfter
      ? {
          contextClamping: {
            requestedBefore,
            requestedAfter,
            effectiveBefore: contextLinesBefore,
            effectiveAfter: contextLinesAfter,
          },
        }
      : {}),
  };
}

/** Explain reduced context consistently across legacy and unified grep. */
export function buildGrepContextClampingNotice(
  adjustment: GrepContextClamping | undefined,
  surface: "mcp" | "cli" = "mcp",
): string | undefined {
  if (!adjustment) return undefined;
  const read = surface === "cli" ? "githits read" : "read";
  return `Context capped (before/after): ${adjustment.requestedBefore}/${adjustment.requestedAfter} -> ${adjustment.effectiveBefore}/${adjustment.effectiveAfter}. More: ${read}.`;
}
