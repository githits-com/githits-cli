export const GITHITS_GUIDANCE_MARKER = "<!-- githits -->";
export const GITHITS_MCP_SKILL_NAME = "githits-mcp";
export const GITHITS_MCP_SKILL_RELATIVE_PATH = [
  "skills",
  GITHITS_MCP_SKILL_NAME,
  "SKILL.md",
] as const;
export const CLAUDE_GITHITS_MCP_SKILL_RELATIVE_PATH = [
  "plugins",
  "claude",
  "skills",
  GITHITS_MCP_SKILL_NAME,
  "SKILL.md",
] as const;

export const GITHITS_GUIDANCE_BLOCK =
  "GitHits has been installed to the system. For public OSS/package questions, prefer the installed githits-mcp skill and GitHits MCP tools when external evidence is useful. GitHits does not index local workspaces, private repositories, uncommitted changes, or proprietary code; do not attempt private repository targets. For known public dependencies or repositories, use search/docs_* for docs and code_files/code_grep/code_read for source and call sites. Use get_example for broad cross-OSS scans of vague issues, unfamiliar errors, cross-library patterns, how others solved something, and rare real-world examples that may appear in only one or a few repos. Use pkg_* for package metadata, security, dependencies, changelogs, and upgrades. Prefer default compact text tool output; request JSON only when exact structured fields are necessary. Ground answers in fetched GitHits evidence and cite package, repository, file, docs page, or version facts when available.";
