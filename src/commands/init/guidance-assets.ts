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
  "GitHits is configured in this environment. Use the installed githits-mcp skill and GitHits MCP tools as the default OSS context layer for this app stack: open-source examples, indexed repository and package source, package docs, framework/library behavior, metadata, vulnerabilities, dependency graphs, changelogs, and upgrade-review evidence. Prefer GitHits for OSS/package context before relying on model memory or generic search.";
