import {
  READ_ONLY_TOOL_ANNOTATIONS,
  type ToolDefinition,
  textResult,
  type ZodRawShape,
} from "./types.js";

const schema: ZodRawShape = {};

export const DESCRIPTION =
  "GitHits guide for public GitHub/package search, grep, code, docs, and examples. Call once per session before other GitHits tools unless this quick-start guide is already in context. Tools execute without this guide, but a session that skips it lacks the shared safety posture and cross-tool routing guidance. Returns target syntax and compact-output rules without querying GitHits evidence.";

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
