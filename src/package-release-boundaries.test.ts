import { describe, expect, it } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseJsonc } from "jsonc-parser";
import { parse as parseYaml } from "yaml";

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
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
        expect(release.run).toContain('--target "$(git rev-parse HEAD)"');
      }
    }
  });
});
