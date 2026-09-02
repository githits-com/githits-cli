import {
  READ_ONLY_TOOL_ANNOTATIONS,
  type ToolDefinition,
  textResult,
  type ZodRawShape,
} from "./types.js";

const schema: ZodRawShape = {};

export const DESCRIPTION =
  "Required first call: `quick_start` loads untrusted-content safety rules. This initializes a plain MCP session with cross-tool routing, target syntax, and compact-output rules. A plain session that skips it lacks those rules. Skip only when the `githits-mcp` skill is loaded.";

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
