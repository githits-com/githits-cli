import type { ReadResult } from "@githits/core-internal";
import {
  MCP_READ_DEFAULT_SPAN,
  MCP_READ_MAX_SPAN,
} from "./code-navigation-defaults.js";
import {
  buildReadFileSuccessPayload,
  formatReadFileTerminal,
  splitReadFileContentLines,
} from "./read-file-response.js";
import { renderReadFileText } from "./read-file-text.js";
import {
  buildReadPackageDocContinuationHint,
  buildReadPackageDocSuccessPayload,
  formatReadPackageDocTerminal,
} from "./read-package-doc-response.js";
import { renderReadPackageDocText } from "./read-package-doc-text.js";

/** Present selector outcomes at the shared CLI and local MCP boundary. */
export function formatSelectorRead(
  response: ReadResult,
  request: {
    target: string;
    selector: string;
    path?: string;
    endLine?: number;
    verbose?: boolean;
    useColors?: boolean;
  },
  format: "mcp-text" | "mcp-json" | "cli-text" | "cli-json",
): string {
  if (response.source === "symbol_resolution") {
    const result = response.result;
    const cli = format === "cli-text" || format === "cli-json";
    const searchAction = cli
      ? `githits search ${JSON.stringify(request.selector)} --in ${JSON.stringify(request.target)} --source symbol`
      : `search({"query":${JSON.stringify(request.selector)},"target":${JSON.stringify(request.target)},"source":"symbol"})`;
    const action =
      result.status === "SNAPSHOT_UNSUPPORTED"
        ? cli
          ? `Use ${searchAction}, then githits read <target> <path> --start N --end M with the returned file and range.`
          : `Use ${searchAction}, then read the returned exact path with start_line and end_line.`
        : result.status === "NOT_FOUND" && result.suggestions.length === 0
          ? `Search related names with ${searchAction} or inspect the indexed files.`
          : undefined;
    const payload = {
      status: result.status,
      candidates: result.candidates,
      suggestions: result.suggestions,
      hasMore: result.hasMore,
      repoUrl: result.repoUrl,
      gitRef: result.gitRef,
      codeIndexState: result.codeIndexState,
      ...(result.message ? { message: result.message } : {}),
      target: request.target,
      selector: request.selector,
      ...(action ? { action } : {}),
    };
    if (format === "mcp-json" || format === "cli-json")
      return JSON.stringify(payload);
    const lines = [
      `${result.status}: ${request.selector}`,
      `Repository: ${result.repoUrl}@${result.gitRef}`,
    ];
    if (result.message) lines.push(result.message);
    for (const candidate of result.candidates) {
      lines.push(
        `Candidate: ${candidate.qualifiedPath ?? candidate.name ?? request.selector} | ${candidate.filePath ?? "?"}:${candidate.startLine ?? "?"}-${candidate.endLine ?? "?"}`,
      );
    }
    for (const suggestion of result.suggestions) {
      lines.push(
        `Suggestion: ${suggestion.qualifiedPath ?? suggestion.name} | ${suggestion.filePath ?? "?"}${suggestion.reason ? ` | ${suggestion.reason}` : ""}`,
      );
    }
    if (result.hasMore)
      lines.push(
        "More matches exist; narrow with an exact path or qualified selector.",
      );
    if (action) lines.push(action);
    return lines.join("\n") + "\n";
  }
  if (response.source === "code") {
    const requested = response.result.targetResolution?.requested;
    const payload = buildReadFileSuccessPayload(response.result, {
      registry: requested?.registry?.toLowerCase(),
      name: requested?.packageName,
      repoUrl: requested?.repoUrl,
      gitRef: requested?.gitRef,
      requestedFilePath: request.path ?? "",
    });
    if (
      (format === "mcp-text" || format === "mcp-json") &&
      payload.content &&
      payload.startLine !== undefined
    ) {
      const maxLines =
        request.endLine === undefined
          ? MCP_READ_DEFAULT_SPAN
          : MCP_READ_MAX_SPAN;
      const lines = splitReadFileContentLines(payload);
      if (lines.length > maxLines) {
        payload.content = lines.slice(0, maxLines).join("\n");
        payload.endLine = payload.startLine + maxLines - 1;
        payload.hint = `Continue with read target=${JSON.stringify(request.target)} path=${JSON.stringify(payload.path)} start_line=${payload.endLine + 1}.`;
      }
    }
    if (format === "mcp-json" || format === "cli-json")
      return JSON.stringify(payload);
    return format === "cli-text"
      ? formatReadFileTerminal(payload, {
          useColors: request.useColors ?? false,
          verbose: request.verbose,
        })
      : renderReadFileText(payload);
  }
  const maxOutputLines =
    format === "mcp-text"
      ? request.endLine === undefined
        ? MCP_READ_DEFAULT_SPAN
        : MCP_READ_MAX_SPAN
      : undefined;
  const payload = buildReadPackageDocSuccessPayload(
    response.result,
    request.target,
    maxOutputLines,
  );
  if (
    maxOutputLines !== undefined &&
    payload.endLine !== undefined &&
    response.result.contentRange.endLine !== undefined &&
    payload.endLine < response.result.contentRange.endLine
  ) {
    payload.hint = buildReadPackageDocContinuationHint(
      request.target,
      payload.endLine + 1,
      response.result.contentRange.endLine,
      maxOutputLines,
    );
  }
  if (format === "mcp-json" || format === "cli-json")
    return JSON.stringify(payload);
  return format === "cli-text"
    ? formatReadPackageDocTerminal(payload, {
        useColors: request.useColors ?? false,
        verbose: request.verbose,
      })
    : renderReadPackageDocText(payload);
}
