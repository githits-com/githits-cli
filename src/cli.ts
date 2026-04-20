#!/usr/bin/env node
import { Command } from "commander";
import { version } from "../package.json";
import {
  registerAuthStatusCommand,
  registerCodeCommandGroup,
  registerFeedbackCommand,
  registerInitCommand,
  registerLanguagesCommand,
  registerLoginCommand,
  registerLogoutCommand,
  registerMcpCommand,
  registerPkgCommandGroup,
  registerSearchCommand,
} from "./commands/index.js";

const program = new Command();

program
  .name("githits")
  .description("Code examples from global open source for your AI assistant")
  .version(version)
  .option("--no-color", "Disable colored output")
  .hook("preAction", (thisCommand) => {
    if (thisCommand.opts().color === false) {
      process.env.NO_COLOR = "1";
    }
  })
  .addHelpText(
    "after",
    `
Getting started:
  githits init                           Set up MCP for your coding agents
  githits login                          Authenticate with your GitHits account
  githits mcp                            Start MCP server for your AI assistant
  githits search "query" --lang python   Search for code examples

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
registerSearchCommand(program);
registerLanguagesCommand(program);
registerFeedbackCommand(program);
const argv = process.argv.slice(2);
if (shouldEagerLoadGatedCommandGroup(argv, "code")) {
  await registerCodeCommandGroup(program);
}
if (shouldEagerLoadGatedCommandGroup(argv, "pkg")) {
  await registerPkgCommandGroup(program);
}

// Auth status as subcommand of `auth`
const authCommand = program
  .command("auth")
  .summary("Manage authentication")
  .description("Manage authentication with GitHits.");
registerAuthStatusCommand(authCommand);

await program.parseAsync();

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
    firstArg === groupName ||
    firstArg === "help" ||
    firstArg === "--help" ||
    firstArg === "-h"
  );
}
