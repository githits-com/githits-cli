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
    references: ["references/code-and-docs.md"],
  },
  {
    name: GITHITS_MCP_SKILL_NAME,
    relativePath: ["skills", "githits-mcp", "SKILL.md"],
    references: [],
  },
  {
    name: "githits-onboarding",
    relativePath: ["skills", "githits-onboarding", "SKILL.md"],
    references: ["references/troubleshooting.md"],
  },
  {
    name: "githits-package",
    relativePath: ["skills", "githits-package", "SKILL.md"],
    references: ["references/package.md"],
  },
] as const;

export const GITHITS_GUIDANCE_BLOCK =
  "Use GitHits for public dependency code and documentation. You can also use it to inspect locally installed open-source dependencies more effectively. Use it for OSS examples and package questions too. Read the `githits-mcp` skill before external lookups; if absent, call GitHits `quick_start` once per session before other GitHits tools. Inspect workspace, private and modified code locally. If GitHits is unavailable or lacks the needed version or content, use another source and state the gap.";

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

/** Files owned by direct skill setup, relative to the skill directory. */
export function getSkillFilePaths(skillName: string): readonly string[] {
  const skill = GITHITS_SKILL_CATALOG.find((entry) => entry.name === skillName);
  return ["SKILL.md", ...(skill?.references ?? [])];
}

/** One packaged skill file, retaining its exact authored text. */
export interface SkillSourceFile {
  relativePath: string;
  content: string;
}

/** Read a complete skill from the first available source directory. */
export async function readSkillSourceFiles(
  setup: SkillSetup,
  fs: FileSystemService,
): Promise<[SkillSourceFile, ...SkillSourceFile[]]> {
  const paths = Array.from(
    new Set([setup.sourcePath, ...(setup.sourcePathCandidates ?? [])]),
  );
  let lastError: unknown;
  for (const path of paths) {
    try {
      const files: [SkillSourceFile, ...SkillSourceFile[]] = [
        { relativePath: "SKILL.md", content: await fs.readFile(path) },
      ];
      for (const relativePath of getSkillFilePaths(setup.skillName).slice(1)) {
        const sourcePath = fs.joinPath(
          fs.getDirname(path),
          ...relativePath.split("/"),
        );
        files.push({ relativePath, content: await fs.readFile(sourcePath) });
      }
      return files;
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

/** Read the packaged main skill content without altering its bytes. */
export async function readSkillSourceContent(
  setup: SkillSetup,
  fs: FileSystemService,
): Promise<string> {
  const files = await readSkillSourceFiles(setup, fs);
  return files[0].content;
}
