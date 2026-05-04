import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

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

const [, , toolName, rawArgs] = process.argv;
assert(toolName, "usage: bun run scripts/mcp-call.ts <tool> <json-args>");
assert(rawArgs, "usage: bun run scripts/mcp-call.ts <tool> <json-args>");

const args = JSON.parse(rawArgs) as Record<string, unknown>;
const transport = new StdioClientTransport({
  command: "bun",
  args: ["run", "dev", "mcp", "start"],
});
const client = new Client({
  name: "githits-mcp-parity-smoke",
  version: "0.1.0",
});

try {
  await client.connect(transport);
  const result = (await client.callTool({
    name: toolName,
    arguments: args,
  })) as ToolCallResult;
  if (result.isError === true) {
    process.stderr.write(`${resultText(result, toolName)}\n`);
    process.exit(1);
  }
  process.stdout.write(resultText(result, toolName));
} finally {
  await client.close();
}
