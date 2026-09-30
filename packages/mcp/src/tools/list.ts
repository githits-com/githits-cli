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
      "Known package such as `npm:express@5.2.1`, repository such as `github:expressjs/express`, or hosted docs site such as `site:expressjs.com`.",
    ),
  paths: z
    .array(z.string())
    .max(1000)
    .optional()
    .describe(
      "Target-relative literal paths and globs form a union for packages, repositories, and sites. Site paths with one leading `/` stay within the supplied target; `/` alone selects its root. Omit or pass `[]` to browse the root.",
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
    .describe(
      "Source inventories only; classifications such as `source` or `doc`, case-insensitive. Select file extensions with a `paths` glob such as `lib/**/*.js`.",
    ),
  languages: z
    .array(z.string())
    .max(64)
    .optional()
    .describe(
      "Source inventories only; language names such as `javascript`, `typescript`, or `rust`, case-insensitive.",
    ),
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
      "Opaque `nextCursor` from a prior list response. Reuse the same target, paths, filters, recursion, and limit; empty is omitted.",
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
      "Omit `format` to use token-efficient text when the model reads the result or follows read and continuation guidance. Set `json` for exact entry kinds or actions, or when code consumes the raw response instead of the model by parsing or filtering it programmatically.",
    ),
};

const DESCRIPTION =
  "List files and documentation paths in a known package, repository, or site. " +
  "Use it to browse structure or find an exact path before `read`; use `search` " +
  "for topics.\n\n" +
  "Replaces code_files and docs_list. Package targets cover one package-owned " +
  "tree; repository targets cover the whole snapshot. Both include source and " +
  "documentation. Hosted docs use an explicit `site:` target supplied by the " +
  "user or a docs search result. `paths` are target-relative literals or globs for every target and " +
  "form a union; omit them for the root. Directories show immediate children " +
  "unless `recursive` expands them; glob depth is independent of recursion. " +
  "In site text, a path without trailing `/` is a page even when its source URL ended in `/`. " +
  "Keep text for model use, including read and continuation guidance; use JSON " +
  "for exact entry kinds or actions and programmatic consumption.";

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
          return textResult(
            formatListText(payload, { useColors: false, syntax: "mcp" }),
          );
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
