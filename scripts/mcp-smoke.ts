import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertCleanErrorEnvelope,
  type McpSmokeCaller,
  type McpSmokeToolResult,
  resultText,
  runMcpSmoke,
} from "@githits/mcp/smoke-test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  printSmokeTimingSummary,
  summarizeMcpArgs,
  trackSmokeStep,
} from "./smoke-telemetry.ts";

const AUTH_ENV_KEYS = ["GITHITS_API_TOKEN", "GITHITS_TOKEN"] as const;
const UNAUTHENTICATED_MCP_URL = "https://mcp-smoke-unauth.githits.invalid";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function isolatedUnauthenticatedEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (
      value !== undefined &&
      !AUTH_ENV_KEYS.includes(key as (typeof AUTH_ENV_KEYS)[number])
    ) {
      env[key] = value;
    }
  }
  const home = mkdtempSync(join(tmpdir(), "githits-mcp-smoke-home-"));
  env.HOME = home;
  env.USERPROFILE = home;
  env.XDG_CONFIG_HOME = join(home, ".config");
  env.APPDATA = join(home, "AppData", "Roaming");
  env.GITHITS_AUTH_STORAGE = "file";
  // Auth storage keys credentials by MCP URL. Keep unauth probes away from
  // real keychain entries even on platforms where HOME does not isolate them.
  env.GITHITS_MCP_URL = UNAUTHENTICATED_MCP_URL;
  return env;
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
  env: Record<string, string> | undefined,
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  const transport = new StdioClientTransport({
    command: "bun",
    args: ["run", "dev", "mcp", "start"],
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

async function assertUnauthenticatedBehavior(): Promise<void> {
  const env = isolatedUnauthenticatedEnv();
  const home = env.HOME;
  try {
    await withMcpClient(env, async (client) => {
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
    if (home) rmSync(home, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  await assertUnauthenticatedBehavior();
  await withMcpClient(undefined, async (client) => {
    await runMcpSmoke(createSmokeCaller(client), { logger: console });
  });
}

try {
  await main();
} finally {
  printSmokeTimingSummary();
}
