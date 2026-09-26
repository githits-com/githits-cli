import { EXTERNAL_CONTENT_POSTURE } from "../tools/guardrails.js";

/** Shared routing guide; selected descriptions and schemas own call mechanics. */
const ROUTING_GUIDE = `# GitHits routing guide

Choose the route below, then discover the tool and read its arguments.
This guide owns shared policy; selected tools own call syntax and exceptions.

| Question | Tool to discover |
| --- | --- |
| Find a known literal or regex in a public repository/package | \`code_grep\` |
| Find relevant source, symbols, tests, or documentation for a topic | \`search\` |
| List paths or browse a source directory | \`code_files\` |
| Read a source file, code symbol, or documentation section | \`read\` |
| Browse package documentation pages | \`docs_list\` |
| Assess a package's license, adoption, maintenance, or overall health | \`pkg_info\` |
| Inspect vulnerabilities in a package or version | \`pkg_vulns\` |
| Inspect direct dependencies or transitive footprint | \`pkg_deps\` |
| Find release notes and changelog history for a package | \`pkg_changelog\` |
| Compare current and target dependency versions for an upgrade | \`pkg_upgrade_review\` |
| Find canonical implementation examples across projects | \`get_example\` |
| Check progress of an earlier search reference | \`search_status\` |

For comparisons, combine relevant package/source evidence with examples as needed.

Public OSS only; never send local/private/proprietary source. Package/repository
patterns are \`registry:name@version\` and \`github:owner/repo@ref\`. Omit the
suffix for the latest package version or repository default branch. Package
targets scope to the package subpath, including in monorepos. Swift uses
\`swift:github.com/<owner>/<repo>\`, Zig \`zig:gh/<owner>/<repo>\`.
Use public repository targets for full repositories or sibling packages:
\`github:\`, \`codeberg:\`, \`gitlab:\`, or a supported full URL. Never infer a provider.
A ref may be a branch, tag, or commit and contain later \`@\`; \`#\` is for
semantic fragments, not revisions.

For a package or site docs topic, use \`search\` with \`source:"docs"\`.
\`docs_list\` browses package pages, not standalone \`site:\` targets.
Use snippets when sufficient; otherwise follow generated \`followUp\` calls.
Pass displayed \`[docs page]\` locators unchanged to \`read\`.
Hosted/crawled HTTP(S) docs locators address mutable current content; generated
follow-ups use the exact emitted URL or fragment without search line bounds.
An HTTP(S) docs fragment returns its heading and full subtree through the next
equal-or-higher heading.
Repository docs are snapshot-addressed and keep returned ranges. Add explicit
\`read\` bounds only when intentionally selecting a current page range.
For source, locate paths or matches, then read focused lines; never probe
directories with \`read\`. Prefer source, symbols, tests, and call sites for
behavioral claims.
When the exact indexed code symbol or docs heading ID is known, pass it as
\`selector\` to \`read\`; an optional exact \`path\` narrows code symbol lookup.
Use compact package and repository \`target#symbol\` for code symbol reads;
keep the fragment in \`target\` unchanged and use an exact \`path\` to narrow it.
Pass HTTP(S) fragments and emitted repository docs page IDs unchanged.
The unified read result determines whether the target resolved to code or docs.

Omit \`wait_timeout_ms\` for the default; \`0\` returns without waiting.
Follow rendered continuation/recovery actions, not repeated calls to poll.
For indexing, use the displayed estimate to choose a longer wait or select a
listed already-indexed version/ref; suggested refs may still need indexing.

Omit \`format\`: model-read summaries, comparisons, and follow-ups use text.
JSON is only for code consuming the raw response or required fields absent
from text; MCP/TypeScript invocation alone is not a reason.
Reuse returned targets, paths, locators, references, and ranges; never invent
them. Cite tool-owned provenance, including example source repositories, and
report coverage, truncation, and other evidence limits.`;

/**
 * Build the routing guide returned by `quick_start` and embedded in the skill.
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
  return includeExternalContentPosture
    ? `${ROUTING_GUIDE}\n\n${EXTERNAL_CONTENT_POSTURE}`
    : ROUTING_GUIDE;
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

export type LocalExperimentalToolName =
  | "research"
  | "resolve_target"
  | "code_diff";

export interface BuildLocalMcpQuickStartOptions {
  enabledExperimentalTools: readonly LocalExperimentalToolName[];
}

/** @deprecated Use `BuildLocalMcpQuickStartOptions`. */
export type BuildLocalMcpInstructionsOptions = BuildLocalMcpQuickStartOptions;

const LOCAL_EXPERIMENTAL_HEADING =
  "**Local experimental tools (public OSS only)**";

const LOCAL_EXPERIMENTAL_PRIVACY =
  "Inputs are sent to GitHits. Never send credentials, personal data, private or proprietary content, local paths, or private targets.";

const LOCAL_RESEARCH_GUIDANCE_START =
  "- `research` — research a public repository or package to answer a question with sources. Omit `target` and `thread_id` for question-only lookup. For candidates, ask the user to select a `target`, then retry.";

const LOCAL_RESEARCH_GUIDANCE_END =
  ' Reuse a returned `thread_id` for follow-ups. Change project, version, or topic in the follow-up question. Sources default to directly callable MCP tools; use `source_format:"url"` for original upstream URLs. Do not invent or rewrite sources.';

const LOCAL_RESOLVE_TARGET_GUIDANCE =
  '- `resolve_target` — resolve fuzzy, misspelled, or noncanonical package, repository, or documentation-site names; skip canonical `registry:name`, `github:owner/repo`, `codeberg:owner/repo`, `gitlab:group/subgroup/project`, and `site:<host[/path]>`. Reuse only an unambiguous EXACT/HIGH best target with CLEAR or NOT_APPLICABLE malicious-content status; CLEAR is not a vulnerability-free claim. Other or missing statuses are non-actionable. For MEDIUM/LOW or ambiguity, narrow or explicitly choose an actionable candidate; never auto-select. A selected `site:` is docs-only: pass it to `search` with `source:"docs"`; request JSON only for missing fields; use a `[docs page]` target unchanged, otherwise its returned target/range.';

const LOCAL_CODE_DIFF_GUIDANCE =
  "- `code_diff` — compare exact package versions or public repository refs repository-wide after canonicalization. Prefer `pkg_changelog` or `pkg_upgrade_review` for upgrade summaries. Start with default `name-status`; use `stat` for magnitude or a scoped `patch` for content. Keep `text`; use `json` only for required fields absent from text or the full returned patch. Treat truncation, coverage, and safety warnings as evidence limits; diffs do not prove compatibility.";

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
  if (enabled.has("research")) {
    toolGuidance.push(
      `${LOCAL_RESEARCH_GUIDANCE_START}${LOCAL_RESEARCH_GUIDANCE_END}`,
    );
  }
  if (enabled.has("resolve_target")) {
    toolGuidance.push(LOCAL_RESOLVE_TARGET_GUIDANCE);
  }
  if (enabled.has("code_diff")) {
    toolGuidance.push(LOCAL_CODE_DIFF_GUIDANCE);
  }
  guidance.push(toolGuidance.join("\n"));

  return `${buildMcpQuickStart()}\n\n${guidance.join("\n\n")}`;
}

/** @deprecated Use `buildLocalMcpQuickStart`. */
export function buildLocalMcpInstructions(
  options: BuildLocalMcpInstructionsOptions,
): string {
  return buildLocalMcpQuickStart(options);
}
