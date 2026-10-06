import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { AGENTIC_ASK_REQUEST_TIMEOUT_MS } from "@githits/core-internal";
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
import { version } from "../package.json";
import history from "../src/services/fixtures/mcp-skill-history.json";
import { inspectSkillContent } from "../src/services/mcp-skill-content.js";
import {
  createIsolatedSmokeEnvironment,
  createScopedSmokeEnvironment,
  writeSmokeConfig,
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
  "research",
] as const;
export const STABLE_MCP_SMOKE_CONFIG = "[experimental]\ntools = false\n";

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
  env: Record<string, string>,
  extraMcpArgs: readonly string[] = [],
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  const launch = toStdioLaunch(target, ["mcp", "start", ...extraMcpArgs]);
  const transport = new StdioClientTransport({
    command: launch.command,
    args: launch.args,
    env,
    cwd: env.HOME,
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
  for (const tool of response.tools) {
    assert(
      tool.annotations?.readOnlyHint === true,
      `${context}: ${tool.name} must advertise readOnlyHint: true`,
    );
    const expectedOpenWorldHint = tool.name !== "quick_start";
    assert(
      tool.annotations?.openWorldHint === expectedOpenWorldHint,
      `${context}: ${tool.name} must advertise openWorldHint: ${expectedOpenWorldHint}, got ${String(tool.annotations?.openWorldHint)}`,
    );
    assert(
      tool.annotations?.destructiveHint === false,
      `${context}: ${tool.name} must advertise destructiveHint: false`,
    );
  }
  let removedFeedbackError = "";
  try {
    const result = await client.callTool({ name: "feedback", arguments: {} });
    removedFeedbackError = result.isError ? JSON.stringify(result.content) : "";
  } catch (error) {
    removedFeedbackError =
      error instanceof Error ? error.message : String(error);
  }
  assert(
    removedFeedbackError.includes("Tool feedback not found"),
    `${context}: removed feedback must fail as an unknown tool`,
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
    instructions === undefined,
    `${context}: GitHits must not publish MCP server instructions`,
  );
  const quickStart = assertDefaultText(
    (await client.callTool({
      name: "quick_start",
      arguments: {},
    })) as McpSmokeToolResult,
    `${context}: quick_start`,
  );
  assert(
    quickStart.includes("`search`") &&
      quickStart.includes("`grep`") &&
      quickStart.includes("`code_diff`"),
    `${context}: quick_start missing stable routing guidance`,
  );
}

async function assertExperimentalMcpSession(
  client: Client,
  context: string,
): Promise<void> {
  await assertMcpSession(client, EXPECTED_EXPERIMENTAL_MCP_TOOLS, context);
  const instructions = await client.getInstructions();
  assert(
    instructions === undefined,
    `${context}: GitHits must not publish MCP server instructions`,
  );
  const quickStart = assertDefaultText(
    (await client.callTool({
      name: "quick_start",
      arguments: {},
    })) as McpSmokeToolResult,
    `${context}: quick_start`,
  );
  assert(
    quickStart.includes("`research`") &&
      !quickStart.includes("`ask`") &&
      quickStart.includes("resolve_target") &&
      quickStart.includes("code_diff") &&
      quickStart.includes("A selected `site:` is docs-only") &&
      quickStart.includes('source:"docs"') &&
      quickStart.includes("`read`") &&
      quickStart.includes("credentials") &&
      /Raw diffs do not\s+prove compatibility/.test(quickStart) &&
      quickStart.includes("public OSS") &&
      !quickStart.includes("Issue reporting"),
    `${context}: experimental quick_start missing routing/privacy guidance or contains retired issue-reporting guidance`,
  );
}

async function assertStableAuthProbe(
  client: Client,
  context: string,
): Promise<void> {
  const result = (await trackSmokeStep(
    `mcp pkg_info {"target":"npm:express"} ${context}`,
    () =>
      client.callTool({
        name: "pkg_info",
        arguments: { target: "npm:express", format: "json" },
      }),
  )) as McpSmokeToolResult;
  const envelope = assertCleanErrorEnvelope(result, `pkg_info ${context}`);
  assert(
    envelope.code === "AUTH_REQUIRED",
    `${context} probe returned unexpected code ${envelope.code}`,
  );
  assert(
    resultText(result, `pkg_info ${context}`).length > 0,
    `${context} probe returned empty error text`,
  );
  for (const format of [undefined, "text"] as const) {
    const readable = (await client.callTool({
      name: "pkg_info",
      arguments: { target: "npm:express", ...(format ? { format } : {}) },
    })) as McpSmokeToolResult;
    assert(
      readable.isError === true,
      `${context}: text auth probe must be an error`,
    );
    const text = resultText(readable, `pkg_info ${context} text`);
    assert(
      text.includes("login"),
      `${context}: text auth error must include remediation`,
    );
    assert(
      !text.trimStart().startsWith("{"),
      `${context}: text auth error must not be JSON`,
    );
  }
}

/** Exercise real startup maintenance inside disposable smoke roots. */
async function prepareSkillUpdateProbe(root: string): Promise<void> {
  const legacy = history[0]?.content;
  assert(
    legacy !== undefined,
    "skill maintenance requires a verified legacy fixture",
  );
  for (const [host, payload] of [
    [".agents", legacy],
    [".claude", `${legacy}User edit\n`],
  ] as const) {
    const dir = join(root, host, "skills", "githits-mcp");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "SKILL.md"), payload);
  }
}

async function assertSkillUpdateProbe(root: string): Promise<void> {
  const installed = inspectSkillContent(
    await readFile(
      join(root, ".agents", "skills", "githits-mcp", "SKILL.md"),
      "utf8",
    ),
  );
  const bundled = await readFile(
    new URL("../skills/githits-mcp/SKILL.md", import.meta.url),
    "utf8",
  );
  assert(
    installed.kind === "managed" &&
      installed.content === bundled &&
      installed.version === version,
    "MCP startup must upgrade unchanged legacy guidance to its exact bundled payload",
  );
  assert(
    (await readFile(
      join(root, ".claude", "skills", "githits-mcp", "SKILL.md"),
      "utf8",
    )) === `${history[0]?.content}User edit\n`,
    "MCP startup must preserve edited guidance",
  );
}

async function assertUnauthenticatedBehavior(
  target: CliLaunchTarget,
): Promise<void> {
  const isolated = createIsolatedSmokeEnvironment("githits-mcp-smoke-home-");
  try {
    writeSmokeConfig(isolated.env, STABLE_MCP_SMOKE_CONFIG);
    await prepareSkillUpdateProbe(isolated.root);
    await withMcpClient(target, isolated.env, [], async (client) => {
      await assertSkillUpdateProbe(isolated.root);
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
    writeSmokeConfig(isolated.env, STABLE_MCP_SMOKE_CONFIG);
    await prepareSkillUpdateProbe(isolated.root);
    await withMcpClient(target, isolated.env, [], async (client) => {
      await assertSkillUpdateProbe(isolated.root);
      await assertStableMcpSession(client, "stable registration");
      await assertStableAuthProbe(client, "registration");
      const diffResult = (await client.callTool({
        name: "code_diff",
        arguments: {
          target: "npm:express",
          from: "5.2.0",
          to: "5.2.1",
          format: "json",
        },
      })) as McpSmokeToolResult;
      assert(
        assertCleanErrorEnvelope(diffResult, "stable code_diff registration")
          .code === "AUTH_REQUIRED",
        "stable code_diff must reach auth without experimental opt-in",
      );
      const resolveResult = (await client.callTool({
        name: "resolve_target",
        arguments: { name: "express", format: "json" },
      })) as McpSmokeToolResult;
      assert(
        assertCleanErrorEnvelope(
          resolveResult,
          "stable resolve_target registration",
        ).code === "AUTH_REQUIRED",
        "stable resolve_target must reach auth without experimental opt-in",
      );
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
        for (const subject of [{ target: "npm:express" }, {}]) {
          const researchResult = (await trackSmokeStep(
            `mcp research ${JSON.stringify(subject)} registration`,
            () =>
              client.callTool(
                {
                  name: "research",
                  arguments: {
                    ...subject,
                    format: "json",
                    question: "Where is Express router dispatch implemented?",
                  },
                },
                undefined,
                { timeout: AGENTIC_ASK_REQUEST_TIMEOUT_MS },
              ),
          )) as McpSmokeToolResult;
          assert(
            assertCleanErrorEnvelope(researchResult, "research registration")
              .code === "AUTH_REQUIRED",
            "research registration should require auth",
          );
        }
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
          'mcp pkg_info {"target":"npm:express"} experimental live auth probe',
          () =>
            client.callTool({
              name: "pkg_info",
              arguments: { target: "npm:express", format: "json" },
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

        const researchJson = (await trackSmokeStep(
          "mcp research JSON experimental live",
          () =>
            client.callTool(
              {
                name: "research",
                arguments: {
                  target: "npm:express",
                  question: "Where is router dispatch implemented?",
                  format: "json",
                },
              },
              undefined,
              { timeout: AGENTIC_ASK_REQUEST_TIMEOUT_MS },
            ),
        )) as McpSmokeToolResult;
        const researchRecord = assertJsonResult(
          researchJson,
          "experimental research JSON",
        ) as Record<string, unknown>;
        assert(
          typeof researchRecord.display_markdown === "string" &&
            researchRecord.display_markdown.length > 0 &&
            typeof researchRecord.thread_id === "string",
          "experimental research should return display text and thread metadata",
        );

        const researchUrlJson = (await trackSmokeStep(
          "mcp research URL JSON experimental live",
          () =>
            client.callTool(
              {
                name: "research",
                arguments: {
                  thread_id: researchRecord.thread_id,
                  question:
                    "How is the matched route handler invoked after dispatch?",
                  source_format: "url",
                  format: "json",
                },
              },
              undefined,
              { timeout: AGENTIC_ASK_REQUEST_TIMEOUT_MS },
            ),
        )) as McpSmokeToolResult;
        const researchUrlPayload = assertJsonResult(
          researchUrlJson,
          "experimental research URL JSON",
        );
        assert(
          researchUrlPayload !== null &&
            typeof researchUrlPayload === "object" &&
            !Array.isArray(researchUrlPayload),
          "experimental research URL JSON should be an object",
        );
        const researchUrlRecord = researchUrlPayload as Record<string, unknown>;
        assert(
          typeof researchUrlRecord.display_markdown === "string" &&
            researchUrlRecord.display_markdown.length > 0 &&
            typeof researchUrlRecord.tool_call_id === "string" &&
            researchUrlRecord.thread_id === researchRecord.thread_id,
          "experimental research URL JSON should preserve the display contract and thread",
        );
        const researchText = (await trackSmokeStep(
          "mcp research text follow-up experimental live",
          () =>
            client.callTool(
              {
                name: "research",
                arguments: {
                  thread_id: researchRecord.thread_id,
                  question: "Summarize that answer briefly.",
                },
              },
              undefined,
              { timeout: AGENTIC_ASK_REQUEST_TIMEOUT_MS },
            ),
        )) as McpSmokeToolResult;
        assert(
          assertDefaultText(researchText, "experimental research text").trim()
            .length > 0,
          "experimental research should return nonempty backend display text",
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
    writeSmokeConfig(stable.env, STABLE_MCP_SMOKE_CONFIG);
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
