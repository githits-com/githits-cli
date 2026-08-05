import { describe, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const root = join(import.meta.dir, "..");

async function readCommand(basePath: string, name: string): Promise<string> {
  return readFile(join(root, basePath, "commands", `${name}.md`), "utf8");
}

function codeBlocks(markdown: string): string {
  return [...markdown.matchAll(/```[^\n]*\n([\s\S]*?)```/g)]
    .map((match) => match[1])
    .join("\n");
}

describe("plugin authentication commands", () => {
  it("uses host-neutral authentication and verification in root commands", async () => {
    const [help, login, logout, status] = await Promise.all([
      readCommand(".", "help"),
      readCommand(".", "login"),
      readCommand(".", "logout"),
      readCommand(".", "status"),
    ]);

    for (const command of [help, login, status]) {
      expect(command).toContain("search_language");
      expect(command).toContain("current host");
    }
    for (const command of [help, login, logout, status]) {
      expect(command).not.toContain("Cursor");
      expect(command).not.toContain("cursor-agent");
      expect(command).not.toContain("/mcp");
    }
  });

  it("keeps root logout host-managed without triggering authentication", async () => {
    const logout = await readCommand(".", "logout");

    expect(logout).toContain("no portable");
    expect(logout).toContain("current host");
    expect(logout).not.toContain("search_language");
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
