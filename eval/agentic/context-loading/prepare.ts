import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createContextInventory } from "../../../scripts/agent-context-load.js";
import protocol from "./protocol.json";

/** Shared argv contract; staging scripts do not launch agents. */
export function buildStudyArgv(
  host: "codex" | "claude",
  task: string,
  fixtureArgs: string[],
  configPath: string,
): string[] {
  return host === "codex"
    ? [
        "codex",
        "exec",
        "--json",
        "--ignore-user-config",
        "--disable",
        "apps",
        "--disable",
        "plugins",
        "--disable",
        "remote_plugin",
        "--dangerously-bypass-approvals-and-sandbox",
        "--skip-git-repo-check",
        "--model",
        protocol.models.codex,
        "-c",
        `model_reasoning_effort="${protocol.codexReasoningEffort}"`,
        "-c",
        'mcp_servers.githits_context_fixture.command="bun"',
        "-c",
        `mcp_servers.githits_context_fixture.args=${JSON.stringify(fixtureArgs)}`,
        task,
      ]
    : [
        "claude",
        "-p",
        task,
        "--model",
        protocol.models.claude,
        "--mcp-config",
        configPath,
        "--strict-mcp-config",
        "--output-format",
        "stream-json",
        "--verbose",
        "--permission-mode",
        "bypassPermissions",
        "--setting-sources",
        "project",
      ];
}

/** Stage fresh, local-only study inputs and argv; never launch an agent or alter auth. */
export async function prepareContextStudy(destination: string): Promise<void> {
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const skill = await readFile(
    join(root, "skills/githits-mcp/SKILL.md"),
    "utf8",
  );
  const anchor = "Load before any GitHits MCP tool call.";
  const heading = /# GitHits MCP\r?\n/.exec(skill)?.[0];
  if (!skill.includes(anchor) || !heading) {
    throw new Error(
      "Canonical skill changed: review the protocol's variant anchors",
    );
  }
  const output = resolve(destination);
  await mkdir(dirname(output), { recursive: true });
  // Refuse an existing study directory: reruns must preserve earlier evidence.
  await mkdir(output);
  const inventory = JSON.stringify(await createContextInventory(), null, 2);
  await writeFile(join(output, "inventory.json"), inventory);
  const variants = {
    baseline: skill,
    description: skill.replace(anchor, `${anchor} ${protocol.hint}`),
    body: skill.replace(heading, `${heading}\n${protocol.hint}\n`),
  };
  const fixturePath = join(
    root,
    "eval/agentic/context-loading/fixture-server.ts",
  );
  const configPath = join(output, "mcp.json");
  await writeFile(
    configPath,
    JSON.stringify(
      {
        mcpServers: {
          githits_context_fixture: { command: "bun", args: [fixturePath] },
        },
      },
      null,
      2,
    ),
  );
  const commands: Array<{
    host: string;
    variant: string;
    repetition: number;
    cwd: string;
    argv: string[];
  }> = [];
  for (const [index, order] of protocol.repetitionOrders.entries()) {
    for (const variant of order) {
      if (!(variant in variants)) throw new Error("Unknown protocol variant");
      const body = variants[variant as keyof typeof variants];
      for (const host of ["codex", "claude"] as const) {
        const cwd = join(output, host, `${variant}-${index + 1}`);
        const skillDir = join(
          cwd,
          host === "codex" ? ".agents" : ".claude",
          "skills/githits-mcp",
        );
        await mkdir(skillDir, { recursive: true });
        await writeFile(join(skillDir, "SKILL.md"), body);
        await writeFile(join(cwd, "prompt.txt"), protocol.task);
        const argv = buildStudyArgv(
          host,
          protocol.task,
          [fixturePath],
          configPath,
        );
        commands.push({ host, variant, repetition: index + 1, cwd, argv });
      }
    }
  }
  await writeFile(
    join(output, "study.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        canonicalSkillSha256: createHash("sha256").update(skill).digest("hex"),
        inventoryFileSha256: createHash("sha256")
          .update(inventory)
          .digest("hex"),
        expectedCliVersions: protocol.cliVersions,
        protocol,
        commands,
      },
      null,
      2,
    ),
  );
}

if (import.meta.main) {
  if (process.argv.length !== 3 || !process.argv[2])
    throw new Error(
      "Usage: bun eval/agentic/context-loading/prepare.ts <new-study-directory>",
    );
  await prepareContextStudy(process.argv[2]);
  process.stdout.write(
    "Prepared 18 commands and skill variants; no agents launched.\n",
  );
}
