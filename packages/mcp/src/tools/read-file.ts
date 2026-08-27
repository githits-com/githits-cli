import type { CodeNavigationService } from "@githits/core-internal";
import { toPkgseerRegistryLowercase } from "@githits/core-internal";
import { z } from "zod";
import { mapCodeNavigationError } from "../shared/code-navigation-error-map.js";
import { withReadFileRecovery } from "../shared/read-file-error.js";
import { buildReadFileParams } from "../shared/read-file-request.js";
import {
  buildReadFileSuccessPayload,
  type LeanReadFileEnvelope,
} from "../shared/read-file-response.js";
import { renderReadFileText } from "../shared/read-file-text.js";
import {
  type CodeTargetArg,
  codeTargetSchema,
  resolveCodeTarget,
} from "./code-navigation-shared.js";
import { CODE_READ_GUARDRAIL } from "./guardrails.js";
import { mcpMappedErrorResult, throwIfCallerCancellation } from "./shared.js";
import {
  BOUNDED_WRITE_TOOL_ANNOTATIONS,
  type ToolDefinition,
  textResult,
  type ZodRawShape,
} from "./types.js";

/**
 * Maximum line span the MCP `code_read` tool will return in one call.
 *
 * Real session traces showed agents requesting 300-600 line windows
 * (and occasionally unbounded full-file reads) which dominated
 * context cost. The cap forces agents to pick a focused window —
 * typical 80-150 lines around a known symbol from `search` or
 * `code_grep` results. CLI command `githits code read` bypasses this
 * cap so humans piping a whole file to disk still work.
 */
export const MCP_READ_MAX_SPAN = 150;

export interface ReadFileArgs {
  target: CodeTargetArg;
  path: string;
  start_line?: number;
  end_line?: number;
  wait_timeout_ms?: number;
  format?: "json" | "text" | "text-v1";
}

const schema: ZodRawShape = {
  target: codeTargetSchema,
  path: z
    .string()
    .describe(
      "Exact file path to read, not a directory. Package addressing: package-relative. Repo addressing: repo-relative. Use `code_files` with `path_prefix` to list directories, then pass an emitted `path` here.",
    ),
  start_line: z
    .number()
    .optional()
    .describe(
      `Starting line (1-indexed). Omit to start at line 1. The MCP surface caps any single read at ${MCP_READ_MAX_SPAN} lines — pick a focused window from your prior \`search\` / \`code_grep\` hit.`,
    ),
  end_line: z
    .number()
    .optional()
    .describe(
      `Ending line (inclusive). Must be ≥ \`start_line\` when both are set. Omitting it implies \`start_line + ${MCP_READ_MAX_SPAN - 1}\` because the MCP surface caps each read at ${MCP_READ_MAX_SPAN} lines.`,
    ),
  wait_timeout_ms: z
    .number()
    .optional()
    .describe(
      "Max milliseconds to wait for indexing (0-60000, default 20000). On an `INDEXING` error envelope, use `details.indexingEstimate` when present to decide whether to wait longer, or pass an already-indexed version/ref from `details.availableVersions` / `details.availableRefs`; `suggestedRefs` are fuzzy hints and may need indexing first.",
    ),
  format: z
    .enum(["text-v1", "text", "json"])
    .default("text-v1")
    .describe(
      'Response format. Default `text-v1` — line-numbered source content. Pass `format: "json"` for the structured envelope.',
    ),
};

export const DESCRIPTION: string =
  "Read an exact indexed file or focused line window; use `code_files` " +
  "to enumerate paths and `code_grep` or `search` to find the right window. " +
  "It does not list directories. **MCP cap: " +
  `${MCP_READ_MAX_SPAN} lines per call** — broader requests (or no ` +
  `range) silently truncate to the first ${MCP_READ_MAX_SPAN} lines ` +
  "from your start, with a `hint` describing what was returned vs. " +
  "requested. Pick a focused window from a `search` / `code_grep` " +
  "match. Response: `{path, language, totalLines, startLine, endLine, " +
  "content, isBinary, hint?}`. Binary files set `isBinary: true` and " +
  "omit `content`. Pass the same `path` emitted by `code_files`. " +
  "Address via `target.registry` + `target.package_name` (package " +
  "scope) or `target.repo_url` + optional `target.git_ref` (repo scope), " +
  "mutually exclusive. When fresh data is not ready within the wait " +
  "window, responses may include `targetResolution` provenance, " +
  "`indexingEstimate`, and " +
  "immediately-queryable alternatives. `availableVersions` and " +
  "`availableRefs` are already indexed/queryable; `suggestedRefs` " +
  "are fuzzy ref hints and may need indexing first. On `INDEXING` " +
  "retry with a longer `wait_timeout_ms` or use a version/ref from " +
  "error details. " +
  "On `FILE_NOT_FOUND`, `FILE_PATH_EXCLUDED`, " +
  "`SOURCE_FILE_INVENTORY_UNKNOWN`, or a legacy `NOT_FOUND` that " +
  "specifically describes a missing file path, follow `details.action` " +
  "to inspect paths available through `code_files`." +
  `\n\n${CODE_READ_GUARDRAIL}`;

interface BoundedRange {
  startLine: number;
  endLine: number;
  capped: boolean;
}

/**
 * Compute the effective `(startLine, endLine)` for the backend call,
 * enforcing the MCP per-call span cap.
 *
 * - No range supplied: `1..MCP_READ_MAX_SPAN`.
 * - `start_line` only: `start..start + MCP_READ_MAX_SPAN - 1`.
 * - `end_line` only: treat start as 1; if span > cap, clamp.
 * - Both supplied with span ≤ cap: untouched.
 * - Both supplied with span > cap: clamp to `start..start + cap - 1`.
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
      endLine: start + MCP_READ_MAX_SPAN - 1,
      capped: true,
    };
  }

  const span = endLine - start + 1;
  if (span > MCP_READ_MAX_SPAN) {
    return {
      startLine: start,
      endLine: start + MCP_READ_MAX_SPAN - 1,
      capped: true,
    };
  }

  return { startLine: start, endLine, capped: false };
}

export function createReadFileTool(
  service: CodeNavigationService,
): ToolDefinition<ReadFileArgs, typeof schema> {
  return {
    name: "code_read",
    description: DESCRIPTION,
    schema,
    annotations: BOUNDED_WRITE_TOOL_ANNOTATIONS,
    handler: async (args, context) => {
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
        return mcpMappedErrorResult(mapped, context);
      }
    },
  };
}

function isTextFormat(format: ReadFileArgs["format"]): boolean {
  return format === undefined || format === "text" || format === "text-v1";
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
    `(MCP cap: ${MCP_READ_MAX_SPAN} lines per call; you requested ${requested}).` +
    `${continuation} ` +
    `Pick a focused start_line/end_line window — typical 80-150 lines around a search/code_grep match. ` +
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
