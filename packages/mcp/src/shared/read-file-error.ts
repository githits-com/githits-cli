import type { MappedError } from "./code-navigation-error-map.js";
import {
  buildContainingPathPrefix,
  buildPathPrefixSuggestion,
  looksLikeMissingFileMessage,
} from "./file-path-recovery.js";

export function withReadFileRecovery(
  mapped: MappedError,
  requestedPath: string,
): MappedError {
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

function buildReadFileNotFoundAction(
  requestedPath: string,
  exactFilePath: boolean,
): string {
  const prefix = exactFilePath
    ? buildContainingPathPrefix(requestedPath)
    : buildPathPrefixSuggestion(requestedPath);
  const preamble = exactFilePath
    ? "`code_read` requires an indexed exact file path. "
    : "`code_read` reads files only, not directories. ";
  const listing =
    prefix === ""
      ? "Use `code_files` without `path_prefix`"
      : `Use \`code_files\` with \`path_prefix: ${JSON.stringify(prefix)}\``;
  return (
    `${preamble}${listing} to list valid indexed paths, then ` +
    "pass an emitted `path` back to `code_read`."
  );
}
