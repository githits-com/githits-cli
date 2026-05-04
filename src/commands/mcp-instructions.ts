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
 * Composition mirrors tool registration in `mcp.ts` so clients see
 * guidance for the same always-on tool surface the server registers.
 */

const CORE_BLOCK = `GitHits provides verified, canonical code examples from global open source. Use it for global solution synthesis and canonical examples when you're stuck, repeated attempts failed, you need up-to-date API usage, the question is comparative across OSS projects (e.g. "how does X vs Y handle Z"), the answer requires reading how a real codebase implements a feature, or the user mentions GitHits.

Example workflow: call \`get_example\` with one focused question; pass \`language\` only when you know the exact language name, otherwise call \`search_language\` first. Default output is markdown with a trailing \`solution_id\`; send \`feedback\` on that solution_id. Reuse prior results before searching again. For dependency-specific grounding, use package-scoped \`search\` before global \`get_example\`.`;

const PACKAGE_TOOLS_PREAMBLE = `Indexed package/source tools inspect third-party dependency source, docs, and registry metadata. Use them when a stack trace points into a dependency, you need to verify how a library works, or you're evaluating whether to add or upgrade a package.

Package spec: \`registry:name[@version]\`. Default outputs are compact \`text-v1\` for agent context efficiency; pass \`format: "json"\` only when you need structured fields for programmatic parsing.`;

const PKG_INFO_BULLET =
  '- `pkg_info` — compact package overview: latest version, license, downloads, quickstart, and active advisory count. Pass `format: "json"` for the structured envelope.';

const DOCS_LIST_BULLET =
  "- `docs_list` — browse hosted and repository-backed package docs. Entries include stable pageIds, source URLs, and repo-file follow-up metadata when available.";

const DOCS_READ_BULLET =
  "- `docs_read` — read a documentation page by pageId. Works for both hosted docs and repo-backed docs.";

const PKG_VULNS_BULLET =
  '- `pkg_vulns` — compact known CVE / OSV advisory summary for npm, PyPI, Hex, or Crates packages, optionally pinned to `version`. Filter with `min_severity`; include retracted advisories with `include_withdrawn`. Pass `format: "json"` for per-advisory structured fields.';

const PKG_DEPS_BULLET =
  '- `pkg_deps` — compact direct runtime deps by default. Use `lifecycle: "runtime"` for explicit runtime-only, a concrete lifecycle for runtime plus matching non-runtime deps, or `lifecycle: "all"` for all groups. Use `include_transitive` for the full graph and `include_importers` for provenance. Pass `format: "json"` for the structured envelope.';

const PKG_CHANGELOG_BULLET =
  '- `pkg_changelog` — compact release notes for a package or GitHub repo, newest-first. Default latest mode returns recent entries with markdown body previews; `from_version` switches to range mode. Set `include_bodies: false` for a compact timeline or pass `format: "json"` for full bodies.';

const SEARCH_BULLET =
  '- `search` — unified search across indexed dependency code, docs, and symbols. Omit `sources` for AUTO. Use `sources:["code"]` for implementation/examples/tests text, `sources:["symbol"]` for precise API/entity lookup, and `sources:["docs"]` for guides/reference/changelogs. Default output is compact `text-v1` with ready-to-call follow-up arguments; pass `format: "json"` for structured locators, highlights, and source status. Complete by default; opt into partial hits with `allow_partial_results: true`. Incomplete responses carry a `searchRef`.';

const SEARCH_STATUS_BULLET =
  "- `search_status` — follow up a prior `search` by `searchRef` to check progress, fetch partial hits, or fetch final results.";

const CODE_FILES_BULLET =
  '- `code_files` — list files in an indexed dependency. `path`, `path_prefix`, and `globs` are OR-ed selectors; extensions, language, file type, and file-intent filters intersect on top. Returned paths feed into `code_read` and help scope `code_grep`; pass `format: "json"` for language/type/size metadata.';

const CODE_READ_BULLET =
  "- `code_read` — read a dependency file by `path`. **MCP cap: 150 lines per call**; choose focused `start_line` / `end_line` windows from `search` or `code_grep`. Binary files set `isBinary: true` and omit `content`. On `FILE_NOT_FOUND` / `NOT_FOUND`, call `code_files` for the actual path.";

const CODE_GREP_BULLET =
  "- `code_grep` — deterministic text or regex grep over indexed source. Use it when you know the pattern; use `search` for discovery. Narrow with `path`, `path_prefix`, `globs`, or `extensions`. Each match's `path:line` chains into `code_read`.";

const SEARCH_VS_SYMBOLS_TIP =
  'Use code-first grounding for behavioral claims: source, symbols, tests, examples, and call sites beat docs prose. Prefer unified `search` for indexed dependency and repository discovery; use `sources:["symbol"]` when you want symbol-shaped results. Prefer `get_example` for global canonical example retrieval after package-scoped grounding. Use `code_grep` for deterministic text matching and `code_read` for focused-window inspection of a known file.';

const REFERENCE_FIRST_TIP =
  "Strategy — reference-first, content-second. Locate symbols and lines with `search` / `code_grep` first, then read only the needed window with `code_read` using explicit `start_line` / `end_line` values, typically 80-150 lines around the match. The MCP `code_read` surface caps each call at 150 lines.";

const MULTI_TURN_TIP =
  '**Delegate multi-call work to a sub-agent.** Code-navigation work (`search`, `code_grep`, `code_read`, `code_files`) often takes 3-10 calls. For cross-project comparisons, codebase mapping, pattern surveys, or "how does X actually work" investigations, spawn a sub-task/sub-agent and ask for a compact synthesis. Do it inline only when the raw snippet belongs in the main conversation.';

/**
 * Build the server-level instructions string for the current session.
 *
 * Emits the core block plus the package/code-tools section.
 * Mirrors `getMcpToolDefinitions` so the instructions stay aligned
 * with the registered tool surface.
 */
export function buildMcpInstructions(_deps: Dependencies): string {
  const sections = [CORE_BLOCK];

  const bullets: string[] = [];
  bullets.push(DOCS_LIST_BULLET);
  bullets.push(DOCS_READ_BULLET);
  bullets.push(PKG_INFO_BULLET);
  bullets.push(PKG_VULNS_BULLET);
  bullets.push(PKG_DEPS_BULLET);
  bullets.push(PKG_CHANGELOG_BULLET);
  bullets.push(SEARCH_BULLET);
  bullets.push(SEARCH_STATUS_BULLET);
  bullets.push(CODE_FILES_BULLET);
  bullets.push(CODE_READ_BULLET);
  bullets.push(CODE_GREP_BULLET);

  const parts = [PACKAGE_TOOLS_PREAMBLE];
  // Lead with delegation because it is the highest-leverage decision
  // for code-navigation work. The reference-first / decision tips
  // follow the bullets where they act as workflow guidance for the
  // chosen tool.
  parts.push(MULTI_TURN_TIP);
  parts.push(bullets.join("\n"));
  parts.push(REFERENCE_FIRST_TIP);
  parts.push(SEARCH_VS_SYMBOLS_TIP);

  sections.push(parts.join("\n\n"));
  return sections.join("\n\n");
}
