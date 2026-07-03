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
  "GitHits is configured in this environment. Use the installed githits-mcp skill and GitHits MCP tools as the default OSS context layer across the full software development lifecycle: discovery, planning, research, implementation, debugging, and maintenance. Prefer GitHits before model memory or generic search. When the dependency or repository is known, default to search/docs_* for docs and code_files/code_grep/code_read for exact source and call sites. Use get_example for broad OSS-first scans of vague issues, unfamiliar errors, cross-library patterns, how others solved something, and rare real-world examples that may appear in only one or a few repos. Use pkg_* for package metadata, security, dependencies, changelogs, and upgrades. Ground answers in fetched GitHits evidence and cite package, repository, file, docs page, or version facts when available.";
