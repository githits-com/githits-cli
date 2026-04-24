import { z } from "zod";
import type { CodeNavigationService } from "../services/index.js";
import {
  buildUnifiedSearchErrorPayload,
  buildUnifiedSearchParams,
  buildUnifiedSearchSuccessPayload,
  toSearchSymbolsFileIntent,
  toSearchSymbolsKind,
  toSymbolCategory,
} from "../shared/index.js";
import {
  type CodeTargetArg,
  codeTargetSchema,
  resolveCodeTarget,
} from "./code-navigation-shared.js";
import { errorResult, type ToolDefinition, textResult } from "./types.js";

type ResolvedCodeTarget = Exclude<
  ReturnType<typeof resolveCodeTarget>,
  { content: unknown }
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
}

const schema = {
  query: z
    .string()
    .min(1)
    .describe(
      "Discovery query string. Supports implicit AND, uppercase OR, parentheses, unary -, quoted phrases, semantic qualifiers (kind:, category:, path:, lang:, name:, intent:), and routing qualifiers (registry:, package:, version:, repo:). Parsed once and compiled per source; it is not forwarded as a raw backend query.",
    ),
  target: codeTargetSchema.optional(),
  targets: z.array(codeTargetSchema).max(20).optional(),
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
      "Optional file-intent filter. When omitted, AUTO/code/symbol searches default to production; explicit docs-only searches omit the filter because docs do not support it.",
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
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  wait_timeout_ms: z.coerce.number().int().min(0).max(60000).optional(),
};

const DESCRIPTION =
  "Search indexed dependency and repository code, docs, and explicit symbols. " +
  "The query field uses GitHits discovery syntax (AND/OR/parens/qualifiers; see the parameter description). " +
  "Structured parameters combine with that query using AND semantics. " +
  "Provide either `target` for one target or `targets` for many. Omit `sources` to use backend AUTO. " +
  "Results are complete by default; set `allow_partial_results: true` to include available hits while indexing continues. " +
  "Use `search_status` with that ref to continue.";

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
          ? resolveCodeTarget(args.target)
          : undefined;
        if (resolvedTarget && "content" in resolvedTarget)
          return resolvedTarget;

        const resolvedTargets = args.targets?.map((entry) =>
          resolveCodeTarget(entry),
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
          targets: resolvedTargets?.filter(isResolvedCodeTarget),
          query: args.query,
          sources: args.sources?.map(
            (entry) => entry.toUpperCase() as "DOCS" | "CODE" | "SYMBOL",
          ),
          kind: toSearchSymbolsKind(args.kind),
          category: toSymbolCategory(args.category),
          pathPrefix: args.path_prefix,
          fileIntent: toSearchSymbolsFileIntent(args.file_intent),
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
          built.defaulted,
          outcome,
        );
        return textResult(JSON.stringify(payload));
      } catch (error) {
        return errorResult(
          JSON.stringify(buildUnifiedSearchErrorPayload(error)),
        );
      }
    },
  };
}

function isResolvedCodeTarget(
  target: ReturnType<typeof resolveCodeTarget>,
): target is ResolvedCodeTarget {
  return !("content" in target);
}
