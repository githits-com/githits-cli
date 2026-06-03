import { z } from "zod";
import type { CodeNavigationService } from "../services/code-navigation-service.js";
import {
  buildUnifiedSearchErrorPayload,
  buildUnifiedSearchStatusPayload,
  renderUnifiedSearchStatusText,
} from "../shared/index.js";
import { addLocalMcpAuthAction } from "./shared.js";
import { errorResult, type ToolDefinition, textResult } from "./types.js";

export interface SearchStatusArgs {
  search_ref: string;
  format?: "json" | "text" | "text-v1";
}

const schema = {
  search_ref: z
    .string()
    .min(1)
    .describe(
      "The `searchRef` field from a prior `search` response (camelCase in the response, snake_case as this parameter). Pass it through unchanged.",
    ),
  format: z
    .enum(["json", "text", "text-v1"])
    .optional()
    .describe(
      'Response format. Default `text-v1` — compact line-oriented output matching `search`. Pass `format: "json"` for the structured envelope.',
    ),
};

const DESCRIPTION =
  "Use only after `search` returns a `searchRef`. Check progress, fetch partial hits (when the original request used `allow_partial_results: true`), or fetch final results for a prior `search` that returned a `searchRef`. " +
  "Pass the `searchRef` from that response as `search_ref` here (response field is camelCase; this parameter is snake_case).";

export function createSearchStatusTool(
  service: CodeNavigationService,
): ToolDefinition<SearchStatusArgs, typeof schema> {
  return {
    name: "search_status",
    description: DESCRIPTION,
    schema,
    annotations: { readOnlyHint: true },
    handler: async (args) => {
      try {
        const outcome = await service.searchStatus(args.search_ref);
        const payload = buildUnifiedSearchStatusPayload(outcome);
        if (isTextFormat(args.format)) {
          return textResult(renderUnifiedSearchStatusText(payload));
        }
        return textResult(JSON.stringify(payload));
      } catch (error) {
        return errorResult(
          JSON.stringify(
            addLocalMcpAuthAction(buildUnifiedSearchErrorPayload(error)),
          ),
        );
      }
    },
  };
}

function isTextFormat(format: SearchStatusArgs["format"]): boolean {
  return format === undefined || format === "text" || format === "text-v1";
}
