import type { CodeNavigationService } from "@githits/core-internal";
import { z } from "zod";
import {
  DEFAULT_WAIT_TIMEOUT_MS,
  MAX_DISCOVERY_WAIT_TIMEOUT_MS,
} from "../shared/code-navigation-defaults.js";
import type { MappedError } from "../shared/mapped-error.js";
import { withIndexingRetryAction } from "../shared/mapped-error-text.js";
import {
  buildUnifiedSearchErrorPayload,
  buildUnifiedSearchStatusPayload,
  projectUnifiedSearchStatusPayload,
} from "../shared/unified-search-response.js";
import { renderUnifiedSearchStatusText } from "../shared/unified-search-status-text.js";
import { renderUnifiedSearchError } from "../shared/unified-search-text.js";
import { addLocalMcpAuthAction, throwIfCallerCancellation } from "./shared.js";
import {
  errorResult,
  OPEN_WORLD_READ_ONLY_TOOL_ANNOTATIONS,
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
    .describe("searchRef from the prior search response, unchanged."),
  wait_timeout_ms: z.coerce
    .number()
    .int()
    .min(0)
    .max(MAX_DISCOVERY_WAIT_TIMEOUT_MS)
    .optional()
    .describe(
      `Time to wait for results in ms. Default ${DEFAULT_WAIT_TIMEOUT_MS}, max ${MAX_DISCOVERY_WAIT_TIMEOUT_MS}.`,
    ),
  format: z
    .enum(["text", "json"])
    .default("text")
    .describe(
      "Omit for text. Use json only when code consumes raw fields or text lacks a required field.",
    ),
};

const DESCRIPTION =
  "Continue an explicit search reference for progress and results. Call this only after a prior search returned both searchRef and a search_status action; pass searchRef unchanged as search_ref. Poll only PENDING, INDEXING, or SEARCHING when more results matter, using visible hits meanwhile. COMPLETED, DEFERRED, TIMEOUT, FAILED and unknown statuses are terminal: keep their evidence and follow the rendered new-search action.";

export function createSearchStatusTool(
  service: CodeNavigationService,
): ToolDefinition<SearchStatusArgs, typeof schema> {
  return {
    name: "search_status",
    description: DESCRIPTION,
    schema,
    annotations: OPEN_WORLD_READ_ONLY_TOOL_ANNOTATIONS,
    handler: async (args, context) => {
      try {
        const outcome = await service.searchStatus(
          args.search_ref,
          args.wait_timeout_ms ?? DEFAULT_WAIT_TIMEOUT_MS,
          {
            signal: context?.signal,
          },
        );
        const payload = buildUnifiedSearchStatusPayload(outcome);
        if (isTextFormat(args.format)) {
          return textResult(renderUnifiedSearchStatusText(payload));
        }
        return textResult(
          JSON.stringify(projectUnifiedSearchStatusPayload(payload)),
        );
      } catch (error) {
        throwIfCallerCancellation(error, context?.signal);
        const basePayload = buildUnifiedSearchErrorPayload(error);
        const mapped = withIndexingRetryAction(
          {
            code: basePayload.code as MappedError["code"],
            message: basePayload.error,
            retryable: basePayload.retryable,
            details: basePayload.details as MappedError["details"],
          },
          "search",
          "mcp",
        );
        const payload = addLocalMcpAuthAction(
          {
            ...basePayload,
            ...(mapped.details
              ? { details: mapped.details as Record<string, unknown> }
              : {}),
          },
          context,
        );
        if (isTextFormat(args.format)) {
          return errorResult(renderUnifiedSearchError(payload));
        }
        return errorResult(JSON.stringify(payload));
      }
    },
  };
}

function isTextFormat(format: SearchStatusArgs["format"]): boolean {
  return format === undefined || format === "text";
}
