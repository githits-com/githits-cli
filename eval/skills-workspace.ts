import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

export interface SkillsFixtureWorkspace {
  workspaceDir: string;
  binDir: string;
  shimPath: string;
  installedDirs: string[];
}

export interface PrepareSkillsFixtureWorkspaceOptions {
  repoRoot: string;
  workspaceDir: string;
  mockCliScriptPath: string;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function shQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

export function prepareSkillsFixtureWorkspace(
  options: PrepareSkillsFixtureWorkspaceOptions,
): SkillsFixtureWorkspace {
  const sourceDir = join(options.repoRoot, "skills");
  assert(existsSync(sourceDir), `Skills directory not found: ${sourceDir}`);
  assert(
    existsSync(options.mockCliScriptPath),
    `Mock CLI script not found: ${options.mockCliScriptPath}`,
  );

  const installedDirs = [
    join(options.workspaceDir, "skills"),
    join(options.workspaceDir, ".agents", "skills"),
    join(options.workspaceDir, ".claude", "skills"),
    join(options.workspaceDir, ".codex", "skills"),
  ];
  for (const installedDir of installedDirs) {
    rmSync(installedDir, { recursive: true, force: true });
    mkdirSync(dirname(installedDir), { recursive: true });
    cpSync(sourceDir, installedDir, { recursive: true });
  }

  const binDir = join(options.workspaceDir, ".eval-bin");
  mkdirSync(binDir, { recursive: true });
  const shimPath = join(binDir, "githits");
  writeFileSync(
    shimPath,
    `#!/bin/sh\nexec bun run ${shQuote(options.mockCliScriptPath)} "$@"\n`,
    "utf8",
  );
  chmodSync(shimPath, 0o755);

  return {
    workspaceDir: options.workspaceDir,
    binDir,
    shimPath,
    installedDirs,
  };
}
