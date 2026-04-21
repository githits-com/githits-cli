/**
 * Shared request builder for `grep_file`. CLI and MCP normalise
 * inputs here so the two surfaces cannot diverge on pattern /
 * context / match-count bounds.
 *
 * The `path` argument deliberately keeps its generic name (rather
 * than `file_path`) to leave room for broader shapes later; today
 * it addresses a single file.
 */

import type {
  CodeNavigationTarget,
  GrepFileParams,
} from "../services/index.js";
import { DEFAULT_WAIT_TIMEOUT_MS } from "./code-navigation-defaults.js";
import { InvalidPackageSpecError } from "./package-spec.js";

const PATTERN_MAX = 200;
const CONTEXT_MIN = 0;
const CONTEXT_MAX = 10;
// Default is no context — matches-only output stays pipe-friendly
// (`grep -o`-style) and token-efficient for agents. Callers opt into
// context explicitly.
const CONTEXT_DEFAULT = 0;
const LIMIT_MIN = 1;
const LIMIT_MAX = 200;
const LIMIT_DEFAULT = 50;
const WAIT_MIN = 0;
const WAIT_MAX = 60_000;

/**
 * The pattern-semantics disclosure. Shared verbatim across the MCP
 * tool description, the MCP `pattern` arg describe, and the CLI
 * help text so the three surfaces never disagree.
 */
export const GREP_PATTERN_SEMANTICS_NOTE =
  "Case-insensitive substring matching. NOT regex — `\\b`, `^`, `.`, etc. match literally. Max 200 characters.";

/**
 * Regex-like metacharacters that almost always signal a deliberate
 * regex attempt. Bare `.`, `*`, `+`, `?`, `^`, `$`, `|`, `(`, `)`
 * are intentionally NOT in this set — they show up in ordinary
 * filenames / words / code fragments (`foo.bar`, `*.js`, `$foo`,
 * `middleware()`, `a|b`), and firing the hint on those would
 * create noise.
 *
 * Covered (deliberate regex signals only):
 * - Escape classes: `\b \B \w \W \d \D \s \S`.
 * - Escaped regex metacharacters: `\. \/ \( \) \[ \] \{ \} \+ \*
 *   \? \^ \$ \|` — these are almost never intentional literal
 *   searches; the user is escaping because they know regex syntax.
 * - Double backslash (raw regex string common form).
 * - Character class: `[...]`.
 * - Non-capturing / lookaround / named group / inline flags:
 *   `(?:...)`, `(?=...)`, `(?!...)`, `(?<=...)`, `(?<!...)`,
 *   `(?<name>...)`, `(?i)` etc.
 * - Brace quantifier: `{N}`, `{N,}`, `{N,M}`.
 *
 * Best-effort: a pattern like `foo|bar` or `^start` won't fire,
 * but the backend's "case-insensitive substring" hint still plays
 * on zero-match responses, so the user isn't left in the dark.
 */
const REGEX_SIGNAL_PATTERNS: readonly RegExp[] = [
  /\\[bBwWdDsS]/, // word/digit/whitespace/boundary escapes (both cases)
  /\\[./(){}[\]+*?^$|]/, // escaped regex metacharacters
  /\\\\/, // double backslash
  /\[[^\]]*\]/, // character class
  /\(\?[=!:<i-]/, // lookaround, non-capturing, named group, inline flags
  /\{\d+,?\d*\}/, // brace quantifier {N}, {N,}, {N,M}
];

export function looksLikeRegexAttempt(pattern: string): boolean {
  return REGEX_SIGNAL_PATTERNS.some((re) => re.test(pattern));
}

export interface GrepFileRequestInput {
  target: CodeNavigationTarget;
  path: string;
  pattern: string;
  contextLines?: number;
  maxMatches?: number;
  waitTimeoutMs?: number;
}

export interface GrepFileRequestBuildResult {
  params: GrepFileParams;
  contextLinesExplicit: boolean;
  maxMatchesExplicit: boolean;
}

export function buildGrepFileParams(
  input: GrepFileRequestInput,
): GrepFileRequestBuildResult {
  const path = input.path?.trim() ?? "";
  if (!path) {
    throw new InvalidPackageSpecError(
      "`path` is required — pass the path to the file within the package or repo.",
    );
  }

  const pattern = input.pattern ?? "";
  if (pattern.length === 0) {
    throw new InvalidPackageSpecError(
      "`pattern` is required — pass the substring to search for.",
    );
  }
  if (pattern.length > PATTERN_MAX) {
    throw new InvalidPackageSpecError(
      `\`pattern\` must be ≤ ${PATTERN_MAX} characters. Got ${pattern.length}.`,
    );
  }

  const contextLines = normaliseContextLines(input.contextLines);
  const maxMatches = normaliseMaxMatches(input.maxMatches);
  const waitTimeoutMs = normaliseWaitTimeoutMs(input.waitTimeoutMs);

  return {
    params: {
      target: input.target,
      path,
      pattern,
      contextLines,
      maxMatches,
      waitTimeoutMs,
    },
    contextLinesExplicit: input.contextLines !== undefined,
    maxMatchesExplicit: input.maxMatches !== undefined,
  };
}

function normaliseContextLines(raw: number | undefined): number {
  if (raw === undefined) return CONTEXT_DEFAULT;
  if (!Number.isInteger(raw) || raw < CONTEXT_MIN || raw > CONTEXT_MAX) {
    throw new InvalidPackageSpecError(
      `\`context_lines\` must be an integer between ${CONTEXT_MIN} and ${CONTEXT_MAX}. Got ${raw}.`,
    );
  }
  return raw;
}

function normaliseMaxMatches(raw: number | undefined): number {
  if (raw === undefined) return LIMIT_DEFAULT;
  if (!Number.isInteger(raw) || raw < LIMIT_MIN || raw > LIMIT_MAX) {
    throw new InvalidPackageSpecError(
      `\`max_matches\` must be an integer between ${LIMIT_MIN} and ${LIMIT_MAX}. Got ${raw}.`,
    );
  }
  return raw;
}

function normaliseWaitTimeoutMs(raw: number | undefined): number {
  if (raw === undefined) return DEFAULT_WAIT_TIMEOUT_MS;
  if (!Number.isInteger(raw) || raw < WAIT_MIN || raw > WAIT_MAX) {
    throw new InvalidPackageSpecError(
      `\`wait_timeout_ms\` must be an integer between ${WAIT_MIN} and ${WAIT_MAX}. Got ${raw}.`,
    );
  }
  return raw;
}
