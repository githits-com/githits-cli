import type { CodeNavigationService } from "@githits/core-internal";
import { toPkgseerRegistryLowercase } from "@githits/core-internal";
import {
  DEFAULT_WAIT_TIMEOUT_MS,
  MCP_READ_DEFAULT_SPAN,
  MCP_READ_MAX_SPAN,
} from "../shared/code-navigation-defaults.js";
import { mapCodeNavigationError } from "../shared/code-navigation-error-map.js";
import { withReadFileRecovery } from "../shared/read-file-error.js";
import { buildReadFileParams } from "../shared/read-file-request.js";
import {
  buildReadFileSuccessPayload,
  type LeanReadFileEnvelope,
} from "../shared/read-file-response.js";
import { renderReadFileText } from "../shared/read-file-text.js";
import { resolveCodeTarget } from "./code-navigation-shared.js";
import { mcpMappedErrorResult, throwIfCallerCancellation } from "./shared.js";
import {
  type ToolExecutionContext,
  type ToolResult,
  textResult,
} from "./types.js";

/**
 * Default line span for an MCP `read` call without an explicit end.
 *
 * Real session traces showed agents requesting 300-600 line windows
 * (and occasionally unbounded full-file reads) which dominated
 * context cost. Omitted end ranges therefore remain focused. A caller that
 * knows the required bounds can deliberately request a larger window up to
 * `MCP_READ_MAX_SPAN`, avoiding pagination overhead for modest whole files.
 * CLI command `githits read` bypasses both bounds so humans piping a
 * whole file to disk still work.
 */
export { MCP_READ_DEFAULT_SPAN, MCP_READ_MAX_SPAN };

export interface ReadFileArgs {
  target: string;
  path: string;
  start_line?: number;
  end_line?: number;
  wait_timeout_ms?: number;
  format?: "text" | "json";
}

interface BoundedRange {
  startLine: number;
  endLine: number;
  capped: boolean;
  spanLimit: number;
}

/**
 * Compute the effective `(startLine, endLine)` for the backend call,
 * enforcing the MCP per-call span cap.
 *
 * - No explicit end: return `MCP_READ_DEFAULT_SPAN` lines.
 * - Explicit end with span ≤ `MCP_READ_MAX_SPAN`: untouched.
 * - Explicit end with a wider span: clamp to `MCP_READ_MAX_SPAN`.
 *
 * The cap is enforced before the backend call so the service does not
 * have to transfer bytes that will be discarded.
 */
export function deriveBoundedRange(
  startLine: number | undefined,
  endLine: number | undefined,
): BoundedRange {
  const start = startLine ?? 1;

  if (endLine === undefined) {
    return {
      startLine: start,
      endLine: start + MCP_READ_DEFAULT_SPAN - 1,
      capped: true,
      spanLimit: MCP_READ_DEFAULT_SPAN,
    };
  }

  const span = endLine - start + 1;
  if (span > MCP_READ_MAX_SPAN) {
    return {
      startLine: start,
      endLine: start + MCP_READ_MAX_SPAN - 1,
      capped: true,
      spanLimit: MCP_READ_MAX_SPAN,
    };
  }

  return {
    startLine: start,
    endLine,
    capped: false,
    spanLimit: MCP_READ_MAX_SPAN,
  };
}

/** Execute the code branch of the unified reader. */
export async function readSourceFile(
  args: ReadFileArgs,
  service: CodeNavigationService,
  context?: ToolExecutionContext,
): Promise<ToolResult> {
  const target = resolveCodeTarget(args.target);
  if ("content" in target) return target;

  try {
    // Cap before the backend call so we don't transfer bytes only
    // to throw them away. CLI surface bypasses this — see the
    // MCP_READ_MAX_SPAN doc-comment for rationale.
    const bounded = deriveBoundedRange(args.start_line, args.end_line);
    const build = buildReadFileParams({
      target,
      filePath: args.path,
      startLine: bounded.startLine,
      endLine: bounded.endLine,
      waitTimeoutMs: args.wait_timeout_ms,
    });
    const result = await service.readFile(build.params);
    const payload = buildReadFileSuccessPayload(result, {
      registry: target.registry
        ? toPkgseerRegistryLowercase(target.registry)
        : undefined,
      name: target.packageName,
      repoUrl: target.repoUrl,
      gitRef: target.gitRef,
      requestedFilePath: build.params.filePath,
    });

    if (shouldEmitCappedHint(bounded, payload)) {
      payload.hint = buildCappedHint(
        payload,
        args.start_line,
        args.end_line,
        bounded.spanLimit,
      );
    }

    if (isTextFormat(args.format)) {
      return textResult(renderReadFileText(payload));
    }
    return textResult(JSON.stringify(payload));
  } catch (error) {
    throwIfCallerCancellation(error, context?.signal);
    const mapped = withReadFileRecovery(
      mapCodeNavigationError(error),
      args.path,
    );
    if (mapped.code === "INDEXING") {
      mapped.details = {
        ...mapped.details,
        action: `Retry read target=${JSON.stringify(args.target)} path=${JSON.stringify(args.path)} wait_timeout_ms=${args.wait_timeout_ms ?? DEFAULT_WAIT_TIMEOUT_MS}.`,
      };
    }
    return mcpMappedErrorResult(mapped, context);
  }
}

function isTextFormat(format: ReadFileArgs["format"]): boolean {
  return format === undefined || format === "text";
}

/**
 * Whether to emit the cap hint.
 *
 * The hint is only useful when the response was actually truncated —
 * i.e., the caller's intent ran past the end of what came back. If
 * the caller asked for the whole file but the file fits within the
 * cap, the response is the whole file and the hint would point at
 * lines that don't exist (real bug found by Codex review).
 *
 * Suppression cases:
 * - Cap clamp logic didn't fire at all.
 * - Binary file (hint is irrelevant).
 * - Backend didn't echo `endLine` / `totalLines` (we can't tell).
 * - The returned end IS the end of the file.
 */
function shouldEmitCappedHint(
  bounded: BoundedRange,
  payload: LeanReadFileEnvelope,
): boolean {
  if (!bounded.capped) return false;
  if (payload.isBinary) return false;
  if (payload.endLine === undefined) return false;
  if (payload.totalLines === undefined) return false;
  return payload.endLine < payload.totalLines;
}

function buildCappedHint(
  payload: LeanReadFileEnvelope,
  originalStart: number | undefined,
  originalEnd: number | undefined,
  spanLimit: number,
): string {
  const requested = describeRequest(originalStart, originalEnd);
  // Suppress the bare end-line if `endLine` is missing — exhaustive
  // suppression already happens upstream in `shouldEmitCappedHint`,
  // but we read `endLine` defensively here.
  const continuation =
    payload.endLine !== undefined
      ? ` To continue, retry with start_line=${payload.endLine + 1}.`
      : "";
  return (
    `Returned lines ${payload.startLine}-${payload.endLine}/${payload.totalLines} ` +
    `(${originalEnd === undefined ? "default span" : "explicit-range ceiling"}: ${spanLimit} lines; you requested ${requested}).` +
    `${continuation} ` +
    `Use start_line/end_line to read only the lines needed around a search/code_grep match. ` +
    `Each retry also costs context, so aim for one well-sized read.`
  );
}

function describeRequest(
  originalStart: number | undefined,
  originalEnd: number | undefined,
): string {
  if (originalStart === undefined && originalEnd === undefined) {
    return "no range";
  }
  if (originalEnd === undefined) {
    return `start_line=${originalStart}, no end_line`;
  }
  if (originalStart === undefined) {
    return `end_line=${originalEnd}, no start_line`;
  }
  return `lines ${originalStart}-${originalEnd}`;
}
