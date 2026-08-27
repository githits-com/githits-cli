import type { PackageIntelligenceService } from "@githits/core-internal";
import { z } from "zod";
import { mapPackageIntelligenceError } from "../shared/package-intelligence-error-map.js";
import { buildReadPackageDocParams } from "../shared/read-package-doc-request.js";
import { buildReadPackageDocSuccessPayload } from "../shared/read-package-doc-response.js";
import { renderReadPackageDocText } from "../shared/read-package-doc-text.js";
import { DOCS_GUARDRAIL } from "./guardrails.js";
import { mcpMappedErrorResult, throwIfCallerCancellation } from "./shared.js";
import {
  READ_ONLY_TOOL_ANNOTATIONS,
  type ToolDefinition,
  textResult,
  type ZodRawShape,
} from "./types.js";

export interface ReadPackageDocArgs {
  page_id: string;
  start_line?: number;
  end_line?: number;
  format?: "json" | "text" | "text-v1";
}

const MCP_DOC_READ_DEFAULT_SPAN = 150;
const MCP_DOC_READ_MAX_SPAN = 300;

const schema: ZodRawShape = {
  page_id: z
    .string()
    .describe(
      "Documentation page ID from `docs_list` or `search` results. Pass through unchanged; repo-backed IDs are snapshot-pinned.",
    ),
  start_line: z
    .number()
    .optional()
    .describe(
      `Starting line (1-indexed). Omit to start at line 1. Without \`end_line\`, text output returns at most ${MCP_DOC_READ_DEFAULT_SPAN} lines.`,
    ),
  end_line: z
    .number()
    .optional()
    .describe(
      `Ending line (inclusive). In text mode, omitting it returns at most ${MCP_DOC_READ_DEFAULT_SPAN} lines from \`start_line\`; an explicit range may request up to ${MCP_DOC_READ_MAX_SPAN} lines. In JSON mode, omitting it reads to the end of the page. Must be ≥ \`start_line\` when both are set.`,
    ),
  format: z
    .enum(["text-v1", "text", "json"])
    .default("text-v1")
    .describe(
      `Response format. Default \`text-v1\` — raw markdown content capped to ${MCP_DOC_READ_DEFAULT_SPAN} lines by default. Pass \`format: "json"\` for the structured envelope; explicit ranges still slice JSON content.`,
    ),
};

export const DESCRIPTION_BASE: string =
  "Read a package documentation page by ID; use `docs_list` to browse and `search` to find topics. " +
  `Works for both hosted/crawled docs and repository-backed docs. Text reads return ${MCP_DOC_READ_DEFAULT_SPAN} lines by default; pass an explicit \`start_line\` / \`end_line\` range for only the lines needed, up to ${MCP_DOC_READ_MAX_SPAN} lines. Broader ranges truncate and report the returned range and \`totalLines\`. ` +
  "Repo-backed results additionally include exact file follow-up metadata for `code_read`.";

export const DESCRIPTION: string = `${DESCRIPTION_BASE}\n\n${DOCS_GUARDRAIL}`;

export function createReadPackageDocTool(
  service: PackageIntelligenceService,
): ToolDefinition<ReadPackageDocArgs, typeof schema> {
  return {
    name: "docs_read",
    description: DESCRIPTION,
    schema,
    annotations: READ_ONLY_TOOL_ANNOTATIONS,
    handler: async (args, context) => {
      try {
        const build = buildReadPackageDocParams({ pageId: args.page_id });
        const result = await service.readPackageDoc(build.params);
        const textMode = isTextFormat(args.format);
        const range = buildRange(args, textMode);
        const payload = buildReadPackageDocSuccessPayload(
          result,
          build.params.pageId,
          range?.range,
        );
        if (
          range?.hint &&
          payload.endLine !== undefined &&
          (payload.totalLines === undefined ||
            payload.endLine < payload.totalLines)
        ) {
          payload.hint = range.hint(payload);
        }
        if (textMode) return textResult(renderReadPackageDocText(payload));
        return textResult(JSON.stringify(payload));
      } catch (error) {
        throwIfCallerCancellation(error, context?.signal);
        const mapped = mapPackageIntelligenceError(error);
        return mcpMappedErrorResult(mapped, context);
      }
    },
  };
}

function isTextFormat(format: ReadPackageDocArgs["format"]): boolean {
  return format === undefined || format === "text" || format === "text-v1";
}

function buildRange(
  args: ReadPackageDocArgs,
  textMode: boolean,
):
  | {
      range: { startLine?: number; endLine?: number };
      hint?: (payload: {
        startLine?: number;
        endLine?: number;
        totalLines?: number;
      }) => string;
    }
  | undefined {
  if (textMode) {
    const startLine = args.start_line ?? 1;
    const spanLimit =
      args.end_line === undefined
        ? MCP_DOC_READ_DEFAULT_SPAN
        : MCP_DOC_READ_MAX_SPAN;
    const requestedEnd = args.end_line ?? startLine + spanLimit - 1;
    const endLine = Math.min(requestedEnd, startLine + spanLimit - 1);
    const wasClamped = requestedEnd > endLine;
    return {
      range: { startLine, endLine },
      hint: wasClamped
        ? (payload) =>
            `Returned lines ${payload.startLine}-${payload.endLine}${payload.totalLines !== undefined ? `/${payload.totalLines}` : ""} (MCP explicit-range ceiling: ${MCP_DOC_READ_MAX_SPAN} lines; you requested lines ${startLine}-${requestedEnd}).`
        : undefined,
    };
  }
  return args.start_line !== undefined || args.end_line !== undefined
    ? { range: { startLine: args.start_line, endLine: args.end_line } }
    : undefined;
}
