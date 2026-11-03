import {
  READ_ONLY_TOOL_ANNOTATIONS,
  type ToolDefinition,
  textResult,
  type ZodRawShape,
} from "./types.js";

const schema: ZodRawShape = {};

export const DESCRIPTION = `Call quick_start first to choose tools and load untrusted-content rules. Call once per session before discovering evidence tools, unless the loaded githits-mcp skill already contains this guide. Do not load both.`;

export const QUICK_START_PREREQUISITE =
  "Load the GitHits guide once per session first (`quick_start` or the `githits-mcp` skill).";

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
