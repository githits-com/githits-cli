import {
  READ_ONLY_TOOL_ANNOTATIONS,
  type ToolDefinition,
  textResult,
  type ZodRawShape,
} from "./types.js";

const schema: ZodRawShape = {};

export const DESCRIPTION =
  "Start GitHits sessions here unless the `githits-mcp` skill is loaded. Load once before other GitHits tools to get the shared safety posture, cross-tool routing, target syntax, and compact-output rules. This tool does not query GitHits evidence.";

export const QUICK_START_PREREQUISITE =
  "Before using this tool, call `quick_start` once per session unless the `githits-mcp` skill is loaded.";

export function createQuickStartTool(
  guide: string,
): ToolDefinition<Record<string, never>, typeof schema> {
  return {
    name: "quick_start",
    description: DESCRIPTION,
    schema,
    annotations: READ_ONLY_TOOL_ANNOTATIONS,
    handler: async () => textResult(guide),
  };
}
