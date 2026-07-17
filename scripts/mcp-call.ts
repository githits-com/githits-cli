import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  type CliLaunchTarget,
  parseCliLaunchTarget,
  toStdioLaunch,
} from "./smoke-launch-target.ts";

interface TextContent {
  type: "text";
  text: string;
}

interface ToolCallResult {
  content?: unknown;
  isError?: boolean;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function resultText(result: ToolCallResult, context: string): string {
  assert(Array.isArray(result.content), `${context}: expected content array`);
  const first = result.content[0] as Partial<TextContent> | undefined;
  assert(first?.type === "text", `${context}: expected text content`);
  assert(typeof first.text === "string", `${context}: expected text string`);
  return first.text;
}

export interface McpCallOptions {
  target: CliLaunchTarget;
  toolName: string;
  args: Record<string, unknown>;
}

export function parseMcpCallArgs(
  argv: readonly string[],
  cwd = process.cwd(),
): McpCallOptions {
  const parsed = parseCliLaunchTarget(argv, cwd);
  assert(
    parsed.remainingArgs.length === 2,
    "usage: bun run scripts/mcp-call.ts [--cli-entry <path>] <tool> <json-args>",
  );
  const [toolName, rawArgs] = parsed.remainingArgs;
  assert(toolName, "MCP parity tool name is required");
  assert(rawArgs, "MCP parity JSON arguments are required");
  const args: unknown = JSON.parse(rawArgs);
  assert(
    args !== null && typeof args === "object" && !Array.isArray(args),
    "MCP parity arguments must be a JSON object",
  );
  return {
    target: parsed.target,
    toolName,
    args: args as Record<string, unknown>,
  };
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const options = parseMcpCallArgs(argv);
  const launch = toStdioLaunch(options.target, ["mcp", "start"]);
  const transport = new StdioClientTransport({
    command: launch.command,
    args: launch.args,
    env: Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] => entry[1] !== undefined,
      ),
    ),
  });
  const client = new Client({
    name: "githits-mcp-parity-smoke",
    version: "0.1.0",
  });

  try {
    await client.connect(transport);
    const result = (await client.callTool({
      name: options.toolName,
      arguments: options.args,
    })) as ToolCallResult;
    if (result.isError === true) {
      process.stderr.write(`${resultText(result, options.toolName)}\n`);
      process.exitCode = 1;
      return;
    }
    process.stdout.write(resultText(result, options.toolName));
  } finally {
    await client.close();
  }
}

if (import.meta.main) {
  await main();
}
