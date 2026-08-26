import {
  READ_ONLY_TOOL_ANNOTATIONS,
  type ToolDefinition,
  textResult,
  type ZodRawShape,
} from "./types.js";

const schema: ZodRawShape = {};

export const DESCRIPTION =
  "GitHits tool guide for search, grep, docs, packages, and cross-project examples. Call once per session before other GitHits tools unless this quick-start guide is already in context. Returns public-OSS scope, target syntax, compact-output guidance, cross-tool workflows, and safety rules without querying GitHits evidence.";

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
