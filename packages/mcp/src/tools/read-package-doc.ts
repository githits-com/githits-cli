import type { PackageIntelligenceService } from "@githits/core-internal";
import { mapPackageIntelligenceError } from "../shared/package-intelligence-error-map.js";
import { buildReadPackageDocParams } from "../shared/read-package-doc-request.js";
import { buildReadPackageDocSuccessPayload } from "../shared/read-package-doc-response.js";
import { renderReadPackageDocText } from "../shared/read-package-doc-text.js";
import { mcpMappedErrorResult, throwIfCallerCancellation } from "./shared.js";
import {
  type ToolExecutionContext,
  type ToolResult,
  textResult,
} from "./types.js";

export interface ReadPackageDocArgs {
  page_id: string;
  start_line?: number;
  end_line?: number;
  format?: "text" | "json";
}

const MCP_DOC_READ_DEFAULT_SPAN = 150;
const MCP_DOC_READ_MAX_SPAN = 300;

/** Execute the docs branch of the unified reader. */
export async function readDocumentationPage(
  args: ReadPackageDocArgs,
  service: PackageIntelligenceService,
  context?: ToolExecutionContext,
): Promise<ToolResult> {
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
  return `Continue with read target=${JSON.stringify(pageId)} start_line=${nextStartLine} end_line=${nextEndLine}.`;
}
