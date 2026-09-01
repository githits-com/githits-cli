export const GITHITS_GUIDANCE_MARKER = "<!-- githits -->";

export const GITHITS_MCP_SKILL_NAME = "githits-mcp";

/** Canonical packaged skills copied by guided setup and removed by uninstall. */
export const GITHITS_SKILL_CATALOG = [
  {
    name: "githits-code",
    relativePath: ["skills", "githits-code", "SKILL.md"],
  },
  {
    name: GITHITS_MCP_SKILL_NAME,
    relativePath: ["skills", "githits-mcp", "SKILL.md"],
  },
  {
    name: "githits-onboarding",
    relativePath: ["skills", "githits-onboarding", "SKILL.md"],
  },
  {
    name: "githits-package",
    relativePath: ["skills", "githits-package", "SKILL.md"],
  },
] as const;

export const GITHITS_GUIDANCE_BLOCK =
  "GitHits is installed for public OSS/package evidence. When the `githits-mcp` skill is loaded, follow it and do not call `quick_start`. Otherwise call GitHits `quick_start` once per session before any other GitHits tool.";
