import type { MappedError } from "./mapped-error.js";

/** Add MCP-native path discovery guidance for an exact-path grep miss. */
export function withGrepFileRecovery(mapped: MappedError): MappedError {
  if (isExactPathAuthorityError(mapped)) {
    return withExactPathAuthorityRecovery(mapped, "grep");
  }

  if (
    mapped.code !== "FILE_NOT_FOUND" ||
    mapped.details?.filePath === undefined
  ) {
    return mapped;
  }

  const prefix = buildContainingPathPrefix(mapped.details.filePath);
  const listing =
    prefix === ""
      ? "Use `code_files` without `path_prefix`"
      : `Use \`code_files\` with \`path_prefix: ${JSON.stringify(prefix)}\``;
  return {
    ...mapped,
    details: {
      ...mapped.details,
      action:
        `${listing} to list valid indexed paths, then pass an emitted \`path\` ` +
        "back to `code_grep`.",
    },
  };
}

/** Whether the backend gave an authoritative reason an exact path is unavailable. */
export function isExactPathAuthorityError(mapped: MappedError): boolean {
  return (
    mapped.code === "FILE_PATH_EXCLUDED" ||
    mapped.code === "SOURCE_FILE_INVENTORY_UNKNOWN"
  );
}

/** Add MCP-native path discovery guidance for exact-path authority errors. */
export function withExactPathAuthorityRecovery(
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
      ? "Use `code_files` without `path_prefix`"
      : `Use \`code_files\` with \`path_prefix: ${JSON.stringify(prefix)}\``;
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
        `\`code_${command}\`.`,
    },
  };
}

/** Derive the containing directory prefix from a confirmed exact file path. */
export function buildContainingPathPrefix(filePath: string): string {
  const trimmed = filePath.trim();
  const slash = trimmed.lastIndexOf("/");
  return slash === -1 ? "" : trimmed.slice(0, slash + 1);
}

/** Derive a directory prefix when a legacy missing path may itself be a directory. */
export function buildPathPrefixSuggestion(requestedPath: string): string {
  const trimmed = requestedPath.trim();
  if (trimmed === "") return "";
  if (trimmed.endsWith("/")) return trimmed;

  const slash = trimmed.lastIndexOf("/");
  const basename = slash === -1 ? trimmed : trimmed.slice(slash + 1);
  if (!basename.includes(".")) return `${trimmed}/`;
  return slash === -1 ? "" : trimmed.slice(0, slash + 1);
}

/** Identify legacy generic NOT_FOUND prose that specifically describes a file path. */
export function looksLikeMissingFileMessage(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("file not found") ||
    lower.includes("path not found") ||
    lower.includes("path doesn't resolve") ||
    lower.includes("path does not resolve")
  );
}
