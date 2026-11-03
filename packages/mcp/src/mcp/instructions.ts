import { EXTERNAL_CONTENT_POSTURE } from "../tools/guardrails.js";

/**
 * Shared guide: cross-tool workflow and conventions that no single tool
 * description owns. Selected descriptions and schemas own call mechanics.
 *
 * Research guidance includes RESEARCH_VERIFIED_ANSWER_GUIDANCE; tests
 * keep its whitespace-normalized text identical to the shared constant.
 */
const GUIDE = `# GitHits

GitHits provides code, documentation, examples, and package information from open-source projects. Use it to understand APIs and implementation behavior, find examples from other projects, check dependencies and vulnerabilities, and compare releases.

GitHits cannot access private repositories, your local workspace, or uncommitted changes. Inspect those with local tools. Never send private targets, private code, local paths, credentials, personal data, or proprietary content.

This guide is both the \`githits-mcp\` skill and the \`quick_start\` result; once either is loaded, do not call \`quick_start\`.

## Choose a tool

| Need | Tool |
| --- | --- |
| A known symbol, file, or docs section | \`read\` |
| Relevant code/docs at an unknown location | \`search\` |
| Exact text, identifiers, or call sites | \`grep\` |
| File names or directory structure | \`list\` |
| Investigating behavior across code/docs | \`research\` |
| Examples from other projects | \`get_example\` |
| Package metadata or maintenance | \`pkg_info\` |
| Vulnerabilities | \`pkg_vulns\` |
| Dependencies | \`pkg_deps\` |
| Release notes | \`pkg_changelog\` |
| A dependency upgrade assessment | \`pkg_upgrade_review\` |
| Exact source changes | \`code_diff\` |
| An unclear project/package name | \`resolve_target\` |
| Active returned search continuation | \`search_status\` |

Choose the direct operation, not a sequence. Use canonical targets without resolution; follow resolver ambiguity rules for unclear names. Read the selected tool's schema.

## Depth and symbol following

Reuse established results; look up what is needed to continue the task. Investigate uncertainties that could change implementation, decisions, or answers. Stop when enough is known; state material gaps.

For usage/setup, an authoritative example or declaration may suffice. Trace implementation when needed. Cover comparison alternatives and establish imports, call shapes, and lifecycle steps required by code you provide.

Read known symbols directly with \`selector\` or a returned declaration range. Follow called symbols when their behavior matters. Use the declaration name and include its file only when known; do not guess qualifications from the caller. Reuse definitions already read. If resolution fails, read a returned declaration range or locate the exact identifier with literal grep. A call site alone does not establish the called implementation.

## Retrieval

- Search for concepts; use literal grep for known text. Keep queries focused on missing information, without repeating project/version scope already supplied by the target.
- Once a useful location is known, use it before searching again. Change unsuccessful queries based on results; do not repeat equivalent searches.
- Use sufficient result content directly. Read omitted deciding conditions or bodies before relying on them. Read complete relevant sections, combine nearby needed code, and avoid repeated small windows.
- Batch independent calls with known arguments; construct dependent calls after inspecting results.
- Reuse returned targets, paths, selectors, and ranges. Packages use package-relative paths; repositories use repository-relative paths. Discover hosted docs through \`search\` with \`source: "docs"\`, then reuse returned site/page locators.
- Keep default text. Use JSON only when code consumes raw fields or text omits a required field. Apply filters and limits; paginate only for needed information.

## Versions, research, and recovery

Targets: packages use \`<registry>:<name>@version\` (such as \`npm:express\`, never literal \`registry:\`), repositories \`github:owner/repo@ref\` or another supported provider, and docs \`site:host[/path]\`. Swift uses \`swift:github.com/<owner>/<repo>\`; Zig uses \`zig:gh/<owner>/<repo>\`. Never infer a provider. Omit suffixes for default selection; \`#\` selects a symbol/heading, not a revision.

Preserve needed versions and served provenance. Do not guess tags, investigate unrelated versions, or substitute current docs for historical behavior. Retrieval timestamps do not establish freshness.

For \`research\`: Ask directly about missing information; sources are included. Cite returned sources; read them for missing details, contradictions, or required source inspection, not routine verification. Reuse \`thread_id\` and state scope changes. Research takes packages/repositories, not docs sites. Omit target and thread_id for project identification; if candidates return, retry with the one matching established context as target; never guess.

Use available results while indexing continues. Follow \`search_status\` only for an active returned continuation whose results matter. Do not repeat search to poll. Respect retry delays; do not retry daily limits before reset. After a failure, use a direct lookup for a specific remaining gap rather than starting an unrestricted investigation.

Use package results directly for package facts. Preserve unknown assessments and coverage limits. Start upgrade assessments with \`pkg_upgrade_review\`; add source or changelog detail only for a gap. Reviews do not authorize modifications. For authorized upgrades, preserve original source/lockfiles and compare the same affected behavior before and after, including untested and omitted/null-input paths. Use isolated fixtures without credentials or production data. Passing existing tests alone does not prove compatibility.`;

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
