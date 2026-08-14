import { describe, expect, it } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
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
});
