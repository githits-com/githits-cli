import type {
  CodeNavigationTarget,
  SearchSymbolsFileIntent,
  SearchSymbolsKind,
  SearchSymbolsMatchMode,
  SearchSymbolsParams,
  SymbolCategory,
} from "../services/index.js";
import {
  DEFAULT_WAIT_TIMEOUT_MS,
  FILE_INTENT_ALL,
  type FileIntentInput,
  SEARCH_SYMBOLS_DEFAULT_FILE_INTENT,
} from "./code-navigation-defaults.js";

/**
 * Caller-facing, surface-agnostic input to `search_symbols`. Both the
 * CLI command and the MCP tool normalise their respective arguments
 * into this shape before invoking `buildSearchSymbolsParams`, so the
 * two surfaces cannot diverge on default application or semantic
 * translation.
 *
 * `fileIntent` is tri-valued: specific intent, `FILE_INTENT_ALL`
 * (caller asked for all), or `undefined` (caller omitted the field —
 * the builder fills in the default).
 */
export interface SearchSymbolsRequestInput {
  target: CodeNavigationTarget;
  query?: string;
  keywords?: string[];
  matchMode?: SearchSymbolsMatchMode;
  kind?: SearchSymbolsKind;
  category?: SymbolCategory;
  filePath?: string;
  limit?: number;
  fileIntent?: FileIntentInput;
  waitTimeoutMs?: number;
}

/**
 * Result of building a search-symbols request. The `params` object is
 * ready to hand to `CodeNavigationService.searchSymbols`; the
 * `defaulted` array lists the fields whose values were filled in by
 * this builder rather than supplied by the caller, for inclusion in
 * the surface's `query.defaulted` echo on the JSON envelope.
 */
export interface SearchSymbolsRequestBuildResult {
  params: SearchSymbolsParams;
  defaulted: ReadonlyArray<"fileIntent" | "waitTimeoutMs">;
}

/**
 * Build a `SearchSymbolsParams` object from caller-facing input.
 *
 * Responsibilities:
 * - Fill in defaults for `fileIntent` and `waitTimeoutMs`.
 * - Translate the `FILE_INTENT_ALL` sentinel to "omit the GraphQL
 *   variable" by leaving `fileIntent: undefined` on the outgoing
 *   params — omission returns all intents on the live backend.
 * - Record which fields were defaulted so the surface can mark them
 *   in its JSON echo.
 *
 * Shared between CLI and MCP per PARITY-REQUEST and PARITY-DEFAULTS.
 */
export function buildSearchSymbolsParams(
  input: SearchSymbolsRequestInput,
): SearchSymbolsRequestBuildResult {
  const defaulted: Array<"fileIntent" | "waitTimeoutMs"> = [];

  const resolvedFileIntent = resolveFileIntent(input.fileIntent, defaulted);
  const resolvedWaitTimeoutMs = resolveWaitTimeoutMs(
    input.waitTimeoutMs,
    defaulted,
  );

  return {
    params: {
      target: input.target,
      query: input.query,
      keywords: input.keywords,
      matchMode: input.matchMode,
      kind: input.kind,
      category: input.category,
      filePath: input.filePath,
      limit: input.limit,
      fileIntent: resolvedFileIntent,
      waitTimeoutMs: resolvedWaitTimeoutMs,
    },
    defaulted,
  };
}

function resolveFileIntent(
  input: FileIntentInput,
  defaulted: Array<"fileIntent" | "waitTimeoutMs">,
): SearchSymbolsFileIntent | undefined {
  if (input === FILE_INTENT_ALL) {
    // Caller asked for all intents; send no filter to the backend.
    return undefined;
  }
  if (input === undefined) {
    defaulted.push("fileIntent");
    return SEARCH_SYMBOLS_DEFAULT_FILE_INTENT;
  }
  return input;
}

function resolveWaitTimeoutMs(
  input: number | undefined,
  defaulted: Array<"fileIntent" | "waitTimeoutMs">,
): number {
  if (input === undefined) {
    defaulted.push("waitTimeoutMs");
    return DEFAULT_WAIT_TIMEOUT_MS;
  }
  return input;
}
