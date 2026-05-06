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

const CORE_BLOCK = `GitHits provides verified, canonical code examples from global open source for AI agents. Pick a path:

- Need a canonical example or cross-project pattern with no specific package pinned (you're stuck, repeated attempts failed, the user wants up-to-date API usage, or the user mentioned GitHits) — call \`get_example\` for global solution synthesis.
- Inspecting a specific known dependency or repository (stack trace points there, verifying how a particular library works, evaluating an upgrade) — call \`search\` plus the indexed code, docs, and package tools listed below.
- Question is comparative across OSS projects (e.g. "how does X vs Y handle Z") or requires reading how a real codebase implements a feature — combine the two: \`search\` for known targets, \`get_example\` for cross-project synthesis.
- Rate a result or share tool/UX feedback — call \`feedback\` with a \`solution_id\` from a prior \`get_example\` response (solution-tied) or omit it for generic feedback about any tool (\`search\`, \`code_*\`, \`docs_*\`, \`pkg_*\`) or the overall experience.

\`get_example\` workflow: pass \`language\` only when you know the exact name; otherwise call \`search_language\` first. Default output is markdown with a trailing \`solution_id\`. Reuse prior results before searching again. For dependency-specific grounding, prefer package-scoped \`search\` before global \`get_example\`.`;

const PACKAGE_TOOLS_PREAMBLE = `Indexed package/source tools inspect third-party dependency source, docs, and registry metadata. Use them when a stack trace points into a dependency, you need to verify how a library works, or you're evaluating whether to add or upgrade a package.

Package spec: \`registry:name[@version]\`. Default outputs are compact \`text-v1\` for agent context efficiency; pass \`format: "json"\` only when you need structured fields for programmatic parsing.`;

const MULTI_TURN_TIP =
  '**Delegate multi-call work to a sub-agent.** Code-navigation work (`search`, `code_grep`, `code_read`, `code_files`) often takes 3-10 calls. For cross-project comparisons, codebase mapping, pattern surveys, or "how does X actually work" investigations, spawn a sub-task/sub-agent and ask for a compact synthesis. Do it inline only when the raw snippet belongs in the main conversation.';

const SEARCH_BULLET =
  '- `search` — unified search across indexed dependency code, docs, and symbols. Omit `sources` for AUTO. Use `sources:["code"]` for implementation/examples/tests text, `sources:["symbol"]` for precise API/entity lookup, and `sources:["docs"]` for guides/reference/changelogs. Default output is compact `text-v1` with ready-to-call follow-up arguments; pass `format: "json"` for structured locators, highlights, and source status. Complete by default; opt into partial hits with `allow_partial_results: true`. Incomplete responses carry a `searchRef`.';

const SEARCH_STATUS_BULLET =
  "- `search_status` — follow up a prior `search` by `searchRef` to check progress, fetch partial hits, or fetch final results.";

const CODE_GREP_BULLET =
  "- `code_grep` — deterministic text or regex grep over indexed source. Use it when you know the pattern; use `search` for discovery. Narrow with `path`, `path_prefix`, `globs`, or `extensions`. Each match's `path:line` chains into `code_read`.";

const CODE_READ_BULLET =
  "- `code_read` — read a dependency file by `path`. **MCP cap: 150 lines per call**. When you already have an exact path (e.g. from a stack trace), call this directly; otherwise locate it first with `search` or `code_grep` and pick a focused `start_line` / `end_line` window. Binary files set `isBinary: true` and omit `content`. On `FILE_NOT_FOUND` / `NOT_FOUND`, call `code_files` for the actual path.";

const CODE_FILES_BULLET =
  '- `code_files` — list files in an indexed dependency. `path`, `path_prefix`, and `globs` are OR-ed selectors; extensions, language, file type, and file-intent filters intersect on top. Returned paths feed into `code_read` and help scope `code_grep`; pass `format: "json"` for language/type/size metadata.';

const DOCS_LIST_BULLET =
  "- `docs_list` — browse hosted and repository-backed package docs. Entries include stable pageIds, source URLs, and repo-file follow-up metadata when available.";

const DOCS_READ_BULLET =
  "- `docs_read` — read a documentation page by pageId. Works for both hosted docs and repo-backed docs.";

const PKG_INFO_BULLET =
  '- `pkg_info` — compact package overview: latest version, license, downloads, quickstart, and active advisory count. Pass `format: "json"` for the structured envelope.';

const PKG_VULNS_BULLET =
  '- `pkg_vulns` — compact known CVE / OSV advisory summary for npm, PyPI, Hex, or Crates packages, optionally pinned to `version`. Filter with `min_severity`; include retracted advisories with `include_withdrawn`. Pass `format: "json"` for per-advisory structured fields.';

const PKG_DEPS_BULLET =
  '- `pkg_deps` — compact direct runtime deps by default. Use `lifecycle: "runtime"` for explicit runtime-only, a concrete lifecycle for runtime plus matching non-runtime deps, or `lifecycle: "all"` for all groups. Use `include_transitive` for the full graph and `include_importers` for provenance. Pass `format: "json"` for the structured envelope.';

const PKG_CHANGELOG_BULLET =
  '- `pkg_changelog` — compact release notes for a package or GitHub repo, newest-first. Default latest mode returns recent entries with markdown body previews; `from_version` switches to range mode. Set `include_bodies: false` for a compact timeline or pass `format: "json"` for full bodies.';

/**
 * Combined strategy tip. Replaces the earlier
 * `REFERENCE_FIRST_TIP` + `SEARCH_VS_SYMBOLS_TIP` pair, which
 * overlapped: both told agents to grep-then-read and both
 * contrasted `search`/`code_grep`/`get_example`. Phrase
 * "reference-first" stays in the section name so prior agent
 * habits and the test invariant continue to anchor here.
 */
const STRATEGY_TIP =
  'Strategy — reference-first. Locate symbols and lines with `search` or `code_grep` first, then read the needed window with `code_read` using explicit `start_line` / `end_line` (typical 80-150 lines around the match; the MCP `code_read` surface caps each call at 150 lines). Source, symbols, tests, and call sites beat docs prose for behavioral claims; use `sources:["symbol"]` when you want symbol-shaped results, `code_grep` for deterministic text matching, and `get_example` for global canonical examples after package-scoped grounding.';

/**
 * Build the server-level instructions string for the current session.
 *
 * Emits the core block plus the package/code-tools section.
 * Mirrors `getMcpToolDefinitions` so the instructions stay aligned
 * with the registered tool surface.
 */
export function buildMcpInstructions(_deps: Dependencies): string {
  // Bullets ordered by agent decision flow: discovery (search) →
  // code reading (grep, read, files) → docs → package metadata.
  // `code_files` follows `code_read` because it is the path-
  // discovery fallback when a known path doesn't resolve, not the
  // step after a hit. Each bullet name↔registration is enforced by
  // `mcp-instructions.test.ts`.
  const bullets = [
    SEARCH_BULLET,
    SEARCH_STATUS_BULLET,
    CODE_GREP_BULLET,
    CODE_READ_BULLET,
    CODE_FILES_BULLET,
    DOCS_LIST_BULLET,
    DOCS_READ_BULLET,
    PKG_INFO_BULLET,
    PKG_VULNS_BULLET,
    PKG_DEPS_BULLET,
    PKG_CHANGELOG_BULLET,
  ];

  // Lead with delegation because it is the highest-leverage decision
  // for code-navigation work. The strategy tip follows the bullets
  // where it acts as workflow guidance for the chosen tool.
  const packageSection = [
    PACKAGE_TOOLS_PREAMBLE,
    MULTI_TURN_TIP,
    bullets.join("\n"),
    STRATEGY_TIP,
  ].join("\n\n");

  return [CORE_BLOCK, packageSection].join("\n\n");
}
