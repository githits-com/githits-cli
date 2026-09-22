import type { ReadResult } from "@githits/core-internal";
import {
  buildReadFileSuccessPayload,
  formatReadFileTerminal,
  splitReadFileContentLines,
} from "./read-file-response.js";
import { renderReadFileText } from "./read-file-text.js";
import {
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
  },
  format: "mcp-text" | "cli-text" | "json",
): string {
  if (response.source === "symbol_resolution") {
    const result = response.result;
    const payload = {
      ...result,
      target: request.target,
      selector: request.selector,
      ...(result.status === "SNAPSHOT_UNSUPPORTED"
        ? {
            action: `Search for ${JSON.stringify(request.selector)} with source=symbol, then read the returned exact path with start_line and end_line.`,
          }
        : {}),
    };
    if (format === "json") return JSON.stringify(payload);
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
    if (result.status === "SNAPSHOT_UNSUPPORTED") lines.push(payload.action!);
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
      format !== "cli-text" &&
      payload.content &&
      payload.startLine !== undefined
    ) {
      const maxLines = request.endLine === undefined ? 150 : 300;
      const lines = splitReadFileContentLines(payload);
      if (lines.length > maxLines) {
        payload.content = lines.slice(0, maxLines).join("\n");
        payload.endLine = payload.startLine + maxLines - 1;
        payload.hint = `Continue with read target=${JSON.stringify(request.target)} path=${JSON.stringify(payload.path)} start_line=${payload.endLine + 1}.`;
      }
    }
    if (format === "json") return JSON.stringify(payload);
    return format === "cli-text"
      ? formatReadFileTerminal(payload, {
          useColors: false,
          verbose: request.verbose,
        })
      : renderReadFileText(payload);
  }
  const maxOutputLines =
    format === "mcp-text"
      ? request.endLine === undefined
        ? 150
        : 300
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
    payload.hint = `Continue with read target=${JSON.stringify(request.target)} start_line=${payload.endLine + 1} end_line=${Math.min(response.result.contentRange.endLine, payload.endLine + maxOutputLines)}.`;
  }
  if (format === "json") return JSON.stringify(payload);
  return format === "cli-text"
    ? formatReadPackageDocTerminal(payload, {
        useColors: false,
        verbose: request.verbose,
      })
    : renderReadPackageDocText(payload);
}
