import { fileURLToPath } from "node:url";
import type { FileSystemService } from "../../services/filesystem-service.js";
import type { SkillSetup } from "./agent-definitions.js";

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

type GithitsSkillName = (typeof GITHITS_SKILL_CATALOG)[number]["name"];

/** Canonical and bundled-runtime candidate paths for each packaged skill. */
export const GITHITS_SKILL_SOURCE_PATHS: Record<
  GithitsSkillName,
  { sourcePath: string; sourcePathCandidates: string[] }
> = Object.fromEntries(
  GITHITS_SKILL_CATALOG.map((skill) => {
    const packagePath = skill.relativePath.join("/");
    return [
      skill.name,
      {
        sourcePath: fileURLToPath(
          new URL(`../../../${packagePath}`, import.meta.url),
        ),
        sourcePathCandidates: [
          fileURLToPath(new URL(`../${packagePath}`, import.meta.url)),
          fileURLToPath(new URL(`../../${packagePath}`, import.meta.url)),
        ],
      },
    ];
  }),
) as Record<
  GithitsSkillName,
  { sourcePath: string; sourcePathCandidates: string[] }
>;

/** Shared root used by agents that follow the Agent Skills convention. */
export const SHARED_AGENTS_SKILL_ROOT = [".agents", "skills"] as const;

/** Active agent skill installation roots keyed by detected agent and scope. */
export const GUIDANCE_SKILL_TARGETS: Record<
  string,
  {
    user?: readonly (readonly string[])[];
    project?: readonly (readonly string[])[];
  }
> = {
  "claude-code": {
    user: [[".claude", "skills"]],
    project: [[".claude", "skills"]],
  },
  cursor: {
    user: [SHARED_AGENTS_SKILL_ROOT],
    project: [SHARED_AGENTS_SKILL_ROOT],
  },
  windsurf: {
    user: [SHARED_AGENTS_SKILL_ROOT],
    project: [SHARED_AGENTS_SKILL_ROOT],
  },
  vscode: {
    user: [SHARED_AGENTS_SKILL_ROOT],
    project: [SHARED_AGENTS_SKILL_ROOT],
  },
  cline: {
    user: [SHARED_AGENTS_SKILL_ROOT],
    project: [SHARED_AGENTS_SKILL_ROOT],
  },
  "codex-cli": {
    user: [SHARED_AGENTS_SKILL_ROOT],
    project: [SHARED_AGENTS_SKILL_ROOT],
  },
  pi: {
    user: [SHARED_AGENTS_SKILL_ROOT],
    project: [SHARED_AGENTS_SKILL_ROOT],
  },
  "gemini-cli": {
    user: [SHARED_AGENTS_SKILL_ROOT],
    project: [SHARED_AGENTS_SKILL_ROOT],
  },
  "google-antigravity": {
    user: [[".gemini", "config", "skills"]],
    project: [SHARED_AGENTS_SKILL_ROOT],
  },
  opencode: {
    user: [SHARED_AGENTS_SKILL_ROOT],
    project: [SHARED_AGENTS_SKILL_ROOT],
  },
  "hermes-agent": {
    user: [[".hermes", "skills"]],
  },
  zed: {
    user: [SHARED_AGENTS_SKILL_ROOT],
    project: [SHARED_AGENTS_SKILL_ROOT],
  },
  junie: {
    user: [SHARED_AGENTS_SKILL_ROOT],
    project: [SHARED_AGENTS_SKILL_ROOT],
  },
  "qwen-code": {
    user: [SHARED_AGENTS_SKILL_ROOT],
    project: [SHARED_AGENTS_SKILL_ROOT],
  },
  kiro: {
    user: [[".kiro", "skills"]],
    project: [[".kiro", "skills"]],
  },
  "kilo-code": {
    user: [SHARED_AGENTS_SKILL_ROOT],
    project: [SHARED_AGENTS_SKILL_ROOT],
  },
  "factory-droid": {
    user: [[".factory", "skills"]],
    project: [[".factory", "skills"]],
  },
};

/** Legacy skill roots retained only for explicit migration and uninstall. */
export const HISTORICAL_GUIDANCE_SKILL_TARGETS: Record<
  string,
  {
    user?: readonly (readonly string[])[];
    project?: readonly (readonly string[])[];
  }
> = {
  cline: {
    user: [[".cline", "skills"]],
    project: [[".cline", "skills"]],
  },
  junie: {
    user: [[".junie", "skills"]],
    project: [[".junie", "skills"]],
  },
};

/** Read the first available packaged skill source without altering its bytes. */
export async function readSkillSourceContent(
  setup: SkillSetup,
  fs: FileSystemService,
): Promise<string> {
  const paths = Array.from(
    new Set([setup.sourcePath, ...(setup.sourcePathCandidates ?? [])]),
  );
  let lastError: unknown;
  for (const path of paths) {
    try {
      return await fs.readFile(path);
    } catch (err) {
      lastError = err;
    }
  }

  const suffix = paths.length > 1 ? ` from ${paths.join(", ")}` : "";
  const detail =
    lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(
    `Cannot read ${setup.skillName} skill source${suffix}: ${detail}`,
  );
}
