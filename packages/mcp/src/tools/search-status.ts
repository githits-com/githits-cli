import type { CodeNavigationService } from "@githits/core-internal";
import { z } from "zod";
import {
  DEFAULT_WAIT_TIMEOUT_MS,
  MAX_WAIT_TIMEOUT_MS,
} from "../shared/code-navigation-defaults.js";
import {
  buildUnifiedSearchErrorPayload,
  buildUnifiedSearchStatusPayload,
} from "../shared/unified-search-response.js";
import { renderUnifiedSearchStatusText } from "../shared/unified-search-status-text.js";
import { addLocalMcpAuthAction } from "./shared.js";
import {
  errorResult,
  READ_ONLY_TOOL_ANNOTATIONS,
  type ToolDefinition,
  textResult,
  type ZodRawShape,
} from "./types.js";

export interface SearchStatusArgs {
  search_ref: string;
  wait_timeout_ms?: number;
  format?: "json" | "text" | "text-v1";
}

const schema: ZodRawShape = {
  search_ref: z
    .string()
    .min(1)
    .describe(
      "The `searchRef` field from a prior `search` response (camelCase in the response, snake_case as this parameter). Pass it through unchanged.",
    ),
  wait_timeout_ms: z.coerce
    .number()
    .int()
    .min(0)
    .max(MAX_WAIT_TIMEOUT_MS)
    .optional()
    .describe(
      "Milliseconds to wait for progress or completion before returning the latest status (0-60000; default 20000).",
    ),
  format: z
    .enum(["text-v1", "text", "json"])
    .default("text-v1")
    .describe(
      'Response format. Default `text-v1` — compact line-oriented output matching `search`. Pass `format: "json"` for the structured envelope.',
    ),
};

const DESCRIPTION =
  "Use only after `search` returns a `searchRef`. Check progress, fetch interim hits when every runnable target/source pair is serveable, fetch partial hits from a serveable subset when the original request used `allow_partial_results: true`, or fetch final results. " +
  "Pass the `searchRef` from that response as `search_ref` here (response field is camelCase; this parameter is snake_case); while it is active, continue with `search_status` instead of repeating `search`. " +
  "The tool waits up to 20 seconds by default; set `wait_timeout_ms` from 0 to 60000 to change that bounded wait.";

export function createSearchStatusTool(
  service: CodeNavigationService,
): ToolDefinition<SearchStatusArgs, typeof schema> {
  return {
    name: "search_status",
    description: DESCRIPTION,
    schema,
    annotations: READ_ONLY_TOOL_ANNOTATIONS,
    handler: async (args) => {
      try {
        const outcome = await service.searchStatus(
          args.search_ref,
          args.wait_timeout_ms ?? DEFAULT_WAIT_TIMEOUT_MS,
        );
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
