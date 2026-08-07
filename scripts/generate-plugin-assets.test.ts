import { describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AGENT_PLUGINS_MCP_SCHEMA_URL,
  AGENT_PLUGINS_SCHEMA_URL,
  CANONICAL_SKILL_NAMES,
  createPluginAssetInputs,
  generatePluginAssets,
  type PluginPackageJson,
  type PluginServerJson,
  renderPluginAssets,
} from "./generate-plugin-assets.ts";

const registryKeywords = [
  "githits",
  "context layer",
  "public open-source",
  "open-source code",
  "code search",
  "package documentation",
  "documentation search",
  "package metadata",
  "vulnerabilities",
  "changelogs",
  "dependency graphs",
  "upgrade evidence",
  "implementation examples",
];

const packageJson: PluginPackageJson = {
  name: "githits",
  version: "1.2.3",
  description: "The code context layer for AI coding agents",
  author: "GitHits",
  homepage: "https://githits.com",
  repository: {
    type: "git",
    url: "git+https://github.com/githits-com/githits-cli.git",
  },
  license: "Apache-2.0",
  keywords: registryKeywords,
};

const serverJson: PluginServerJson = {
  version: "1.2.3",
  remotes: [{ type: "streamable-http", url: "https://mcp.githits.com" }],
  packages: [{ identifier: "githits", version: "1.2.3" }],
  _meta: {
    "io.modelcontextprotocol.registry/publisher-provided": {
      keywords: registryKeywords,
    },
  },
};

describe("plugin asset generation", () => {
  it("renders host-specific transports from canonical inputs", () => {
    const inputs = createPluginAssetInputs(packageJson, serverJson, [
      ...CANONICAL_SKILL_NAMES,
    ]);
    const assets = new Map(
      renderPluginAssets(inputs).map((asset) => [asset.path, asset.content]),
    );

    expect(JSON.parse(assets.get(".mcp.json") ?? "{}")).toEqual({
      mcpServers: {
        githits: {
          type: "http",
          url: "https://mcp.githits.com",
        },
      },
    });
    const assetPaths: string[] = [...assets.keys()];
    expect(assetPaths).toContain("mcp.json");
    expect(JSON.parse(assets.get("mcp.json") ?? "{}")).toEqual({
      $schema: AGENT_PLUGINS_MCP_SCHEMA_URL,
      mcpServers: {
        githits: {
          type: "streamable-http",
          url: "https://mcp.githits.com",
        },
      },
    });
    expect(
      JSON.parse(assets.get("gemini-extension.json") ?? "{}").mcpServers,
    ).toEqual({
      githits: {
        httpUrl: "https://mcp.githits.com",
      },
    });
    expect(JSON.parse(assets.get("plugin.json") ?? "{}")).toEqual({
      $schema: AGENT_PLUGINS_SCHEMA_URL,
      name: "githits",
      version: "1.2.3",
      description: "The code context layer for AI coding agents",
      author: { name: "GitHits" },
      homepage: "https://githits.com",
      repository: "https://github.com/githits-com/githits-cli",
      license: "Apache-2.0",
      keywords: registryKeywords,
    });
    expect(JSON.parse(assets.get("mcp_config.json") ?? "{}")).toEqual(
      expect.objectContaining({
        mcpServers: {
          githits: {
            serverUrl: "https://mcp.githits.com",
          },
        },
      }),
    );
    expect(JSON.parse(assets.get(".codex-plugin/plugin.json") ?? "{}")).toEqual(
      expect.objectContaining({
        name: "githits",
        skills: "./skills/",
        mcpServers: "./.mcp.json",
      }),
    );
    expect(
      JSON.parse(assets.get(".cursor-plugin/plugin.json") ?? "{}"),
    ).toEqual(
      expect.objectContaining({
        name: "githits",
        skills: "skills",
        mcpServers: ".mcp.json",
      }),
    );
  });

  it("points the first-party Claude marketplace at the root payload", () => {
    const inputs = createPluginAssetInputs(packageJson, serverJson, [
      ...CANONICAL_SKILL_NAMES,
    ]);
    const marketplace = JSON.parse(
      renderPluginAssets(inputs).find(
        (asset) => asset.path === ".claude-plugin/marketplace.json",
      )?.content ?? "{}",
    ) as {
      plugins?: Array<{
        source?: { source?: string; url?: string };
      }>;
    };

    expect(marketplace.plugins?.[0]?.source).toEqual({
      source: "url",
      url: "https://github.com/githits-com/githits-cli.git",
    });
  });

  it("rejects release and canonical skill drift", () => {
    expect(() =>
      createPluginAssetInputs(
        packageJson,
        { ...serverJson, version: "1.2.2" },
        [...CANONICAL_SKILL_NAMES],
      ),
    ).toThrow("Root version mismatch");

    expect(() =>
      createPluginAssetInputs(packageJson, serverJson, ["githits-mcp"]),
    ).toThrow("Canonical skill set mismatch");

    expect(() =>
      createPluginAssetInputs(
        { ...packageJson, keywords: ["outdated"] },
        serverJson,
        [...CANONICAL_SKILL_NAMES],
      ),
    ).toThrow("Plugin keyword mismatch");
  });

  it("writes assets and detects stale generated output", async () => {
    const root = await mkdtemp(join(tmpdir(), "githits-plugin-assets-"));
    try {
      await writeFile(join(root, "package.json"), JSON.stringify(packageJson));
      await writeFile(join(root, "server.json"), JSON.stringify(serverJson));
      for (const skillName of CANONICAL_SKILL_NAMES) {
        const skillRoot = join(root, "skills", skillName);
        await mkdir(skillRoot, { recursive: true });
        await writeFile(join(skillRoot, "SKILL.md"), `# ${skillName}\n`);
      }

      await generatePluginAssets({ root });
      await expect(
        generatePluginAssets({ root, check: true }),
      ).resolves.toHaveLength(10);

      await writeFile(join(root, ".mcp.json"), "{}\n");
      await expect(generatePluginAssets({ root, check: true })).rejects.toThrow(
        "- .mcp.json",
      );

      await generatePluginAssets({ root });
      expect(await readFile(join(root, ".mcp.json"), "utf8")).toContain(
        "https://mcp.githits.com",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
