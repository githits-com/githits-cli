import { describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

interface CliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

async function runCli(
  xdgConfigHome: string,
  args: string[],
): Promise<CliResult> {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    XDG_CONFIG_HOME: xdgConfigHome,
    GITHITS_DISABLE_UPDATE_CHECK: "1",
    GITHITS_API_URL: "not-a-url",
    GITHITS_MCP_URL: "not-a-url",
    GITHITS_ACCOUNTS_URL: "not-a-url",
    GITHITS_CODE_NAV_URL: "not-a-url",
    NO_COLOR: "1",
  };
  delete env.GITHITS_API_TOKEN;

  const child = Bun.spawn(["bun", "run", "src/cli.ts", ...args], {
    cwd: process.cwd(),
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { stdout, stderr, exitCode };
}

async function withConfig<T>(
  contents: string | undefined,
  fn: (xdgConfigHome: string) => Promise<T>,
): Promise<T> {
  const xdgConfigHome = await mkdtemp(join(tmpdir(), "githits-cli-policy-"));
  try {
    if (contents !== undefined) {
      const configDir = join(xdgConfigHome, "githits");
      await mkdir(configDir, { recursive: true });
      await writeFile(join(configDir, "config.toml"), contents);
    }
    return await fn(xdgConfigHome);
  } finally {
    await rm(xdgConfigHome, { recursive: true, force: true });
  }
}

describe("experimental CLI process policy", () => {
  it("hides experimental commands from absent and false config help", async () => {
    for (const contents of [undefined, "[experimental]\ntools = false\n"]) {
      await withConfig(contents, async (xdgConfigHome) => {
        const root = await runCli(xdgConfigHome, ["--help"]);
        expect(root.exitCode).toBe(0);
        expect(root.stdout).not.toContain("resolve");

        const code = await runCli(xdgConfigHome, ["code", "--help"]);
        expect(code.exitCode).toBe(0);
        expect(code.stdout).toContain("files");
        expect(code.stdout).toContain("read");
        expect(code.stdout).toContain("grep");
        expect(code.stdout).not.toContain("diff");
        expect(code.stdout).not.toContain("compare exact trees");
      });
    }
  }, 30_000);

  it("shows experimental commands when tools are enabled", async () => {
    await withConfig(
      "[experimental]\ntools = true\n",
      async (xdgConfigHome) => {
        const root = await runCli(xdgConfigHome, ["--help"]);
        expect(root.exitCode).toBe(0);
        expect(root.stdout).toContain("resolve");

        const code = await runCli(xdgConfigHome, ["code", "--help"]);
        expect(code.exitCode).toBe(0);
        expect(code.stdout).toContain("diff");
        expect(code.stdout).toContain("compare exact trees");
      },
    );
  }, 30_000);

  it("rejects disabled direct commands before auth, update, or service work", async () => {
    await withConfig(undefined, async (xdgConfigHome) => {
      for (const args of [
        ["resolve", "--help"],
        ["code", "diff", "--help"],
        ["help", "resolve"],
        ["help", "code", "diff"],
      ]) {
        const result = await runCli(xdgConfigHome, args);
        expect(result.exitCode).toBe(1);
        expect(result.stdout).toBe("");
        expect(result.stderr).toContain(
          join(xdgConfigHome, "githits", "config.toml"),
        );
        expect(result.stderr).toContain("[experimental]\ntools = true");
        expect(result.stderr).not.toContain("unknown command");
        expect(result.stderr).not.toContain("Invalid GITHITS_API_URL");
        expect(result.stderr).not.toContain("Authentication");
      }
    });
  }, 30_000);

  it("keeps stable recovery surfaces available for malformed config", async () => {
    await withConfig("[experimental\n", async (xdgConfigHome) => {
      for (const args of [
        ["--help"],
        ["--version"],
        ["code", "--help"],
        ["doctor", "--help"],
        ["logout", "--help"],
      ]) {
        const result = await runCli(xdgConfigHome, args);
        expect(result.exitCode).toBe(0);
        expect(result.stdout).not.toContain("resolve");
        expect(result.stdout).not.toContain("diff");
      }

      const direct = await runCli(xdgConfigHome, ["resolve", "express"]);
      expect(direct.exitCode).toBe(1);
      expect(direct.stderr).toContain(
        join(xdgConfigHome, "githits", "config.toml"),
      );
      expect(direct.stderr).toContain("Cannot parse GitHits config");

      const directDiff = await runCli(xdgConfigHome, [
        "code",
        "diff",
        "--help",
      ]);
      expect(directDiff.exitCode).toBe(1);
      expect(directDiff.stderr).toContain("Cannot parse GitHits config");
    });
  }, 30_000);
});
