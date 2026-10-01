import {
  GITHITS_MCP_SKILL_NAME,
  GITHITS_SKILL_SOURCE_PATHS,
  GUIDANCE_SKILL_TARGETS,
  readSkillSourceContent,
} from "../commands/init/guidance-assets.js";
import type { FileSystemService } from "./filesystem-service.js";
import {
  decideSkillUpdate,
  inspectSkillContent,
  renderManagedSkillContent,
} from "./mcp-skill-content.js";
import { LEGACY_MCP_SKILL_HASHES } from "./mcp-skill-history.js";
import { loadSkillUpdateSettings } from "./skill-config.js";

export interface McpSkillUpdateDependencies {
  fs: FileSystemService;
  version: string;
  env: Record<string, string | undefined>;
  warn: (message: string) => void;
}

/** Existing init roots are the only destinations owned by startup maintenance. */
export function getMcpSkillRoots(
  fs: FileSystemService,
  warn: (message: string) => void,
): string[] {
  const roots = new Set<string>();
  for (const scope of ["user", "project"] as const) {
    try {
      const base = scope === "user" ? fs.getHomeDir() : fs.getCwd();
      for (const targets of Object.values(GUIDANCE_SKILL_TARGETS)) {
        for (const segments of targets[scope] ?? []) {
          roots.add(fs.joinPath(base, ...segments));
        }
      }
    } catch {
      warn(
        `GitHits MCP skill maintenance skipped an unreadable ${scope} skill scope.`,
      );
    }
  }
  return [...roots];
}

function isMissing(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

/** Refresh only verified unchanged files; local maintenance never owns server availability. */
export async function updateInstalledMcpSkill(
  dependencies: McpSkillUpdateDependencies,
): Promise<void> {
  const { fs, version, env, warn } = dependencies;
  if (env.GITHITS_DISABLE_SKILL_UPDATE) return;
  try {
    if (!(await loadSkillUpdateSettings(fs)).autoUpdate) return;
  } catch {
    warn(
      "GitHits MCP skill maintenance skipped: cannot read skill update policy.",
    );
    return;
  }

  let bundled: string;
  let replacement: string;
  try {
    const source = GITHITS_SKILL_SOURCE_PATHS[GITHITS_MCP_SKILL_NAME];
    bundled = await readSkillSourceContent(
      {
        method: "skill",
        skillName: GITHITS_MCP_SKILL_NAME,
        ...source,
        targetPath: "",
      },
      fs,
    );
    replacement = renderManagedSkillContent(bundled, version);
  } catch {
    warn("GitHits MCP skill maintenance skipped: cannot read packaged skill.");
    return;
  }

  const destinations = new Set<string>();
  for (const root of getMcpSkillRoots(fs, warn)) {
    try {
      destinations.add(
        fs.joinPath(
          await fs.realpath(root),
          GITHITS_MCP_SKILL_NAME,
          "SKILL.md",
        ),
      );
    } catch (error) {
      if (!isMissing(error))
        warn("GitHits MCP skill maintenance skipped an unreadable skill root.");
    }
  }

  const seen = new Set<string>();
  for (const candidate of destinations) {
    try {
      const destination = await fs.realpath(candidate);
      if (!destinations.has(destination) || seen.has(destination)) continue;
      seen.add(destination);
      if (!(await fs.isFile(destination))) continue;
      const installed = await fs.readFile(destination);
      const decision = decideSkillUpdate(
        installed,
        bundled,
        version,
        LEGACY_MCP_SKILL_HASHES,
      );
      if (decision === "warn-newer") {
        const inspection = inspectSkillContent(installed);
        if (inspection.kind === "managed") {
          warn(
            `GitHits CLI ${version} has different guidance from the MCP skill installed by ${inspection.version}; preserving the newer shared skill. Use this CLI's init to intentionally reinstall its guidance.`,
          );
        }
      } else if (
        decision === "update" &&
        (await fs.readFile(destination)) === installed
      ) {
        await fs.atomicWriteFile(destination, replacement);
      }
    } catch (error) {
      if (!isMissing(error))
        warn(
          "GitHits could not update an installed MCP skill; continuing startup.",
        );
    }
  }
}
