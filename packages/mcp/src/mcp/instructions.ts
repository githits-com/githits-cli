import { EXTERNAL_CONTENT_POSTURE } from "../tools/guardrails.js";

/**
 * Shared guide: cross-tool workflow and conventions that no single tool
 * description owns. Selected descriptions and schemas own call mechanics.
 *
 * Research guidance includes RESEARCH_VERIFIED_ANSWER_GUIDANCE; tests
 * keep its whitespace-normalized text identical to the shared constant.
 */
const GUIDE = `# GitHits

GitHits provides open-source code, documentation, examples, and package information for API usage, implementation, dependencies, vulnerabilities, and release comparisons.

GitHits cannot access private repositories, your local workspace, or uncommitted changes. Inspect those with local tools. Never send private targets, private code, local paths, credentials, personal data, or proprietary content.

Load this guide through \`githits-mcp\` or \`quick_start\` once; do not load both.

## Choose a tool

| Need | Tool |
| --- | --- |
| A known symbol, file, or docs section | \`read\` |
| Relevant code/docs at an unknown location | \`search\` |
| Exact text, regex patterns, or call sites | \`grep\` |
| File names or directory structure | \`list\` |
| Investigating behavior across code/docs | \`research\` |
| Examples from other projects | \`get_example\` |
| Package metadata, registry source, or maintenance | \`pkg_info\` |
| Vulnerabilities | \`pkg_vulns\` |
| Dependencies | \`pkg_deps\` |
| Release notes | \`pkg_changelog\` |
| A dependency upgrade assessment | \`pkg_upgrade_review\` |
| Exact source changes | \`code_diff\` |
| An unclear project/package name | \`resolve_target\` |
| Active returned search continuation | \`search_status\` |

Use canonical targets without resolution; follow resolver ambiguity rules for unclear names. Read the selected schema; omit unused optional arguments.

## Depth and symbol following

Reuse results. Investigate missing information that could change the implementation, decision, or answer. Stop when enough is known; state material gaps.

For usage/setup, an authoritative example or declaration may suffice. For implementation, cover requested behavior, comparison alternatives, and deciding conditions. Keep separate implementations, versions, and execution paths distinct; state which were not inspected. Preserve which function each source assigns behavior to. Establish imports, call shapes, and lifecycle steps required by your code.

Read known symbols with \`read\` selector before searching. Follow needed helpers/re-exports by declaration name and reuse definitions already read. Follow actual imports/calls: shared names or helpers do not establish shared behavior, and a call site alone does not establish implementation.

## Retrieval

- Search concepts; literal-grep known text. Regex patterns use grep, never search. Omit project/version terms already in the target.
- Use known locations before searching again. Revise failed queries from results; do not repeat equivalent searches.
- Use sufficient content directly. Read omitted deciding conditions or bodies; combine nearby needed code and avoid repeated small windows.
- Batch independent calls with known arguments; inspect results before dependent calls.
- Reuse returned targets, paths, selectors, and ranges: package-relative paths for packages, repository-relative paths for repositories. Discover docs with \`search\` and its \`source: "docs"\` argument; reuse returned site/page locators and exact heading IDs, not titles.
- Filter/limit output; paginate only for needed information.

## Versions, research, and recovery

Targets: packages use \`<registry>:<name>@version\` (such as \`npm:express\`, never literal \`registry:\`), repositories \`github:owner/repo@ref\` or another supported provider, and docs \`site:host[/path]\`. Swift uses \`swift:github.com/<owner>/<repo>\`; Zig uses \`zig:gh/<owner>/<repo>\`. Never infer a provider. Omit suffixes for default selection; \`#\` selects a symbol/heading, not a revision.

Cite the source supporting each claim, including advisory IDs for vulnerability claims. Preserve versions and served provenance. Do not guess tags, investigate unrelated versions, or substitute current docs for historical behavior. Retrieval time does not prove freshness.

For \`research\`: Ask for missing information; sources are included. Use and cite a sufficient answer directly. Open sources only for a specific missing detail, contradiction, or explicit source-inspection request; citations are not a reading checklist. Reuse \`thread_id\` and state scope changes.

A Research rate limit applies across questions/targets: wait the returned delay; do not retry daily limits before reset. Otherwise retrieve only a specific remaining gap. Correct invalid arguments before retrying; never repeat an unchanged invalid call.

Use package facts directly. Preserve unknown assessments and coverage limits. Start upgrades with \`pkg_upgrade_review\`; add source/changelog detail only for gaps. Reviews do not authorize modifications. For authorized upgrades, preserve original source/lockfiles; compare the same affected behavior before and after, including untested and omitted/null-input paths. Use isolated fixtures without credentials or production data. Passing tests alone does not prove compatibility.`;

/**
 * Build the guide returned by `quick_start` and published as the skill body.
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
    ? `${GUIDE}\n\n${EXTERNAL_CONTENT_POSTURE}`
    : GUIDE;
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

/** Guidance a local-only experimental tool adds to the local quick-start guide. */
export interface LocalExperimentalToolGuidance {
  name: string;
  /** One Markdown bullet with the tool's routing and contract. */
  guidance: string;
}

export interface BuildLocalMcpQuickStartOptions {
  enabledExperimentalTools: readonly LocalExperimentalToolGuidance[];
}

/** @deprecated Use `BuildLocalMcpQuickStartOptions`. */
export type BuildLocalMcpInstructionsOptions = BuildLocalMcpQuickStartOptions;

const LOCAL_EXPERIMENTAL_HEADING = "## Local experimental tools";

const LOCAL_EXPERIMENTAL_PRIVACY =
  "Inputs are sent to GitHits. Never send credentials, personal data, private or proprietary content, local paths, or private targets.";

/**
 * Compose local-only experimental guidance without changing the public
 * `buildMcpQuickStart()` output or public package surface. With no enabled
 * experimental tools the result is exactly the public guide.
 */
export function buildLocalMcpQuickStart(
  options: BuildLocalMcpQuickStartOptions,
): string {
  if (options.enabledExperimentalTools.length === 0)
    return buildMcpQuickStart();

  const guidance = [
    LOCAL_EXPERIMENTAL_HEADING,
    LOCAL_EXPERIMENTAL_PRIVACY,
    options.enabledExperimentalTools.map((tool) => tool.guidance).join("\n"),
  ];
  return `${buildMcpQuickStart()}\n\n${guidance.join("\n\n")}`;
}

/** @deprecated Use `buildLocalMcpQuickStart`. */
export function buildLocalMcpInstructions(
  options: BuildLocalMcpInstructionsOptions,
): string {
  return buildLocalMcpQuickStart(options);
}
