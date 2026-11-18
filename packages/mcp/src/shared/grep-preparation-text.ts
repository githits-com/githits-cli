/** Name preparation work in a compact target row; raw reasons stay in JSON. */
export function grepPreparationState(reason: unknown): string {
  switch (reason) {
    case "repository_indexing":
      return "indexing";
    case "documentation_publishing":
    case "documentation_discovery":
    case "site_v6_required":
    case "starting_url_pending":
      return "preparing documentation";
    default:
      return "preparing";
  }
}

/** Translate known reasons; callers choose how to present unknown diagnostics. */
export function grepPreparationReason(reason: string): string {
  switch (reason) {
    case "repository_indexing":
      return "repository is being indexed";
    case "documentation_publishing":
      return "documentation is being prepared";
    case "no_grep_scopes":
      return "no searchable source or documentation is available";
    case "repository_not_found":
      return "repository was not found";
    case "package_not_found":
      return "package was not found";
    case "package_source_not_found":
      return "package source was not found";
    case "repository_ref_not_found":
      return "repository ref was not found";
    case "ref_not_found":
      return "repository ref was not found";
    case "package_source_ref_not_found":
      return "package source ref was not found";
    case "package_version_not_found":
      return "package source ref could not be resolved";
    case "package_version_unresolved":
      return "package version could not be resolved";
    case "repository_ref_ambiguous":
      return "repository ref is ambiguous";
    case "repository_legally_blocked":
      return "repository access is legally blocked";
    case "repository_resolution_error":
      return "repository resolution failed";
    case "repository_unavailable":
      return "repository is unavailable";
    case "package_source_unsupported":
      return "package source is unsupported";
    case "package_security_removed":
      return "package source was removed for security reasons";
    case "package_scope_unavailable":
      return "package source scope is unavailable";
    case "package_release_unusable":
      return "package release is unusable";
    case "no_site_pages":
      return "no searchable documentation pages are available";
    case "site_ambiguous":
      return "documentation site is ambiguous";
    case "site_not_indexed":
      return "documentation site is not indexed";
    case "site_no_docs":
      return "documentation site has no searchable pages";
    case "site_redirected":
      return "documentation site has moved";
    case "site_failed":
      return "documentation site preparation failed";
    case "site_v6_required":
      return "documentation site requires a publication format update";
    case "documentation_site_not_admitted":
      return "documentation site has not been admitted";
    case "documentation_source_resolution_required":
      return "documentation source must be resolved";
    case "documentation_site_no_docs":
      return "documentation site has no searchable pages";
    case "documentation_site_identity_blocked":
      return "documentation site identity needs resolution";
    case "documentation_site_failed":
      return "documentation site preparation failed";
    case "documentation_discovery":
      return "documentation sources are being discovered";
    case "documentation_unavailable":
      return "documentation is unavailable";
    case "starting_url_pending":
      return "requested documentation URL is being prepared";
    case "starting_url_missed_at_cap":
      return "requested documentation URL was not reached before the crawl limit";
    case "starting_url_absent_from_current_corpus":
      return "requested documentation URL is absent from the current corpus";
    default:
      return reason;
  }
}
