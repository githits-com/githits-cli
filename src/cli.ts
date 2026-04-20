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
if (shouldRegisterCodeCommands(process.argv.slice(2))) {
  await registerCodeCommandGroup(program);
}

// Auth status as subcommand of `auth`
const authCommand = program
  .command("auth")
  .summary("Manage authentication")
  .description("Manage authentication with GitHits.");
registerAuthStatusCommand(authCommand);

await program.parseAsync();

function shouldRegisterCodeCommands(args: string[]): boolean {
  const [firstArg] = args;
  return (
    firstArg === "code" ||
    firstArg === "help" ||
    firstArg === "--help" ||
    firstArg === "-h"
  );
}
