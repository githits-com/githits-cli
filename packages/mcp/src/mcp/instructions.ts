import { EXTERNAL_CONTENT_POSTURE } from "../tools/guardrails.js";

/** Shared routing guide; selected tool descriptions own argument mechanics. */
const ROUTING_GUIDE = `# GitHits routing guide

Choose the route matching the user's question below. Then discover the named
tool and read its argument description before calling it. This guide supplies
the routing decision; the selected tool supplies its argument details.

| Question | Tool to discover |
| --- | --- |
| Find a known literal or regex in a public repository/package | \`code_grep\` |
| Find relevant source, symbols, tests, or documentation for a topic | \`search\` |
| List paths or browse a source directory | \`code_files\` |
| Read a known exact source file or matched lines | \`code_read\` |
| Browse package documentation pages | \`docs_list\` |
| Read a documentation page returned by search or docs_list | \`docs_read\` |
| Assess a package's license, adoption, maintenance, or overall health | \`pkg_info\` |
| Inspect vulnerabilities in a package or version | \`pkg_vulns\` |
| Inspect direct dependencies or transitive footprint | \`pkg_deps\` |
| Find release notes for a package or repository | \`pkg_changelog\` |
| Compare current and target dependency versions for an upgrade | \`pkg_upgrade_review\` |
| Find canonical implementation examples across projects | \`get_example\` |
| Check progress of an earlier search reference | \`search_status\` |

Use \`search_language\` only if \`get_example\` needs language disambiguation. For comparative questions, combine
the relevant package/source route with examples when needed.

Scope: public OSS only, never local/private/proprietary source. Package targets
use \`registry:name[@version]\` and inspect an indexed artifact/manifest root;
Swift uses \`swift:github.com/<owner>/<repo>\`, Zig \`zig:gh/<owner>/<repo>\`.
Use public repository targets for full repositories or sibling packages, with
an explicit provider (such as \`github:owner/repo\`) or supported full URL.
Never infer a repository provider. Use selected tool descriptions for supported
target forms and argument details.

For a package or site docs topic, use \`search\` with \`source:"docs"\`.
\`docs_list\` browses package pages, not standalone \`site:\` targets.
Pass the emitted \`docsReadTarget\` (or historical \`pageId\`) to \`docs_read\`.
For source evidence, locate paths or matches before reading; never use
\`code_read\` to list/probe directories.

Keep default text for reading and follow-ups. Reuse returned targets, paths,
page locators, references and line ranges; do not invent them. Read only needed
lines. Use JSON only for programmatic parsing or required fields missing from
text. Cite tool-owned provenance, including get_example source references,
and report coverage, truncation and other evidence limits.`;

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

export type LocalExperimentalToolName = "ask" | "resolve_target" | "code_diff";

export interface BuildLocalMcpQuickStartOptions {
  enabledExperimentalTools: readonly LocalExperimentalToolName[];
}

/** @deprecated Use `BuildLocalMcpQuickStartOptions`. */
export type BuildLocalMcpInstructionsOptions = BuildLocalMcpQuickStartOptions;

const LOCAL_EXPERIMENTAL_HEADING =
  "**Local experimental tools (public OSS only)**";

const LOCAL_EXPERIMENTAL_PRIVACY =
  "Inputs are sent to GitHits. Never send credentials, personal data, private or proprietary content, local paths, or private targets.";

const LOCAL_AGENTIC_ASK_GUIDANCE_START =
  "- `ask` — ask a public repository or package question and receive a source-cited answer. Omit `target` and `thread_id` for question-only lookup. For candidates, ask the user to select a `target`, then retry.";

const LOCAL_AGENTIC_ASK_GUIDANCE_END =
  ' Reuse a returned `thread_id` for follow-ups. Change project, version, or topic in the follow-up question. Sources default to directly callable MCP tools; use `source_format:"url"` for original upstream URLs. Do not invent or rewrite sources. Use the returned Ask run ID when reporting a defect. Keep text; use JSON only for required fields absent from text.';

const LOCAL_RESOLVE_TARGET_GUIDANCE =
  '- `resolve_target` — resolve fuzzy, misspelled, or noncanonical package, repository, or documentation-site names; skip canonical `registry:name`, `github:owner/repo`, `codeberg:owner/repo`, `gitlab:group/subgroup/project`, and `site:<host[/path]>`. Reuse only an unambiguous EXACT/HIGH best target with CLEAR or NOT_APPLICABLE malicious-content status; CLEAR is not a vulnerability-free claim. Other or missing statuses are non-actionable. For MEDIUM/LOW or ambiguity, narrow or explicitly choose an actionable candidate; never auto-select. A selected `site:` target is docs-only: pass it to `search` with `source:"docs"`; request `format:"json"` only if required locator fields are absent from text, then use its `docsReadTarget` (or `pageId`) and range with `docs_read`.';

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
  if (enabled.has("ask")) {
    toolGuidance.push(
      `${LOCAL_AGENTIC_ASK_GUIDANCE_START}${LOCAL_AGENTIC_ASK_GUIDANCE_END}`,
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
