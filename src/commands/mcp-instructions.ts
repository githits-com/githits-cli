import type { Dependencies } from "../container.js";

/**
 * Server-level MCP instructions.
 *
 * The MCP `instructions` field gives clients a short, cross-tool
 * orientation for the server — rationale, workflow glue, and
 * relationships that the per-tool descriptions cannot cover on
 * their own. Per upstream guidance it should stay terse: anything
 * that belongs to a single tool lives in that tool's description.
 *
 * Composition mirrors tool registration in `mcp.ts`. Each bullet is
 * emitted only when its backing service is wired, so MCP clients
 * never see guidance for a tool that isn't registered in the
 * current session.
 */

const CORE_BLOCK = `GitHits surfaces verified, canonical code examples from global open source. Use it when you're stuck, the user is frustrated by repeated failed attempts, you need up-to-date API usage, or the user mentions GitHits.

Workflow: call \`search_language\` first if the language name is uncertain → call \`get_example\` with one focused question → send \`feedback\` on the returned solution_id so quality improves. Each search addresses a single issue; reuse context from prior results before re-searching.`;

const PACKAGE_TOOLS_PREAMBLE = `Package tools work with third-party dependency source plus registry metadata. Use them when a stack trace points into a dependency, you need to verify how a library actually works, or you're evaluating whether to add or upgrade a package.

Package spec: \`registry:name[@version]\`.`;

const PACKAGE_SUMMARY_BULLET =
  "- `package_summary` — instant package overview: latest version, license, downloads, quickstart, and active advisory count.";

const PACKAGE_VULNERABILITIES_BULLET =
  "- `package_vulnerabilities` — known CVE / OSV advisories for npm, PyPI, Hex, or Crates packages (optionally pinned to `@version`). Malicious-package advisories surface in a disjoint `malware` bucket; filter with `min_severity` or include retracted advisories with `include_withdrawn`.";

const PACKAGE_DEPENDENCIES_BULLET =
  "- `package_dependencies` — direct runtime deps plus, when the backend has them, dev / peer / optional / feature groups. Pass `lifecycle` to filter groups server-side, `include_transitive` for the full graph, and `include_importers` when you also need per-package provenance. Supports npm, PyPI, Hex, Crates, vcpkg, and Zig.";

const PACKAGE_CHANGELOG_BULLET =
  "- `package_changelog` — release notes for a package or GitHub repo, newest-first. Default latest mode returns the 10 most recent entries with full markdown bodies; `from_version` switches to range mode between two versions. Addressable via `registry` + `package_name` or `repo_url`. Set `include_bodies: false` for a version / date / URL timeline when bodies aren't needed.";

const SEARCH_BULLET =
  "- `search` — unified search across indexed dependency code, docs, and explicit symbols. Structured fields are the primary UX; omit `sources` for AUTO. Production file intent is applied by default where supported, but some sources may ignore that filter and report it in `sourceStatus`. Returns only trustworthy complete results by default; opt into partial hits with `allow_partial_results: true`. If indexing is still in progress, the response carries a `searchRef`.";

const SEARCH_STATUS_BULLET =
  "- `search_status` — follow up a prior unified search by `searchRef`. Use it after `search` returns incomplete state to check progress, fetch partial hits when the original request used `allow_partial_results: true`, or fetch final results.";

const LIST_FILES_BULLET =
  "- `list_files` — discover what files a dependency ships. Use `path_prefix` to scope to a subdirectory; the response includes each file's language, type, and byte size. Returned `path` values feed directly into `read_file` and help scope `grep_repo`.";

const READ_FILE_BULLET =
  "- `read_file` — fetch a file's contents from a dependency. Pass the same `path` emitted by `list_files`. Default returns the full file; pass `start_line` / `end_line` for a bounded range. Binary files set `isBinary: true` and omit `content` — branch on the flag, not the null. A `FILE_NOT_FOUND` (or `NOT_FOUND`) response is the signal to call `list_files` for the actual path.";

const GREP_REPO_BULLET =
  "- `grep_repo` — deterministic text grep over indexed source files. Use it when you know the exact text or regex to match; use `search` for discovery. Whole-target grep is the default; narrow with `path`, `path_prefix`, `globs`, or `extensions`. Returned `matches[].filePath` feeds directly into `read_file`.";

const SEARCH_VS_SYMBOLS_TIP =
  'Prefer `get_example` for canonical example retrieval; prefer unified `search` for indexed dependency and repository discovery; use `sources:["symbol"]` when you want symbol-shaped results. Use `grep_repo` for deterministic text matching and `read_file` for full-file inspection.';

/**
 * Whether the MCP session should register and describe package tools.
 *
 * Agents must not see tools or guidance that would silently fail, so
 * only an explicit `code_navigation` capability enables the surface.
 *
 * Single source of truth — tool registration in `mcp.ts` and the
 * package-tools fragment in `buildMcpInstructions` must share this
 * predicate to prevent drift between what's advertised and what's
 * documented.
 */
export function isPackageToolsCapabilityOpen(deps: Dependencies): boolean {
  return deps.codeNavigationCapability === "enabled";
}

/**
 * Build the server-level instructions string for the current session.
 *
 * Emits the core block unconditionally. Appends a package-tools
 * section composed of a preamble plus one bullet per service that
 * is actually wired. Mirrors `getMcpToolDefinitions` so the
 * instructions never reference a tool that isn't registered, even
 * in half-open states where only one service is available.
 */
export function buildMcpInstructions(deps: Dependencies): string {
  const sections = [CORE_BLOCK];

  if (!isPackageToolsCapabilityOpen(deps)) {
    return sections.join("\n\n");
  }

  const bullets: string[] = [];
  if (deps.packageIntelligenceService) {
    bullets.push(PACKAGE_SUMMARY_BULLET);
    bullets.push(PACKAGE_VULNERABILITIES_BULLET);
    bullets.push(PACKAGE_DEPENDENCIES_BULLET);
    bullets.push(PACKAGE_CHANGELOG_BULLET);
  }
  if (deps.codeNavigationService) {
    bullets.push(SEARCH_BULLET);
    bullets.push(SEARCH_STATUS_BULLET);
    bullets.push(LIST_FILES_BULLET);
    bullets.push(READ_FILE_BULLET);
    bullets.push(GREP_REPO_BULLET);
  }

  if (bullets.length === 0) {
    return sections.join("\n\n");
  }

  const parts = [PACKAGE_TOOLS_PREAMBLE, bullets.join("\n")];
  // The decision tip contrasts `get_example` with unified `search`, so
  // it is only meaningful when unified search is actually registered.
  if (deps.codeNavigationService) {
    parts.push(SEARCH_VS_SYMBOLS_TIP);
  }

  sections.push(parts.join("\n\n"));
  return sections.join("\n\n");
}
