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
  format?: "text" | "json";
}

const MCP_DOC_READ_DEFAULT_SPAN = 150;
const MCP_DOC_READ_MAX_SPAN = 300;

const schema: ZodRawShape = {
  page_id: z
    .string()
    .describe(
      "Emitted `docsReadTarget` or historical `pageId` from `docs_list` or `search`. Pass through unchanged; repo-backed targets are snapshot-pinned IDs.",
    ),
  start_line: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      `Explicit starting line (1-indexed). Either explicit bound overrides a URL fragment. Omit both bounds to resolve an indexed fragment or read the full page. Without \`end_line\`, text output returns at most ${MCP_DOC_READ_DEFAULT_SPAN} lines from the backend selection.`,
    ),
  end_line: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      `Explicit ending line (inclusive). Either explicit bound overrides a URL fragment. Text locally displays up to ${MCP_DOC_READ_MAX_SPAN} lines when an end is explicit; omitting it displays up to ${MCP_DOC_READ_DEFAULT_SPAN} lines from the backend selection. JSON returns the complete backend selection. Must be ≥ \`start_line\` when both are set.`,
    ),
  format: z
    .enum(["text", "json"])
    .default("text")
    .describe(
      `Omit \`format\` to use token-efficient text when the model reads the result or chooses follow-up tools. Set \`json\` only when code consumes the raw response instead of the model, or a required field is absent from text. Text locally displays up to ${MCP_DOC_READ_DEFAULT_SPAN} lines without an explicit end or ${MCP_DOC_READ_MAX_SPAN} with one; JSON returns the complete backend selection and range metadata.`,
    ),
};

export const DESCRIPTION_BASE: string =
  "Read a package documentation page by emitted target or stable page ID. " +
  "Pass `docsReadTarget` from `docs_list` or `search` to `page_id`; historical IDs remain accepted. " +
  "An HTTP(S) fragment resolves one exact indexed section; either explicit line bound overrides it. " +
  `Crawled and repo-backed docs are supported. Text locally displays ${MCP_DOC_READ_DEFAULT_SPAN} lines by default or up to ${MCP_DOC_READ_MAX_SPAN} lines when an end is explicit, with an absolute continuation when truncated. ` +
  "JSON retains the backend range, resolved anchor, `docsReadTarget`, stable `pageId`, and `sourceUrl`; repo-backed results include exact `code_read` metadata.";

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
        const build = buildReadPackageDocParams({
          pageId: args.page_id,
          startLine: args.start_line,
          endLine: args.end_line,
        });
        const result = await service.readPackageDoc(build.params);
        const textMode = isTextFormat(args.format);
        const maxOutputLines = textMode
          ? args.end_line === undefined
            ? MCP_DOC_READ_DEFAULT_SPAN
            : MCP_DOC_READ_MAX_SPAN
          : undefined;
        const payload = buildReadPackageDocSuccessPayload(
          result,
          build.params.pageId,
          maxOutputLines,
        );
        if (
          textMode &&
          maxOutputLines !== undefined &&
          payload.endLine !== undefined &&
          result.contentRange.endLine !== undefined &&
          payload.endLine < result.contentRange.endLine
        ) {
          payload.hint = buildContinuationHint(
            payload.pageId,
            payload.endLine + 1,
            result.contentRange.endLine,
            maxOutputLines,
          );
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
  return format === undefined || format === "text";
}

function buildContinuationHint(
  pageId: string,
  nextStartLine: number,
  backendEndLine: number,
  maxOutputLines: number,
): string {
  const nextEndLine = Math.min(
    backendEndLine,
    nextStartLine + maxOutputLines - 1,
  );
  return `Continue with docs_read page_id=${JSON.stringify(pageId)} start_line=${nextStartLine} end_line=${nextEndLine}.`;
}
