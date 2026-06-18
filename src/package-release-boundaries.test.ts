import { describe, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

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

function allDependencyNames(packageJson: PackageJson): Set<string> {
  return new Set([
    ...Object.keys(packageJson.dependencies ?? {}),
    ...Object.keys(packageJson.devDependencies ?? {}),
    ...Object.keys(packageJson.peerDependencies ?? {}),
    ...Object.keys(packageJson.optionalDependencies ?? {}),
  ]);
}

describe("package release boundaries", () => {
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

    expect(workflow).toContain('TAG_REF="refs/tags/$TAG"');
    expect(workflow).toContain('git rev-parse --verify "$TAG_REF^{commit}"');
    expect(workflow).toContain('git push origin "refs/tags/$TAG"');
    expect(createTagIndex).toBeGreaterThan(-1);
    expect(publishIndex).toBeGreaterThan(-1);
    expect(createTagIndex).toBeLessThan(publishIndex);
  });
});
