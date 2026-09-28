import type {
  ListFileIntent,
  ListParams,
  ListService,
} from "@githits/core-internal";
import { z } from "zod";
import { mapListError } from "../shared/list-error-map.js";
import { buildListParams } from "../shared/list-request.js";
import { projectListResult } from "../shared/list-response.js";
import { formatListText } from "../shared/list-text.js";
import { mcpMappedErrorResult, throwIfCallerCancellation } from "./shared.js";
import {
  OPEN_WORLD_READ_ONLY_TOOL_ANNOTATIONS,
  type ToolDefinition,
  textResult,
  type ZodRawShape,
} from "./types.js";

export interface ListArgs {
  target: string;
  paths?: string[];
  recursive?: boolean;
  file_types?: string[];
  languages?: string[];
  intents?: ListFileIntent[];
  limit?: number;
  after?: string;
  wait_timeout_ms?: number;
  format?: "text" | "json";
}

const LIST_INTENTS = [
  "PRODUCTION",
  "TEST",
  "BENCHMARK",
  "EXAMPLE",
  "GENERATED",
  "FIXTURE",
  "BUILD",
  "VENDOR",
] as const satisfies readonly ListFileIntent[];

const schema: ZodRawShape = {
  target: z
    .string()
    .describe(
      "Compact package target such as `npm:express@5.2.1` or repository target such as `github:expressjs/express`; use `site:<host[/path]>` for hosted documentation.",
    ),
  paths: z
    .array(z.string())
    .max(1000)
    .optional()
    .describe(
      "Literal paths and glob patterns form a union. Omit `paths` or pass `[]` to browse roots.",
    ),
  recursive: z
    .boolean()
    .optional()
    .describe(
      "Expand selected directories to descendant leaves. Without this, selected directories show immediate children. Glob depth is independent of recursion.",
    ),
  file_types: z
    .array(z.string())
    .max(64)
    .optional()
    .describe("Source inventories only; filter by file type."),
  languages: z
    .array(z.string())
    .max(64)
    .optional()
    .describe("Source inventories only; filter by language."),
  intents: z
    .array(z.enum(LIST_INTENTS))
    .max(64)
    .optional()
    .describe(
      "Source inventories only; filter by file intent: PRODUCTION, TEST, BENCHMARK, EXAMPLE, GENERATED, FIXTURE, BUILD, or VENDOR.",
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(500)
    .optional()
    .describe("Maximum entries to return (1-500)."),
  after: z
    .string()
    .optional()
    .describe(
      "Opaque cursor from a prior list response; an empty value is omitted.",
    ),
  wait_timeout_ms: z
    .number()
    .int()
    .min(0)
    .max(300_000)
    .optional()
    .describe("Maximum wait for indexing in milliseconds (0-300000)."),
  format: z
    .enum(["text", "json"])
    .default("text")
    .describe(
      "Omit `format` to use token-efficient text when the model reads the result or chooses follow-up tools. Set `json` only when code consumes the raw response instead of the model, or a required field is absent from text.",
    ),
};

const DESCRIPTION =
  "List files or documentation pages in a package, repository, or site. " +
  "Browse a known target to enumerate its paths.\n\n" +
  "Replaces code_files and docs_list. A package target covers one package-owned " +
  "source tree; a repository target covers the whole repository snapshot. " +
  "Package and repository inventories contain source and documentation files " +
  "together. Hosted documentation uses a separate inventory selected with an " +
  "explicit site target. Paths select a literal/glob union; omit paths to " +
  "browse roots. Selected directories show immediate children unless " +
  "recursive expands them; glob depth is independent of recursion. Text returns " +
  "a path inventory, while JSON carries exact read/browse actions for follow-up calls.";

export function createListTool(
  service: ListService,
): ToolDefinition<ListArgs, typeof schema> {
  return {
    name: "list",
    description: DESCRIPTION,
    schema,
    annotations: OPEN_WORLD_READ_ONLY_TOOL_ANNOTATIONS,
    handler: async (args, context) => {
      let builtParams: ListParams | undefined;
      try {
        builtParams = buildListParams({
          target: args.target,
          paths: args.paths,
          recursive: args.recursive,
          fileTypes: args.file_types,
          languages: args.languages,
          intents: args.intents,
          limit: args.limit,
          after: args.after,
          waitTimeoutMs: args.wait_timeout_ms,
          includeDetailedFields: args.format === "json",
        });
        const result = await service.list(builtParams);
        const payload = projectListResult(result);
        if (args.format !== "json") {
          return textResult(formatListText(payload, { useColors: false }));
        }
        return textResult(JSON.stringify(payload));
      } catch (error) {
        throwIfCallerCancellation(error, context?.signal);
        const mapped = mapListError(error, {
          hasAfter: builtParams?.after !== undefined,
        });
        return mcpMappedErrorResult(mapped, context);
      }
    },
  };
}
