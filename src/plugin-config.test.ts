import { describe, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

describe("plugin MCP configuration", () => {
  it("uses the hosted remote MCP for root plugin packages", async () => {
    const rootMcpPath = join(import.meta.dir, "..", ".mcp.json");
    const contents = await readFile(rootMcpPath, "utf8");
    const parsed = JSON.parse(contents) as {
      mcpServers?: Record<string, { type?: string; url?: string }>;
    };

    expect(parsed.mcpServers).toBeDefined();
    expect(parsed.mcpServers?.githits).toBeDefined();
    expect(parsed.mcpServers?.githits).toEqual({
      type: "http",
      url: "https://mcp.githits.com",
    });
  });

  it("uses Streamable HTTP for the Gemini extension", async () => {
    const contents = await readFile(
      join(import.meta.dir, "..", "gemini-extension.json"),
      "utf8",
    );
    const parsed = JSON.parse(contents) as {
      mcpServers?: Record<string, { httpUrl?: string; command?: string }>;
    };

    expect(parsed.mcpServers?.githits).toEqual({
      httpUrl: "https://mcp.githits.com",
    });
  });

  it("uses Antigravity's remote serverUrl schema", async () => {
    const contents = await readFile(
      join(import.meta.dir, "..", "mcp_config.json"),
      "utf8",
    );
    const parsed = JSON.parse(contents) as {
      mcpServers?: Record<string, { serverUrl?: string; command?: string }>;
    };

    expect(parsed.mcpServers?.githits).toEqual({
      serverUrl: "https://mcp.githits.com",
    });
  });

  it("advertises both hosted and stdio transports in the MCP registry", async () => {
    const contents = await readFile(
      join(import.meta.dir, "..", "server.json"),
      "utf8",
    );
    const parsed = JSON.parse(contents) as {
      remotes?: Array<{ type?: string; url?: string }>;
      packages?: Array<{ identifier?: string; transport?: { type?: string } }>;
    };

    expect(parsed.remotes).toContainEqual({
      type: "streamable-http",
      url: "https://mcp.githits.com",
    });
    expect(parsed.packages).toContainEqual(
      expect.objectContaining({
        identifier: "githits",
        transport: { type: "stdio" },
      }),
    );
  });
});
