import {
  assertCleanErrorEnvelope,
  type McpSmokeCaller,
  type McpSmokeToolResult,
  resultText,
  runMcpSmoke,
} from "@githits/mcp/smoke-test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createIsolatedSmokeEnvironment } from "./smoke-environment.ts";
import {
  type CliLaunchTarget,
  formatCliLaunchTarget,
  parseCliLaunchTarget,
  toStdioLaunch,
} from "./smoke-launch-target.ts";
import {
  printSmokeTimingSummary,
  summarizeMcpArgs,
  trackSmokeStep,
} from "./smoke-telemetry.ts";

export interface McpSmokeScriptOptions {
  mode: "live" | "registration";
  target: CliLaunchTarget;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

export function parseMcpSmokeArgs(
  argv: readonly string[],
  cwd = process.cwd(),
): McpSmokeScriptOptions {
  const parsed = parseCliLaunchTarget(argv, cwd);
  let mode: McpSmokeScriptOptions["mode"] = "live";
  let modeSpecified = false;

  for (let index = 0; index < parsed.remainingArgs.length; index += 1) {
    const value = parsed.remainingArgs[index];
    if (value !== "--mode") {
      throw new Error(`Unknown MCP smoke option: ${value}`);
    }
    if (modeSpecified) throw new Error("--mode may only be specified once");
    const requestedMode = parsed.remainingArgs[index + 1];
    if (requestedMode !== "live" && requestedMode !== "registration") {
      throw new Error("--mode must be live or registration");
    }
    mode = requestedMode;
    modeSpecified = true;
    index += 1;
  }

  return { mode, target: parsed.target };
}

function createSmokeCaller(client: Client): McpSmokeCaller {
  return {
    listTools: () => trackSmokeStep("mcp listTools", () => client.listTools()),
    callTool: (name: string, args: Record<string, unknown>) =>
      trackSmokeStep(
        `mcp ${name}${summarizeMcpArgs(args)}`,
        async () =>
          (await client.callTool({
            name,
            arguments: args,
          })) as McpSmokeToolResult,
      ),
  };
}

async function withMcpClient<T>(
  target: CliLaunchTarget,
  env: Record<string, string> | undefined,
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  const launch = toStdioLaunch(target, ["mcp", "start"]);
  const transport = new StdioClientTransport({
    command: launch.command,
    args: launch.args,
    env,
  });
  const client = new Client({ name: "githits-mcp-smoke", version: "0.1.0" });
  try {
    await client.connect(transport);
    return await fn(client);
  } finally {
    await client.close();
  }
}

async function assertUnauthenticatedBehavior(
  target: CliLaunchTarget,
): Promise<void> {
  const isolated = createIsolatedSmokeEnvironment("githits-mcp-smoke-home-");
  try {
    await withMcpClient(target, isolated.env, async (client) => {
      const toolsResponse = await trackSmokeStep(
        "mcp listTools unauthenticated",
        () => client.listTools(),
      );
      assert(
        toolsResponse.tools.length > 0,
        "unauthenticated listTools returned no tools",
      );
      const result = (await trackSmokeStep(
        'mcp search_language {"query":"python"} unauthenticated',
        () =>
          client.callTool({
            name: "search_language",
            arguments: { query: "python" },
          }),
      )) as McpSmokeToolResult;
      const envelope = assertCleanErrorEnvelope(
        result,
        "search_language unauthenticated",
      );
      assert(
        envelope.code === "AUTH_REQUIRED",
        `unauthenticated probe returned unexpected code ${envelope.code}`,
      );
      assert(
        resultText(result, "search_language unauthenticated").length > 0,
        "unauthenticated probe returned empty error text",
      );
    });
  } finally {
    isolated.cleanup();
  }
}

async function runRegistrationSmoke(target: CliLaunchTarget): Promise<void> {
  const isolated = createIsolatedSmokeEnvironment(
    "githits-mcp-registration-smoke-home-",
  );
  try {
    await withMcpClient(target, isolated.env, async (client) => {
      await runMcpSmoke(createSmokeCaller(client), {
        includeLiveTools: false,
        logger: console,
      });
    });
    console.log("MCP registration smoke passed");
  } finally {
    isolated.cleanup();
  }
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const options = parseMcpSmokeArgs(argv);
  process.stderr.write(
    `[smoke] CLI launch target: ${formatCliLaunchTarget(options.target)}\n`,
  );
  if (options.mode === "registration") {
    await runRegistrationSmoke(options.target);
    return;
  }

  await assertUnauthenticatedBehavior(options.target);
  await withMcpClient(options.target, inheritedEnv(), async (client) => {
    await runMcpSmoke(createSmokeCaller(client), { logger: console });
  });
}

function inheritedEnv(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
}

if (import.meta.main) {
  try {
    await main();
  } finally {
    printSmokeTimingSummary();
  }
}
