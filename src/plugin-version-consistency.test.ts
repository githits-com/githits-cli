import { describe, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

async function readJson<T>(path: string): Promise<T> {
  const contents = await readFile(path, "utf8");
  return JSON.parse(contents) as T;
}

describe("plugin metadata consistency", () => {
  it("keeps package and plugin manifest versions aligned", async () => {
    const root = join(import.meta.dir, "..");

    const packageJson = await readJson<{ version: string }>(
      join(root, "package.json"),
    );

    const openPlugin = await readJson<{ version: string }>(
      join(root, ".plugin", "plugin.json"),
    );

    const claudePlugin = await readJson<{ version: string }>(
      join(root, ".claude-plugin", "plugin.json"),
    );

    const codexPlugin = await readJson<{ version: string }>(
      join(root, ".codex-plugin", "plugin.json"),
    );

    const cursorPlugin = await readJson<{ version: string }>(
      join(root, ".cursor-plugin", "plugin.json"),
    );

    const claudeMarketplace = await readJson<{
      metadata?: { version?: string };
      plugins?: Array<{ name?: string; version?: string }>;
    }>(join(root, ".claude-plugin", "marketplace.json"));

    const geminiExtension = await readJson<{ version: string }>(
      join(root, "gemini-extension.json"),
    );

    const expected = packageJson.version;

    expect(openPlugin.version).toBe(expected);
    expect(claudePlugin.version).toBe(expected);
    expect(codexPlugin.version).toBe(expected);
    expect(cursorPlugin.version).toBe(expected);
    expect(claudeMarketplace.metadata?.version).toBe(expected);
    expect(
      claudeMarketplace.plugins?.find((plugin) => plugin.name === "githits")
        ?.version,
    ).toBe(expected);
    expect(geminiExtension.version).toBe(expected);
  });

  it("keeps package and plugin descriptions aligned", async () => {
    const root = join(import.meta.dir, "..");
    const packageJson = await readJson<{ description: string }>(
      join(root, "package.json"),
    );
    const openPlugin = await readJson<{ description: string }>(
      join(root, ".plugin", "plugin.json"),
    );
    const claudePlugin = await readJson<{ description: string }>(
      join(root, ".claude-plugin", "plugin.json"),
    );
    const codexPlugin = await readJson<{ description: string }>(
      join(root, ".codex-plugin", "plugin.json"),
    );
    const cursorPlugin = await readJson<{ description: string }>(
      join(root, ".cursor-plugin", "plugin.json"),
    );
    const claudeMarketplace = await readJson<{
      metadata?: { description?: string };
      plugins?: Array<{ name?: string; description?: string }>;
    }>(join(root, ".claude-plugin", "marketplace.json"));
    const geminiExtension = await readJson<{ description: string }>(
      join(root, "gemini-extension.json"),
    );
    const readme = await readFile(join(root, "README.md"), "utf8");
    const expected = packageJson.description;

    expect(openPlugin.description).toBe(expected);
    expect(claudePlugin.description).toBe(expected);
    expect(codexPlugin.description).toBe(expected);
    expect(cursorPlugin.description).toBe(expected);
    expect(claudeMarketplace.metadata?.description).toBe(expected);
    expect(
      claudeMarketplace.plugins?.find((plugin) => plugin.name === "githits")
        ?.description,
    ).toBe(expected);
    expect(geminiExtension.description).toBe(expected);
    expect(readme.split(/\r?\n/).map((line) => line.trim())).toContain(
      `${expected}.`,
    );
  });

  it("keeps the MCP registry description capability-oriented", async () => {
    const root = join(import.meta.dir, "..");
    const serverManifest = await readJson<{ description: string }>(
      join(root, "server.json"),
    );

    expect(serverManifest.description).toBe(
      "Search public open-source code, documentation, metadata, vulnerabilities, changelogs, and examples.",
    );
  });
});
