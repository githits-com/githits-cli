import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildStudyArgv } from "./prepare.js";
import {
  buildRoutingGuide,
  ROUTING_SKILL_DESCRIPTION,
} from "./routing-guide.js";

export const FIRST_READ_DESCRIPTION =
  "Use GitHits for public OSS code, documentation, examples, packages, dependencies, upgrades, and vulnerabilities. Read this skill first to choose a tool, then discover that tool and follow its description.";

export const LUNA_TASKS = {
  code: "In github:openai/codex, find the literal tool_search and inspect a matching tool_search_call schema definition. Which fields does that definition require? Cite the file and lines. Use available tools to verify the answer and state evidence limitations. Do not edit local files or delegate.",
  docs: "Find the npm:express documentation on route handlers, read the relevant section, and explain the handler signature and how control passes between handlers. Cite the documentation URL or page locator. Use available tools to verify the answer and state evidence limitations. Do not edit local files or delegate.",
  upgrade:
    "Review an npm:zod upgrade from 4.3.6 to 4.4.3. Preserve those exact versions, report any direct advisory changes and whether compatibility is established. Use available tools to verify the answer and state evidence limitations. Do not edit local files or delegate.",
};

/**
 * Preserve the neutral-task pilot setup on CI's Luna/low model identity.
 * Normal-home global skills can override staged candidates: these launches are
 * not isolated comparisons without exact skill-path and payload verification.
 * See observations/luna-pilot-exclusions.json for the excluded attempts.
 */
export async function prepareLunaStudy(destination: string): Promise<void> {
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const canonical = await readFile(
    join(root, "skills/githits-mcp/SKILL.md"),
    "utf8",
  );
  const router = (description: string): string =>
    `---\nname: githits-mcp\ndescription: ${JSON.stringify(description)}\n---\n\n# GitHits MCP\n\nThis skill contains the routing guide; do not call quick_start again.\n\n${buildRoutingGuide()}\n`;
  const variants = {
    baseline: canonical,
    router: router(ROUTING_SKILL_DESCRIPTION),
    "first-read": router(FIRST_READ_DESCRIPTION),
  };
  const output = resolve(destination);
  await mkdir(dirname(output), { recursive: true });
  await mkdir(output);
  const commands: Array<{
    host: string;
    variant: string;
    workload: string;
    repetition: number;
    cwd: string;
    argv: string[];
  }> = [];
  const names = Object.keys(variants) as Array<keyof typeof variants>;
  for (let repetition = 1; repetition <= 3; repetition++) {
    const offset = repetition - 1;
    for (const variant of [...names.slice(offset), ...names.slice(0, offset)]) {
      for (const [workload, task] of Object.entries(LUNA_TASKS)) {
        const cwd = join(
          output,
          "codex",
          `${variant}-${workload}-${repetition}`,
        );
        const skillDir = join(cwd, ".agents/skills/githits-mcp");
        await mkdir(skillDir, { recursive: true });
        await writeFile(join(skillDir, "SKILL.md"), variants[variant]);
        const fixtureArgs = [
          join(root, "eval/agentic/context-loading/fixture-server.ts"),
          variant === "baseline" ? "canonical" : "routing",
        ];
        const config = join(cwd, "mcp.json");
        await writeFile(
          config,
          JSON.stringify(
            {
              mcpServers: {
                githits_context_fixture: { command: "bun", args: fixtureArgs },
              },
            },
            null,
            2,
          ),
        );
        const argv = buildStudyArgv("codex", task, fixtureArgs, config);
        argv[argv.indexOf("--model") + 1] = "gpt-5.6-luna";
        const effort = argv.findIndex((value) =>
          value.startsWith("model_reasoning_effort="),
        );
        argv[effort] = 'model_reasoning_effort="low"';
        argv.splice(2, 0, "--ignore-rules");
        commands.push({
          host: "codex",
          variant,
          workload,
          repetition,
          cwd,
          argv,
        });
      }
    }
  }
  await writeFile(
    join(output, "study.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        model: "gpt-5.6-luna",
        effort: "low",
        variants,
        tasks: LUNA_TASKS,
        commands,
      },
      null,
      2,
    ),
  );
}

if (import.meta.main) {
  if (process.argv.length !== 3 || !process.argv[2])
    throw new Error("Usage: prepare-luna.ts <new-study-directory>");
  await prepareLunaStudy(process.argv[2]);
  process.stdout.write("Prepared 27 Luna commands; no agents launched.\n");
}
