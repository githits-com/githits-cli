import type { MappedError } from "./code-navigation-error-map.js";

export function withReadFileRecovery(
  mapped: MappedError,
  requestedPath: string,
): MappedError {
  if (mapped.code !== "FILE_NOT_FOUND" && mapped.code !== "NOT_FOUND") {
    return mapped;
  }

  return {
    ...mapped,
    details: {
      ...mapped.details,
      action: buildReadFileNotFoundAction(requestedPath),
    },
  };
}

function buildReadFileNotFoundAction(requestedPath: string): string {
  const prefix = buildPathPrefixSuggestion(requestedPath);
  return (
    "`code_read` reads files only, not directories. " +
    `Use \`code_files\` with \`path_prefix: ${JSON.stringify(prefix)}\` ` +
    "to list candidate files, then pass an emitted `path` back to `code_read`."
  );
}

function buildPathPrefixSuggestion(requestedPath: string): string {
  const trimmed = requestedPath.trim();
  if (trimmed === "") return "";
  if (trimmed.endsWith("/")) return trimmed;

  const slash = trimmed.lastIndexOf("/");
  const basename = slash === -1 ? trimmed : trimmed.slice(slash + 1);
  if (!basename.includes(".")) return `${trimmed}/`;
  return slash === -1 ? "" : trimmed.slice(0, slash + 1);
}
