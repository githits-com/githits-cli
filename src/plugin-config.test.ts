import { describe, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

describe("plugin MCP configuration", () => {
  it("defines githits MCP server in root Open Plugin package", async () => {
    const rootMcpPath = join(import.meta.dir, "..", ".mcp.json");
    const contents = await readFile(rootMcpPath, "utf8");
    const parsed = JSON.parse(contents) as {
      mcpServers?: Record<string, { command?: string; args?: string[] }>;
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
  });

  it("defines githits MCP server in Claude plugin payload", async () => {
    const pluginMcpPath = join(
      import.meta.dir,
      "..",
      "plugins",
      "claude",
      ".mcp.json",
    );
    const contents = await readFile(pluginMcpPath, "utf8");
    const parsed = JSON.parse(contents) as {
      mcpServers?: Record<string, { command?: string; args?: string[] }>;
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
  });
});
