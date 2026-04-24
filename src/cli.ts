#!/usr/bin/env node
import { Command } from "commander";
import { version } from "../package.json";
import {
  registerAuthStatusCommand,
  registerCodeCommandGroup,
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
import {
  endTelemetrySpan,
  flushTelemetry,
  isTelemetryEnabled,
  startTelemetrySpan,
  withTelemetrySpan,
} from "./shared/index.js";

const program = new Command();
const commandSpans = new WeakMap<
  Command,
  ReturnType<typeof startTelemetrySpan>
>();

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
  .hook("preAction", (thisCommand, actionCommand) => {
    if (thisCommand.opts().color === false) {
      process.env.NO_COLOR = "1";
    }

    const command = actionCommand ?? thisCommand;
    commandSpans.set(
      command,
      startTelemetrySpan(getTelemetryCommandName(command)),
    );
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
  githits example "query" --lang python                  Get code examples

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
const argv = process.argv.slice(2);
const helpInvocation = isHelpInvocation(argv);
const shouldLoadGatedHelpRegistration = needsGatedHelpRegistration(argv);
const helpRegistrationOptions = shouldLoadGatedHelpRegistration
  ? await loadHelpRegistrationOptions()
  : undefined;

if (shouldEagerLoadSearchCommands(argv)) {
  await withTelemetrySpan("cli.register.search", () =>
    registerUnifiedSearchCommands(program, helpRegistrationOptions),
  );
}
if (shouldEagerLoadGatedCommandGroup(argv, "code")) {
  await withTelemetrySpan("cli.register.code-group", () =>
    registerCodeCommandGroup(program, helpRegistrationOptions),
  );
}
if (shouldEagerLoadGatedCommandGroup(argv, "pkg")) {
  await withTelemetrySpan("cli.register.pkg-group", () =>
    registerPkgCommandGroup(program, helpRegistrationOptions),
  );
}

// Auth status as subcommand of `auth`
const authCommand = program
  .command("auth")
  .summary("Manage authentication")
  .description("Manage authentication with GitHits.");
registerAuthStatusCommand(authCommand);

await withTelemetrySpan("cli.parse", () => program.parseAsync());

/**
 * Argv-sniff optimisation for gated command groups. Returns `true`
 * when the user's invocation might need the group registered — i.e.
 * they typed the group name or asked for help. This is NOT a
 * capability gate; the actual gate lives inside
 * `registerXxxCommandGroup`. Here we only decide whether to build
 * the container eagerly so registration can run.
 */
function shouldEagerLoadGatedCommandGroup(
  args: string[],
  groupName: string,
): boolean {
  const [firstArg] = args;
  return (
    firstArg === groupName || (firstArg === "help" && args[1] === groupName)
  );
}

function shouldEagerLoadSearchCommands(args: string[]): boolean {
  const [firstArg] = args;
  return (
    firstArg === "search" ||
    firstArg === "search-status" ||
    (firstArg === "help" && isSearchHelpTarget(args[1]))
  );
}

function isHelpInvocation(args: string[]): boolean {
  return (
    args.length === 0 ||
    args[0] === "help" ||
    args.includes("--help") ||
    args.includes("-h")
  );
}

function needsGatedHelpRegistration(args: string[]): boolean {
  if (!isHelpInvocation(args)) {
    return false;
  }

  const [firstArg, secondArg] = args;
  if (firstArg === "help") {
    return (
      isSearchHelpTarget(secondArg) ||
      secondArg === "code" ||
      secondArg === "pkg"
    );
  }

  return (
    isSearchHelpTarget(firstArg) || firstArg === "code" || firstArg === "pkg"
  );
}

function isSearchHelpTarget(value: string | undefined): boolean {
  return value === "search" || value === "search-status";
}

async function loadHelpRegistrationOptions() {
  const { resolveStartupCodeNavigationRegistrationState } = await import(
    "./container.js"
  );
  const registrationState =
    await resolveStartupCodeNavigationRegistrationState();
  return {
    capability: registrationState.capability,
    expiredStoredAuth: shouldUseExpiredStoredAuthFallbackForHelp(argv)
      ? registrationState.expiredStoredAuth
      : false,
  };
}

function shouldUseExpiredStoredAuthFallbackForHelp(args: string[]): boolean {
  const [firstArg, secondArg] = args;
  return (
    firstArg === "search" ||
    firstArg === "search-status" ||
    firstArg === "code" ||
    firstArg === "pkg" ||
    (firstArg === "help" &&
      (isSearchHelpTarget(secondArg) ||
        secondArg === "code" ||
        secondArg === "pkg"))
  );
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
