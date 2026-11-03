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
import type { MappedError } from "../shared/mapped-error.js";
import { withIndexingRetryAction } from "../shared/mapped-error-text.js";
import { buildUnifiedSearchParams } from "../shared/unified-search-request.js";
import {
  buildUnifiedSearchErrorPayload,
  buildUnifiedSearchSuccessPayload,
  projectUnifiedSearchSuccessPayload,
} from "../shared/unified-search-response.js";
import { parseUnifiedSearchTargetSpec } from "../shared/unified-search-target.js";
import {
  renderUnifiedSearchError,
  renderUnifiedSearchSuccess,
} from "../shared/unified-search-text.js";
import { withVersionRefRecovery } from "../shared/version-ref-recovery.js";
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
  type ToolExecutionContext,
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
    "Compact package, repository, or site target; see target for forms.",
  );

const schema: ZodRawShape = {
  query: z
    .string()
    .min(1)
    .describe(
      "Focused missing behavior, API names, or exact text; omit redundant target/version keywords. Space-separate inline qualifiers, e.g. `createApplication kind:function category:callable path:lib/ intent:production lang:javascript`; no comma separators or trailing punctuation. Use `name:Router` for a name; qualifiers support query boolean syntax.",
    ),
  target: searchTargetSchema
    .optional()
    .describe(
      "One compact target: `npm:react@version`, `github:facebook/react@ref`, `launchpad:~owner/+git/repo@ref` (`lp:PROJECT` also accepted), or `site:react.dev`. Omit the suffix for the latest package version or repository default branch; a ref may be a branch, tag, or commit. `#` is for semantic fragments. For a docs page URL use read with that URL as target and no path; search docs with a package, repository, or site: target. Do not also pass `targets`.",
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
      "docs (guides/reference), code (source/tests), or symbol (APIs/entities); omit to auto-select.",
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
      "Default true returns a serveable subset plus searchRef while other target/source pairs prepare. False requires all runnable pairs; refresh may still return complete interim hits with searchRef. Paginate with nextOffset.",
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
      "Omit for text. Use json only when code consumes raw fields or text lacks a required field.",
    ),
};

const DESCRIPTION =
  "Discover relevant docs, code, and symbols in a known public target. Start here for unknown locations; read known symbols with selector instead. The target sets project/version scope; put other constraints in query and inspect warnings and sourceStatus. Use sufficient hits directly; otherwise replay a hit's complete read action or followUp, keeping its target, path, selector and bounds together. Use visible hits while indexing continues; call search_status only for a returned active action and searchRef when more results matter; never repeat search to poll. For suggestedSiteTargets, choose a site: target and retry explicitly; suggestions are not aliases. public_only filters code/symbols, not docs. Hosted docs are mutable; repository docs address snapshots." +
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
          ? resolveSearchTarget(effectiveTarget, context, args.format)
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
          resolveSearchTarget(entry, context, args.format),
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
        return textResult(
          JSON.stringify(projectUnifiedSearchSuccessPayload(payload)),
        );
      } catch (error) {
        throwIfCallerCancellation(error, context?.signal);
        const basePayload = buildUnifiedSearchErrorPayload(error);
        const indexingMapped = withIndexingRetryAction(
          {
            code: basePayload.code as MappedError["code"],
            message: basePayload.error,
            retryable: basePayload.retryable,
            details: basePayload.details as MappedError["details"],
          },
          "search",
          "mcp",
        );
        const mapped = withVersionRefRecovery(indexingMapped, {
          syntax: "mcp",
          tool: "search",
          args,
        });
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

function resolveSearchTarget(
  target: string,
  context: ToolExecutionContext | undefined,
  format: SearchArgs["format"],
): UnifiedSearchTarget | ToolResult {
  try {
    return parseUnifiedSearchTargetSpec(target);
  } catch (error) {
    const mapped = mapCodeNavigationError(error);
    return mcpMappedErrorResult(mapped, context, format);
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
