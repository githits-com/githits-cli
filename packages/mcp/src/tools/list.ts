import type {
  ListFileIntent,
  ListParams,
  ListService,
} from "@githits/core-internal";
import { z } from "zod";
import {
  DEFAULT_WAIT_TIMEOUT_MS,
  MAX_DISCOVERY_WAIT_TIMEOUT_MS,
} from "../shared/code-navigation-defaults.js";
import { mapListError } from "../shared/list-error-map.js";
import { buildListParams } from "../shared/list-request.js";
import { projectListResult } from "../shared/list-response.js";
import { formatListText } from "../shared/list-text.js";
import { withIndexingRetryAction } from "../shared/mapped-error-text.js";
import { serviceRequestArgs } from "../shared/service-request-args.js";
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
      "Known package such as `npm:express@5.2.1`, repository such as `github:expressjs/express` or `launchpad:~owner/+git/repo` (`lp:PROJECT` also accepted), or hosted docs site such as `site:expressjs.com`.",
    ),
  paths: z
    .array(z.string())
    .max(1000)
    .optional()
    .describe(
      "Omit or pass [] to browse the root; never pass blank entries. Package/repository paths are relative: do not use / for their root. Literal paths and globs form a union. Only site paths accept a leading /; / selects the site root.",
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
      'File classes such as source or doc, not languages or extensions. For JavaScript use languages:["javascript"] or paths:["**/*.js"], never file_types:["javascript"]. Source inventories only; case-insensitive.',
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
    .describe(
      `Maximum wait for indexing in milliseconds (0-300000; default ${DEFAULT_WAIT_TIMEOUT_MS}).`,
    ),
  format: z
    .enum(["text", "json"])
    .default("text")
    .describe(
      "Omit for text. Use json only when code consumes raw fields or text lacks a required field. JSON exposes exact entry kinds/actions.",
    ),
};

const DESCRIPTION =
  "List files and documentation paths in a known package, repository, or site. Use this for names and structure; skip it when a usable path or symbol is known, and avoid whole-project enumeration for narrow lookups. Package targets cover their package tree; repositories cover the snapshot; both include source and docs. Hosted docs need an explicit site target from the user or a docs search result. Reuse returned read actions; paginate only for needed paths. In site text, a path without trailing / is a page, even if its source URL ends with /.";

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
          includeTargetProvenance: true,
        });
        const result = await service.list(
          builtParams,
          ...serviceRequestArgs(context?.signal),
        );
        const payload = projectListResult(result);
        if (args.format !== "json") {
          return textResult(
            formatListText(payload, {
              useColors: false,
              syntax: "mcp",
              hasAfter: builtParams.after !== undefined,
            }),
          );
        }
        return textResult(JSON.stringify(payload));
      } catch (error) {
        throwIfCallerCancellation(error, context?.signal);
        const mapped = mapListError(error, {
          hasAfter: builtParams?.after !== undefined,
        });
        return mcpMappedErrorResult(
          withIndexingRetryAction(mapped, "list", "mcp", {
            maxWaitMs: MAX_DISCOVERY_WAIT_TIMEOUT_MS,
            hasAfter: builtParams?.after !== undefined,
          }),
          context,
          args.format,
          {
            recovery: { syntax: "mcp", tool: "list", args },
            indexingTarget: args.target,
            indexingOutcome: args.target.startsWith("site:")
              ? "No pages available yet."
              : "No files available yet.",
          },
        );
      }
    },
  };
}
