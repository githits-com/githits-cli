import type {
  CodeNavigationTarget,
  GrepPathSelectorKind,
  GrepRepoParams,
} from "../services/index.js";
import {
  DEFAULT_WAIT_TIMEOUT_MS,
  MAX_WAIT_TIMEOUT_MS,
} from "./code-navigation-defaults.js";
import { InvalidPackageSpecError } from "./package-spec.js";

const PATTERN_MAX = 200;
const CONTEXT_MIN = 0;
const CONTEXT_MAX = 10;
const LIMIT_MIN = 1;
const LIMIT_MAX = 1000;
const LIMIT_DEFAULT = 50;
const WAIT_MIN = 0;

export const GREP_REPO_PATTERN_NOTE =
  "Text grep over indexed source files. `literal` (default) does substring matching; `regex` uses RE2 syntax (no lookaround, no backreferences) and needs a literal anchor for indexed repo-wide searches. Pattern max 200 UTF-8 bytes; matching is ASCII case-insensitive by default.";

export interface GrepRepoRequestPathSelectorInput {
  kind: "exact" | "prefix" | "glob";
  value: string;
}

export interface GrepRepoRequestInput {
  target: CodeNavigationTarget;
  pattern: string;
  path?: string;
  pathPrefix?: string;
  globs?: string[];
  extensions?: string[];
  patternType?: "literal" | "regex";
  caseSensitive?: boolean;
  excludeDocFiles?: boolean;
  excludeTestFiles?: boolean;
  contextLines?: number;
  contextLinesBefore?: number;
  contextLinesAfter?: number;
  maxMatches?: number;
  maxMatchesPerFile?: number;
  cursor?: string;
  symbolFields?: string[];
  waitTimeoutMs?: number;
}

export interface GrepRepoRequestBuildResult {
  params: GrepRepoParams;
  explicit: {
    path: boolean;
    pathPrefix: boolean;
    globs: boolean;
    extensions: boolean;
    patternType: boolean;
    caseSensitive: boolean;
    excludeDocFiles: boolean;
    excludeTestFiles: boolean;
    contextLines: boolean;
    contextLinesBefore: boolean;
    contextLinesAfter: boolean;
    maxMatches: boolean;
    maxMatchesPerFile: boolean;
    cursor: boolean;
    symbolFields: boolean;
  };
}

export function buildGrepRepoParams(
  input: GrepRepoRequestInput,
): GrepRepoRequestBuildResult {
  const pattern = input.pattern ?? "";
  if (pattern.length === 0 || pattern.trim().length === 0) {
    throw new InvalidPackageSpecError(
      "`pattern` is required — pass the text to search for.",
    );
  }
  if (Buffer.byteLength(pattern, "utf8") > PATTERN_MAX) {
    throw new InvalidPackageSpecError(
      `\`pattern\` must be ≤ ${PATTERN_MAX} UTF-8 bytes.`,
    );
  }

  const path = normalizeOptionalNonEmpty(input.path, "path");
  const pathPrefix = normalizeOptionalNonEmpty(input.pathPrefix, "path_prefix");
  const globs = normalizeStringList(input.globs, "globs");
  const extensions = normalizeExtensions(input.extensions);

  const contextLines = normalizeOptionalContext(
    input.contextLines,
    "context_lines",
  );
  const contextLinesBefore = normalizeOptionalContext(
    input.contextLinesBefore,
    "context_lines_before",
  );
  const contextLinesAfter = normalizeOptionalContext(
    input.contextLinesAfter,
    "context_lines_after",
  );

  const resolvedBefore =
    contextLinesBefore ?? (contextLines !== undefined ? contextLines : 0);
  const resolvedAfter =
    contextLinesAfter ?? (contextLines !== undefined ? contextLines : 0);

  const maxMatches = normalizeMaxMatches(input.maxMatches);
  const maxMatchesPerFile = normalizeMaxMatchesPerFile(input.maxMatchesPerFile);
  const waitTimeoutMs = normalizeWaitTimeoutMs(input.waitTimeoutMs);
  const cursor = normalizeOptionalNonEmpty(input.cursor, "cursor");
  const symbolFields = normalizeStringList(input.symbolFields, "symbol_fields");

  const pathSelectors = buildPathSelectors({ path, pathPrefix, globs });
  const hasPathSelectors = (pathSelectors?.length ?? 0) > 0;

  return {
    params: {
      target: input.target,
      pattern,
      patternType:
        input.patternType === "regex"
          ? "REGEX"
          : input.patternType === "literal"
            ? "LITERAL"
            : undefined,
      caseSensitive: input.caseSensitive,
      pathSelectors,
      extensions,
      excludeDocFiles: input.excludeDocFiles,
      excludeTestFiles: input.excludeTestFiles,
      allowUnscoped: hasPathSelectors ? undefined : true,
      contextLinesBefore: resolvedBefore,
      contextLinesAfter: resolvedAfter,
      maxMatches,
      maxMatchesPerFile,
      cursor,
      symbolFields: symbolFields.length > 0 ? symbolFields : undefined,
      waitTimeoutMs,
    },
    explicit: {
      path: path !== undefined,
      pathPrefix: pathPrefix !== undefined,
      globs: globs.length > 0,
      extensions: extensions.length > 0,
      patternType: input.patternType !== undefined,
      caseSensitive: input.caseSensitive !== undefined,
      excludeDocFiles: input.excludeDocFiles !== undefined,
      excludeTestFiles: input.excludeTestFiles !== undefined,
      contextLines: input.contextLines !== undefined,
      contextLinesBefore: input.contextLinesBefore !== undefined,
      contextLinesAfter: input.contextLinesAfter !== undefined,
      maxMatches: input.maxMatches !== undefined,
      maxMatchesPerFile: input.maxMatchesPerFile !== undefined,
      cursor: cursor !== undefined,
      symbolFields: symbolFields.length > 0,
    },
  };
}

function buildPathSelectors(input: {
  path?: string;
  pathPrefix?: string;
  globs: string[];
}): GrepRepoParams["pathSelectors"] {
  const selectors: Array<{ kind: GrepPathSelectorKind; value: string }> = [];
  if (input.path) selectors.push({ kind: "EXACT", value: input.path });
  if (input.pathPrefix) {
    selectors.push({ kind: "PREFIX", value: input.pathPrefix });
  }
  for (const glob of input.globs) {
    selectors.push({ kind: "GLOB", value: glob });
  }
  return selectors.length > 0 ? selectors : undefined;
}

function normalizeOptionalNonEmpty(
  value: string | undefined,
  field: string,
): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new InvalidPackageSpecError(
      `\`${field}\` cannot be empty when provided.`,
    );
  }
  return trimmed;
}

function normalizeStringList(
  values: string[] | undefined,
  field: string,
): string[] {
  if (!values) return [];
  const out: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      throw new InvalidPackageSpecError(
        `\`${field}\` entries cannot be empty.`,
      );
    }
    out.push(trimmed);
  }
  return out;
}

function normalizeExtensions(values: string[] | undefined): string[] {
  const out = normalizeStringList(values, "extensions");
  for (const value of out) {
    if (value.startsWith(".")) {
      throw new InvalidPackageSpecError(
        "`extensions` values must not include a leading dot.",
      );
    }
  }
  return out;
}

function normalizeOptionalContext(
  value: number | undefined,
  field: string,
): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || value < CONTEXT_MIN || value > CONTEXT_MAX) {
    throw new InvalidPackageSpecError(
      `\`${field}\` must be an integer between ${CONTEXT_MIN} and ${CONTEXT_MAX}. Got ${value}.`,
    );
  }
  return value;
}

function normalizeMaxMatches(value: number | undefined): number {
  if (value === undefined) return LIMIT_DEFAULT;
  if (!Number.isInteger(value) || value < LIMIT_MIN || value > LIMIT_MAX) {
    throw new InvalidPackageSpecError(
      `\`max_matches\` must be an integer between ${LIMIT_MIN} and ${LIMIT_MAX}. Got ${value}.`,
    );
  }
  return value;
}

function normalizeMaxMatchesPerFile(
  value: number | undefined,
): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || value < 0 || value > LIMIT_MAX) {
    throw new InvalidPackageSpecError(
      `\`max_matches_per_file\` must be an integer between 0 and ${LIMIT_MAX}. Got ${value}.`,
    );
  }
  return value;
}

function normalizeWaitTimeoutMs(value: number | undefined): number {
  if (value === undefined) return DEFAULT_WAIT_TIMEOUT_MS;
  if (
    !Number.isInteger(value) ||
    value < WAIT_MIN ||
    value > MAX_WAIT_TIMEOUT_MS
  ) {
    throw new InvalidPackageSpecError(
      `\`wait_timeout_ms\` must be an integer between ${WAIT_MIN} and ${MAX_WAIT_TIMEOUT_MS}. Got ${value}.`,
    );
  }
  return value;
}
