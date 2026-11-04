import { describe, expect, it } from "bun:test";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { parse as parseJsonc } from "jsonc-parser";
import { subset } from "semver";
import { parse as parseYaml } from "yaml";

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  engines: { node: string };
  exports?: unknown;
  name: string;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  version: string;
}

interface BunLock {
  workspaces: Record<string, { version?: string }>;
}

const changelogCategories = [
  "added",
  "changed",
  "deprecated",
  "removed",
  "fixed",
  "security",
] as const;

const semverImpacts = ["none", "patch", "minor", "major"] as const;

function isSemverImpact(
  value: unknown,
): value is (typeof semverImpacts)[number] {
  return (
    typeof value === "string" &&
    (semverImpacts as readonly string[]).includes(value)
  );
}

function allDependencyNames(packageJson: PackageJson): Set<string> {
  return new Set([
    ...Object.keys(packageJson.dependencies ?? {}),
    ...Object.keys(packageJson.devDependencies ?? {}),
    ...Object.keys(packageJson.peerDependencies ?? {}),
    ...Object.keys(packageJson.optionalDependencies ?? {}),
  ]);
}

describe("package release boundaries", () => {
  it("uses a Commander release supporting every advertised CLI Node version", async () => {
    const rootPackage = await readJson<PackageJson>(
      join(import.meta.dir, "..", "package.json"),
    );
    const require = createRequire(import.meta.url);
    const commanderPackage = await readJson<PackageJson>(
      join(dirname(require.resolve("commander")), "package.json"),
    );

    expect(
      subset(rootPackage.engines.node, commanderPackage.engines.node),
    ).toBe(true);
  });

  it("documents the current public package versions across changelog line endings", async () => {
    const root = join(import.meta.dir, "..");
    const rootPackage = await readJson<PackageJson>(join(root, "package.json"));
    const mcpPackage = await readJson<PackageJson>(
      join(root, "packages", "mcp", "package.json"),
    );
    const rawChangelog = await readFile(join(root, "CHANGELOG.md"), "utf8");
    const lfChangelog = rawChangelog.replaceAll("\r\n", "\n");

    for (const changelog of [
      lfChangelog,
      lfChangelog.replaceAll("\n", "\r\n"),
    ]) {
      expect(changelog).not.toContain("## [Unreleased]");
      expect(changelog).toContain(
        `## [${rootPackage.name} ${rootPackage.version}]`,
      );
      expect(changelog).toContain(
        `## [${mcpPackage.name} ${mcpPackage.version}]`,
      );
    }
  });

  it("keeps the MCP package and lockfile workspace versions aligned", async () => {
    const root = join(import.meta.dir, "..");
    const mcpPackage = await readJson<PackageJson>(
      join(root, "packages", "mcp", "package.json"),
    );
    const lockfile = parseJsonc(
      await readFile(join(root, "bun.lock"), "utf8"),
    ) as BunLock;

    expect(lockfile.workspaces["packages/mcp"]?.version).toBe(
      mcpPackage.version,
    );
  });

  it("keeps independent changelog fragments well formed", async () => {
    const root = join(import.meta.dir, "..");
    const changesDirectory = join(root, "changes");
    const fragmentNames = (await readdir(changesDirectory)).filter(
      (name: string): boolean => name !== "README.md",
    );
    const fileNamePattern = new RegExp(
      `^[a-z0-9][a-z0-9-]*\\.(${changelogCategories.join("|")})\\.md$`,
    );

    for (const fragmentName of fragmentNames) {
      expect(fragmentName).toMatch(fileNamePattern);

      const source = (
        await readFile(join(changesDirectory, fragmentName), "utf8")
      ).replaceAll("\r\n", "\n");
      const fragment = source.match(/^---\n([\s\S]*?)\n---\n\n([\s\S]*\S)\n?$/);

      expect(fragment).not.toBeNull();
      const metadataSource = fragment?.[1];
      const body = fragment?.[2];
      if (metadataSource === undefined || body === undefined) {
        throw new Error(
          `Invalid changelog fragment structure: ${fragmentName}`,
        );
      }

      const impact = parseYaml(metadataSource) as Record<string, unknown>;
      expect(Object.keys(impact).sort()).toEqual(["@githits/mcp", "githits"]);
      expect(isSemverImpact(impact.githits)).toBe(true);
      expect(isSemverImpact(impact["@githits/mcp"])).toBe(true);

      expect(body).toMatch(
        /^- \*\*[^*\n]+\*\* - \S[^\n]*(?:\n {2,}\S[^\n]*)*$/,
      );
    }
  });

  it("keeps root githits releasable without a published @githits/mcp", async () => {
    const root = join(import.meta.dir, "..");
    const rootPackage = await readJson<PackageJson>(join(root, "package.json"));

    expect(rootPackage.name).toBe("githits");
    expect(allDependencyNames(rootPackage)).not.toContain("@githits/mcp");
  });

  it("keeps @githits/mcp independent from private workspace packages", async () => {
    const root = join(import.meta.dir, "..");
    const mcpPackage = await readJson<PackageJson>(
      join(root, "packages", "mcp", "package.json"),
    );
    const dependencies = allDependencyNames(mcpPackage);

    expect(mcpPackage.name).toBe("@githits/mcp");
    expect(dependencies).not.toContain("@githits/core-internal");
    expect(dependencies).not.toContain("@githits/mcp/internal");
    expect(JSON.stringify(mcpPackage.exports)).not.toContain("./internal");
    expect(JSON.stringify(mcpPackage.exports)).toContain("./smoke-test");
  });

  it("resolves private workspace declarations before publishing @githits/mcp", async () => {
    const root = join(import.meta.dir, "..");
    const buildConfig = await readFile(
      join(root, "packages", "mcp", "bunup.config.ts"),
      "utf8",
    );

    expect(buildConfig).toContain('resolve: ["@githits/core-internal"]');
    expect(buildConfig).toContain('preferredTsconfig: "../../tsconfig.json"');
    expect(buildConfig).toContain('"src/smoke-test.ts"');
  });

  it("keeps MCP release publishing recoverable", async () => {
    const root = join(import.meta.dir, "..");
    const workflow = await readFile(
      join(root, ".github", "workflows", "mcp-release.yml"),
      "utf8",
    );
    const createTagIndex = workflow.indexOf("- name: Create MCP git tag");
    const publishIndex = workflow.indexOf(
      "- name: Publish @githits/mcp to npm",
    );
    const npmPublishedCheckIndex = workflow.indexOf(
      'if npm view "@githits/mcp@$VERSION" version',
    );
    const tagHeadCheckIndex = workflow.indexOf(
      "Existing tag $TAG points to $TAG_COMMIT, not HEAD $HEAD_COMMIT",
    );

    expect(workflow).toContain('TAG_REF="refs/tags/$TAG"');
    expect(workflow).toContain('git rev-parse --verify "$TAG_REF^{commit}"');
    expect(workflow).toContain(
      'if [ "$NPM_PUBLISHED" != "true" ] && [ "$TAG_COMMIT" != "$HEAD_COMMIT" ]; then',
    );
    expect(workflow).toContain('git push origin "refs/tags/$TAG"');
    expect(npmPublishedCheckIndex).toBeGreaterThan(-1);
    expect(tagHeadCheckIndex).toBeGreaterThan(-1);
    expect(npmPublishedCheckIndex).toBeLessThan(tagHeadCheckIndex);
    expect(createTagIndex).toBeGreaterThan(-1);
    expect(publishIndex).toBeGreaterThan(-1);
    expect(createTagIndex).toBeLessThan(publishIndex);
  });

  it("refuses to recreate a published root release tag at a later commit", async () => {
    const root = join(import.meta.dir, "..");
    const workflow = await readFile(
      join(root, ".github", "workflows", "release.yml"),
      "utf8",
    );
    const npmPublishedCheckIndex = workflow.indexOf(
      'if npm view "githits@$VERSION" version',
    );
    const missingTagGuardIndex = workflow.indexOf(
      "Refusing to create a tag at a later commit.",
    );
    const createTagIndex = workflow.indexOf("- name: Create root git tag");
    const publishIndex = workflow.indexOf("- name: Publish to npm");
    const createReleaseIndex = workflow.indexOf(
      "- name: Create GitHub Release",
    );

    expect(npmPublishedCheckIndex).toBeGreaterThan(-1);
    expect(missingTagGuardIndex).toBeGreaterThan(npmPublishedCheckIndex);
    expect(workflow).toContain(
      'if [ "$TAG_EXISTS" = "true" ] && [ "$TAG_COMMIT" != "$(git rev-parse HEAD)" ]; then',
    );
    expect(createTagIndex).toBeGreaterThan(missingTagGuardIndex);
    expect(createTagIndex).toBeLessThan(publishIndex);
    expect(workflow).toContain('git push origin "refs/tags/$TAG"');
    expect(createReleaseIndex).toBeGreaterThan(missingTagGuardIndex);
  });

  it("requires separate human approval to merge a release PR", async () => {
    const root = join(import.meta.dir, "..");
    const instructionPaths = [
      "AGENTS.md",
      join(".agents", "skills", "githits-release", "SKILL.md"),
      join("changes", "README.md"),
      join("docs", "implementation", "release-process.md"),
      join("docs", "guidelines", "REVIEW_GUIDELINES.md"),
    ];

    for (const instructionPath of instructionPaths) {
      const instructions = (
        await readFile(join(root, instructionPath), "utf8")
      ).replaceAll(/\s+/g, " ");

      expect(instructions).toContain("separate, explicit human approval");
      expect(instructions).toContain("after the release PR exists");
      expect(instructions).toContain("does not authorize merging");
    }
  });

  it("gates downstream releases on npm publication availability in both workflows", async () => {
    interface WorkflowStep {
      name: string;
      run?: string;
      if?: string;
      "working-directory"?: string;
      "continue-on-error"?: boolean;
      "timeout-minutes"?: number;
    }
    interface ReleaseWorkflow {
      on: { pull_request?: { paths: string[] } };
      jobs: Record<string, { steps: WorkflowStep[] }>;
    }

    const cases = [
      {
        file: "release.yml",
        job: "release",
        publish: "Publish to npm",
        command: "bun run scripts/publish-npm.ts",
        downstream: ["Publish to MCP registry", "Create GitHub Release"],
      },
      {
        file: "mcp-release.yml",
        job: "publish",
        publish: "Publish @githits/mcp to npm",
        command: "bun run ../../scripts/publish-npm.ts",
        downstream: ["Create MCP GitHub Release"],
      },
    ];
    for (const entry of cases) {
      const workflow = parseYaml(
        await readFile(
          join(import.meta.dir, "..", ".github", "workflows", entry.file),
          "utf8",
        ),
      ) as ReleaseWorkflow;
      const steps = workflow.jobs[entry.job]!.steps;
      const publishIndex = steps.findIndex(
        (step) => step.name === entry.publish,
      );
      expect(publishIndex).toBeGreaterThan(-1);
      const publish = steps[publishIndex]!;
      expect(publish.run).toBe(entry.command);
      expect(publish["continue-on-error"]).not.toBe(true);
      expect(publish["timeout-minutes"]).toBeGreaterThan(20);
      expect(publish.if).toContain("npm_published == 'false'");
      for (const name of entry.downstream) {
        const index = steps.findIndex((step) => step.name === name);
        expect(index).toBeGreaterThan(publishIndex);
        expect(steps[index]!.if).not.toMatch(/always\(|failure\(/);
      }
      if (entry.file === "mcp-release.yml") {
        expect(publish["working-directory"]).toBe("packages/mcp");
        expect(workflow.on.pull_request?.paths).toContain(
          "scripts/publish-npm*",
        );
      } else {
        expect(publish["working-directory"]).toBeUndefined();
        const release = steps.find(
          (step) => step.name === "Create GitHub Release",
        )!;
        expect(release.run).toContain("--verify-tag");
        expect(release.run).not.toContain("--target");
      }
    }
  });
});

interface ChangelogJob {
  outputs?: Record<string, string>;
  needs?: string;
  if?: string;
  uses?: string;
  permissions: Record<string, string>;
  with?: Record<string, string>;
  secrets?: Record<string, string>;
  "runs-on"?: string;
  "timeout-minutes"?: number;
  "continue-on-error"?: boolean;
  steps?: {
    run: string;
    env: Record<string, string>;
    "continue-on-error"?: boolean;
  }[];
}

interface ChangelogWorkflow {
  on: Record<
    string,
    {
      inputs: Record<
        string,
        { description: string; required: boolean; type: string }
      >;
      secrets?: Record<string, { required: boolean }>;
    }
  >;
  permissions: Record<string, string>;
  jobs: Record<string, ChangelogJob>;
}

async function readChangelogWorkflow(name: string): Promise<ChangelogWorkflow> {
  return parseYaml(
    await readFile(
      join(import.meta.dir, "..", ".github", "workflows", name),
      "utf8",
    ),
  ) as ChangelogWorkflow;
}

describe("Mintlify release trigger", () => {
  it("shares a non-fatal, permissionless trigger between real releases and manual runs", async () => {
    const release = await readChangelogWorkflow("release.yml");
    const trigger = await readChangelogWorkflow(
      "mintlify-changelog-trigger.yml",
    );
    const caller = release.jobs["trigger-docs-changelog"]!;
    const job = trigger.jobs["trigger-docs-changelog"]!;
    expect(release.jobs.release!.outputs).toEqual({
      released: "$" + "{{ steps.version.outputs.should_release }}",
      version: "$" + "{{ steps.version.outputs.version }}",
    });
    expect(caller.needs).toBe("release");
    expect(caller.if).toBe("needs.release.outputs.released == 'true'");
    expect(caller.uses).toBe(
      "./.github/workflows/mintlify-changelog-trigger.yml",
    );
    expect(caller.permissions).toEqual({});
    expect(caller.with).toEqual({
      version: "$" + "{{ needs.release.outputs.version }}",
    });
    expect(caller.secrets).toEqual({
      MINTLIFY_API_KEY: "$" + "{{ secrets.MINTLIFY_API_KEY }}",
    });
    expect(caller["continue-on-error"]).toBeUndefined();
    expect(trigger.permissions).toEqual({});
    expect(Object.keys(trigger.on).sort()).toEqual([
      "workflow_call",
      "workflow_dispatch",
    ]);
    for (const event of ["workflow_call", "workflow_dispatch"]) {
      expect(trigger.on[event]!.inputs.version).toEqual({
        description: "CLI version for logging only",
        required: false,
        type: "string",
      });
    }
    expect(trigger.on.workflow_call!.secrets).toEqual({
      MINTLIFY_API_KEY: { required: false },
    });
    expect(job["runs-on"]).toBe("aks-deployment-runner");
    expect(job.permissions).toEqual({});
    expect(job["timeout-minutes"]).toBe(5);
    expect(job.steps).toHaveLength(1);
    expect(job.steps![0]!["continue-on-error"]).toBe(true);
    expect(job.steps![0]!.env).toEqual({
      MINTLIFY_API_KEY: "$" + "{{ secrets.MINTLIFY_API_KEY }}",
      MINTLIFY_PROJECT_ID: "$" + "{{ vars.MINTLIFY_PROJECT_ID }}",
      MINTLIFY_DRAFT_CHANGELOG_WORKFLOW_ID:
        "$" + "{{ vars.MINTLIFY_DRAFT_CHANGELOG_WORKFLOW_ID }}",
      VERSION: "$" + "{{ inputs.version }}",
    });
  });

  const settings: Record<string, string> = {
    MINTLIFY_API_KEY: "fixture-key",
    MINTLIFY_PROJECT_ID: "fixture-project",
    MINTLIFY_DRAFT_CHANGELOG_WORKFLOW_ID: "fixture-workflow",
  };
  for (const missing of [
    ...Object.keys(settings),
    "all",
    "none",
    "request-failure",
    "request-timeout",
    "no-version",
    "literal-version",
  ]) {
    // The workflow runs on Linux; Windows CI still checks its YAML contract above.
    it.skipIf(process.platform === "win32")(
      `handles trigger configuration: ${missing}`,
      async () => {
        const trigger = await readChangelogWorkflow(
          "mintlify-changelog-trigger.yml",
        );
        const script = trigger.jobs["trigger-docs-changelog"]!.steps![0]!.run;
        const dir = await mkdtemp(join(tmpdir(), "mintlify-trigger-"));
        try {
          await writeFile(
            join(dir, "curl"),
            '#!/bin/bash\nset -eu\nprintf "%s\\n" "$@" > "$CURL_ARGS"\nexit "$CURL_EXIT"\n',
            { mode: 0o755 },
          );
          const argsPath = join(dir, "args");
          const env: Record<string, string> = {
            ...settings,
            PATH: `${dir}:/usr/bin:/bin`,
            VERSION: "0.39.0",
            CURL_ARGS: argsPath,
            CURL_EXIT:
              missing === "request-failure"
                ? "22"
                : missing === "request-timeout"
                  ? "28"
                  : "0",
          };
          if (missing === "no-version") env.VERSION = "";
          if (missing === "literal-version")
            env.VERSION = "$(exit 91); `exit 92`";
          if (missing === "all")
            for (const name of Object.keys(settings)) env[name] = "";
          else if (missing in settings) env[missing] = "";
          const child = Bun.spawn(["/bin/bash", "-c", script], {
            env,
            stdout: "pipe",
            stderr: "pipe",
          });
          const [stdout, stderr, code] = await Promise.all([
            new Response(child.stdout).text(),
            new Response(child.stderr).text(),
            child.exited,
          ]);
          expect(stderr).toBe("");
          expect(stdout).not.toContain(settings.MINTLIFY_API_KEY!);
          if (missing === "all" || missing in settings) {
            expect(code).toBe(0);
            expect(stdout).toContain(
              `::notice::Skipping Mintlify Draft changelog: ${missing === "all" ? "MINTLIFY_API_KEY" : missing} is missing.`,
            );
            expect(await Bun.file(argsPath).exists()).toBe(false);
          } else {
            expect(code).toBe(
              missing === "request-failure"
                ? 22
                : missing === "request-timeout"
                  ? 28
                  : 0,
            );
            expect(stdout).toContain(
              `CLI version: ${env.VERSION || "unspecified"}`,
            );
            expect(
              (await readFile(argsPath, "utf8")).trim().split("\n"),
            ).toEqual([
              "-fsS",
              "--connect-timeout",
              "10",
              "--max-time",
              "30",
              "--retry",
              "2",
              "--retry-max-time",
              "120",
              "-X",
              "POST",
              "https://api.mintlify.com/v1/workflow/fixture-project/fixture-workflow/trigger",
              "-H",
              "Authorization: Bearer fixture-key",
            ]);
          }
        } finally {
          await rm(dir, { recursive: true, force: true });
        }
      },
    );
  }
});
