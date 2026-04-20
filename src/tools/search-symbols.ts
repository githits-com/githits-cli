import { z } from "zod";
import type { CodeNavigationService } from "../services/index.js";
import {
  toSearchSymbolsFileIntent,
  toSearchSymbolsKind,
  toSearchSymbolsMatchMode,
  toSymbolCategory,
} from "../shared/code-navigation.js";
import { FILE_INTENT_ALL } from "../shared/code-navigation-defaults.js";
import { buildSearchSymbolsParams } from "../shared/search-symbols-request.js";
import {
  buildSearchSymbolsErrorPayload,
  buildSearchSymbolsSuccessPayload,
} from "../shared/search-symbols-response.js";
import {
  type CodeTargetArg,
  codeTargetSchema,
  resolveCodeTarget,
} from "./code-navigation-shared.js";
import { errorResult, type ToolDefinition, textResult } from "./types.js";

export interface SearchSymbolsArgs {
  target: CodeTargetArg;
  query?: string;
  keywords?: string[];
  match_mode?: "or" | "and";
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
  file_path?: string;
  limit?: number;
  file_intent?:
    | "production"
    | "test"
    | "benchmark"
    | "example"
    | "generated"
    | "fixture"
    | "build"
    | "vendor"
    | "all";
  wait_timeout_ms?: number;
}

const schema = {
  target: codeTargetSchema,
  query: z
    .string()
    .max(500)
    .optional()
    .describe(
      "Search keywords - exact source tokens, not natural language. Required if keywords not provided.",
    ),
  keywords: z
    .array(z.string())
    .max(20)
    .optional()
    .describe(
      "Search keywords (max 20). Combined using match_mode. Can be used alone or together with query.",
    ),
  match_mode: z
    .enum(["or", "and"])
    .optional()
    .describe("How to combine keywords: or (any match) or and (all match)"),
  category: z
    .enum(["callable", "type", "module", "data", "documentation"])
    .optional()
    .describe(
      "Broad symbol category filter — the preferred surface for filtering. callable (function/method/constructor/getter/setter/operator), type (class/interface/trait/struct/enum/record/protocol/extension/etc.), module (module/namespace/package/object), data (field/property/event/constant), documentation (doc_section).",
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
      "Precise symbol kind filter. Prefer `category` for broad filtering; use `kind` only when you need a specific construct (e.g. trait vs interface).",
    ),
  file_path: z
    .string()
    .optional()
    .describe(
      "Filter results to files whose path starts with this value (e.g., 'src/' for a directory)",
    ),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(50)
    .optional()
    .describe("Max results to return (max 50)"),
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
      "all",
    ])
    .optional()
    .describe(
      "File intent filter. Defaults to 'production' so top results are production source. Pass 'all' to include tests, benchmarks, examples, and other non-production files.",
    ),
  wait_timeout_ms: z.coerce
    .number()
    .int()
    .min(0)
    .max(60000)
    .optional()
    .describe(
      "Max milliseconds to wait for indexing before returning. Defaults to 20000 (20 seconds) to cover typical indexing (p50 ~11s). On an INDEXING response, retry with wait_timeout_ms up to 60000 to block until ready.",
    ),
};

const DESCRIPTION =
  "Search a dependency's source code by exact-token matches. Use for symbol lookup, not natural-language questions. " +
  "Package scope: pass target.registry + target.package_name. Repo scope: pass target.repo_url + target.git_ref. " +
  "`file_intent` defaults to 'production' so top results are production source; pass 'all' to include tests, examples, benchmarks. " +
  "`query` and `keywords` can combine; `match_mode` controls AND vs OR across keywords. " +
  "Filter by `category` (broad: callable/type/module/data/documentation — preferred) or `kind` (precise construct like trait/record/namespace). " +
  "Prefer `file_path` to scope to a directory (e.g., 'src/'). " +
  "Responses include each match's source code, line range, and unified `kind`/`category` classification. " +
  "If the response is an INDEXING error, the package is being indexed on-demand — retry the same call with `wait_timeout_ms: 60000` to block until ready.";

export function createSearchSymbolsTool(
  service: CodeNavigationService,
): ToolDefinition<SearchSymbolsArgs, typeof schema> {
  return {
    name: "search_symbols",
    description: DESCRIPTION,
    schema,
    annotations: { readOnlyHint: true },
    handler: async (args) => {
      const target = resolveCodeTarget(args.target);
      if ("content" in target) return target;

      if (!args.query && (!args.keywords || args.keywords.length === 0)) {
        // Emit a valid-JSON error payload so MCP clients can always
        // parse `content[0].text` (PARITY-ERROR-ENVELOPE).
        return errorResult(
          JSON.stringify({
            error: "Provide either query or keywords.",
            code: "INVALID_ARGUMENT",
          }),
        );
      }

      try {
        const { params, defaulted } = buildSearchSymbolsParams({
          target,
          query: args.query,
          keywords: args.keywords,
          matchMode: toSearchSymbolsMatchMode(args.match_mode),
          kind: toSearchSymbolsKind(args.kind),
          category: toSymbolCategory(args.category),
          filePath: args.file_path,
          limit: args.limit,
          fileIntent:
            args.file_intent === "all"
              ? FILE_INTENT_ALL
              : toSearchSymbolsFileIntent(args.file_intent),
          waitTimeoutMs: args.wait_timeout_ms,
        });
        const result = await service.searchSymbols(params);
        const payload = buildSearchSymbolsSuccessPayload(
          params,
          defaulted,
          result,
        );
        return textResult(JSON.stringify(payload));
      } catch (error) {
        return errorResult(
          JSON.stringify(buildSearchSymbolsErrorPayload(error)),
        );
      }
    },
  };
}
