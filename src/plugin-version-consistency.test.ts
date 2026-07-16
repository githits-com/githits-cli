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

    const claudePayloadPlugin = await readJson<{ version: string }>(
      join(root, "plugins", "claude", ".claude-plugin", "plugin.json"),
    );

    const claudeMarketplace = await readJson<{
      metadata?: { version?: string };
    }>(join(root, ".claude-plugin", "marketplace.json"));

    const geminiExtension = await readJson<{ version: string }>(
      join(root, "gemini-extension.json"),
    );

    const expected = packageJson.version;

    expect(openPlugin.version).toBe(expected);
    expect(claudePlugin.version).toBe(expected);
    expect(claudePayloadPlugin.version).toBe(expected);
    expect(claudeMarketplace.metadata?.version).toBe(expected);
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
    const claudePayloadPlugin = await readJson<{ description: string }>(
      join(root, "plugins", "claude", ".claude-plugin", "plugin.json"),
    );
    const claudeMarketplace = await readJson<{
      metadata?: { description?: string };
      plugins?: Array<{ name?: string; description?: string }>;
    }>(join(root, ".claude-plugin", "marketplace.json"));
    const geminiExtension = await readJson<{ description: string }>(
      join(root, "gemini-extension.json"),
    );
    const geminiContext = await readFile(join(root, "GEMINI.md"), "utf8");
    const expected = packageJson.description;

    expect(openPlugin.description).toBe(expected);
    expect(claudePlugin.description).toBe(expected);
    expect(claudePayloadPlugin.description).toBe(expected);
    expect(claudeMarketplace.metadata?.description).toBe(expected);
    expect(
      claudeMarketplace.plugins?.find((plugin) => plugin.name === "githits")
        ?.description,
    ).toBe(expected);
    expect(geminiExtension.description).toBe(expected);
    expect(geminiContext).toContain(`\n${expected}.\n`);
  });
});
