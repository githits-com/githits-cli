import type {
  CodeNavigationService,
  UnifiedSearchTarget,
} from "@githits/core-internal";
import { z } from "zod";
import {
  DEFAULT_WAIT_TIMEOUT_MS,
  MAX_DISCOVERY_WAIT_TIMEOUT_MS,
} from "../shared/code-navigation-defaults.js";
import { mapCodeNavigationError } from "../shared/code-navigation-error-map.js";
import { buildUnifiedSearchParams } from "../shared/unified-search-request.js";
import {
  buildUnifiedSearchErrorPayload,
  buildUnifiedSearchSuccessPayload,
} from "../shared/unified-search-response.js";
import { parseUnifiedSearchTargetSpec } from "../shared/unified-search-target.js";
import {
  renderUnifiedSearchError,
  renderUnifiedSearchSuccess,
} from "../shared/unified-search-text.js";
import { SEARCH_GUARDRAIL } from "./guardrails.js";
import {
  addLocalMcpAuthAction,
  mcpMappedErrorResult,
  throwIfCallerCancellation,
} from "./shared.js";
import {
  errorResult,
  OPEN_WORLD_READ_ONLY_TOOL_ANNOTATIONS,
  type ToolDefinition,
  type ToolResult,
  textResult,
  type ZodRawShape,
} from "./types.js";

type ResolvedSearchTarget = Exclude<
  ReturnType<typeof resolveSearchTarget>,
  ToolResult
>;

export interface SearchArgs {
  query: string;
  target?: string;
  targets?: string[];
  source?: "docs" | "code" | "symbol";
  public_only?: boolean;
  allow_partial_results?: boolean;
  limit?: number;
  offset?: number;
  wait_timeout_ms?: number;
  format?: "text" | "json";
}

const searchTargetSchema = z
  .string()
  .min(1)
  .describe(
    "Compact package, repository, or exact docs-site target, such as `npm:react`, `github:facebook/react@main`, or `site:react.dev`. Repository revisions use `@ref`; `#` is reserved for semantic fragments.",
  );

const schema: ZodRawShape = {
  query: z
    .string()
    .min(1)
    .describe(
      "Focused discovery terms, API names, behaviors, or quoted phrases. Add constraints inline, for example `kind:function`, `category:callable`, `path:lib/`, `intent:production`, `name:Router`, or `lang:typescript`; qualifiers combine with terms using query boolean syntax.",
    ),
  target: searchTargetSchema
    .optional()
    .describe(
      "One compact package, repository, or exact docs-site target, such as `npm:react`, `github:facebook/react@main`, or `site:react.dev`. Repository revisions use `@ref`; `#` is reserved for semantic fragments. Do not also pass `targets`.",
    ),
  targets: z
    .array(searchTargetSchema)
    .max(20)
    .optional()
    .describe("Up to 20 compact targets. Do not also pass `target`."),
  source: z
    .enum(["docs", "code", "symbol"])
    .optional()
    .describe(
      "Optional result source: `docs` for guides/reference pages, `code` for source and tests, or `symbol` for APIs/entities. Omit to let GitHits select the best sources.",
    ),
  public_only: z
    .boolean()
    .optional()
    .describe(
      'Set true to restrict code and symbol results to public APIs. False is equivalent to omitting it; ignored for `source:"docs"`.',
    ),
  allow_partial_results: z
    .boolean()
    .optional()
    .describe(
      "Default false keeps hits atomic across runnable target/source pairs, although a complete serveable interim result may accompany searchRef while refresh continues. When true, permits a serveable subset while other pairs remain unavailable and still returns searchRef for continuation. Partial payloads support normal pagination via nextOffset.",
    ),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe("Maximum results to return (default 10, max 100)."),
  offset: z.coerce
    .number()
    .int()
    .min(0)
    .optional()
    .describe(
      "Zero-based result offset (default 0). Continue pagination with the response's `nextOffset` when present.",
    ),
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
      "Omit `format` to use token-efficient text when the model reads the result or chooses follow-up tools. Set `json` only when code consumes the raw response instead of the model, or a required field is absent from text.",
    ),
};

const DESCRIPTION =
  'Discover relevant docs, code, and symbols in a known public target. Start here for open-ended "how does", "where is", "find", or "locate" questions. ' +
  "Required: `query` plus either `target` or `targets`; pass `target` or `targets`, not both. " +
  "Target indexed dependencies and repositories, or standalone docs with `site:<host[/path]>`. " +
  "Put search constraints in `query`; backend validation reports accepted values. Inspect returned warnings and `sourceStatus` when a qualifier is ignored or incompatible with a selected source. `public_only` remains structured and is ignored for docs. " +
  "A `search` call can return complete results directly. Only when its response supplies both a `searchRef` and a `search_status` action, follow that action with `search_status`; never repeat `search` to poll. Terminal or unrecognized statuses are not polled; follow the response's recovery guidance instead. If the response includes advisory `sourceStatus[].suggestedSiteTargets`, retry one explicitly; do not treat suggestions as aliases or retry automatically. " +
  "Use hit content directly when sufficient; follow its generated `followUp` only for more context. Hosted `[docs page]` HTTP(S) targets address mutable current content: pass the returned URL or fragment unchanged, and generated follow-ups omit search line bounds. Repository docs remain snapshot-addressed and keep returned ranges. Explicit `read` bounds are caller-selected ranges. For source hits use the returned target, path, and line range." +
  `\n\n${SEARCH_GUARDRAIL}`;

export function createSearchTool(
  service: CodeNavigationService,
): ToolDefinition<SearchArgs, typeof schema> {
  return {
    name: "search",
    description: DESCRIPTION,
    schema,
    annotations: OPEN_WORLD_READ_ONLY_TOOL_ANNOTATIONS,
    handler: async (args, context) => {
      try {
        const effectiveTarget = isBlankSearchTarget(args.target)
          ? undefined
          : args.target;
        const resolvedTarget = effectiveTarget
          ? resolveSearchTarget(effectiveTarget)
          : undefined;
        if (resolvedTarget && "content" in resolvedTarget)
          return resolvedTarget;

        const effectiveTargets = args.targets?.filter(
          (target) => !isBlankSearchTarget(target),
        );
        const nonEmptyTargets = effectiveTargets?.length
          ? effectiveTargets
          : undefined;
        const resolvedTargets = nonEmptyTargets?.map((entry) =>
          resolveSearchTarget(entry),
        );
        const resolvedTargetsError = resolvedTargets?.find(
          (entry) => "content" in entry,
        );
        if (resolvedTargetsError) {
          return resolvedTargetsError;
        }

        const built = buildUnifiedSearchParams({
          target:
            resolvedTarget && !("content" in resolvedTarget)
              ? resolvedTarget
              : undefined,
          targets: resolvedTargets?.filter(isResolvedSearchTarget),
          query: args.query,
          sources: args.source
            ? [args.source.toUpperCase() as "DOCS" | "CODE" | "SYMBOL"]
            : undefined,
          publicOnly: args.public_only,
          allowPartialResults: args.allow_partial_results,
          limit: args.limit,
          offset: args.offset,
          waitTimeoutMs: args.wait_timeout_ms,
        });

        const outcome = await service.search(built.params, {
          signal: context?.signal,
          omitFocusedSource: isTextFormat(args.format),
        });
        const payload = buildUnifiedSearchSuccessPayload(
          built.params,
          built.rawQuery,
          built.compiledQuery,
          outcome,
        );
        if (isTextFormat(args.format)) {
          return textResult(renderUnifiedSearchSuccess(payload));
        }
        return textResult(JSON.stringify(payload));
      } catch (error) {
        throwIfCallerCancellation(error, context?.signal);
        const payload = addLocalMcpAuthAction(
          buildUnifiedSearchErrorPayload(error),
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

function isBlankSearchTarget(
  target: SearchArgs["target"] | undefined,
): boolean {
  if (target === undefined) return true;
  return target.trim().length === 0;
}

function isResolvedSearchTarget(
  target: ReturnType<typeof resolveSearchTarget>,
): target is ResolvedSearchTarget {
  return !("content" in target);
}

function resolveSearchTarget(target: string): UnifiedSearchTarget | ToolResult {
  try {
    return parseUnifiedSearchTargetSpec(target);
  } catch (error) {
    const mapped = mapCodeNavigationError(error);
    return mcpMappedErrorResult(mapped);
  }
}

/**
 * Default response format is text — agents consume the MCP surface
 * and benefit from the compact form. Programmatic / parity callers
 * opt into JSON explicitly.
 */
function isTextFormat(format: SearchArgs["format"]): boolean {
  return format === undefined || format === "text";
}
