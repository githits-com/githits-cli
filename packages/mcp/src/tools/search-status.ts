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
import { addLocalMcpAuthAction, throwIfCallerCancellation } from "./shared.js";
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
  format?: "text" | "json";
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
    .enum(["text", "json"])
    .default("text")
    .describe(
      "Default `text` is token-efficient. Use `json` only for programmatic follow-up or exact structured details.",
    ),
};

const DESCRIPTION =
  "Continue an explicit `search` reference: inspect progress, retrieve interim or partial hits, or fetch final results. Call this only after a prior `search` response explicitly supplies both a `searchRef` and a `search_status` action; otherwise the initial `search` result is complete or has its own recovery guidance. " +
  "Pass that response's `searchRef` as `search_ref` here (response field is camelCase; this parameter is snake_case), including for active `PENDING`, `INDEXING`, or `SEARCHING` progress or a completed result with an evidence notice. Fetch partial hits from a serveable subset only when the original request used `allow_partial_results: true`. `DEFERRED`, `TIMEOUT`, and `FAILED` are terminal; unrecognized statuses are not polled. Preserve any disclosed evidence from those stopped references and follow the rendered new-search action. " +
  "The tool waits up to 20 seconds by default; set `wait_timeout_ms` from 0 to 60000 to change that bounded wait.";

export function createSearchStatusTool(
  service: CodeNavigationService,
): ToolDefinition<SearchStatusArgs, typeof schema> {
  return {
    name: "search_status",
    description: DESCRIPTION,
    schema,
    annotations: READ_ONLY_TOOL_ANNOTATIONS,
    handler: async (args, context) => {
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
        throwIfCallerCancellation(error, context?.signal);
        return errorResult(
          JSON.stringify(
            addLocalMcpAuthAction(
              buildUnifiedSearchErrorPayload(error),
              context,
            ),
          ),
        );
      }
    },
  };
}

function isTextFormat(format: SearchStatusArgs["format"]): boolean {
  return format === undefined || format === "text";
}
