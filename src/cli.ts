#!/usr/bin/env node
import { Command } from "commander";
import { version } from "../package.json";
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
  githits init                         Set up MCP for your coding agents
  githits login                        Authenticate with your GitHits account
  githits mcp                          Show MCP setup instructions
  githits example "query"              Get code examples

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
const registrationArgv = stripRootRegistrationOptions(argv);
const shouldLoadGatedHelpRegistration =
  needsGatedHelpRegistration(registrationArgv);
const helpRegistrationOptions = shouldLoadGatedHelpRegistration
  ? await loadHelpRegistrationOptions(registrationArgv)
  : undefined;

if (shouldEagerLoadSearchCommands(registrationArgv)) {
  await withTelemetrySpan("cli.register.search", () =>
    registerUnifiedSearchCommands(program, helpRegistrationOptions),
  );
}
if (shouldEagerLoadGatedCommandGroup(registrationArgv, "code")) {
  await withTelemetrySpan("cli.register.code-group", () =>
    registerCodeCommandGroup(program, helpRegistrationOptions),
  );
}
if (shouldEagerLoadGatedCommandGroup(registrationArgv, "pkg")) {
  await withTelemetrySpan("cli.register.pkg-group", () =>
    registerPkgCommandGroup(program, helpRegistrationOptions),
  );
}
if (shouldEagerLoadGatedCommandGroup(registrationArgv, "docs")) {
  await withTelemetrySpan("cli.register.docs-group", () =>
    registerDocsCommandGroup(program, helpRegistrationOptions),
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
 * Commander supports root options before subcommands, e.g.
 * `githits --no-color pkg info`. Registration happens before Commander
 * parses argv, so the lightweight gated-command sniff must ignore root-only
 * flags or it will misclassify `--no-color` as the requested command.
 */
function stripRootRegistrationOptions(args: string[]): string[] {
  return args.filter((arg) => arg !== "--no-color");
}

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
      secondArg === "pkg" ||
      secondArg === "docs"
    );
  }

  return (
    isSearchHelpTarget(firstArg) ||
    firstArg === "code" ||
    firstArg === "pkg" ||
    firstArg === "docs"
  );
}

function isSearchHelpTarget(value: string | undefined): boolean {
  return value === "search" || value === "search-status";
}

async function loadHelpRegistrationOptions(args: string[]) {
  const { resolveStartupCodeNavigationRegistrationState } = await import(
    "./container.js"
  );
  const registrationState =
    await resolveStartupCodeNavigationRegistrationState();
  return {
    capability: registrationState.capability,
    expiredStoredAuth: shouldUseExpiredStoredAuthFallbackForHelp(args)
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
    firstArg === "docs" ||
    (firstArg === "help" &&
      (isSearchHelpTarget(secondArg) ||
        secondArg === "code" ||
        secondArg === "pkg" ||
        secondArg === "docs"))
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
