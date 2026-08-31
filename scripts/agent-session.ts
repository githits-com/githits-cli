import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { parse as parseToml } from "smol-toml";
import {
  type AgentName,
  buildCodexConfigArgs,
  buildEvalEnv,
  buildMcpConfig,
  buildOpenCodeConfig,
  buildOpenCodeSkillsConfig,
  type CodexReasoningEffort,
  createWorkloadIsolation,
  type EvalSurface,
  type GuidanceInstallationMetadata,
  type GuidanceProfile,
  isolateOpenCodeSkills,
  prepareFullGuidanceWorkspace,
  prepareSkillsWorkspace,
  type ServerMode,
  type SkillInstallationMetadata,
  validateCodexEvalHome,
  validateExperimentalToolsScope,
  validateGuidanceProfileScope,
  type WorkloadIsolation,
  type WorkloadIsolationMetadata,
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

export interface AgentSessionDependencies {
  baseEnv?: NodeJS.ProcessEnv;
  spawn?: typeof Bun.spawn;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function defaultWorkspaceDir(): string {
  return mkdtempSync(join(tmpdir(), "githits-agent-session-"));
}

const CODEX_INTERACTIVE_CONFIG_KEYS = new Set([
  "model",
  "model_reasoning_effort",
  "projects",
]);

function isTable(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateCodexInteractiveConfig(codexHome: string): void {
  const configPath = join(codexHome, "config.toml");
  if (!existsSync(configPath)) return;

  let configText: string;
  try {
    configText = readFileSync(configPath, "utf8");
  } catch {
    throw new Error("CODEX_HOME config.toml could not be read");
  }

  let config: unknown;
  try {
    config = parseToml(configText);
  } catch {
    throw new Error("CODEX_HOME config.toml is not valid TOML");
  }
  assert(isTable(config), "CODEX_HOME config.toml must be a table");

  for (const key of Object.keys(config)) {
    assert(
      CODEX_INTERACTIVE_CONFIG_KEYS.has(key),
      `CODEX_HOME config.toml contains unsupported key: ${key}`,
    );
  }

  if ("projects" in config) {
    assert(
      isTable(config.projects),
      "CODEX_HOME config.toml projects must be a table",
    );
    for (const project of Object.values(config.projects)) {
      assert(
        isTable(project),
        "CODEX_HOME config.toml project entries must be tables",
      );
      for (const key of Object.keys(project)) {
        assert(
          key === "trust_level",
          `CODEX_HOME config.toml contains unsupported key: ${key}`,
        );
      }
    }
  }
}

export function validateCodexInteractiveEvalHome(
  baseEnv: NodeJS.ProcessEnv,
): void {
  validateCodexEvalHome(baseEnv);
  const codexHome = baseEnv.CODEX_HOME;
  assert(codexHome !== undefined, "CODEX_HOME is required");
  validateCodexInteractiveConfig(codexHome);
}

function sessionIsolationMetadata(
  metadata: WorkloadIsolationMetadata,
): Omit<WorkloadIsolationMetadata, "workspace"> {
  const { workspace: _workspace, ...safeMetadata } = metadata;
  return safeMetadata;
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
          value === "descriptors" || value === "full",
          "--guidance-profile must be descriptors or full",
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
    options.guidanceProfile = "descriptors";
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
  --guidance-profile descriptors|full  MCP guidance profile (default: descriptors)
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
  baseEnv: NodeJS.ProcessEnv = process.env,
): string[] {
  const command = ["codex", "-C", options.workspaceDir];
  command.push(
    "--disable",
    "apps",
    "--disable",
    "plugins",
    "--disable",
    "remote_plugin",
    "-c",
    "mcp_servers={}",
  );
  if (options.surface === "mcp") {
    command.push(...buildCodexConfigArgs(options, baseEnv));
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

export function prepareAgentSession(
  options: AgentSessionOptions,
  baseEnv: NodeJS.ProcessEnv = process.env,
  isolationMetadata?: WorkloadIsolationMetadata,
): {
  command: string[];
  mcpConfigPath: string;
  skillInstallation?: SkillInstallationMetadata;
  guidanceInstallation?: GuidanceInstallationMetadata;
} {
  mkdirSync(options.workspaceDir, { recursive: true });
  validateExperimentalToolsScope(options);
  if (options.surface === "mcp" && options.guidanceProfile === undefined) {
    options.guidanceProfile = "descriptors";
  }
  validateGuidanceProfileScope(options);
  const openCodeConfigPath = join(options.workspaceDir, "opencode.json");
  if (options.agent === "opencode" && existsSync(openCodeConfigPath)) {
    throw new Error(
      `Refusing to overwrite existing OpenCode config: ${openCodeConfigPath}`,
    );
  }
  const sessionDir = join(options.workspaceDir, ".agent-session");
  const mcpConfigPath = join(sessionDir, "mcp.json");
  const guidanceInstallation =
    options.guidanceProfile === "full"
      ? prepareFullGuidanceWorkspace(options, options.workspaceDir)
      : undefined;
  const skillInstallation =
    options.surface === "skills"
      ? prepareSkillsWorkspace(options, options.workspaceDir)
      : guidanceInstallation?.skillInstallation;
  mkdirSync(sessionDir, { recursive: true });

  writeJson(
    mcpConfigPath,
    options.surface === "mcp"
      ? buildMcpConfig(options, baseEnv)
      : { mcpServers: {} },
  );
  if (options.agent === "opencode") {
    writeJson(
      openCodeConfigPath,
      options.surface === "mcp"
        ? buildOpenCodeConfig(options)
        : buildOpenCodeSkillsConfig(),
    );
  }

  const command =
    options.agent === "claude"
      ? buildClaudeSessionCommand(options, mcpConfigPath)
      : options.agent === "codex"
        ? buildCodexSessionCommand(options, baseEnv)
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
    ...(isolationMetadata
      ? { isolation: sessionIsolationMetadata(isolationMetadata) }
      : {}),
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
  dependencies: AgentSessionDependencies = {},
): Promise<number> {
  assert(
    existsSync(options.repoRoot),
    `Repo root not found: ${options.repoRoot}`,
  );
  const baseEnv = dependencies.baseEnv ?? process.env;
  const evalEnv = buildEvalEnv(baseEnv);
  let isolation: WorkloadIsolation | undefined;
  if (options.agent === "codex") {
    if (!options.dryRun || evalEnv.CODEX_HOME !== undefined) {
      validateCodexInteractiveEvalHome(evalEnv);
    }
    isolation = createWorkloadIsolation(evalEnv);
  }
  try {
    const prepared = prepareAgentSession(options, baseEnv, isolation?.metadata);
    const env = isolation?.env ?? evalEnv;
    if (options.agent === "opencode") {
      isolateOpenCodeSkills(env);
    }
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

    const proc = (dependencies.spawn ?? Bun.spawn)(prepared.command, {
      cwd: options.workspaceDir,
      env,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });
    return await proc.exited;
  } finally {
    if (isolation) rmSync(isolation.rootDir, { recursive: true, force: true });
  }
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
