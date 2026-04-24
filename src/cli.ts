#!/usr/bin/env node
import { Command } from "commander";
import { version } from "../package.json";
import { handleCliError } from "./cli/errors.js";
import {
  enforceCachedRequiredUpdateForInvocation,
  runWithUpdateCheckFlush,
  startRequiredUpdateRefreshTaskForInvocation,
  startUpdateCheckTaskForInvocation,
} from "./cli/update-check.js";
import {
  registerAuthStatusCommand,
  registerCodeCommandGroup,
  registerDocsCommandGroup,
  registerExampleCommand,
  registerFeedbackCommand,
  registerInitCommand,
  registerLanguagesCommand,
  registerLoginCommand,
  registerLogoutCommand,
  registerMcpCommand,
  registerPkgCommandGroup,
  registerUnifiedSearchCommands,
} from "./commands/index.js";
import { loginFlow, stderrLoginOutput } from "./commands/login.js";
import { createContainer } from "./container.js";
import {
  getCommandPath,
  maybeAutoLoginBeforeCommand,
} from "./shared/auto-login.js";
import {
  FileSystemServiceImpl,
  NpmRegistryUpdateCheckService,
} from "./services/index.js";
import {
  endTelemetrySpan,
  flushTelemetry,
  isTelemetryEnabled,
  startTelemetrySpan,
  withTelemetrySpan,
} from "./shared/index.js";

const program = new Command();
const argv = process.argv.slice(2);
const commandSpans = new WeakMap<
  Command,
  ReturnType<typeof startTelemetrySpan>
>();
const createUpdateCheckService = () =>
  new NpmRegistryUpdateCheckService({
    currentVersion: version,
    fileSystemService: new FileSystemServiceImpl(),
  });

await enforceCachedRequiredUpdateForInvocation({
  args: argv,
  env: process.env,
  createService: createUpdateCheckService,
  stderr: process.stderr,
  exit: process.exit as (code: number) => never,
});

const updateCheckTask = startUpdateCheckTaskForInvocation({
  args: argv,
  env: process.env,
  stderrIsTTY: process.stderr.isTTY === true,
  stdinIsTTY: process.stdin.isTTY === true,
  stdoutIsTTY: process.stdout.isTTY === true,
  createService: createUpdateCheckService,
});
const requiredUpdateRefreshTask = startRequiredUpdateRefreshTaskForInvocation({
  args: argv,
  env: process.env,
  createService: createUpdateCheckService,
});

if (isTelemetryEnabled()) {
  process.once("exit", (exitCode) => {
    flushTelemetry(exitCode);
  });
}

program
  .name("githits")
  .description("Code examples from global open source for your AI assistant")
  .version(version)
  .option("--no-color", "Disable colored output")
  .hook("preAction", async (thisCommand, actionCommand) => {
    if (thisCommand.opts().color === false) {
      process.env.NO_COLOR = "1";
    }

    const command = actionCommand ?? thisCommand;
    commandSpans.set(
      command,
      startTelemetrySpan(getTelemetryCommandName(command)),
    );

    const authResult = await maybeAutoLoginBeforeCommand(command, {
      createContainer,
      loginFlow: (options, deps) => loginFlow(options, deps, stderrLoginOutput),
    });
    if (authResult.status !== "failed") {
      return;
    }

    console.error(`${authResult.message}\n`);
    console.error("Run `githits login` to try again.");
    process.exit(1);
  })
  .hook("postAction", (_thisCommand, actionCommand) => {
    endTelemetrySpan(commandSpans.get(actionCommand));
  })
  .addHelpText(
    "after",
    `
Getting started:
  githits init                           Set up MCP for your coding agents
  githits login                          Authenticate with your GitHits account
  githits mcp                            Start MCP server for your AI assistant
  githits search "router middleware" --in npm:express   Search dependency code/docs
  npx -y githits@latest example "query" --lang python    One-shot example search with browser login

Learn more at https://githits.com
Docs: https://app.githits.com/docs/
Support: support@githits.com`,
  );

// Setup command
registerInitCommand(program);

// Auth commands
registerLoginCommand(program);
registerLogoutCommand(program);

// MCP server command
registerMcpCommand(program);

// CLI commands
registerExampleCommand(program);
registerLanguagesCommand(program);
registerFeedbackCommand(program);
const registrationArgv = stripRootRegistrationOptions(argv);

if (shouldEagerLoadSearchCommands(registrationArgv)) {
  await withTelemetrySpan("cli.register.search", () =>
    registerUnifiedSearchCommands(program),
  );
}
if (shouldEagerLoadGatedCommandGroup(registrationArgv, "code")) {
  await withTelemetrySpan("cli.register.code-group", () =>
    registerCodeCommandGroup(program),
  );
}
if (shouldEagerLoadGatedCommandGroup(registrationArgv, "pkg")) {
  await withTelemetrySpan("cli.register.pkg-group", () =>
    registerPkgCommandGroup(program),
  );
}
if (shouldEagerLoadGatedCommandGroup(registrationArgv, "docs")) {
  await withTelemetrySpan("cli.register.docs-group", () =>
    registerDocsCommandGroup(program),
  );
}

// Auth status as subcommand of `auth`
const authCommand = program
  .command("auth")
  .summary("Manage authentication")
  .description("Manage authentication with GitHits.");
registerAuthStatusCommand(authCommand);

try {
  await runWithUpdateCheckFlush(
    () => withTelemetrySpan("cli.parse", () => program.parseAsync()),
    updateCheckTask,
    { stderr: process.stderr, requiredUpdateRefreshTask },
  );
} catch (error) {
  handleCliError(error, {
    stderr: process.stderr,
    exit: process.exit as (code: number) => never,
  });
}

/**
 * Commander supports root options before subcommands, e.g.
 * `githits --no-color pkg info`. Registration happens before Commander
 * parses argv, so the lightweight command sniff must ignore root-only
 * flags or it will misclassify `--no-color` as the requested command.
 */
function stripRootRegistrationOptions(args: string[]): string[] {
  return args.filter((arg) => arg !== "--no-color");
}

/**
 * Argv-sniff optimisation for command groups. Returns `true`
 * when the user's invocation might need the group registered — i.e.
 * they typed the group name or asked for help. Here we only decide
 * whether to build the command group eagerly so registration can run.
 */
function shouldEagerLoadGatedCommandGroup(
  args: string[],
  groupName: string,
): boolean {
  const [firstArg] = args;
  return (
    args.length === 0 ||
    firstArg === groupName ||
    (firstArg === "help" && (!args[1] || args[1] === groupName)) ||
    firstArg === "--help" ||
    firstArg === "-h"
  );
}

function shouldEagerLoadSearchCommands(args: string[]): boolean {
  const [firstArg] = args;
  return (
    args.length === 0 ||
    firstArg === "search" ||
    firstArg === "search-status" ||
    firstArg === "--help" ||
    firstArg === "-h" ||
    (firstArg === "help" && (!args[1] || isSearchHelpTarget(args[1])))
  );
}

function isSearchHelpTarget(value: string | undefined): boolean {
  return value === "search" || value === "search-status";
}

function getTelemetryCommandName(command: Command): string {
  const names = getCommandPath(command);

  return `command.${names.join(".")}`;
}
