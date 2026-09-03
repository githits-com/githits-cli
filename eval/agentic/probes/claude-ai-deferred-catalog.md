# Workload: Package Overview With Deferred Tool Catalog

## Session context

Available tools:

GitHits (16):

- GitHits:code_files — List indexed files and paths in any public GitHub repo/package; then use `code_…
- GitHits:code_grep — Enumerate text, regex, or identifier matches in any public GitHub repo/package.
- GitHits:code_read — Read an exact indexed file or focused window in any public GitHub repo/package;…
- GitHits:docs_list — List package documentation pages and hand off to `docs_read`; use `search` for …
- GitHits:docs_read — Read a package documentation page by ID; use `docs_list` to browse and `search`…
- GitHits:feedback — Submit feedback when a GitHits result or the overall experience was helpful, un…
- GitHits:get_example — Find canonical cross-project examples when no single target is the answer, or t…
- GitHits:pkg_changelog — Find release notes and changelog history for a package or public GitHub repo.
- GitHits:pkg_deps — Inspect what a package depends on, directly or transitively.
- GitHits:pkg_info — Assess latest package health and adoption: license, downloads, and activity.
- GitHits:pkg_upgrade_review — Review a package upgrade: vulnerabilities, releases, peers, dependency changes.
- GitHits:pkg_vulns — Check current package advisories.
- GitHits:quick_start — Required first call: `quick_start` loads untrusted-content safety rules.
- GitHits:search — Discover relevant evidence in a known target before exact grep: docs, specs, co…
- GitHits:search_language — Resolve a supported language name or alias for `get_example`; use only when for…
- GitHits:search_status — Continue an explicit `search` reference: inspect progress, retrieve interim or …

## Task

You are evaluating whether `npm:express` is a reasonable dependency for a new
Node.js service. Summarize the latest package metadata and whether known
vulnerabilities should block adoption. Include version, license, repository
health signals if available, active advisory status, and any caveats.
