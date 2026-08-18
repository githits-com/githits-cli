import { describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

interface CliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

const configHomeEnvKey =
  process.platform === "win32" ? "APPDATA" : "XDG_CONFIG_HOME";
const alternateConfigHomeEnvKey =
  configHomeEnvKey === "APPDATA" ? "XDG_CONFIG_HOME" : "APPDATA";

async function runCli(
  configHome: string,
  args: string[],
  isolatedHome?: string,
): Promise<CliResult> {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    GITHITS_DISABLE_UPDATE_CHECK: "1",
    GITHITS_API_URL: "not-a-url",
    GITHITS_MCP_URL: "not-a-url",
    GITHITS_ACCOUNTS_URL: "not-a-url",
    GITHITS_CODE_NAV_URL: "not-a-url",
    NO_COLOR: "1",
  };
  delete env.GITHITS_API_TOKEN;
  if (isolatedHome !== undefined) {
    env.HOME = isolatedHome;
    env.USERPROFILE = isolatedHome;
  }
  env[configHomeEnvKey] = configHome;
  delete env[alternateConfigHomeEnvKey];

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
  fn: (configHome: string) => Promise<T>,
): Promise<T> {
  const configHome = await mkdtemp(join(tmpdir(), "githits-cli-policy-"));
  try {
    if (contents !== undefined) {
      const configDir = join(configHome, "githits");
      await mkdir(configDir, { recursive: true });
      await writeFile(join(configDir, "config.toml"), contents);
    }
    return await fn(configHome);
  } finally {
    await rm(configHome, { recursive: true, force: true });
  }
}

async function withMissingConfig<T>(
  fn: (configHome: string, isolatedHome: string) => Promise<T>,
): Promise<T> {
  const configHome = await mkdtemp(
    join(tmpdir(), "githits-cli-missing-config-"),
  );
  const isolatedHome = await mkdtemp(
    join(tmpdir(), "githits-cli-missing-home-"),
  );
  try {
    return await fn(configHome, isolatedHome);
  } finally {
    await rm(configHome, { recursive: true, force: true });
    await rm(isolatedHome, { recursive: true, force: true });
  }
}

describe("experimental CLI process policy", () => {
  it("hides experimental commands when canonical and legacy config are absent", async () => {
    await withMissingConfig(async (xdgConfigHome, isolatedHome) => {
      const root = await runCli(xdgConfigHome, ["--help"], isolatedHome);
      expect(root.exitCode).toBe(0);
      expect(root.stdout).not.toContain("resolve");

      const code = await runCli(
        xdgConfigHome,
        ["code", "--help"],
        isolatedHome,
      );
      expect(code.exitCode).toBe(0);
      expect(code.stdout).not.toContain("diff");
    });
  }, 30_000);

  it("hides experimental commands from empty and false config help", async () => {
    for (const contents of ["", "[experimental]\ntools = false\n"]) {
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
    await withConfig(
      "[experimental]\ntools = false\n",
      async (xdgConfigHome) => {
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
        const directJson = await runCli(xdgConfigHome, [
          "code",
          "diff",
          "npm:express",
          "5.2.0..5.2.1",
          "--json",
        ]);
        expect(directJson.exitCode).toBe(1);
        expect(directJson.stdout).toBe("");
        expect(JSON.parse(directJson.stderr)).toEqual({
          error: `Experimental CLI command "code diff" is disabled. Enable it in ${join(xdgConfigHome, "githits", "config.toml")} by adding:\n[experimental]\ntools = true`,
          code: "INVALID_ARGUMENT",
          retryable: false,
        });
      },
    );
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

      const directJson = await runCli(xdgConfigHome, [
        "resolve",
        "express",
        "--json",
      ]);
      expect(directJson.exitCode).toBe(1);
      expect(directJson.stdout).toBe("");
      expect(JSON.parse(directJson.stderr)).toMatchObject({
        code: "INVALID_ARGUMENT",
        retryable: false,
      });
    });
  }, 30_000);
});
