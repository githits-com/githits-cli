import { z } from "zod";
import type { CodeNavigationService } from "../services/index.js";
import {
  buildUnifiedSearchErrorPayload,
  buildUnifiedSearchStatusPayload,
} from "../shared/index.js";
import { errorResult, type ToolDefinition, textResult } from "./types.js";

export interface SearchStatusArgs {
  search_ref: string;
}

const schema = {
  search_ref: z
    .string()
    .min(1)
    .describe("Search reference returned by search."),
};

const DESCRIPTION =
  "Check progress or fetch final results for a prior unified search. " +
  "Pass the search_ref returned by `search` when the original request did not complete within the wait window.";

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
        return textResult(JSON.stringify(payload));
      } catch (error) {
        return errorResult(
          JSON.stringify(buildUnifiedSearchErrorPayload(error)),
        );
      }
    },
  };
}
