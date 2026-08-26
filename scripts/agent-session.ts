import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import {
  type AgentName,
  buildCodexConfigArgs,
  buildEvalEnv,
  buildMcpConfig,
  buildOpenCodeConfig,
  type CodexReasoningEffort,
  type EvalSurface,
  emptyOpenCodeConfig,
  type GuidanceInstallationMetadata,
  type GuidanceProfile,
  prepareFullGuidanceWorkspace,
  prepareSkillsWorkspace,
  type ServerMode,
  type SkillInstallationMetadata,
  validateExperimentalToolsScope,
  validateGuidanceProfileScope,
} from "./agent-eval.ts";

export interface AgentSessionOptions {
  agent: AgentName;
  surface: EvalSurface;
  server: ServerMode;
  guidanceProfile?: GuidanceProfile;
  experimentalTools: boolean;
  model?: string;
  reasoningEffort?: CodexReasoningEffort;
  prompt?: string;
  workspaceDir: string;
  repoRoot: string;
  publishedPackage: string;
  dryRun: boolean;
  bypassPermissions: boolean;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function defaultWorkspaceDir(): string {
  return mkdtempSync(join(tmpdir(), "githits-agent-session-"));
}

export function parseSessionArgs(
  argv: string[],
  repoRoot = process.cwd(),
): AgentSessionOptions {
  const options: AgentSessionOptions = {
    agent: "claude",
    surface: "mcp",
    server: "local",
    guidanceProfile: undefined,
    experimentalTools: false,
    workspaceDir: defaultWorkspaceDir(),
    repoRoot,
    publishedPackage: "githits@latest",
    dryRun: false,
    bypassPermissions: false,
  };

  let guidanceProfileExplicit = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case "--agent": {
        const value = argv[++i];
        assert(
          value === "claude" || value === "codex" || value === "opencode",
          "--agent must be claude, codex, or opencode",
        );
        options.agent = value;
        break;
      }
      case "--surface": {
        const value = argv[++i];
        assert(
          value === "mcp" || value === "skills",
          "--surface must be mcp or skills",
        );
        options.surface = value;
        break;
      }
      case "--server": {
        const value = argv[++i];
        assert(
          value === "local" || value === "published",
          "--server must be local or published",
        );
        options.server = value;
        break;
      }
      case "--model": {
        const value = argv[++i];
        assert(value, "--model requires a model name");
        options.model = value;
        break;
      }
      case "--guidance-profile": {
        const value = argv[++i];
        assert(
          value === "descriptors" ||
            value === "instructions" ||
            value === "full",
          "--guidance-profile must be descriptors, instructions, or full",
        );
        options.guidanceProfile = value;
        guidanceProfileExplicit = true;
        break;
      }
      case "--reasoning-effort": {
        const value = argv[++i];
        assert(
          value === "minimal" ||
            value === "low" ||
            value === "medium" ||
            value === "high" ||
            value === "xhigh" ||
            value === "max" ||
            value === "ultra",
          "--reasoning-effort must be minimal, low, medium, high, xhigh, max, or ultra",
        );
        options.reasoningEffort = value;
        break;
      }
      case "--prompt": {
        const value = argv[++i];
        assert(value, "--prompt requires text");
        options.prompt = value;
        break;
      }
      case "--workspace": {
        const value = argv[++i];
        assert(value, "--workspace requires a path");
        options.workspaceDir = resolve(repoRoot, value);
        break;
      }
      case "--published-package": {
        const value = argv[++i];
        assert(value, "--published-package requires a package spec");
        options.publishedPackage = value;
        break;
      }
      case "--dry-run":
        options.dryRun = true;
        break;
      case "--bypass-permissions":
        options.bypassPermissions = true;
        break;
      case "--experimental-tools":
        options.experimentalTools = true;
        break;
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  validateExperimentalToolsScope(options);
  if (options.surface === "mcp" && options.guidanceProfile === undefined) {
    options.guidanceProfile = "instructions";
  }
  validateGuidanceProfileScope(options, guidanceProfileExplicit);
  assert(
    options.agent === "codex" || options.reasoningEffort === undefined,
    "--reasoning-effort requires --agent codex",
  );
  return options;
}

function printHelp(): void {
  console.log(`Usage: bun run agent:session [options]

Options:
  --agent claude|codex|opencode   Agent to start (default: claude)
  --surface mcp|skills            GitHits surface to wire in (default: mcp)
  --server local|published        Local checkout or published package (default: local)
  --model <name>                  Agent model name or alias
  --guidance-profile descriptors|instructions|full  MCP guidance profile (default: instructions)
  --reasoning-effort minimal|low|medium|high|xhigh|max|ultra  Codex reasoning effort
  --prompt <text>                 Optional initial prompt
  --workspace <dir>               Workspace to use; defaults to a temp dir
  --published-package <spec>      Package for published mode (default: githits@latest)
  --experimental-tools            Enable local experimental MCP tools for this session
  --bypass-permissions            Start with noninteractive/bypass approvals enabled
  --dry-run                       Print setup metadata and command without launching
`);
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

export function buildClaudeSessionCommand(
  options: AgentSessionOptions,
  mcpConfigPath: string,
): string[] {
  const command = [
    "claude",
    "--mcp-config",
    mcpConfigPath,
    "--strict-mcp-config",
  ];
  if (options.surface === "mcp") {
    if (options.guidanceProfile === "full") {
      command.push("--setting-sources", "project");
    } else {
      command.push("--disable-slash-commands");
    }
  } else {
    command.push("--setting-sources", "project");
  }
  if (options.bypassPermissions) {
    command.push("--permission-mode", "bypassPermissions");
  }
  if (options.model) command.push("--model", options.model);
  if (options.prompt) command.push(options.prompt);
  return command;
}

export function buildCodexSessionCommand(
  options: AgentSessionOptions,
): string[] {
  const command = ["codex", "-C", options.workspaceDir];
  if (options.surface === "mcp") {
    command.push("-c", "mcp_servers={}", ...buildCodexConfigArgs(options));
    command.push("--ignore-rules");
  } else {
    command.push("--ignore-user-config", "-c", "mcp_servers={}");
  }
  if (options.bypassPermissions) {
    command.push("--dangerously-bypass-approvals-and-sandbox");
  }
  if (options.surface === "skills" && options.reasoningEffort) {
    command.push(
      "-c",
      `model_reasoning_effort=${JSON.stringify(options.reasoningEffort)}`,
    );
  }
  if (options.model) command.push("-m", options.model);
  if (options.prompt) command.push(options.prompt);
  return command;
}

export function buildOpenCodeSessionCommand(
  options: AgentSessionOptions,
): string[] {
  const command = ["opencode", "run", "--dir", options.workspaceDir];
  if (options.bypassPermissions) {
    command.push("--dangerously-skip-permissions");
  }
  if (options.model) command.push("--model", options.model);
  if (options.prompt) command.push(options.prompt);
  return command;
}

export function prepareAgentSession(options: AgentSessionOptions): {
  command: string[];
  mcpConfigPath: string;
  skillInstallation?: SkillInstallationMetadata;
  guidanceInstallation?: GuidanceInstallationMetadata;
} {
  mkdirSync(options.workspaceDir, { recursive: true });
  validateExperimentalToolsScope(options);
  if (options.surface === "mcp" && options.guidanceProfile === undefined) {
    options.guidanceProfile = "instructions";
  }
  validateGuidanceProfileScope(options);
  const openCodeConfigPath = join(options.workspaceDir, "opencode.json");
  if (options.agent === "opencode" && existsSync(openCodeConfigPath)) {
    throw new Error(
      `Refusing to overwrite existing OpenCode config: ${openCodeConfigPath}`,
    );
  }
  const sessionDir = join(options.workspaceDir, ".agent-session");
  mkdirSync(sessionDir, { recursive: true });
  const mcpConfigPath = join(sessionDir, "mcp.json");
  const guidanceInstallation =
    options.guidanceProfile === "full"
      ? prepareFullGuidanceWorkspace(options, options.workspaceDir)
      : undefined;
  const skillInstallation =
    options.surface === "skills"
      ? prepareSkillsWorkspace(options, options.workspaceDir)
      : guidanceInstallation?.skillInstallation;

  writeJson(
    mcpConfigPath,
    options.surface === "mcp" ? buildMcpConfig(options) : { mcpServers: {} },
  );
  if (options.agent === "opencode") {
    writeJson(
      openCodeConfigPath,
      options.surface === "mcp"
        ? buildOpenCodeConfig(options)
        : emptyOpenCodeConfig(),
    );
  }

  const command =
    options.agent === "claude"
      ? buildClaudeSessionCommand(options, mcpConfigPath)
      : options.agent === "codex"
        ? buildCodexSessionCommand(options)
        : buildOpenCodeSessionCommand(options);

  writeJson(join(sessionDir, "session.json"), {
    agent: options.agent,
    surface: options.surface,
    server: options.server,
    experimentalTools: options.experimentalTools,
    model: options.model,
    reasoningEffort: options.reasoningEffort,
    guidanceProfile: options.guidanceProfile,
    workspaceDir: options.workspaceDir,
    mcpConfigPath,
    openCodeConfigPath,
    command,
    skillInstallation,
    guidanceInstallation,
  });

  return {
    command,
    mcpConfigPath,
    skillInstallation,
    guidanceInstallation,
  };
}

export async function runAgentSession(
  options: AgentSessionOptions,
): Promise<number> {
  assert(
    existsSync(options.repoRoot),
    `Repo root not found: ${options.repoRoot}`,
  );
  const prepared = prepareAgentSession(options);
  const env = buildEvalEnv(process.env);
  if (prepared.skillInstallation) {
    env.PATH = `${dirname(prepared.skillInstallation.cliShim)}${env.PATH ? `${delimiter}${env.PATH}` : ""}`;
  }

  console.log(`Workspace: ${options.workspaceDir}`);
  console.log(`Surface: ${options.surface}`);
  console.log(
    `Command: ${prepared.command.map((part) => JSON.stringify(part)).join(" ")}`,
  );
  if (prepared.skillInstallation) {
    console.log(
      `Skills: ${prepared.skillInstallation.installedDirs.join(", ")}`,
    );
  }
  if (options.dryRun) return 0;

  const proc = Bun.spawn(prepared.command, {
    cwd: options.workspaceDir,
    env,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  return await proc.exited;
}

async function main(): Promise<void> {
  const options = parseSessionArgs(process.argv.slice(2), process.cwd());
  const exitCode = await runAgentSession(options);
  process.exit(exitCode);
}

if (import.meta.main) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  });
}
