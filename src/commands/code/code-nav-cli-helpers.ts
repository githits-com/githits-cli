/**
 * Shared CLI helpers for the indexed `code files` / `code read`
 * / `code grep` commands. Each command parses its own positionals
 * (because the shape varies — `[spec] [path]` vs `[spec] [pattern]
 * [path]`), but addressing resolution, numeric-option parsing, and
 * error-envelope rendering are all identical across them.
 *
 * Extracted once three verbatim copies had accumulated.
 */

import type {
  CodeNavigationService,
  CodeNavigationTarget,
} from "../../services/index.js";
import {
  formatMappedErrorForTerminal,
  type MappedError,
  mapCodeNavigationError,
} from "../../shared/code-navigation-error-map.js";
import {
  InvalidPackageSpecError,
  parsePackageSpec,
  toPkgseerRegistry,
} from "../../shared/index.js";

/**
 * Fields every indexed `code` command shares.
 */
export interface SharedCodeNavCliDependencies {
  codeNavigationService: CodeNavigationService | undefined;
  codeNavigationUrl: string | undefined;
  hasValidToken: boolean;
  mcpUrl: string;
}

/**
 * Fields every indexed `code` command's options carry.
 */
export interface SharedCodeNavCliOptions {
  repoUrl?: string;
  gitRef?: string;
}

/**
 * Resolve a `CodeNavigationTarget` from CLI input. `<spec>` mode
 * and `--repo-url <url> --git-ref <ref>` mode are mutually
 * exclusive; each command parses its own positionals and calls
 * this with the resolved spec string (or `undefined` in repo-URL
 * mode).
 */
export function resolveCliCodeNavTarget(
  spec: string | undefined,
  options: SharedCodeNavCliOptions,
): CodeNavigationTarget {
  const hasSpec = Boolean(spec);
  const hasRepoUrl = Boolean(options.repoUrl);
  const hasGitRef = Boolean(options.gitRef);

  if (hasSpec && (hasRepoUrl || hasGitRef)) {
    throw new InvalidPackageSpecError(
      "Provide either a package spec (e.g. `npm:express`) or `--repo-url` + `--git-ref`, not both.",
    );
  }
  if (!hasSpec && !hasRepoUrl) {
    throw new InvalidPackageSpecError(
      "A package spec (e.g. `npm:express`) or `--repo-url` + `--git-ref` is required.",
    );
  }
  if (hasRepoUrl && !hasGitRef) {
    throw new InvalidPackageSpecError(
      "`--repo-url` requires `--git-ref` for code files/read/grep (a tag, branch, commit, or `HEAD`).",
    );
  }

  if (hasSpec) {
    const parsed = parsePackageSpec(spec as string);
    return {
      registry: toPkgseerRegistry(parsed.registry),
      packageName: parsed.name,
      version: parsed.version,
    };
  }

  return {
    repoUrl: options.repoUrl,
    gitRef: options.gitRef,
  };
}

/**
 * Parse an optional `--flag N` integer option with bounds.
 * Returns `undefined` when the caller didn't supply the flag.
 * Throws `InvalidPackageSpecError` on non-integer or out-of-range
 * input so the error classifier routes to `INVALID_ARGUMENT`.
 */
export function parseIntCliOption(
  raw: string | undefined,
  name: string,
  min: number,
  max: number,
): number | undefined {
  if (raw === undefined) return undefined;
  if (!/^-?\d+$/.test(raw.trim())) {
    throw new InvalidPackageSpecError(
      `${name} expects an integer between ${min} and ${max}. Got '${raw}'.`,
    );
  }
  const parsed = Number.parseInt(raw, 10);
  if (parsed < min || parsed > max) {
    throw new InvalidPackageSpecError(
      `${name} expects an integer between ${min} and ${max}. Got ${parsed}.`,
    );
  }
  return parsed;
}

/**
 * Render the `INDEXING` error for terminal output — surfaces
 * `indexingRef` + a sample of `availableVersions` as dimmed
 * detail lines under the error message.
 *
 * Common to `code files` / `code read` / `code grep` since all three
 * share the same indexing-retry story.
 */
export function formatIndexingError(mapped: MappedError): string {
  if (mapped.code === "UPDATE_REQUIRED") {
    return formatMappedErrorForTerminal(mapped);
  }
  if (mapped.code !== "INDEXING") return mapped.message;
  const detail = mapped.details ?? {};
  const lines = [mapped.message];
  if (detail.indexingRef) lines.push(`  indexingRef: ${detail.indexingRef}`);
  const versions = detail.availableVersions;
  if (versions && versions.length > 0) {
    const shown = versions
      .slice(0, 5)
      .map((entry) => entry.version ?? entry.ref)
      .join(", ");
    const more = versions.length - 5;
    const suffix = more > 0 ? ` (+${more} more)` : "";
    lines.push(`  already-indexed versions: ${shown}${suffix}`);
  }
  return lines.join("\n");
}

/**
 * Terminal error renderer for `code read` / `code grep`. Adds the
 * `code files` recovery hint for concrete missing-path cases, even
 * when the backend still collapses them into generic `NOT_FOUND`.
 * Leaves unrelated repository / indexing-state `NOT_FOUND` errors
 * alone so we don't send users toward path debugging for the wrong
 * class of failure.
 */
export function formatFileErrorWithFilesHint(mapped: MappedError): string {
  if (mapped.code === "UPDATE_REQUIRED") {
    return formatMappedErrorForTerminal(mapped);
  }
  if (mapped.code === "FILE_NOT_FOUND") {
    return `${mapped.message}\n  Use \`code files\` to list available paths.`;
  }
  if (
    mapped.code === "NOT_FOUND" &&
    looksLikeMissingFileMessage(mapped.message)
  ) {
    return `${mapped.message}\n  Use \`code files\` to list available paths.`;
  }
  if (looksLikeMissingNavpackMessage(mapped.message)) {
    return [
      "Source index for this target is temporarily unavailable.",
      "  Retry with `--wait 60000`, use an already-indexed version/ref, or try again later.",
    ].join("\n");
  }
  if (mapped.code === "BACKEND_ERROR") {
    const retry = mapped.retryable
      ? "Retry in a moment; if it persists, narrow the target or file an issue."
      : "Narrow the target (path, path-prefix, glob) and retry; if it persists, file an issue.";
    return `${mapped.message}\n  ${retry}`;
  }
  return formatIndexingError(mapped);
}

function looksLikeMissingFileMessage(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("file not found") ||
    lower.includes("path not found") ||
    lower.includes("path doesn't resolve") ||
    lower.includes("path does not resolve")
  );
}

function looksLikeMissingNavpackMessage(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("has no navpack for this ref") ||
    lower.includes("navpack was pruned") ||
    lower.includes("indexedrepository row still claims current state")
  );
}

/**
 * Shared error-printing + `process.exit` path used by every
 * indexed `code` command. JSON callers get the shared
 * `{error, code, retryable, details?}` envelope on stderr;
 * terminal callers get a per-command renderer wrapper.
 *
 * Each command passes its own `terminalRenderer` so the hint
 * message can differ (e.g. `code files` doesn't need the
 * `code files`-as-recovery hint; `code read` / `code grep` do).
 *
 * `exitCode` defaults to 1; `code grep` overrides to 2 so callers
 * can distinguish "no matches" (exit 1, `grep` convention) from
 * "error" (exit 2).
 */
export function handleCodeNavCommandError(
  error: unknown,
  json: boolean,
  terminalRenderer: (mapped: MappedError) => string,
  exitCode = 1,
  mapMappedError: (mapped: MappedError) => MappedError = (mapped) => mapped,
): never {
  const mapped = mapMappedError(mapCodeNavigationError(error));
  if (json) {
    // eslint-disable-next-line no-console
    console.error(
      JSON.stringify({
        error: mapped.message,
        code: mapped.code,
        retryable: mapped.retryable ?? false,
        ...(mapped.details ? { details: mapped.details } : {}),
      }),
    );
    process.exit(exitCode);
  }
  // eslint-disable-next-line no-console
  console.error(terminalRenderer(mapped));
  process.exit(exitCode);
}
