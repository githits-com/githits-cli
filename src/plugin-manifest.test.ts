import { describe, expect, it } from "bun:test";
import { lstat, readdir, readFile, readlink } from "node:fs/promises";
import { join } from "node:path";

describe("plugin manifest wiring", () => {
  const root = join(import.meta.dir, "..");

  it("points the first-party Claude marketplace at the root payload", async () => {
    const marketplacePath = join(root, ".claude-plugin", "marketplace.json");
    const contents = await readFile(marketplacePath, "utf8");
    const parsed = JSON.parse(contents) as {
      plugins?: Array<{
        name?: string;
        source?: { source?: string; url?: string };
      }>;
    };

    const githitsPlugin = parsed.plugins?.find(
      (plugin) => plugin.name === "githits",
    );
    expect(githitsPlugin).toBeDefined();
    expect(githitsPlugin?.source).toEqual({
      source: "url",
      url: "https://github.com/githits-com/githits-cli.git",
    });
  });

  it("keeps generated host manifest versions aligned", async () => {
    const packageJson = JSON.parse(
      await readFile(join(root, "package.json"), "utf8"),
    ) as { version?: string };
    const manifestPaths = [
      [".plugin", "plugin.json"],
      [".claude-plugin", "plugin.json"],
      [".codex-plugin", "plugin.json"],
      [".cursor-plugin", "plugin.json"],
      ["gemini-extension.json"],
      ["plugin.json"],
    ];

    for (const parts of manifestPaths) {
      const manifest = JSON.parse(
        await readFile(join(root, ...parts), "utf8"),
      ) as { version?: string };
      expect(manifest.version).toBe(packageJson.version);
    }
  });

  it("uses MCP registry keywords across generated plugin manifests", async () => {
    const serverJson = JSON.parse(
      await readFile(join(root, "server.json"), "utf8"),
    ) as {
      _meta?: {
        "io.modelcontextprotocol.registry/publisher-provided"?: {
          keywords?: string[];
        };
      };
    };
    const keywords =
      serverJson._meta?.["io.modelcontextprotocol.registry/publisher-provided"]
        ?.keywords;

    for (const parts of [
      [".plugin", "plugin.json"],
      [".claude-plugin", "plugin.json"],
      [".codex-plugin", "plugin.json"],
      [".cursor-plugin", "plugin.json"],
      ["plugin.json"],
    ]) {
      const manifest = JSON.parse(
        await readFile(join(root, ...parts), "utf8"),
      ) as { keywords?: string[] };
      expect(manifest.keywords).toEqual(keywords);
    }

    const marketplace = JSON.parse(
      await readFile(join(root, ".claude-plugin", "marketplace.json"), "utf8"),
    ) as { plugins?: Array<{ keywords?: string[] }> };
    expect(marketplace.plugins?.[0]?.keywords).toEqual(keywords);
  });

  it("declares the shared skills and host-specific MCP configs", async () => {
    const codexManifest = JSON.parse(
      await readFile(join(root, ".codex-plugin", "plugin.json"), "utf8"),
    ) as { skills?: string; mcpServers?: string };
    expect(codexManifest.skills).toBe("./skills/");
    expect(codexManifest.mcpServers).toBe("./.mcp.json");

    const cursorManifest = JSON.parse(
      await readFile(join(root, ".cursor-plugin", "plugin.json"), "utf8"),
    ) as { skills?: string; mcpServers?: string };
    expect(cursorManifest.skills).toBe("skills");
    expect(cursorManifest.mcpServers).toBe(".mcp.json");
  });

  it("provides the shared Agent Plugins and Antigravity manifest", async () => {
    const manifest = JSON.parse(
      await readFile(join(root, "plugin.json"), "utf8"),
    ) as { name?: string };

    expect(manifest).toEqual(
      expect.objectContaining({
        $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
        name: "githits",
      }),
    );
  });

  it("uses only the canonical root skill tree", async () => {
    const skillEntries = await readdir(join(root, "skills"), {
      withFileTypes: true,
    });
    expect(
      skillEntries
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort(),
    ).toEqual([
      "githits-code",
      "githits-mcp",
      "githits-onboarding",
      "githits-package",
    ]);

    for (const legacyPath of [
      join(root, "plugins", "claude"),
      join(root, "commands"),
    ]) {
      try {
        const entries = await readdir(legacyPath, {
          recursive: true,
          withFileTypes: true,
        });
        expect(entries.filter((entry) => entry.isFile())).toEqual([]);
      } catch (error) {
        expect((error as NodeJS.ErrnoException).code).toBe("ENOENT");
      }
    }
  });

  it("shares repository guidance through host symlinks", async () => {
    for (const filename of ["CLAUDE.md", "GEMINI.md"]) {
      const path = join(root, filename);
      expect((await lstat(path)).isSymbolicLink()).toBe(true);
      expect(await readlink(path)).toBe("AGENTS.md");
    }
  });
});
