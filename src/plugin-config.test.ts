import { describe, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

interface McpServerConfig {
  url?: string;
  command?: string;
  args?: string[];
}

interface RegistryManifest {
  remotes?: Array<{
    type?: string;
    url?: string;
  }>;
}

describe("plugin MCP configuration", () => {
  it("uses hosted remote MCP in the root Open Plugin package", async () => {
    const rootMcpPath = join(import.meta.dir, "..", ".mcp.json");
    const registryPath = join(import.meta.dir, "..", "server.json");
    const [rootMcpContents, registryContents] = await Promise.all([
      readFile(rootMcpPath, "utf8"),
      readFile(registryPath, "utf8"),
    ]);
    const parsed = JSON.parse(rootMcpContents) as {
      mcpServers?: Record<string, McpServerConfig>;
    };
    const registry = JSON.parse(registryContents) as RegistryManifest;
    const streamableHttpRemotes =
      registry.remotes?.filter((remote) => remote.type === "streamable-http") ??
      [];

    expect(parsed.mcpServers).toBeDefined();
    expect(parsed.mcpServers?.githits).toBeDefined();
    expect(streamableHttpRemotes).toHaveLength(1);
    expect(streamableHttpRemotes[0]?.url).toBeDefined();
    expect(parsed.mcpServers?.githits?.url).toBe(streamableHttpRemotes[0]?.url);
    expect(parsed.mcpServers?.githits?.command).toBeUndefined();
    expect(parsed.mcpServers?.githits?.args).toBeUndefined();
  });

  it("uses local stdio MCP in the Claude plugin payload", async () => {
    const pluginMcpPath = join(
      import.meta.dir,
      "..",
      "plugins",
      "claude",
      ".mcp.json",
    );
    const contents = await readFile(pluginMcpPath, "utf8");
    const parsed = JSON.parse(contents) as {
      mcpServers?: Record<string, McpServerConfig>;
    };

    expect(parsed.mcpServers).toBeDefined();
    expect(parsed.mcpServers?.githits).toBeDefined();
    expect(parsed.mcpServers?.githits?.command).toBe("npx");
    expect(parsed.mcpServers?.githits?.args).toEqual([
      "-y",
      "githits@latest",
      "mcp",
      "start",
    ]);
    expect(parsed.mcpServers?.githits?.url).toBeUndefined();
  });
});
