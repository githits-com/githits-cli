/** Translate verified preparation reasons without mislabeling resolution failures. */
export function grepPreparationReason(reason: string): string {
  switch (reason) {
    case "repository_indexing":
      return "repository is being indexed";
    case "documentation_publishing":
      return "documentation is being prepared";
    case "no_grep_scopes":
      return "no searchable source or documentation is available";
    default:
      return reason;
  }
}
