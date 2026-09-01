#!/usr/bin/env node
import { colorizeBrand, shouldUseColors } from "@githits/mcp/internal";
import { Command } from "commander";
import { description as productDescription, version } from "../package.json";
import { runCliMain } from "./cli/errors.js";
import {
  enforceCachedRequiredUpdateForInvocation,
  runWithUpdateCheckFlush,
  startRequiredUpdateRefreshTaskForInvocation,
  startUpdateCheckTaskForInvocation,
} from "./cli/update-check.js";
import {
  registerAskCommand,
  registerAuthStatusCommand,
  registerCodeCommandGroup,
  registerDocsCommandGroup,
  registerDoctorCommand,
  registerExampleCommand,
  registerFeedbackCommand,
  registerInitCommand,
  registerLanguagesCommand,
  registerLoginCommand,
  registerLogoutCommand,
  registerMcpCommand,
  registerPkgCommandGroup,
  registerResolveCommand,
  registerSettingsCommand,
  registerUnifiedSearchCommands,
} from "./commands/index.js";
import { loginFlow, stderrLoginOutput } from "./commands/login.js";
import {
  clearAutoLoginAuthSessionMetadata,
  createContainer,
  loadAutoLoginAuthSessionMetadata,
} from "./container.js";
import {
  resolveExperimentalCliPolicy,
  shouldRegisterCliCommand,
} from "./services/experimental-cli-policy.js";
import { FileSystemServiceImpl } from "./services/filesystem-service.js";
import { createLazyCliFetch } from "./services/proxy-fetch.js";
import { NpmRegistryUpdateCheckService } from "./services/update-check-service.js";
import { createRootCliPreAction } from "./shared/root-cli-pre-action.js";
import {
  endTelemetrySpan,
  flushTelemetry,
  isTelemetryEnabled,
  startTelemetrySpan,
  withTelemetrySpan,
} from "./shared/telemetry.js";

const program = new Command();
const argv = process.argv.slice(2);
// Bridge the --no-color flag to the NO_COLOR convention that every
// shouldUseColors() call across the CLI reads.
if (argv.includes("--no-color")) {
  process.env.NO_COLOR = "1";
}
const useColors = shouldUseColors();
const commandSpans = new WeakMap<
  Command,
  ReturnType<typeof startTelemetrySpan>
>();
const createUpdateCheckService = () =>
  new NpmRegistryUpdateCheckService({
    currentVersion: version,
    fileSystemService: new FileSystemServiceImpl(),
    fetcher: createLazyCliFetch(),
  });

if (isTelemetryEnabled()) {
  process.once("exit", (exitCode) => {
    flushTelemetry(exitCode);
  });
}

async function main(): Promise<void> {
  const experimentalCliPolicy = await resolveExperimentalCliPolicy(
    new FileSystemServiceImpl(),
    argv,
  );
  const resolveAvailable = shouldRegisterCliCommand(
    "resolve",
    experimentalCliPolicy.tools,
  );
  const askAvailable = shouldRegisterCliCommand(
    "ask",
    experimentalCliPolicy.tools,
  );

  await enforceCachedRequiredUpdateForInvocation({
    args: argv,
    env: process.env,
    createService: createUpdateCheckService,
    stderr: process.stderr,
    exit: process.exit as (code: number) => never,
  });

  const rootCliPreAction = createRootCliPreAction({
    createContainer,
    loadAuthSessionMetadata: loadAutoLoginAuthSessionMetadata,
    clearAuthSessionMetadata: clearAutoLoginAuthSessionMetadata,
    loginFlow: (options, deps) => loginFlow(options, deps, stderrLoginOutput),
  });

  program
    .name("githits")
    .description(productDescription)
    .version(version)
    .option("--no-color", "Disable colored output")
    .configureHelp({
      styleTitle: (title: string) =>
        colorizeBrand(title, "primary", useColors, { bold: true }),
    })
    .hook("preAction", async (thisCommand, actionCommand) => {
      const command = actionCommand ?? thisCommand;
      commandSpans.set(
        command,
        startTelemetrySpan(getTelemetryCommandName(command)),
      );

      await rootCliPreAction(thisCommand, actionCommand);
    })
    .hook("postAction", (_thisCommand, actionCommand) => {
      endTelemetrySpan(commandSpans.get(actionCommand));
    })
    .addHelpText("after", buildGettingStartedText(resolveAvailable));

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
  registerDoctorCommand(program);
  if (askAvailable) {
    registerAskCommand(program);
  }
  if (resolveAvailable) {
    registerResolveCommand(program);
  }
  registerSettingsCommand(program);
  const registrationArgv = stripRootRegistrationOptions(argv);
  const updateCheckTask = startUpdateCheckTaskForInvocation({
    args: argv,
    env: process.env,
    stderrIsTTY: process.stderr.isTTY === true,
    stdinIsTTY: process.stdin.isTTY === true,
    stdoutIsTTY: process.stdout.isTTY === true,
    createService: createUpdateCheckService,
  });
  const requiredUpdateRefreshTask = startRequiredUpdateRefreshTaskForInvocation(
    {
      args: argv,
      env: process.env,
      createService: createUpdateCheckService,
    },
  );

  await runWithUpdateCheckFlush(
    async () => {
      if (shouldEagerLoadSearchCommands(registrationArgv)) {
        await withTelemetrySpan("cli.register.search", () =>
          registerUnifiedSearchCommands(program),
        );
      }
      if (shouldEagerLoadCommandGroup(registrationArgv, "code")) {
        await withTelemetrySpan("cli.register.code-group", () =>
          registerCodeCommandGroup(program, {
            experimentalTools: experimentalCliPolicy.tools,
          }),
        );
      }
      if (shouldEagerLoadCommandGroup(registrationArgv, "pkg")) {
        await withTelemetrySpan("cli.register.pkg-group", () =>
          registerPkgCommandGroup(program),
        );
      }
      if (shouldEagerLoadCommandGroup(registrationArgv, "docs")) {
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

      await withTelemetrySpan("cli.parse", () => program.parseAsync());
    },
    updateCheckTask,
    { stderr: process.stderr, requiredUpdateRefreshTask },
  );
}

await runCliMain(main, {
  stderr: process.stderr,
  exit: process.exit as (code: number) => never,
  json: argv.includes("--json"),
});

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
function shouldEagerLoadCommandGroup(
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

function buildGettingStartedText(resolveAvailable: boolean): string {
  const experimentalResolve = resolveAvailable
    ? "\n  githits resolve express              Resolve a package or repository name"
    : "";
  return `
${colorizeBrand("Getting started:", "primary", useColors, { bold: true })}
  githits init                         Connect GitHits to your coding agents
  githits login                        Sign in to your GitHits account
  githits mcp                          Show MCP setup instructions
  githits example "query"              Find real-world implementations${experimentalResolve}

Learn more at https://githits.com
Docs: https://docs.githits.com
Support: support@githits.com`;
}

function getTelemetryCommandName(command: Command): string {
  const names: string[] = [];
  let current: Command | null = command;

  while (current) {
    const name = current.name();
    if (name && name !== "githits") {
      names.unshift(name);
    }
    current = current.parent ?? null;
  }

  return `command.${names.join(".")}`;
}
