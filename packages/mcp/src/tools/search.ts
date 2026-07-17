import type {
  CodeNavigationService,
  CodeNavigationTarget,
} from "@githits/core-internal";
import { z } from "zod";
import {
  type CodeNavigationRegistryArg,
  toCodeNavigationRegistry,
  toFileIntent,
  toSymbolCategory,
  toSymbolKind,
} from "../shared/code-navigation.js";
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
import {
  type CodeTargetArg,
  structuredCodeTargetSchema,
} from "./code-navigation-shared.js";
import { SEARCH_GUARDRAIL } from "./guardrails.js";
import { addLocalMcpAuthAction, mcpMappedErrorResult } from "./shared.js";
import {
  BOUNDED_WRITE_TOOL_ANNOTATIONS,
  errorResult,
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
  target?: CodeTargetArg;
  targets?: CodeTargetArg[];
  source?: "docs" | "code" | "symbol";
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
      "Compact discovery target string. Package with explicit registry: `npm:react@18.2.0` or `npm:react` for latest release. Repository: `github:facebook/react`, `github.com/facebook/react`, `https://github.com/facebook/react`, or any repo form with `#HEAD` / `@HEAD` for a git ref. Output uses canonical `github:owner/repo#ref` form.",
    ),
]);

const schema: ZodRawShape = {
  query: z
    .string()
    .min(1)
    .describe(
      "What to find in the target. Use natural terms, API names, or quoted phrases; optional qualifiers like `path:`, `name:`, `lang:`, `kind:`, and `repo:` are supported for precision.",
    ),
  target: searchTargetSchema
    .optional()
    .describe(
      "One package or repository target. Pass `target` or `targets`, not both.",
    ),
  targets: z
    .array(searchTargetSchema)
    .max(20)
    .optional()
    .describe(
      "Multiple package or repository targets. Pass `targets` or `target`, not both.",
    ),
  source: z
    .enum(["docs", "code", "symbol"])
    .optional()
    .describe(
      "Optional result source: `docs` for guides/reference pages, `code` for source and tests, or `symbol` for APIs/entities. Omit to let GitHits select the best sources.",
    ),
  category: z
    .enum(["callable", "type", "module", "data", "documentation"])
    .optional()
    .describe(
      'Optional symbol/category filter. Best for `source:"symbol"` or precise API searches; omit for broad source-code searches because filters combine with AND and can exclude file hits. Ignored for `source:"docs"`.',
    ),
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
    .optional()
    .describe(
      'Optional symbol kind filter. Best for `source:"symbol"` or exact API/entity searches; omit for broad source-code searches because filters combine with AND and can exclude file hits. Ignored for `source:"docs"`.',
    ),
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
      'Optional code file-intent filter. Omit it to search across all intents. Ignored for `source:"docs"` because docs search does not support file intents.',
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
    .enum(["text-v1", "text", "json"])
    .default("text-v1")
    .describe(
      'Response format. Default `text-v1` — compact line-oriented output. Pass `format: "json"` for the structured envelope. `text` is an alias for `text-v1`. The text format is a public, snapshot-tested contract.',
    ),
};

const DESCRIPTION =
  "Use when investigating a known package or repository and you need to discover relevant docs, source files, examples, tests, or APIs before reading exact files. Search indexed dependency and repository code, docs, and explicit symbols. " +
  "Required: `query` plus either `target` or `targets`; pass `target` or `targets`, not both. " +
  "Omit `source` to let GitHits select the best sources; set it only to restrict results to docs, code, or symbols. " +
  'Structured parameters combine with the `query` using AND semantics. For `source:"docs"`, code/symbol-only filters (`category`, `kind`, `file_intent`, `public_only`) are ignored because docs search does not support them. ' +
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
    annotations: BOUNDED_WRITE_TOOL_ANNOTATIONS,
    handler: async (args) => {
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
        const payload = addLocalMcpAuthAction(
          buildUnifiedSearchErrorPayload(error),
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
  if (typeof target === "string") return target.trim().length === 0;
  return !(
    normaliseOptionalValue(target.registry) ||
    normaliseOptionalValue(target.package_name) ||
    normaliseOptionalValue(target.version) ||
    normaliseOptionalValue(target.repo_url) ||
    normaliseOptionalValue(target.git_ref)
  );
}

function normaliseOptionalValue(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
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
      return mcpMappedErrorResult(mapped);
    }
  }

  const registry = normaliseOptionalValue(target.registry)?.toLowerCase();
  const packageName = normaliseOptionalValue(target.package_name);
  const version = normaliseOptionalValue(target.version);
  const repoUrl = normaliseOptionalValue(target.repo_url);
  const gitRef = normaliseOptionalValue(target.git_ref);
  const hasPackageTarget = registry !== undefined || packageName !== undefined;
  const hasRepoTarget = repoUrl !== undefined || gitRef !== undefined;
  if (hasPackageTarget && hasRepoTarget) {
    return invalidSearchTargetResult(
      "Invalid target: provide either registry + package_name or repo_url with optional git_ref, not both.",
    );
  }
  if (!hasPackageTarget && !hasRepoTarget) {
    return invalidSearchTargetResult(
      "Missing target: provide registry + package_name or repo_url.",
    );
  }
  if (hasPackageTarget) {
    if (!registry || !packageName) {
      return invalidSearchTargetResult(
        "Incomplete package target: both registry and package_name are required.",
      );
    }
    return {
      registry: toCodeNavigationRegistry(registry as CodeNavigationRegistryArg),
      packageName,
      version,
    };
  }
  if (!repoUrl) {
    return invalidSearchTargetResult(
      "Incomplete repository target: repo_url is required.",
    );
  }
  return { repoUrl, gitRef };
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
