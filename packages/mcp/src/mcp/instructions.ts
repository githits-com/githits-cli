import { EXTERNAL_CONTENT_POSTURE } from "../tools/guardrails.js";

/** Detailed guidance returned by the `quick_start` tool. */

const CORE_BLOCK = `GitHits provides verified open-source examples plus indexed package/repository evidence.

Routing: use \`get_example\` for canonical cross-project examples; use \`search\` / \`code_*\` / \`docs_*\` / \`pkg_*\` for a known dependency, repository, stack trace, package adoption question, or upgrade review; use both for comparative OSS questions or when package-scoped evidence needs broader examples. Use \`search_language\` only to disambiguate a \`get_example\` language. Use \`feedback\` after helpful or flawed results.

GitHits indexes public OSS/package evidence, not local workspaces, private repositories, uncommitted changes, or proprietary code. Do not attempt private repository targets; they return \`REPOSITORY_NOT_FOUND\`.

When presenting \`get_example\` output, include source repository provenance/citations from GitHits' generated references/provenance section whenever present.`;

const PACKAGE_TOOLS_PREAMBLE = `Indexed package/source tools inspect third-party dependency source, docs, and registry metadata. Package targets use \`registry:name[@version]\` and inspect an indexed artifact/manifest root; Swift packages use \`swift:github.com/<owner>/<repo>\` and Zig packages use \`zig:gh/<owner>/<repo>\`. Use public GitHub repository targets for full repositories or sibling packages; repo targets use GitHub URLs. Prefer the default compact \`text-v1\` output; request JSON only when exact structured fields are necessary.`;

const SEARCH_BULLET =
  "- `search` — discover relevant docs, code, tests, examples, and symbols in known packages/repos or exact `site:<host[/path]>` documentation targets before reading exact files; retry advisory `suggestedSiteTargets` explicitly when returned.";

const SEARCH_STATUS_BULLET =
  "- `search_status` — follow up a prior `searchRef` from `search`.";

const CODE_GREP_BULLET =
  "- `code_grep` — deterministic text/regex grep when you already know the pattern; use matches as `code_read` follow-ups.";

const CODE_READ_BULLET =
  "- `code_read` — read one exact file path; never use it to list/probe directories. Read only the needed lines: 150 lines by default, or up to 300 with an explicit range.";

const CODE_FILES_BULLET =
  "- `code_files` — list/discover file paths; first choice for directory enumeration before `code_read` or scoped `code_grep`.";

const DOCS_LIST_BULLET =
  '- `docs_list` — browse documentation pages available for a package, not standalone `site:` targets. For a package or site docs topic, use `search` with `source:"docs"`; request `format:"json"` when exact `pageId` and line locators are needed, then pass them to `docs_read`.';

const DOCS_READ_BULLET =
  "- `docs_read` — read a documentation page by pageId from `docs_list` or docs `search` results; text reads return 150 lines by default or up to 300 with an explicit range.";

const PKG_INFO_BULLET =
  "- `pkg_info` — latest package health/adoption overview: license, repo health, downloads, publish age, latest vulnerability status.";

const PKG_VULNS_BULLET =
  "- `pkg_vulns` — known vulnerabilities/advisories for a package or pinned version; use `pkg_upgrade_review` for current-vs-target upgrades.";

const PKG_DEPS_BULLET =
  "- `pkg_deps` — direct dependencies, dependency groups, or bounded transitive dependency footprint.";

const PKG_CHANGELOG_BULLET =
  "- `pkg_changelog` — release notes/changelog evidence for a package or GitHub repo.";

const PKG_UPGRADE_REVIEW_BULLET =
  "- `pkg_upgrade_review` — preferred evidence tool for dependency updates; compares current vs target facts and reports no risk score.";

/**
 * Combined strategy tip. Replaces the earlier
 * `REFERENCE_FIRST_TIP` + `SEARCH_VS_SYMBOLS_TIP` pair, which
 * overlapped: both told agents to grep-then-read and both
 * contrasted `search`/`code_grep`/`get_example`. Phrase
 * "reference-first" stays in the section name so prior agent
 * habits and the test invariant continue to anchor here.
 */
const STRATEGY_TIP =
  "Strategy — reference-first. Source, symbols, tests, and call sites beat docs prose. Enumerate paths with `code_files`; locate symbols/lines with `search` or `code_grep`; use explicit ranges to read only the needed lines with `code_read`.";

/**
 * Build the detailed guide returned by `quick_start`.
 *
 * Emits the core block plus the package/code-tools section.
 * Mirrors `getMcpToolDefinitions` so the instructions stay aligned
 * with the registered tool surface.
 */
export interface BuildMcpQuickStartOptions {
  /**
   * Include the external-content posture (shared guardrail block).
   * Defaults to `true` — production always wants it. The eval mock
   * MCP server passes `false` so it can compare baseline (no
   * guardrail) vs guardrailed instructions cleanly.
   */
  includeExternalContentPosture?: boolean;
}

/** @deprecated Use `BuildMcpQuickStartOptions`; retained for API compatibility. */
export type BuildMcpInstructionsOptions = BuildMcpQuickStartOptions;

export function buildMcpQuickStart(
  options: BuildMcpQuickStartOptions = {},
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

  const packageSection = [
    PACKAGE_TOOLS_PREAMBLE,
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

/**
 * @deprecated Use `buildMcpQuickStart`. GitHits no longer publishes MCP
 * initialize instructions because clients expose them inconsistently.
 */
export function buildMcpInstructions(
  options: BuildMcpInstructionsOptions = {},
): string {
  return buildMcpQuickStart(options);
}

export type LocalExperimentalToolName = "ask" | "resolve_target" | "code_diff";

export interface BuildLocalMcpQuickStartOptions {
  enabledExperimentalTools: readonly LocalExperimentalToolName[];
  reportToolIssues?: "experimental" | "all";
}

/** @deprecated Use `BuildLocalMcpQuickStartOptions`. */
export type BuildLocalMcpInstructionsOptions = BuildLocalMcpQuickStartOptions;

const LOCAL_EXPERIMENTAL_HEADING =
  "**Local experimental tools (public OSS only)**";

const LOCAL_EXPERIMENTAL_PRIVACY =
  "Inputs are sent to GitHits. Never send credentials, personal data, private or proprietary content, local paths, or private targets.";

const LOCAL_AGENTIC_ASK_GUIDANCE =
  '- `ask` — answer one question about one canonical public package or repository target using backend-controlled grounded retrieval. The answer is retained for replay and evaluation. Sources default to directly callable MCP tools in backend-selected order; use `source_format:"url"` for original upstream URLs. Do not invent or rewrite sources. Use the returned Ask run ID when reporting a defect. Prefer the default text output; use JSON only for the exact validated response envelope.';

const LOCAL_RESOLVE_TARGET_GUIDANCE =
  '- `resolve_target` — resolve fuzzy, misspelled, or noncanonical package, repository, or documentation-site names; skip canonical `registry:name`, `github:owner/repo`, and `site:<host[/path]>`. Reuse only an unambiguous EXACT/HIGH best target with CLEAR or NOT_APPLICABLE malicious-content status; CLEAR is not a vulnerability-free claim. Other or missing statuses are non-actionable. For MEDIUM/LOW or ambiguity, narrow or explicitly choose an actionable candidate; never auto-select. A selected `site:` target is docs-only: pass it to `search` with `source:"docs"`; request `format:"json"` when exact locator fields are needed, then pass a relevant `pageId` and returned line range to `docs_read`.';

const LOCAL_CODE_DIFF_GUIDANCE =
  "- `code_diff` — compare exact package versions or public GitHub refs repository-wide after canonicalization. Prefer `pkg_changelog` or `pkg_upgrade_review` for upgrade summaries. Start with default `name-status`; use `stat` for magnitude or a scoped `patch` for content. Keep `text-v1` unless exact fields or the full returned patch are needed. Treat truncation, coverage, and safety warnings as evidence limits; diffs do not prove compatibility.";

/**
 * Compose local-only experimental guidance without changing the public
 * `buildMcpQuickStart()` output or public package surface.
 */
export function buildLocalMcpQuickStart(
  options: BuildLocalMcpQuickStartOptions,
): string {
  const enabled = new Set(options.enabledExperimentalTools);
  if (enabled.size === 0) return buildMcpQuickStart();

  const guidance: string[] = [
    LOCAL_EXPERIMENTAL_HEADING,
    LOCAL_EXPERIMENTAL_PRIVACY,
  ];
  const toolGuidance: string[] = [];
  if (enabled.has("ask")) {
    toolGuidance.push(LOCAL_AGENTIC_ASK_GUIDANCE);
  }
  if (enabled.has("resolve_target")) {
    toolGuidance.push(LOCAL_RESOLVE_TARGET_GUIDANCE);
  }
  if (enabled.has("code_diff")) {
    toolGuidance.push(LOCAL_CODE_DIFF_GUIDANCE);
  }
  guidance.push(toolGuidance.join("\n"));
  if (options.reportToolIssues !== undefined) {
    guidance.push(buildIssueReportingGuidance(options));
  }

  return `${buildMcpQuickStart()}\n\n${guidance.join("\n\n")}`;
}

function buildIssueReportingGuidance(
  options: BuildLocalMcpQuickStartOptions,
): string {
  const scope =
    options.reportToolIssues === "all"
      ? "any GitHits tool in this session"
      : [...new Set(options.enabledExperimentalTools)]
          .map((name) => `\`${name}\``)
          .join(" or ");
  return `**Issue reporting (${options.reportToolIssues})** — for each distinct concrete defect observed in ${scope}, make one \`feedback\` call with \`accepted: false\`, exact \`tool_name\`, and concise redacted expected-vs-observed context or a stable error code. Do not report valid empty results, expected bounds or safety omissions, or user judgment. Never include credentials, personal data, private/proprietary content, file bodies, or large outputs. Do not retry or report a failed feedback call.`;
}

/** @deprecated Use `buildLocalMcpQuickStart`. */
export function buildLocalMcpInstructions(
  options: BuildLocalMcpInstructionsOptions,
): string {
  return buildLocalMcpQuickStart(options);
}
