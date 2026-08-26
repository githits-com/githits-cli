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
} from "@githits/core-internal";
import {
  buildContainingPathPrefix,
  buildPathPrefixSuggestion,
  InvalidPackageSpecError,
  isExactPathAuthorityError,
  looksLikeMissingFileMessage,
  type MappedError,
  parseCodeNavigationTargetSpec,
} from "@githits/mcp/internal";
import { mapCodeNavigationErrorForCli } from "../../shared/cli-error-diagnostics.js";
import {
  buildCliMappedErrorPayload,
  formatMappedErrorForTerminal,
} from "../format-mapped-error.js";

export { parseIntCliOption } from "../../shared/cli-options.js";

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
 * and `--repo-url <url> [--git-ref <ref>]` mode are mutually
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
      "Provide either a package spec (e.g. `npm:express`) or `--repo-url` with optional `--git-ref`, not both.",
    );
  }
  if (!hasSpec && !hasRepoUrl) {
    throw new InvalidPackageSpecError(
      "A package spec (e.g. `npm:express`) or `--repo-url` is required.",
    );
  }
  if (hasSpec) {
    return parseCodeNavigationTargetSpec(spec as string);
  }

  return {
    repoUrl: options.repoUrl,
    gitRef: options.gitRef,
  };
}

/**
 * Render the `INDEXING` error for terminal output — surfaces
 * `indexingRef` + a sample of `availableVersions` as dimmed
 * detail lines under the error message.
 *
 * Shared by human `search` / `search-status` errors and the indexed
 * `code files` / `code read` / `code grep` commands.
 */
export function formatIndexingError(mapped: MappedError): string {
  if (mapped.code === "UPDATE_REQUIRED") {
    return formatMappedErrorForTerminal(mapped);
  }
  if (mapped.code !== "INDEXING") return formatMappedErrorForTerminal(mapped);
  const detail = mapped.details ?? {};
  const lines = [mapped.message];
  if (detail.hint && !mapped.message.includes(detail.hint)) {
    lines.push(`  hint: ${detail.hint}`);
  }
  if (detail.indexingRef) lines.push(`  indexing ref: ${detail.indexingRef}`);
  const estimate = detail.indexingEstimate;
  if (estimate) {
    const bounds =
      typeof estimate.lowerSeconds === "number" &&
      typeof estimate.upperSeconds === "number"
        ? `${estimate.lowerSeconds}-${estimate.upperSeconds}s`
        : undefined;
    const elapsed =
      typeof estimate.elapsedSeconds === "number"
        ? `${estimate.elapsedSeconds}s elapsed`
        : undefined;
    const summary = [bounds, elapsed].filter(Boolean).join(", ");
    if (summary) lines.push(`  indexing estimate: ${summary}`);
  }
  const versions = detail.availableVersions;
  if (versions && versions.length > 0) {
    const shown = versions
      .slice(0, 5)
      .map((entry) => entry.version ?? entry.ref)
      .join(", ");
    const more = versions.length - 5;
    const suffix = more > 0 ? ` (+${more} more)` : "";
    lines.push(`  indexed refs/versions: ${shown}${suffix}`);
  }
  const refs = detail.availableRefs;
  if (refs && refs.length > 0) {
    const shown = refs
      .slice(0, 5)
      .map((entry) => entry.ref)
      .join(", ");
    const more = refs.length - 5;
    const suffix = more > 0 ? ` (+${more} more)` : "";
    lines.push(`  indexed refs: ${shown}${suffix}`);
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
    return `${formatMappedErrorForTerminal(mapped)}\n  Use \`code files\` to list available paths.`;
  }
  if (isExactPathAuthorityError(mapped)) {
    const guidance =
      mapped.code === "FILE_PATH_EXCLUDED"
        ? "This path is excluded from the indexed source; use `code files` to list indexed paths."
        : "The source inventory cannot verify this path; use `code files` to list indexed paths it can currently verify.";
    return `${formatMappedErrorForTerminal(mapped)}\n  ${guidance}`;
  }
  if (
    mapped.code === "NOT_FOUND" &&
    looksLikeMissingFileMessage(mapped.message)
  ) {
    return `${formatMappedErrorForTerminal(mapped)}\n  Use \`code files\` to list available paths.`;
  }
  if (mapped.code === "REF_NOT_FOUND") {
    return `${formatMappedErrorForTerminal(mapped)}\n  Check that the repository URL and git ref exist and are publicly accessible.`;
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
    return `${formatMappedErrorForTerminal(mapped)}\n  ${retry}`;
  }
  return formatIndexingError(mapped);
}

/** Add CLI-native structured recovery for a missing `code read` path. */
export function withCliReadFileRecovery(
  mapped: MappedError,
  requestedPath: string,
): MappedError {
  if (isExactPathAuthorityError(mapped)) {
    return withCliExactPathAuthorityRecovery(mapped, "read");
  }

  if (
    mapped.code !== "FILE_NOT_FOUND" &&
    (mapped.code !== "NOT_FOUND" ||
      !looksLikeMissingFileMessage(mapped.message))
  ) {
    return mapped;
  }

  return withCliPathRecovery(
    mapped,
    mapped.details?.filePath ?? requestedPath,
    "read",
    mapped.code === "FILE_NOT_FOUND",
  );
}

/** Add CLI-native structured recovery for an exact-path `code grep` miss. */
export function withCliGrepFileRecovery(mapped: MappedError): MappedError {
  if (isExactPathAuthorityError(mapped)) {
    return withCliExactPathAuthorityRecovery(mapped, "grep");
  }

  if (
    mapped.code !== "FILE_NOT_FOUND" ||
    mapped.details?.filePath === undefined
  ) {
    return mapped;
  }

  return withCliPathRecovery(mapped, mapped.details.filePath, "grep", true);
}

function withCliExactPathAuthorityRecovery(
  mapped: MappedError,
  command: "read" | "grep",
): MappedError {
  if (
    !isExactPathAuthorityError(mapped) ||
    mapped.details?.filePath === undefined
  ) {
    return mapped;
  }

  const prefix = buildContainingPathPrefix(mapped.details.filePath);
  const listing =
    prefix === ""
      ? "Use `githits code files` without a path prefix"
      : `Use \`githits code files\` with path prefix ${JSON.stringify(prefix)}`;
  const reason =
    mapped.code === "FILE_PATH_EXCLUDED"
      ? "This path is excluded from the indexed source."
      : "The source inventory cannot verify this path.";
  return {
    ...mapped,
    details: {
      ...mapped.details,
      action:
        `${reason} ${listing} to list indexed paths available to ` +
        `\`githits code ${command}\`.`,
    },
  };
}

function withCliPathRecovery(
  mapped: MappedError,
  requestedPath: string,
  command: "read" | "grep",
  exactFilePath: boolean,
): MappedError {
  const prefix = exactFilePath
    ? buildContainingPathPrefix(requestedPath)
    : buildPathPrefixSuggestion(requestedPath);
  const handoff =
    command === "grep"
      ? "pass an emitted path as `--path <path>` to `githits code grep`."
      : "pass an emitted path to `githits code read`.";
  const readPreamble =
    command === "read"
      ? exactFilePath
        ? "`githits code read` requires an indexed exact file path. "
        : "`githits code read` reads files only, not directories. "
      : "";
  const listing =
    prefix === ""
      ? "Use `githits code files` without a path prefix"
      : `Use \`githits code files\` with path prefix ${JSON.stringify(prefix)}`;

  return {
    ...mapped,
    details: {
      ...mapped.details,
      action: `${readPreamble}${listing} to list valid indexed paths, then ${handoff}`,
    },
  };
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
  const mapped = mapMappedError(mapCodeNavigationErrorForCli(error));
  if (json) {
    // eslint-disable-next-line no-console
    console.error(JSON.stringify(buildCliMappedErrorPayload(mapped)));
    process.exit(exitCode);
  }
  // eslint-disable-next-line no-console
  console.error(terminalRenderer(mapped));
  process.exit(exitCode);
}
