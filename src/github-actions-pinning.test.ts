import { describe, expect, it } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";

const pinnedBunVersion = '"1.4.4"';
const matrixBunVersion = "$" + "{{ matrix.bun-version }}";
const pinnedAction = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+@[0-9a-f]{40}$/;
const versionComment = /^v\d+\.\d+\.\d+$/;
const workflowsWithoutBun = new Set(["gitleaks.yml", "main.yml", "pr.yml"]);
const privilegedJobs = new Map<string, string>([
  ["release.yml", "release"],
  ["mcp-release.yml", "publish"],
]);

interface WorkflowJob {
  permissions?: Record<string, string>;
  uses?: string;
}

interface WorkflowFile {
  jobs?: Record<string, WorkflowJob>;
  on?: Record<string, unknown>;
  permissions?: Record<string, string>;
}

function permissionKeys(
  permissions: Record<string, string> | undefined,
): string[] {
  return Object.keys(permissions ?? {}).sort();
}

describe("GitHub Actions supply-chain pins", () => {
  it("pins third-party actions and Bun 1.4.4 without widening token permissions", async () => {
    const workflowDirectory = join(
      import.meta.dir,
      "..",
      ".github",
      "workflows",
    );
    const workflowNames = (await readdir(workflowDirectory))
      .filter((name) => name.endsWith(".yml"))
      .sort();

    expect(workflowNames).toEqual([
      "agent-evals.yml",
      "ci.yml",
      "gitleaks.yml",
      "main.yml",
      "mcp-release.yml",
      "pr.yml",
      "release.yml",
    ]);

    for (const workflowName of workflowNames) {
      const source = await readFile(
        join(workflowDirectory, workflowName),
        "utf8",
      );
      const uses = [...source.matchAll(/^[ \t]*uses:[ \t]*(.+)$/gm)].map(
        (match) => match[1] ?? "",
      );
      expect(uses.length).toBeGreaterThan(0);

      for (const rawUse of uses) {
        const [action, comment] = rawUse.split(/\s+#\s*/);
        if (action?.startsWith("./")) {
          expect(comment).toBeUndefined();
          expect(action).not.toContain("@");
          continue;
        }

        expect(action).toMatch(pinnedAction);
        expect(comment).toMatch(versionComment);
      }

      const bunVersions = [
        ...source.matchAll(/^[ \t]*bun-version:[ \t]*(.+)$/gm),
      ].flatMap((match) => {
        const bunVersion = match[1];
        return bunVersion === undefined ? [] : [bunVersion];
      });
      for (const bunVersion of bunVersions) {
        expect([pinnedBunVersion, matrixBunVersion]).toContain(bunVersion);
      }
      if (!workflowsWithoutBun.has(workflowName)) {
        expect(bunVersions).toContain(pinnedBunVersion);
      }

      const workflow = parseYaml(source) as WorkflowFile;
      const workflowPermissions = workflow.permissions ?? {};
      expect(permissionKeys(workflowPermissions)).toEqual(
        workflowName === "agent-evals.yml" ? ["contents"] : [],
      );
      if (workflowName === "agent-evals.yml") {
        expect(workflowPermissions.contents).toBe("read");
      }

      const jobs = workflow.jobs ?? {};
      const privilegedJob = privilegedJobs.get(workflowName);
      if (privilegedJob !== undefined) {
        expect(jobs[privilegedJob]?.permissions).toEqual({
          contents: "write",
          "id-token": "write",
        });
      }

      for (const [jobName, job] of Object.entries(jobs)) {
        if (jobName === privilegedJob) continue;
        if (job.permissions === undefined) {
          expect(job.uses).toBeUndefined();
          continue;
        }
        expect(job.permissions).toEqual({ contents: "read" });
      }

      if (workflowName === "release.yml") {
        expect(Object.keys(workflow.on ?? {}).sort()).toEqual(["workflow_run"]);
      }
    }
  });

  it("runs the pinned gitleaks OSS binary instead of gitleaks-action", async () => {
    const source = await readFile(
      join(import.meta.dir, "..", ".github", "workflows", "gitleaks.yml"),
      "utf8",
    );

    expect(source).toContain('version="8.30.1"');
    expect(source).toContain(
      "551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb",
    );
    expect(source).toContain(
      "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1",
    );
    expect(source).toContain(
      "actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9 # v7.0.2",
    );
    expect(source).not.toContain("uses: gitleaks/gitleaks-action");
    expect(source).not.toContain("GITLEAKS_LICENSE");
  });
});
