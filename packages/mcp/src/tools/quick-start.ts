import {
  READ_ONLY_TOOL_ANNOTATIONS,
  type ToolDefinition,
  textResult,
  type ZodRawShape,
} from "./types.js";

const schema: ZodRawShape = {};

export const DESCRIPTION =
  "Choose the GitHits tool for an OSS question before discovering evidence tools. Call this routing guide first unless the loaded githits-mcp skill already contains it. It identifies which tool to discover, the evidence scope, and untrusted-content rules.";

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
