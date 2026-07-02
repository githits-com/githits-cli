import { copyFile, mkdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CLAUDE_GITHITS_MCP_SKILL_RELATIVE_PATH,
  GITHITS_MCP_SKILL_RELATIVE_PATH,
} from "../src/commands/init/guidance-assets.js";

export const GITHITS_MCP_SKILL_SOURCE = join(
  ...GITHITS_MCP_SKILL_RELATIVE_PATH,
);

export const CLAUDE_GITHITS_MCP_SKILL_TARGET = join(
  ...CLAUDE_GITHITS_MCP_SKILL_RELATIVE_PATH,
);

export interface SyncClaudeSkillAssetsOptions {
  root?: string;
  clean?: boolean;
}

export async function syncClaudeSkillAssets(
  options: SyncClaudeSkillAssetsOptions = {},
): Promise<void> {
  const root = resolve(
    options.root ?? fileURLToPath(new URL("..", import.meta.url)),
  );
  const targetPath = join(root, CLAUDE_GITHITS_MCP_SKILL_TARGET);

  if (options.clean) {
    await rm(targetPath, { force: true });
    return;
  }

  const sourcePath = join(root, GITHITS_MCP_SKILL_SOURCE);
  await mkdir(dirname(targetPath), { recursive: true });
  await copyFile(sourcePath, targetPath);
}

function parseArgs(args: string[]): SyncClaudeSkillAssetsOptions {
  const options: SyncClaudeSkillAssetsOptions = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--clean") {
      options.clean = true;
      continue;
    }
    if (arg === "--root") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("--root requires a path");
      }
      options.root = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }

  return options;
}

const scriptPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (scriptPath === fileURLToPath(import.meta.url)) {
  await syncClaudeSkillAssets(parseArgs(process.argv.slice(2)));
}
