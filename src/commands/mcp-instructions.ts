import type { Dependencies } from "../container.js";
import { EXTERNAL_CONTENT_POSTURE } from "../tools/guardrails.js";

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
- Rate a result or share tool/UX feedback — call \`feedback\` with a \`solution_id\` from a prior \`get_example\` response (solution-tied) or omit it for generic session feedback about any tool (\`search\`, \`code_*\`, \`docs_*\`, \`pkg_*\`) or the overall experience. Pass \`tool_name\` when rating a specific tool result.

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
  "- `code_grep` — deterministic text or regex grep over indexed source. Use it when you know the pattern; use `search` for discovery. Narrow with `path`, `path_prefix`, `globs`, or `extensions`. Each match's `filePath`/file heading plus line number chains into `code_read`.";

const CODE_READ_BULLET =
  "- `code_read` — read one exact dependency file by `path`; do not use it to probe/list directories like `lib` or `lib/`. **MCP cap: 150 lines per call**. When you already have an exact path (e.g. from a stack trace), call this directly; otherwise locate it first with `search`, `code_grep`, or `code_files` and pick a focused `start_line` / `end_line` window. Binary files set `isBinary: true` and omit `content`. On `FILE_NOT_FOUND` / `NOT_FOUND`, follow `details.action` or call `code_files` for the actual path.";

const CODE_FILES_BULLET =
  '- `code_files` — list or discover file paths in an indexed dependency. First choice for file-listing/path-enumeration tasks such as "files under lib/" (`path_prefix: "lib/"`, optional `extensions: ["js"]`); do not use `code_read` to probe directories and do not use `code_grep` with empty or generic patterns to list files. `path`, `path_prefix`, and `globs` are OR-ed selectors; extensions, language, file type, and file-intent filters intersect on top. Returned paths feed into `code_read` and help scope `code_grep`; pass `format: "json"` for language/type/size metadata.';

const DOCS_LIST_BULLET =
  '- `docs_list` — browse hosted and repository-backed package docs when you need the available pages. It is not topic search; for "find docs about X", call `search` with `sources:["docs"]`, then pass the returned `pageId` to `docs_read`. Entries include stable pageIds, source URLs, and repo-file follow-up metadata when available.';

const DOCS_READ_BULLET =
  "- `docs_read` — read a documentation page by pageId. Works for both hosted docs and repo-backed docs. Prefer focused `start_line` / `end_line` windows from `search` hits or prior `docs_read` `totalLines` metadata instead of rereading large pages.";

const PKG_INFO_BULLET =
  '- `pkg_info` — latest-version package triage by `registry` + `package_name` (e.g. `npm` + `express`): license, repository popularity, downloads, publish age, and vulnerability status. Set `verbose: true` for GitHub language/topics/last-pushed, recent advisories, and recent changes; pass `format: "json"` for structured fields.';

const PKG_VULNS_BULLET =
  '- `pkg_vulns` — compact known CVE / OSV advisory summary for npm, PyPI, Hex, Crates, NuGet, Maven, Packagist, RubyGems, or Go packages; vcpkg and Zig are not supported. Optionally pin `version` (e.g. `npm` + `lodash` + `4.17.20`). Filter with `min_severity`; include retracted advisories with `include_withdrawn`; set `advisory_scope: "non_affecting"` for historical advisories or `"all"` for affected + historical rows. For upgrade reviews, check the target version explicitly or prefer `pkg_upgrade_review`. Default text is capped; use `verbose: true` for all selected rows or `format: "json"` for the complete per-advisory envelope.';

const PKG_DEPS_BULLET =
  '- `pkg_deps` — compact direct runtime deps by default. Use `lifecycle: "runtime"` for explicit runtime-only, a concrete lifecycle for runtime plus matching non-runtime deps, or `lifecycle: "all"` for all groups. Use `include_transitive` for the full graph and `include_importers` for provenance. For upgrade evidence, prefer `pkg_upgrade_review` because it diffs current vs target dependency facts. Pass `format: "json"` for the structured envelope.';

const PKG_CHANGELOG_BULLET =
  '- `pkg_changelog` — compact release notes for a package or GitHub repo, newest-first (e.g. `npm` + `express` + `limit: 2`). Default latest mode returns recent entries with 10-line markdown previews; `from_version` switches to range mode. Use range mode for every manual upgrade review, including patches, unless `pkg_upgrade_review` fits. Set `body_lines` to tune text previews, `verbose: true` for full text bodies, `include_bodies: false` for a compact timeline, or `format: "json"` for the complete envelope.';

const PKG_UPGRADE_REVIEW_BULLET =
  "- `pkg_upgrade_review` — preferred tool when the user asks for evidence about dependency updates, outdated dependency bumps, or lockfile/package updates. It compares current vs target direct and transitive vulnerabilities, changelog entries, deprecation metadata, peer changes, dependency changes, and optional dependency issues. It reports facts only; the calling agent owns the final assessment. Do not infer acceptability from semver alone; patch updates still require changelog and vulnerability evidence.";

/**
 * Combined strategy tip. Replaces the earlier
 * `REFERENCE_FIRST_TIP` + `SEARCH_VS_SYMBOLS_TIP` pair, which
 * overlapped: both told agents to grep-then-read and both
 * contrasted `search`/`code_grep`/`get_example`. Phrase
 * "reference-first" stays in the section name so prior agent
 * habits and the test invariant continue to anchor here.
 */
const STRATEGY_TIP =
  'Strategy — reference-first. For file/path enumeration, call `code_files` directly; never test directory paths with `code_read`. For behavioral claims, locate symbols and lines with `search` or `code_grep` first, then read the needed window with `code_read` using explicit `start_line` / `end_line` (typical 80-150 lines around the match; the MCP `code_read` surface caps each call at 150 lines). Source, symbols, tests, and call sites beat docs prose; use `sources:["symbol"]` when you want symbol-shaped results, `code_grep` for deterministic text matching, and `get_example` for global canonical examples after package-scoped grounding.';

/**
 * Build the server-level instructions string for the current session.
 *
 * Emits the core block plus the package/code-tools section.
 * Mirrors `getMcpToolDefinitions` so the instructions stay aligned
 * with the registered tool surface.
 */
export interface BuildMcpInstructionsOptions {
  /**
   * Include the external-content posture (shared guardrail block).
   * Defaults to `true` — production always wants it. The eval mock
   * MCP server passes `false` so it can compare baseline (no
   * guardrail) vs guardrailed instructions cleanly.
   */
  includeExternalContentPosture?: boolean;
}

export function buildMcpInstructions(
  _deps: Dependencies,
  options: BuildMcpInstructionsOptions = {},
): string {
  const includeExternalContentPosture =
    options.includeExternalContentPosture ?? true;
  // Bullets ordered by agent decision flow: discovery (search) →
  // file/path enumeration (files) → source grep/read → docs →
  // package metadata. Each bullet name↔registration is enforced by
  // `mcp-instructions.test.ts`.
  const bullets = [
    SEARCH_BULLET,
    SEARCH_STATUS_BULLET,
    CODE_FILES_BULLET,
    CODE_GREP_BULLET,
    CODE_READ_BULLET,
    DOCS_LIST_BULLET,
    DOCS_READ_BULLET,
    PKG_INFO_BULLET,
    PKG_VULNS_BULLET,
    PKG_DEPS_BULLET,
    PKG_CHANGELOG_BULLET,
    PKG_UPGRADE_REVIEW_BULLET,
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

  // External-content posture lands between the core orientation and the
  // package/code tool section so the agent reads how to treat third-
  // party content before scanning the tool inventory. Designed and
  // empirically validated in `docs/implementation/TOOL_GUARDRAILS.md`.
  const sections = includeExternalContentPosture
    ? [CORE_BLOCK, EXTERNAL_CONTENT_POSTURE, packageSection]
    : [CORE_BLOCK, packageSection];
  return sections.join("\n\n");
}
