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

const CORE_BLOCK = `GitHits surfaces verified, canonical code examples from global open source. Use it when you're stuck, the user is frustrated by repeated failed attempts, you need up-to-date API usage, the question is comparative across OSS projects (e.g. "how does X vs Y handle Z"), the answer requires reading how a real codebase implements a feature, or the user mentions GitHits.

Workflow: call \`get_example\` with one focused question, optionally passing \`language\` when the desired language is known; call \`search_language\` first only if you need to force a language and the exact name is uncertain. Send \`feedback\` on the returned solution_id so quality improves. Each search addresses a single issue; reuse context from prior results before re-searching.`;

const PACKAGE_TOOLS_PREAMBLE = `Package tools work with third-party dependency source plus registry metadata. Use them when a stack trace points into a dependency, you need to verify how a library actually works, or you're evaluating whether to add or upgrade a package.

Package spec: \`registry:name[@version]\`.`;

const PKG_INFO_BULLET =
  "- `pkg_info` — instant package overview: latest version, license, downloads, quickstart, and active advisory count.";

const DOCS_LIST_BULLET =
  "- `docs_list` — browse mixed package documentation pages from hosted docs and repository-backed docs. Each entry includes a stable pageId, source kind, source URL, and for repo docs exact file follow-up metadata.";

const DOCS_READ_BULLET =
  "- `docs_read` — read a documentation page by pageId. Works for both hosted docs and repo-backed docs.";

const PKG_VULNS_BULLET =
  "- `pkg_vulns` — known CVE / OSV advisories for npm, PyPI, Hex, or Crates packages (optionally pinned to `@version`). Malicious-package advisories surface in a disjoint `malware` bucket; filter with `min_severity` or include retracted advisories with `include_withdrawn`.";

const PKG_DEPS_BULLET =
  "- `pkg_deps` — direct runtime deps plus, when the backend has them, dev / peer / optional / feature groups. Pass `lifecycle` to filter groups server-side, `include_transitive` for the full graph, and `include_importers` when you also need per-package provenance. Supports npm, PyPI, Hex, Crates, vcpkg, and Zig.";

const PKG_CHANGELOG_BULLET =
  "- `pkg_changelog` — release notes for a package or GitHub repo, newest-first. Default latest mode returns the 10 most recent entries with full markdown bodies; `from_version` switches to range mode between two versions. Addressable via `registry` + `package_name` or `repo_url`. Set `include_bodies: false` for a version / date / URL timeline when bodies aren't needed.";

const SEARCH_BULLET =
  '- `search` — unified search across indexed dependency code, docs, and explicit symbols. Structured fields are the primary UX; omit `sources` for AUTO. Default response is a compact text listing (`text-v1`); pass `format: "json"` for the structured envelope with full locator fields, highlights, and source status. Returns only trustworthy complete results by default; opt into partial hits with `allow_partial_results: true`. If indexing is still in progress, the response carries a `searchRef`.';

const SEARCH_STATUS_BULLET =
  "- `search_status` — follow up a prior unified search by `searchRef`. Use it after `search` returns incomplete state to check progress, fetch partial hits when the original request used `allow_partial_results: true`, or fetch final results.";

const CODE_FILES_BULLET =
  '- `code_files` — discover what files a dependency ships. Use `path_prefix` to scope to a subdirectory. Default response is a paths-only listing (`text-v1`); pass `format: "json"` for the full envelope with each file\'s language, type, and byte size. Returned paths feed directly into `code_read` and help scope `code_grep`.';

const CODE_READ_BULLET =
  "- `code_read` — fetch a file's contents from a dependency. Pass the same `path` emitted by `code_files`. **MCP cap: 150 lines per call** — broader requests (or no range) silently truncate to the first 150 lines from your start, with a `hint` describing what was returned vs. requested. Pick a focused window from a `search` / `code_grep` match. Binary files set `isBinary: true` and omit `content`. A `FILE_NOT_FOUND` (or `NOT_FOUND`) response is the signal to call `code_files` for the actual path.";

const CODE_GREP_BULLET =
  '- `code_grep` — deterministic text grep over indexed source files. Use it when you know the exact text or regex to match; use `search` for discovery. Whole-target grep is the default; narrow with `path`, `path_prefix`, `globs`, or `extensions`. Default response groups matches by file with line numbers (`text-v1`); pass `format: "json"` for the `matches[]` array with byte offsets and symbol metadata. Each match\'s `path:line` chains directly into `code_read`.';

const SEARCH_VS_SYMBOLS_TIP =
  'Prefer `get_example` for canonical example retrieval; prefer unified `search` for indexed dependency and repository discovery; use `sources:["symbol"]` when you want symbol-shaped results. Use `code_grep` for deterministic text matching and `code_read` for focused-window inspection of a known file.';

const REFERENCE_FIRST_TIP =
  "Strategy — reference-first, content-second. Locate symbols and lines with `search` / `code_grep` first, then read only the lines you actually need with `code_read` using explicit `start_line` / `end_line` windows around the match (typically 80-150 lines). The MCP `code_read` surface caps each call at 150 lines; bigger requests are silently truncated. Each turn — including retries to widen or re-narrow — costs context, so pick a focused window the first time rather than starting wide and trimming.";

const MULTI_TURN_TIP =
  '**Delegate multi-call work to a sub-agent.** Code-navigation tools (`search`, `code_grep`, `code_read`, `code_files`) are inherently multi-call — answering even simple questions usually takes 3-10 tool calls, and reading raw source into the main conversation compounds quickly. The default approach for any cross-project comparison, codebase mapping, pattern survey, or "how does X actually work" investigation is to spawn a sub-task / sub-agent that does the digging and returns only a compact synthesis. Do the work in the main conversation only when the result genuinely belongs there (e.g., the user asked for a specific snippet to paste into their own code). When in doubt, delegate.';

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
  return (
    deps.codeNavigationCliOverrideEnabled ||
    deps.codeNavigationCapability === "enabled" ||
    (deps.codeNavigationCapability === "unknown" &&
      deps.envApiToken !== undefined)
  );
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
    bullets.push(DOCS_LIST_BULLET);
    bullets.push(DOCS_READ_BULLET);
    bullets.push(PKG_INFO_BULLET);
    bullets.push(PKG_VULNS_BULLET);
    bullets.push(PKG_DEPS_BULLET);
    bullets.push(PKG_CHANGELOG_BULLET);
  }
  if (deps.codeNavigationService) {
    bullets.push(SEARCH_BULLET);
    bullets.push(SEARCH_STATUS_BULLET);
    bullets.push(CODE_FILES_BULLET);
    bullets.push(CODE_READ_BULLET);
    bullets.push(CODE_GREP_BULLET);
  }

  if (bullets.length === 0) {
    return sections.join("\n\n");
  }

  const parts = [PACKAGE_TOOLS_PREAMBLE];
  // The multi-turn tip leads when code-navigation is wired — it is
  // the highest-leverage decision the agent makes (delegate vs.
  // run inline) and reading it before the per-tool bullets means
  // the framing arrives before any specific tool fires. The
  // reference-first / decision tips follow the bullets where they
  // act as workflow guidance for the chosen tool.
  if (deps.codeNavigationService) {
    parts.push(MULTI_TURN_TIP);
  }
  parts.push(bullets.join("\n"));
  if (deps.codeNavigationService) {
    parts.push(REFERENCE_FIRST_TIP);
    parts.push(SEARCH_VS_SYMBOLS_TIP);
  }

  sections.push(parts.join("\n\n"));
  return sections.join("\n\n");
}
