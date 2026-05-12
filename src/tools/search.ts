import { z } from "zod";
import type {
  CodeNavigationService,
  CodeNavigationTarget,
} from "../services/index.js";
import { toCodeNavigationRegistry } from "../shared/code-navigation.js";
import { mapCodeNavigationError } from "../shared/code-navigation-error-map.js";
import {
  buildUnifiedSearchErrorPayload,
  buildUnifiedSearchParams,
  buildUnifiedSearchSuccessPayload,
  renderUnifiedSearchError,
  renderUnifiedSearchSuccess,
  toFileIntent,
  toSymbolCategory,
  toSymbolKind,
} from "../shared/index.js";
import { parseUnifiedSearchTargetSpec } from "../shared/unified-search-target.js";
import {
  type CodeTargetArg,
  structuredCodeTargetSchema,
} from "./code-navigation-shared.js";
import { SEARCH_GUARDRAIL } from "./guardrails.js";
import {
  errorResult,
  type ToolDefinition,
  type ToolResult,
  textResult,
} from "./types.js";

type ResolvedSearchTarget = Exclude<
  ReturnType<typeof resolveSearchTarget>,
  ToolResult
>;

export interface SearchArgs {
  query: string;
  target?: CodeTargetArg;
  targets?: CodeTargetArg[];
  sources?: Array<"docs" | "code" | "symbol">;
  category?: "callable" | "type" | "module" | "data" | "documentation";
  kind?:
    | "function"
    | "method"
    | "constructor"
    | "getter"
    | "setter"
    | "operator"
    | "class"
    | "interface"
    | "trait"
    | "struct"
    | "enum"
    | "record"
    | "protocol"
    | "extension"
    | "delegate"
    | "mixin"
    | "actor"
    | "annotation"
    | "type"
    | "module"
    | "namespace"
    | "package"
    | "object"
    | "field"
    | "property"
    | "event"
    | "constant"
    | "doc_section";
  path_prefix?: string;
  file_intent?:
    | "production"
    | "test"
    | "benchmark"
    | "example"
    | "generated"
    | "fixture"
    | "build"
    | "vendor";
  public_only?: boolean;
  name?: string;
  language?: string;
  allow_partial_results?: boolean;
  limit?: number;
  offset?: number;
  wait_timeout_ms?: number;
  format?: "json" | "text" | "text-v1";
}

const searchTargetSchema = z.union([
  structuredCodeTargetSchema,
  z
    .string()
    .min(1)
    .describe(
      "Compact discovery target string. Package: `npm:react@18.2.0`. Repository: `https://github.com/facebook/react` for backend default branch or `https://github.com/facebook/react#HEAD` for an explicit ref.",
    ),
]);

const schema = {
  query: z
    .string()
    .min(1)
    .describe(
      "Discovery query string. Supports implicit AND, uppercase OR, parentheses, unary -, quoted phrases, semantic qualifiers (kind:, category:, path:, lang:, name:, intent:), and routing qualifiers (registry:, package:, version:, repo:). Parsed once and compiled per source; it is not forwarded as a raw backend query.",
    ),
  target: searchTargetSchema.optional(),
  targets: z.array(searchTargetSchema).max(20).optional(),
  sources: z
    .array(z.enum(["docs", "code", "symbol"]))
    .optional()
    .describe("Optional source selection. Omit for backend AUTO."),
  category: z
    .enum(["callable", "type", "module", "data", "documentation"])
    .optional(),
  kind: z
    .enum([
      "function",
      "method",
      "constructor",
      "getter",
      "setter",
      "operator",
      "class",
      "interface",
      "trait",
      "struct",
      "enum",
      "record",
      "protocol",
      "extension",
      "delegate",
      "mixin",
      "actor",
      "annotation",
      "type",
      "module",
      "namespace",
      "package",
      "object",
      "field",
      "property",
      "event",
      "constant",
      "doc_section",
    ])
    .optional(),
  path_prefix: z.string().optional(),
  file_intent: z
    .enum([
      "production",
      "test",
      "benchmark",
      "example",
      "generated",
      "fixture",
      "build",
      "vendor",
    ])
    .optional()
    .describe(
      "Optional file-intent filter. Omit it to search across all intents; some sources may ignore this filter and report that in sourceStatus.",
    ),
  public_only: z.boolean().optional(),
  name: z.string().optional(),
  language: z.string().optional(),
  allow_partial_results: z
    .boolean()
    .optional()
    .describe(
      "Default false waits for all sources; if the wait window expires, returns only searchRef/progress. When true, includes hits from sources that finished so far and still returns searchRef for continuation. Partial payloads support normal pagination via nextOffset.",
    ),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe("Maximum results to return (default 10, max 100)."),
  offset: z.coerce.number().int().min(0).optional(),
  wait_timeout_ms: z.coerce.number().int().min(0).max(60000).optional(),
  format: z
    .enum(["json", "text", "text-v1"])
    .optional()
    .describe(
      'Response format. Default `text-v1` — compact line-oriented output. Pass `format: "json"` for the structured envelope. `text` is an alias for `text-v1`. The text format is a public, snapshot-tested contract.',
    ),
};

const DESCRIPTION =
  "Search indexed dependency and repository code, docs, and explicit symbols. " +
  "Provide either `target` for one target or `targets` for many; omit `sources` to use backend AUTO. " +
  "Structured parameters combine with the `query` using AND semantics. " +
  "Complete by default — if indexing is still running, the response carries a `searchRef` and no hits; pass it to `search_status` to follow up. " +
  "Set `allow_partial_results: true` to opt into hits from sources that finished while others continue indexing. " +
  "Each hit's `type` tells you the follow-up tool: `documentation_page` and `repository_doc` → `docs_read` with `locator.pageId`; `repository_code` and `repository_symbol` → `code_read` with `locator.filePath` (and `locator.startLine`/`endLine` when present)." +
  `\n\n${SEARCH_GUARDRAIL}`;

export function createSearchTool(
  service: CodeNavigationService,
): ToolDefinition<SearchArgs, typeof schema> {
  return {
    name: "search",
    description: DESCRIPTION,
    schema,
    annotations: { readOnlyHint: true },
    handler: async (args) => {
      try {
        const resolvedTarget = args.target
          ? resolveSearchTarget(args.target)
          : undefined;
        if (resolvedTarget && "content" in resolvedTarget)
          return resolvedTarget;

        const resolvedTargets = args.targets?.map((entry) =>
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
          sources: args.sources?.map(
            (entry) => entry.toUpperCase() as "DOCS" | "CODE" | "SYMBOL",
          ),
          kind: toSymbolKind(args.kind),
          category: toSymbolCategory(args.category),
          pathPrefix: args.path_prefix,
          fileIntent: toFileIntent(args.file_intent),
          publicOnly: args.public_only,
          name: args.name,
          language: args.language,
          allowPartialResults: args.allow_partial_results,
          limit: args.limit,
          offset: args.offset,
          waitTimeoutMs: args.wait_timeout_ms,
        });

        const outcome = await service.search(built.params);
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
        const payload = buildUnifiedSearchErrorPayload(error);
        if (isTextFormat(args.format)) {
          return errorResult(renderUnifiedSearchError(payload));
        }
        return errorResult(JSON.stringify(payload));
      }
    },
  };
}

function isResolvedSearchTarget(
  target: ReturnType<typeof resolveSearchTarget>,
): target is ResolvedSearchTarget {
  return !("content" in target);
}

function resolveSearchTarget(
  target: CodeTargetArg,
): CodeNavigationTarget | ToolResult {
  if (typeof target === "string") {
    try {
      return parseUnifiedSearchTargetSpec(target);
    } catch (error) {
      const mapped = mapCodeNavigationError(error);
      return errorResult(
        JSON.stringify({
          error: mapped.message,
          code: mapped.code,
          retryable: mapped.retryable ?? false,
          ...(mapped.details ? { details: mapped.details } : {}),
        }),
      );
    }
  }

  const hasPackageTarget = Boolean(target.registry || target.package_name);
  const hasRepoTarget = Boolean(target.repo_url || target.git_ref);
  if (hasPackageTarget && hasRepoTarget) {
    return invalidSearchTargetResult(
      "Invalid target: provide either registry + package_name or repo_url + git_ref, not both.",
    );
  }
  if (!hasPackageTarget && !hasRepoTarget) {
    return invalidSearchTargetResult(
      "Missing target: provide registry + package_name or repo_url.",
    );
  }
  if (hasPackageTarget) {
    if (!target.registry || !target.package_name) {
      return invalidSearchTargetResult(
        "Incomplete package target: both registry and package_name are required.",
      );
    }
    return {
      registry: toCodeNavigationRegistry(target.registry),
      packageName: target.package_name,
      version: target.version,
    };
  }
  if (!target.repo_url) {
    return invalidSearchTargetResult(
      "Incomplete repository target: repo_url is required.",
    );
  }
  return { repoUrl: target.repo_url, gitRef: target.git_ref };
}

function invalidSearchTargetResult(message: string): ToolResult {
  return errorResult(
    JSON.stringify({
      error: message,
      code: "INVALID_ARGUMENT",
      retryable: false,
    }),
  );
}

/**
 * Default response format is text-v1 — agents consume the MCP surface
 * and benefit from the compact form. Programmatic / parity callers
 * opt into JSON explicitly.
 */
function isTextFormat(format: SearchArgs["format"]): boolean {
  return format === undefined || format === "text" || format === "text-v1";
}
