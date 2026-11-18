import {
  buildContainingPathPrefix,
  buildPathPrefixSuggestion,
  isExactPathAuthorityError,
  looksLikeMissingFileMessage,
  withExactPathAuthorityRecovery,
} from "./file-path-recovery.js";
import type { MappedError } from "./mapped-error.js";
import { shellQuoteExact } from "./shell-quote.js";

export function withReadFileRecovery(
  mapped: MappedError,
  requestedPath: string,
): MappedError {
  if (isExactPathAuthorityError(mapped)) {
    return withExactPathAuthorityRecovery(mapped);
  }

  if (
    mapped.code !== "FILE_NOT_FOUND" &&
    (mapped.code !== "NOT_FOUND" ||
      !looksLikeMissingFileMessage(mapped.message))
  ) {
    return mapped;
  }

  const recoveryPath = mapped.details?.filePath ?? requestedPath;
  return {
    ...mapped,
    details: {
      ...mapped.details,
      action: buildReadFileNotFoundAction(
        recoveryPath,
        mapped.code === "FILE_NOT_FOUND",
      ),
    },
  };
}

/** Shared missing-file wording; callers retain their existing error classification. */
export function buildReadFileNotFoundAction(
  requestedPath: string,
  exactFilePath: boolean,
  syntax: "mcp" | "cli" = "mcp",
): string {
  const prefix = exactFilePath
    ? buildContainingPathPrefix(requestedPath)
    : buildPathPrefixSuggestion(requestedPath);
  const listing =
    syntax === "cli"
      ? `Use \`githits list <target>${prefix ? ` ${prefix.startsWith("-") ? "-- " : ""}${shellQuoteExact(prefix)}` : ""}\``
      : prefix === ""
        ? "Use `list` without `paths`"
        : `Use \`list\` with \`paths: ${JSON.stringify([prefix])}\``;
  const read = syntax === "cli" ? "githits read" : "read";
  return `${listing}, then \`${read}\` a returned file path.`;
}
