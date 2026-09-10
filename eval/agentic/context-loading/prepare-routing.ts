import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createContextInventory } from "../../../scripts/agent-context-load.js";
import { buildStudyArgv } from "./prepare.js";
import protocol from "./protocol.json";
import {
  BOOTSTRAP_SKILL_BODY,
  buildRoutingGuide,
  ROUTING_QUICK_START_DESCRIPTION,
  ROUTING_SKILL_DESCRIPTION,
} from "./routing-guide.js";

export const ROUTING_TASKS = {
  grep: protocol.task,
  package:
    "Use GitHits MCP to look up the npm package zod's license and latest version. Report those two facts plus any evidence limitations. Do not edit files, delegate, or use CLI/web alternatives. Follow available skill guidance.",
};

/** Stage two paired delivery comparisons with fixed tasks and rotated order. */
export async function prepareRoutingStudy(destination: string): Promise<void> {
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const canonical = await readFile(
    join(root, "skills/githits-mcp/SKILL.md"),
    "utf8",
  );
  const match = /^(---\r?\n[\s\S]*?\r?\n---\r?\n)/.exec(canonical);
  if (!match?.[1]) throw new Error("Missing skill metadata");
  const header = match[1];
  const routingHeader = `---\nname: githits-mcp\ndescription: ${JSON.stringify(ROUTING_SKILL_DESCRIPTION)}\n---\n`;
  const routingGuide = buildRoutingGuide();
  const variants = {
    "skill-baseline": { skill: canonical, guide: "canonical" },
    "skill-router": {
      skill: `${routingHeader}\n# GitHits MCP\n\nThis skill contains the routing guide; do not call quick_start again.\n\n${routingGuide}\n`,
      guide: "routing",
    },
    "bootstrap-baseline": {
      skill: `${header}\n${BOOTSTRAP_SKILL_BODY}`,
      guide: "canonical",
    },
    "bootstrap-router": {
      skill: `${routingHeader}\n${BOOTSTRAP_SKILL_BODY}`,
      guide: "routing",
    },
  } as const;
  const output = resolve(destination);
  await mkdir(dirname(output), { recursive: true });
  await mkdir(output); // Refuse existing evidence directories.
  await writeFile(
    join(output, "inventory.json"),
    JSON.stringify(await createContextInventory(), null, 2),
  );
  const names = Object.keys(variants) as Array<keyof typeof variants>;
  const commands: Array<{
    host: string;
    variant: string;
    workload: string;
    repetition: number;
    cwd: string;
    argv: string[];
  }> = [];
  for (let repetition = 1; repetition <= 3; repetition++) {
    const offset = repetition - 1;
    for (const variant of [...names.slice(offset), ...names.slice(0, offset)]) {
      const candidate = variants[variant];
      for (const [workload, task] of Object.entries(ROUTING_TASKS)) {
        for (const host of ["codex", "claude"] as const) {
          const cwd = join(
            output,
            host,
            `${variant}-${workload}-${repetition}`,
          );
          const skillDir = join(
            cwd,
            host === "codex" ? ".agents" : ".claude",
            "skills/githits-mcp",
          );
          await mkdir(skillDir, { recursive: true });
          await writeFile(join(skillDir, "SKILL.md"), candidate.skill);
          await writeFile(join(cwd, "prompt.txt"), task);
          const fixtureArgs = [
            join(root, "eval/agentic/context-loading/fixture-server.ts"),
            candidate.guide,
          ];
          const configPath = join(cwd, "mcp.json");
          await writeFile(
            configPath,
            JSON.stringify(
              {
                mcpServers: {
                  githits_context_fixture: {
                    command: "bun",
                    args: fixtureArgs,
                  },
                },
              },
              null,
              2,
            ),
          );
          commands.push({
            host,
            variant,
            workload,
            repetition,
            cwd,
            argv: buildStudyArgv(host, task, fixtureArgs, configPath),
          });
        }
      }
    }
  }
  const sha256 = (value: string): string =>
    createHash("sha256").update(value).digest("hex");
  await writeFile(
    join(output, "study.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        design:
          "Two paired delivery comparisons, three rotated repetitions, two workloads, two hosts. Bootstrap variants both load an entry skill; neither is plain MCP without a skill.",
        expectedCliVersions: protocol.cliVersions,
        requestedModels: protocol.models,
        requestedCodexEffort: protocol.codexReasoningEffort,
        tasks: ROUTING_TASKS,
        variants: Object.fromEntries(
          Object.entries(variants).map(([name, value]) => [
            name,
            { ...value, skillSha256: sha256(value.skill) },
          ]),
        ),
        routingGuide,
        routingQuickStartDescription: ROUTING_QUICK_START_DESCRIPTION,
        commands,
      },
      null,
      2,
    ),
  );
}

if (import.meta.main) {
  if (process.argv.length !== 3 || !process.argv[2])
    throw new Error("Usage: prepare-routing.ts <new-study-directory>");
  await prepareRoutingStudy(process.argv[2]);
  process.stdout.write(
    "Prepared 48 routing study commands; no agents launched.\n",
  );
}
