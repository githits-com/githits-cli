import { buildMcpInstructions } from "@githits/mcp";
import {
  assertCleanErrorEnvelope,
  assertDefaultText,
  assertJsonResult,
  EXPECTED_MCP_TOOLS,
  type McpSmokeCaller,
  type McpSmokeToolResult,
  resultText,
  runMcpSmoke,
} from "@githits/mcp/smoke-test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  createIsolatedSmokeEnvironment,
  createScopedSmokeEnvironment,
} from "./smoke-environment.ts";
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

export const EXPECTED_EXPERIMENTAL_MCP_TOOLS = [
  ...EXPECTED_MCP_TOOLS,
  "resolve_target",
  "code_diff",
] as const;

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
  extraMcpArgs: readonly string[] = [],
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  const launch = toStdioLaunch(target, ["mcp", "start", ...extraMcpArgs]);
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

async function assertMcpSession(
  client: Client,
  expectedTools: readonly string[],
  context: string,
): Promise<void> {
  const response = await trackSmokeStep(`${context} listTools`, () =>
    client.listTools(),
  );
  const actual = response.tools.map((tool) => tool.name).sort();
  const expected = [...expectedTools].sort();
  assert(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${context}: expected exact tools ${expected.join(", ")}, got ${actual.join(", ")}`,
  );
}

async function assertStableMcpSession(
  client: Client,
  context: string,
): Promise<void> {
  await assertMcpSession(client, EXPECTED_MCP_TOOLS, context);
  const instructions = await client.getInstructions();
  assert(
    instructions === buildMcpInstructions(),
    `${context}: stable instructions changed from public baseline`,
  );
}

async function assertExperimentalMcpSession(
  client: Client,
  context: string,
): Promise<void> {
  await assertMcpSession(client, EXPECTED_EXPERIMENTAL_MCP_TOOLS, context);
  const instructions = await client.getInstructions();
  assert(
    typeof instructions === "string" &&
      instructions.includes("resolve_target") &&
      instructions.includes("code_diff") &&
      instructions.includes("credentials") &&
      instructions.includes("compatibility") &&
      instructions.includes("does not prove compatibility") &&
      instructions.includes("public-OSS") &&
      !instructions.includes("Opt-in issue reporting"),
    `${context}: experimental instructions missing routing/privacy guidance or reporting is enabled`,
  );
}

async function assertStableAuthProbe(
  client: Client,
  context: string,
): Promise<void> {
  const result = (await trackSmokeStep(
    `mcp search_language {"query":"python"} ${context}`,
    () =>
      client.callTool({
        name: "search_language",
        arguments: { query: "python" },
      }),
  )) as McpSmokeToolResult;
  const envelope = assertCleanErrorEnvelope(
    result,
    `search_language ${context}`,
  );
  assert(
    envelope.code === "AUTH_REQUIRED",
    `${context} probe returned unexpected code ${envelope.code}`,
  );
  assert(
    resultText(result, `search_language ${context}`).length > 0,
    `${context} probe returned empty error text`,
  );
}

async function assertUnauthenticatedBehavior(
  target: CliLaunchTarget,
): Promise<void> {
  const isolated = createIsolatedSmokeEnvironment("githits-mcp-smoke-home-");
  try {
    await withMcpClient(target, isolated.env, [], async (client) => {
      await assertStableMcpSession(client, "stable unauthenticated");
      await assertStableAuthProbe(client, "unauthenticated");
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
    await withMcpClient(target, isolated.env, [], async (client) => {
      await assertStableMcpSession(client, "stable registration");
      await assertStableAuthProbe(client, "registration");
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

async function runExperimentalRegistrationSmoke(
  target: CliLaunchTarget,
): Promise<void> {
  const isolated = createIsolatedSmokeEnvironment(
    "githits-mcp-experimental-registration-smoke-home-",
  );
  try {
    await withMcpClient(
      target,
      isolated.env,
      ["--experimental-tools"],
      async (client) => {
        await assertExperimentalMcpSession(client, "experimental registration");
        const resolveResult = (await trackSmokeStep(
          'mcp resolve_target {"name":"express"} registration',
          () =>
            client.callTool({
              name: "resolve_target",
              arguments: { name: "express" },
            }),
        )) as McpSmokeToolResult;
        assert(
          assertCleanErrorEnvelope(resolveResult, "resolve_target registration")
            .code === "AUTH_REQUIRED",
          "resolve_target registration should require auth",
        );

        const diffResult = (await trackSmokeStep(
          'mcp code_diff {"target":"npm:express"} registration',
          () =>
            client.callTool({
              name: "code_diff",
              arguments: {
                target: "npm:express",
                from: "5.2.0",
                to: "5.2.1",
                view: "name-status",
                format: "json",
              },
            }),
        )) as McpSmokeToolResult;
        assert(
          assertCleanErrorEnvelope(diffResult, "code_diff registration")
            .code === "AUTH_REQUIRED",
          "code_diff registration should require auth",
        );
      },
    );
    console.log("MCP experimental registration smoke passed");
  } finally {
    isolated.cleanup();
  }
}

async function runExperimentalLiveSmoke(
  target: CliLaunchTarget,
): Promise<void> {
  const scoped = createScopedSmokeEnvironment("githits-mcp-experimental-live-");
  try {
    await withMcpClient(
      target,
      scoped.env,
      ["--experimental-tools"],
      async (client) => {
        await assertExperimentalMcpSession(client, "experimental live");
        const authProbe = (await trackSmokeStep(
          'mcp search_language {"query":"python"} experimental live auth probe',
          () =>
            client.callTool({
              name: "search_language",
              arguments: { query: "python" },
            }),
        )) as McpSmokeToolResult;
        if (authProbe.isError === true) {
          const envelope = assertCleanErrorEnvelope(
            authProbe,
            "experimental live auth probe",
          );
          assert(
            envelope.code === "AUTH_REQUIRED",
            `experimental live auth probe returned ${envelope.code}`,
          );
          console.log("AUTH_REQUIRED: live MCP experimental smoke skipped");
          return;
        }

        const resolveText = (await trackSmokeStep(
          "mcp resolve_target default text experimental live",
          () =>
            client.callTool({
              name: "resolve_target",
              arguments: { name: "express" },
            }),
        )) as McpSmokeToolResult;
        const resolveTextBody = assertDefaultText(
          resolveText,
          "experimental resolve default text",
        );
        assert(
          resolveTextBody.includes("npm:express") &&
            !resolveTextBody.includes("githits ") &&
            !resolveTextBody.includes("--"),
          "experimental resolve text should use MCP-native follow-up guidance",
        );

        const resolveJson = (await trackSmokeStep(
          "mcp resolve_target JSON experimental live",
          () =>
            client.callTool({
              name: "resolve_target",
              arguments: { name: "express", format: "json" },
            }),
        )) as McpSmokeToolResult;
        const resolvePayload = assertJsonResult(
          resolveJson,
          "experimental resolve JSON",
        );
        assert(
          resolvePayload !== null && typeof resolvePayload === "object",
          "experimental resolve JSON should be an object",
        );

        const diffText = (await trackSmokeStep(
          "mcp code_diff name-status default text experimental live",
          () =>
            client.callTool({
              name: "code_diff",
              arguments: {
                target: "npm:express",
                from: "5.2.0",
                to: "5.2.1",
                view: "name-status",
              },
            }),
        )) as McpSmokeToolResult;
        const diffTextBody = assertDefaultText(
          diffText,
          "experimental code diff default text",
        );
        assert(
          diffTextBody.length > 0 &&
            !diffTextBody.includes("githits ") &&
            !diffTextBody.includes("--"),
          "experimental code diff text should be MCP-native",
        );

        const diffJson = (await trackSmokeStep(
          "mcp code_diff name-status JSON experimental live",
          () =>
            client.callTool({
              name: "code_diff",
              arguments: {
                target: "npm:express",
                from: "5.2.0",
                to: "5.2.1",
                view: "name-status",
                format: "json",
              },
            }),
        )) as McpSmokeToolResult;
        const diffPayload = assertJsonResult(
          diffJson,
          "experimental code diff JSON",
        );
        assert(
          diffPayload !== null && typeof diffPayload === "object",
          "experimental code diff JSON should be an object",
        );
      },
    );
  } finally {
    scoped.cleanup();
  }
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const options = parseMcpSmokeArgs(argv);
  process.stderr.write(
    `[smoke] CLI launch target: ${formatCliLaunchTarget(options.target)}\n`,
  );
  if (options.mode === "registration") {
    await runRegistrationSmoke(options.target);
    await runExperimentalRegistrationSmoke(options.target);
    return;
  }

  await assertUnauthenticatedBehavior(options.target);
  const stable = createScopedSmokeEnvironment("githits-mcp-live-stable-");
  try {
    await withMcpClient(options.target, stable.env, [], async (client) => {
      await assertStableMcpSession(client, "stable live");
      await runMcpSmoke(createSmokeCaller(client), { logger: console });
    });
  } finally {
    stable.cleanup();
  }
  await runExperimentalLiveSmoke(options.target);
}

if (import.meta.main) {
  try {
    await main();
  } finally {
    printSmokeTimingSummary();
  }
}
