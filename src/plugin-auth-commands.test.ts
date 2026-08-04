import { describe, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const root = join(import.meta.dir, "..");

async function readMarketplaceServerName(): Promise<string> {
  const contents = await readFile(join(root, ".mcp.json"), "utf8");
  const parsed = JSON.parse(contents) as {
    mcpServers?: Record<string, unknown>;
  };
  const serverNames = Object.keys(parsed.mcpServers ?? {});

  expect(serverNames).toEqual(["githits"]);
  return serverNames[0] as string;
}

async function readCommand(basePath: string, name: string): Promise<string> {
  return readFile(join(root, basePath, "commands", `${name}.md`), "utf8");
}

function codeBlocks(markdown: string): string {
  return [...markdown.matchAll(/```[^\n]*\n([\s\S]*?)```/g)]
    .map((match) => match[1])
    .join("\n");
}

describe("plugin authentication commands", () => {
  it("uses executable Cursor authentication and verification in root commands", async () => {
    const [serverName, help, login, logout, status] = await Promise.all([
      readMarketplaceServerName(),
      readCommand(".", "help"),
      readCommand(".", "login"),
      readCommand(".", "logout"),
      readCommand(".", "status"),
    ]);
    const loginCommand = `cursor-agent mcp login ${serverName}`;
    const listToolsCommand = `cursor-agent mcp list-tools ${serverName}`;

    expect(login).toContain(loginCommand);
    expect(help).toContain(loginCommand);
    for (const command of [help, login, status]) {
      expect(command).toContain("cursor-agent mcp list");
      expect(command).toContain(listToolsCommand);
      expect(command).toContain("search_language");
      expect(command).toContain("new Cursor Agent chat");
    }
    for (const command of [help, login, logout, status]) {
      expect(command).not.toMatch(
        /cursor-agent mcp (?:login|list-tools|logout) GitHits/,
      );
    }
  });

  it("keeps root logout manual without inventing a Cursor command", async () => {
    const [serverName, logout] = await Promise.all([
      readMarketplaceServerName(),
      readCommand(".", "logout"),
    ]);
    const logoutCommand = `cursor-agent mcp logout ${serverName}`;

    expect(logout).toMatch(/Cursor's\s+MCP settings/);
    expect(logout).toContain("does not have a supported");
    expect(logout).toContain(logoutCommand);
    expect(codeBlocks(logout)).not.toContain(logoutCommand);
  });

  it("does not prescribe local CLI authentication for root remote sessions", async () => {
    const commands = await Promise.all(
      ["login", "logout", "status"].map((name) => readCommand(".", name)),
    );

    expect(codeBlocks(commands.join("\n"))).not.toMatch(
      /githits (?:login|logout|auth status)/,
    );
  });

  it("keeps Claude payload authentication on local stdio commands", async () => {
    const [login, logout, status] = await Promise.all([
      readCommand("plugins/claude", "login"),
      readCommand("plugins/claude", "logout"),
      readCommand("plugins/claude", "status"),
    ]);

    expect(login).toContain("npx -y githits login");
    expect(login).toContain("npx -y githits login --no-browser");
    expect(logout).toContain("npx -y githits logout");
    expect(status).toContain("npx -y githits auth status");

    for (const command of [login, logout, status]) {
      expect(command).not.toContain("cursor-agent mcp");
    }
  });

  it("keeps root help static and Claude help executable over stdio", async () => {
    const [rootHelp, claudeHelp] = await Promise.all([
      readCommand(".", "help"),
      readCommand("plugins/claude", "help"),
    ]);
    const npxGitHitsCommand = /\bnpx\b[^\n]*\bgithits(?:@latest)?(?=\s|$)/;

    expect(rootHelp).not.toMatch(npxGitHitsCommand);
    expect(codeBlocks(rootHelp)).not.toMatch(npxGitHitsCommand);
    expect(codeBlocks(claudeHelp)).toContain("npx -y githits help");
  });
});
