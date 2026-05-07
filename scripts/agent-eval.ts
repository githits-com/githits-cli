import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import {
  assertUniqueWorkloadIds,
  buildRunReportFromMetadata,
  formatRunReport,
  workloadIdFromPath,
  writeReportJson,
} from "./agent-eval-report.ts";

type AgentName = "claude" | "codex";
type ServerMode = "local" | "published";
type RunStatus = "dry-run" | "success" | "failed" | "timeout";

export interface AgentEvalOptions {
  agent: AgentName;
  model?: string;
  server: ServerMode;
  workloads: string[];
  outDir: string;
  timeoutSeconds: number;
  publishedPackage: string;
  dryRun: boolean;
  repoRoot: string;
  schemaPath: string;
  reportingPath: string;
}

export interface McpServerConfig {
  mcpServers: {
    githits: {
      command: string;
      args: string[];
      env?: Record<string, string>;
    };
  };
}

interface WorkloadRunMetadata {
  id: string;
  path: string;
  status: RunStatus;
  exitCode?: number;
  durationMs?: number;
  timedOut?: boolean;
  command: string[];
  workspaceDir: string;
  workloadDir: string;
  toolCallCount?: number;
}

interface ExtractedToolCall {
  agent: AgentName;
  server?: string;
  tool: string;
  status?: string;
  arguments?: unknown;
  error?: unknown;
}

const PASSTHROUGH_ENV_KEYS = [
  "GITHITS_API_URL",
  "GITHITS_MCP_URL",
  "GITHITS_CODE_NAV_URL",
  "PKGSEER_URL",
  "GITHITS_API_TOKEN",
  "GITHITS_AUTH_STORAGE",
] as const;

const BASE_ENV_KEYS = [
  "PATH",
  "HOME",
  "USERPROFILE",
  "XDG_CONFIG_HOME",
  "APPDATA",
  "USER",
  "LOGNAME",
  "USERNAME",
  "SystemRoot",
  "WINDIR",
  "COMSPEC",
  "TMPDIR",
  "TMP",
  "TEMP",
  "SHELL",
  "LANG",
  "LC_ALL",
  "SECURITYSESSIONID",
  "XPC_FLAGS",
  "XPC_SERVICE_NAME",
  "__CF_USER_TEXT_ENCODING",
  "ANTHROPIC_API_KEY",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_VERTEX",
  "AWS_PROFILE",
  "AWS_REGION",
  "AWS_DEFAULT_REGION",
  "GOOGLE_APPLICATION_CREDENTIALS",
] as const;

const SECRET_PATTERN = /(TOKEN|API_KEY|SECRET|PASSWORD|CREDENTIAL)/i;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function defaultOutDir(repoRoot: string): string {
  return join(repoRoot, ".agent-eval", "runs", timestamp());
}

function parsePositiveInteger(value: string, flag: string): number {
  const parsed = Number(value);
  assert(
    Number.isInteger(parsed) && parsed > 0,
    `${flag} must be a positive integer`,
  );
  return parsed;
}

export function parseArgs(
  argv: string[],
  repoRoot = process.cwd(),
): AgentEvalOptions {
  const options: AgentEvalOptions = {
    agent: "claude",
    server: "local",
    workloads: [],
    outDir: defaultOutDir(repoRoot),
    timeoutSeconds: 300,
    publishedPackage: "githits@latest",
    dryRun: false,
    repoRoot,
    schemaPath: join(repoRoot, "eval", "agentic", "result.schema.json"),
    reportingPath: join(
      repoRoot,
      "eval",
      "agentic",
      "workloads",
      "REPORTING.md",
    ),
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case "--agent": {
        const value = argv[++i];
        assert(
          value === "claude" || value === "codex",
          "--agent must be claude or codex",
        );
        options.agent = value;
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
      case "--workload": {
        const value = argv[++i];
        assert(value, "--workload requires a path");
        options.workloads.push(value);
        break;
      }
      case "--out": {
        const value = argv[++i];
        assert(value, "--out requires a path");
        options.outDir = resolve(repoRoot, value);
        break;
      }
      case "--timeout": {
        const value = argv[++i];
        assert(value, "--timeout requires seconds");
        options.timeoutSeconds = parsePositiveInteger(value, "--timeout");
        break;
      }
      case "--published-package": {
        const value = argv[++i];
        assert(value, "--published-package requires a package spec");
        options.publishedPackage = value;
        break;
      }
      case "--schema": {
        const value = argv[++i];
        assert(value, "--schema requires a path");
        options.schemaPath = resolve(repoRoot, value);
        break;
      }
      case "--reporting": {
        const value = argv[++i];
        assert(value, "--reporting requires a path");
        options.reportingPath = resolve(repoRoot, value);
        break;
      }
      case "--dry-run":
        options.dryRun = true;
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

  if (options.workloads.length === 0) {
    options.workloads.push(
      join(repoRoot, "eval", "agentic", "workloads", "express-router.md"),
    );
  }
  options.workloads = options.workloads.map((path) => resolve(repoRoot, path));
  return options;
}

function printHelp(): void {
  console.log(`Usage: bun run agent:e2e [options]

Options:
  --agent claude|codex            Agent to run (default: claude)
  --model <name>                  Agent model name or alias, e.g. sonnet, haiku, gpt-5.4-mini
  --server local|published        MCP server mode (default: local)
  --workload <path>               Workload markdown path, repeatable
  --out <dir>                     Output directory
  --timeout <seconds>             Per-workload timeout (default: 300)
  --published-package <spec>      Package for published mode (default: githits@latest)
  --schema <path>                 Result JSON schema path
  --reporting <path>              Reporting contract markdown path
  --dry-run                       Generate artifacts without invoking Claude
`);
}

export function buildMcpConfig(
  options: Pick<AgentEvalOptions, "server" | "repoRoot" | "publishedPackage">,
): McpServerConfig {
  const command = buildMcpCommand(options);
  return {
    mcpServers: {
      githits: command,
    },
  };
}

function buildMcpCommand(
  options: Pick<AgentEvalOptions, "server" | "repoRoot" | "publishedPackage">,
): McpServerConfig["mcpServers"]["githits"] {
  if (options.server === "local") {
    return {
      command: "bun",
      args: ["run", "--cwd", options.repoRoot, "dev", "mcp", "start"],
    };
  }

  return {
    command: "npx",
    args: ["-y", options.publishedPackage, "mcp", "start"],
  };
}

export function buildCodexConfig(
  options: Pick<AgentEvalOptions, "server" | "repoRoot" | "publishedPackage">,
): string {
  const command = buildMcpCommand(options);
  return [
    "[mcp_servers.githits]",
    `command = ${JSON.stringify(command.command)}`,
    `args = ${JSON.stringify(command.args)}`,
    "",
  ].join("\n");
}

export function buildCodexConfigArgs(
  options: Pick<AgentEvalOptions, "server" | "repoRoot" | "publishedPackage">,
): string[] {
  const command = buildMcpCommand(options);
  return [
    "-c",
    `mcp_servers.githits.command=${JSON.stringify(command.command)}`,
    "-c",
    `mcp_servers.githits.args=${JSON.stringify(command.args)}`,
  ];
}

export function buildEvalEnv(
  baseEnv: NodeJS.ProcessEnv,
): Record<string, string> {
  const env: Record<string, string> = {};

  for (const key of [...BASE_ENV_KEYS, ...PASSTHROUGH_ENV_KEYS]) {
    const value = baseEnv[key];
    if (value !== undefined) {
      env[key] = value;
    }
  }

  env.NO_COLOR = "1";
  return env;
}

export function collectSecretValues(env: Record<string, string>): string[] {
  const values = new Set<string>();
  for (const [key, value] of Object.entries(env)) {
    if (SECRET_PATTERN.test(key) && value.length >= 8) {
      values.add(value);
    }
  }
  return [...values].sort((a, b) => b.length - a.length);
}

export function redactText(text: string, secretValues: string[]): string {
  let redacted = text;
  for (const secret of secretValues) {
    redacted = redacted.split(secret).join("<redacted>");
  }
  return redacted;
}

export function sanitizedEnvSummary(
  env: Record<string, string>,
): Record<string, string> {
  const summary: Record<string, string> = {};
  for (const key of PASSTHROUGH_ENV_KEYS) {
    const value = env[key];
    if (value === undefined) {
      continue;
    }
    summary[key] = SECRET_PATTERN.test(key) ? "<redacted>" : value;
  }
  if (env.HOME) summary.HOME = "<inherited>";
  if (env.USERPROFILE) summary.USERPROFILE = "<inherited>";
  if (env.XDG_CONFIG_HOME) summary.XDG_CONFIG_HOME = "<inherited>";
  if (env.APPDATA) summary.APPDATA = "<inherited>";
  return summary;
}

function workloadId(workloadPath: string): string {
  return workloadIdFromPath(workloadPath);
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function redactValue(value: unknown, secretValues: string[]): unknown {
  if (typeof value === "string") {
    return redactText(value, secretValues);
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, secretValues));
  }
  if (value !== null && typeof value === "object") {
    const redacted: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      redacted[key] = redactValue(item, secretValues);
    }
    return redacted;
  }
  return value;
}

async function commandOutput(
  command: string,
  args: string[],
  cwd: string,
): Promise<string | undefined> {
  try {
    const proc = Bun.spawn([command, ...args], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      proc.exited,
    ]);
    if (exitCode !== 0) {
      return undefined;
    }
    return stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

async function collectGitMetadata(
  repoRoot: string,
): Promise<Record<string, string | undefined>> {
  const [branch, sha] = await Promise.all([
    commandOutput("git", ["branch", "--show-current"], repoRoot),
    commandOutput("git", ["rev-parse", "HEAD"], repoRoot),
  ]);
  return { branch, sha };
}

async function claudeVersion(): Promise<string | undefined> {
  return commandOutput("claude", ["--version"], process.cwd());
}

async function codexVersion(): Promise<string | undefined> {
  return commandOutput("codex", ["--version"], process.cwd());
}

async function assertClaudeAvailable(): Promise<void> {
  const version = await claudeVersion();
  assert(
    version,
    "claude CLI not found or not executable. Install Claude Code before running live agent evals.",
  );
}

async function assertCodexAvailable(): Promise<void> {
  const version = await codexVersion();
  assert(
    version,
    "codex CLI not found or not executable. Install Codex before running live agent evals.",
  );
}

function extractFinalJson(stdout: string): unknown | undefined {
  const lines = stdout.split("\n").filter((line) => line.trim().length > 0);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    if (!line) continue;
    try {
      const event = JSON.parse(line) as Record<string, unknown>;
      const message = event.message;
      if (message !== null && typeof message === "object") {
        const text = extractTextFromContent(
          (message as Record<string, unknown>).content,
        );
        if (text) {
          const parsed = parseJsonFromText(text);
          if (parsed !== undefined) return parsed;
        }
      }
      const candidates = [
        event.result,
        event.message,
        event.content,
        event.text,
      ];
      for (const candidate of candidates) {
        if (typeof candidate === "string") {
          const parsed = parseJsonFromText(candidate);
          if (parsed !== undefined) return parsed;
        }
      }
      if (event.status || event.answer || event.githitsToolsUsed) {
        return event;
      }
    } catch {
      try {
        return JSON.parse(line);
      } catch {
        // Continue scanning older lines.
      }
    }
  }
  return undefined;
}

function extractTextFromContent(content: unknown): string | undefined {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return undefined;
  const parts = content.flatMap((item): string[] => {
    if (item === null || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    return record.type === "text" && typeof record.text === "string"
      ? [record.text]
      : [];
  });
  return parts.length > 0 ? parts.join("\n") : undefined;
}

function extractClaudeToolCalls(
  event: Record<string, unknown>,
): ExtractedToolCall[] {
  const message = event.message;
  if (message === null || typeof message !== "object") return [];
  const content = (message as Record<string, unknown>).content;
  if (!Array.isArray(content)) return [];
  return content.flatMap((item): ExtractedToolCall[] => {
    if (item === null || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    if (record.type !== "tool_use" || typeof record.name !== "string")
      return [];
    const match = record.name.match(/^mcp__(.+)__(.+)$/);
    if (!match) return [];
    const server = match[1];
    const tool = match[2];
    if (!server || !tool) return [];
    return [
      {
        agent: "claude",
        server,
        tool,
        status: "started",
        arguments: record.input,
      },
    ];
  });
}

function extractCodexToolCall(
  event: Record<string, unknown>,
): ExtractedToolCall | undefined {
  const item = event.item;
  if (item === null || typeof item !== "object") return undefined;
  const record = item as Record<string, unknown>;
  if (record.type !== "mcp_tool_call" || typeof record.tool !== "string") {
    return undefined;
  }
  return {
    agent: "codex",
    server: typeof record.server === "string" ? record.server : undefined,
    tool: record.tool,
    status: typeof record.status === "string" ? record.status : undefined,
    arguments: record.arguments,
    error: record.error,
  };
}

export function extractToolCalls(
  stdout: string,
  agent: AgentName,
): ExtractedToolCall[] {
  const calls: ExtractedToolCall[] = [];
  for (const line of stdout.split("\n")) {
    if (line.trim().length === 0) continue;
    try {
      const event = JSON.parse(line) as Record<string, unknown>;
      if (agent === "claude") {
        calls.push(...extractClaudeToolCalls(event));
      } else {
        const call = extractCodexToolCall(event);
        if (call) calls.push(call);
      }
    } catch {
      // Ignore non-JSON lines.
    }
  }
  return calls;
}

function parseJsonFromText(text: string): unknown | undefined {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // Continue to fenced JSON extraction.
  }

  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (!fence?.[1]) {
    return undefined;
  }
  try {
    return JSON.parse(fence[1].trim());
  } catch {
    return undefined;
  }
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

function isToolIssueArray(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        typeof item === "string" ||
        (item !== null &&
          typeof item === "object" &&
          typeof (item as Record<string, unknown>).tool === "string" &&
          typeof (item as Record<string, unknown>).issue === "string"),
    )
  );
}

function isOptionalStringArray(value: unknown): boolean {
  return value === undefined || isStringArray(value);
}

export function isValidAgentReport(value: unknown): boolean {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const report = value as Record<string, unknown>;
  const allowedKeys = new Set([
    "status",
    "answer",
    "toolIssues",
    "instructionIssues",
    "githitsUsefulness",
    "githitsUsefulnessReason",
    "confidence",
    "expectedToolUse",
    "unexpectedToolUse",
  ]);
  if (Object.keys(report).some((key) => !allowedKeys.has(key))) {
    return false;
  }
  return (
    (report.status === "success" ||
      report.status === "failure" ||
      report.status === "inconclusive") &&
    typeof report.answer === "string" &&
    isToolIssueArray(report.toolIssues) &&
    isStringArray(report.instructionIssues) &&
    isOptionalStringArray(report.expectedToolUse) &&
    isOptionalStringArray(report.unexpectedToolUse) &&
    (report.githitsUsefulness === "helped" ||
      report.githitsUsefulness === "hurt" ||
      report.githitsUsefulness === "unused" ||
      report.githitsUsefulness === "unclear") &&
    typeof report.githitsUsefulnessReason === "string" &&
    (report.confidence === "high" ||
      report.confidence === "medium" ||
      report.confidence === "low")
  );
}

async function runWithTimeout(
  command: string[],
  cwd: string,
  env: Record<string, string>,
  timeoutSeconds: number,
): Promise<{
  stdout: string;
  stderr: string;
  exitCode?: number;
  timedOut: boolean;
}> {
  const proc = Bun.spawn(command, {
    cwd,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill("SIGTERM");
    setTimeout(() => proc.kill("SIGKILL"), 2_000).unref?.();
  }, timeoutSeconds * 1_000);

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited.catch(() => undefined),
  ]);
  clearTimeout(timer);
  return { stdout, stderr, exitCode, timedOut };
}

export function buildClaudeCommand(
  prompt: string,
  mcpConfigPath: string,
  model?: string,
): string[] {
  const command = [
    "claude",
    "-p",
    prompt,
    "--mcp-config",
    mcpConfigPath,
    "--strict-mcp-config",
    "--disable-slash-commands",
    "--output-format",
    "stream-json",
    "--verbose",
    "--permission-mode",
    "bypassPermissions",
    "--no-session-persistence",
  ];
  if (model) command.push("--model", model);
  return command;
}

export function buildCodexCommand(
  prompt: string,
  workspaceDir: string,
  finalMessagePath: string,
  schemaPath: string,
  options: Pick<
    AgentEvalOptions,
    "server" | "repoRoot" | "publishedPackage" | "model"
  >,
): string[] {
  const command = [
    "codex",
    "exec",
    ...buildCodexConfigArgs(options),
    "--cd",
    workspaceDir,
    "--skip-git-repo-check",
    "--ephemeral",
    "--json",
    "--output-last-message",
    finalMessagePath,
    "--output-schema",
    schemaPath,
    "--sandbox",
    "read-only",
    "--ignore-rules",
  ];
  if (options.model) command.push("-m", options.model);
  command.push(prompt);
  return command;
}

async function runWorkload(
  options: AgentEvalOptions,
  workloadPath: string,
  runDir: string,
  env: Record<string, string>,
  mcpConfig: McpServerConfig,
  secretValues: string[],
): Promise<WorkloadRunMetadata> {
  assert(existsSync(workloadPath), `Workload not found: ${workloadPath}`);
  assert(
    existsSync(options.reportingPath),
    `Reporting contract not found: ${options.reportingPath}`,
  );
  const id = workloadId(workloadPath);
  const workloadDir = join(runDir, "workloads", id);
  const workspaceDir = mkdtempSync(
    join(tmpdir(), "githits-agent-eval-workspace-"),
  );
  mkdirSync(workloadDir, { recursive: true });

  const workloadPrompt = readFileSync(workloadPath, "utf8").trimEnd();
  const reportingPrompt = readFileSync(options.reportingPath, "utf8").trim();
  const prompt = `${workloadPrompt}\n\n${reportingPrompt}\n`;
  const mcpConfigPath = join(workloadDir, "mcp.json");
  const codexConfigPath = join(workloadDir, "codex-config.toml");
  const codexFinalPath = join(workloadDir, "codex-final.txt");
  writeFileSync(join(workloadDir, "prompt.md"), prompt);
  writeJson(mcpConfigPath, mcpConfig);
  writeFileSync(codexConfigPath, buildCodexConfig(options));

  const command =
    options.agent === "claude"
      ? buildClaudeCommand(prompt, mcpConfigPath, options.model)
      : buildCodexCommand(
          prompt,
          workspaceDir,
          codexFinalPath,
          options.schemaPath,
          options,
        );
  const workloadEnv = { ...env };
  const metadataBase = {
    id,
    path: workloadPath,
    command,
    workspaceDir,
    workloadDir,
  };

  try {
    if (options.dryRun) {
      writeJson(join(workloadDir, "dry-run.json"), metadataBase);
      return { ...metadataBase, status: "dry-run" };
    }

    const started = Date.now();
    const result = await runWithTimeout(
      command,
      workspaceDir,
      workloadEnv,
      options.timeoutSeconds,
    );
    const durationMs = Date.now() - started;

    writeFileSync(
      join(workloadDir, "stdout.json"),
      redactText(result.stdout, secretValues),
    );
    writeFileSync(
      join(workloadDir, "stderr.txt"),
      redactText(result.stderr, secretValues),
    );

    const toolCalls = extractToolCalls(result.stdout, options.agent);
    writeJson(
      join(workloadDir, "tool-calls.json"),
      redactValue(toolCalls, secretValues),
    );

    const finalJson = extractFinalJson(result.stdout);
    const codexFinalText = existsSync(codexFinalPath)
      ? readFileSync(codexFinalPath, "utf8")
      : undefined;
    if (codexFinalText !== undefined) {
      writeFileSync(
        join(workloadDir, "codex-final.txt"),
        redactText(codexFinalText, secretValues),
      );
    }
    const reportJson =
      options.agent === "codex" && codexFinalText !== undefined
        ? parseJsonFromText(codexFinalText)
        : finalJson;
    const validFinalJson = isValidAgentReport(reportJson);
    if (validFinalJson) {
      writeJson(
        join(workloadDir, "final.json"),
        redactValue(reportJson, secretValues),
      );
    } else if (reportJson !== undefined) {
      writeJson(
        join(workloadDir, "invalid-final.json"),
        redactValue(reportJson, secretValues),
      );
    }

    const status: RunStatus = result.timedOut
      ? "timeout"
      : result.exitCode === 0 && validFinalJson
        ? "success"
        : "failed";

    return {
      ...metadataBase,
      status,
      exitCode: result.exitCode,
      durationMs,
      timedOut: result.timedOut,
      toolCallCount: toolCalls.length,
    };
  } finally {
    rmSync(workspaceDir, { recursive: true, force: true });
  }
}

export async function runAgentEval(options: AgentEvalOptions): Promise<void> {
  assert(
    existsSync(options.schemaPath),
    `Schema not found: ${options.schemaPath}`,
  );
  mkdirSync(options.outDir, { recursive: true });
  assertUniqueWorkloadIds(options.workloads);
  const env = buildEvalEnv(process.env);
  const secretValues = collectSecretValues(env);
  const mcpConfig = buildMcpConfig(options);

  if (!options.dryRun) {
    if (options.agent === "claude") {
      await assertClaudeAvailable();
    } else {
      await assertCodexAvailable();
    }
  }

  const [git, claude, codex] = await Promise.all([
    collectGitMetadata(options.repoRoot),
    claudeVersion(),
    codexVersion(),
  ]);

  const workloadResults: WorkloadRunMetadata[] = [];
  for (const workload of options.workloads) {
    workloadResults.push(
      await runWorkload(
        options,
        workload,
        options.outDir,
        env,
        mcpConfig,
        secretValues,
      ),
    );
  }

  const runMetadata = {
    agent: options.agent,
    model: options.model,
    server: options.server,
    publishedPackage: options.publishedPackage,
    dryRun: options.dryRun,
    timeoutSeconds: options.timeoutSeconds,
    repoRoot: options.repoRoot,
    schemaPath: options.schemaPath,
    reportingPath: options.reportingPath,
    git,
    claudeVersion: claude,
    codexVersion: codex,
    env: sanitizedEnvSummary(env),
    workloads: workloadResults,
  };

  writeJson(join(options.outDir, "run.json"), runMetadata);

  writeJson(join(options.outDir, "summary.json"), {
    status: workloadResults.some(
      (result) => result.status === "failed" || result.status === "timeout",
    )
      ? "failed"
      : options.dryRun
        ? "dry-run"
        : "success",
    workloads: workloadResults.map(
      ({ id, status, exitCode, durationMs, timedOut }) => ({
        id,
        status,
        exitCode,
        durationMs,
        timedOut,
      }),
    ),
  });

  const report = buildRunReportFromMetadata(options.outDir, runMetadata);
  writeReportJson(options.outDir, report);
  console.log(formatRunReport(report).trimEnd());
}

async function main(): Promise<void> {
  const repoRoot = process.cwd();
  const options = parseArgs(process.argv.slice(2), repoRoot);
  if (!isAbsolute(options.outDir)) {
    options.outDir = resolve(repoRoot, options.outDir);
  }
  await runAgentEval(options);
}

if (import.meta.main) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  });
}
