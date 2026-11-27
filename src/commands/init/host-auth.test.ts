import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  mock,
  spyOn,
} from "bun:test";
import { posix, win32 } from "node:path";
import { ExitPromptError } from "@inquirer/core";
import type { PromptService } from "../../services/prompt-service.js";
import {
  createMockExecService,
  createMockFileSystemService,
  createMockPromptService,
} from "../../services/test-helpers.js";
import {
  getInitAgentDefinitions,
  type InitSetupScope,
} from "./agent-definitions.js";
import { runHostAuthentication } from "./host-auth.js";

const paths = process.platform === "win32" ? win32 : posix;
const ORIGINAL_CWD =
  process.platform === "win32"
    ? win32.join("C:/", "original", "repo", "sub")
    : "/original/repo/sub";
const ISOLATED_CWD =
  process.platform === "win32"
    ? win32.join("C:/", "isolated", "auth")
    : "/isolated/auth";
const URL = "https://mcp.githits.com";
const codex = (state: string): string =>
  JSON.stringify([
    {
      name: "githits",
      enabled: true,
      transport: { type: "streamable_http", url: URL },
      auth_status: state,
      http_headers: { secret: "SYNTHETIC_SECRET" },
    },
  ]);
const claude = (state: string): string =>
  `githits:\n  Scope: User config (available in all your projects)\n  Status: ${state}\n  Type: http\n  URL: ${URL}`;
let output: ReturnType<typeof spyOn>;
beforeEach(() => {
  output = spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  output.mockRestore();
});

function fixture(
  ids: string[] = ["codex-cli"],
  answers: string[] = ["sign_in", "run"],
) {
  const agents = getInitAgentDefinitions("remote").filter((agent) =>
    ids.includes(agent.id),
  );
  const fs = createMockFileSystemService({
    getCwd: () => ORIGINAL_CWD,
    joinPath: paths.join,
    exists: mock(async () => false),
    createTempDir: mock(async () => ISOLATED_CWD),
  });
  let loggedIn = false;
  const order: string[] = [];
  const exec = createMockExecService({
    exec: mock(async (command, args) => {
      order.push(`${command} ${args.join(" ")}`);
      if (args.includes("--help"))
        return {
          exitCode: 0,
          stdout:
            command === "claude"
              ? "  get <name>\n  login [options] <name>"
              : command === "codex"
                ? "  list\n  login"
                : `${command} mcp auth [name]\nCommands:\n  ${command} mcp auth list`,
          stderr: "",
        };
      const stdout =
        command === "codex"
          ? codex(loggedIn ? "o_auth" : "not_logged_in")
          : command === "claude"
            ? claude(loggedIn ? "✓ Connected" : "! Needs authentication")
            : `│ ● ✗ GitHits ${loggedIn ? "authenticated" : "not authenticated"}\n│ ${URL}`;
      return { exitCode: 0, stdout, stderr: "SYNTHETIC_SECRET" };
    }),
    execInteractive: mock(async (command, args) => {
      order.push(`RUN ${command} ${args.join(" ")}`);
      loggedIn = true;
      return { exitCode: 0, signal: null };
    }),
  });
  const prompts = createMockPromptService({
    select: mock(async <T>(_message: string) => {
      const value = answers.shift();
      if (value === "cancel") throw new ExitPromptError();
      return value as T;
    }) as PromptService["select"],
  });
  return {
    fs,
    exec,
    prompts,
    agents,
    order,
    setLoggedIn: () => {
      loggedIn = true;
    },
    run: (scope: InitSetupScope = "user") =>
      runHostAuthentication(
        agents,
        scope,
        { fileSystemService: fs, execService: exec, promptService: prompts },
        false,
      ),
  };
}

describe("guided native host authentication", () => {
  it("checks, obtains two explicit choices, hands off terminal then rechecks", async () => {
    const f = fixture();
    const result = await f.run();
    expect(result.authenticatedIds).toEqual(["codex-cli"]);
    expect(result.remaining).toEqual([]);
    expect(f.prompts.select).toHaveBeenCalledTimes(2);
    expect(f.exec.execInteractive).toHaveBeenCalledTimes(1);
    expect(f.order).toEqual([
      "codex mcp --help",
      "codex mcp list --json",
      "RUN codex mcp login githits",
      "codex mcp list --json",
    ]);
    for (const call of (f.exec.exec as ReturnType<typeof mock>).mock.calls)
      expect(call[2]?.cwd).toBe(ISOLATED_CWD);
    expect(f.exec.execInteractive).toHaveBeenCalledWith(
      "codex",
      ["mcp", "login", "githits"],
      { cwd: ISOLATED_CWD, env: expect.any(Object) },
    );
    expect(f.fs.deleteDirIfEmpty).toHaveBeenCalledWith(ISOLATED_CWD);
    expect(output.mock.calls.flat().join("\n")).not.toContain(
      "SYNTHETIC_SECRET",
    );
  });
  it("does not offer sign-in to an authenticated host", async () => {
    const f = fixture();
    f.setLoggedIn();
    const result = await f.run();
    expect(result.remaining).toEqual([]);
    expect(f.prompts.select).not.toHaveBeenCalled();
    expect(f.exec.execInteractive).not.toHaveBeenCalled();
  });
  for (const answers of [["instructions"], ["sign_in", "skip"]])
    it(`preserves instructions on ${answers.at(-1)}`, async () => {
      const f = fixture(undefined, [...answers]);
      const result = await f.run();
      expect(result.remaining.map((agent) => agent.id)).toEqual(["codex-cli"]);
      expect(f.exec.execInteractive).not.toHaveBeenCalled();
    });
  it("leaves unknown status manual and never leaks errors", async () => {
    const f = fixture();
    f.exec.exec = mock(async () => {
      throw new Error("SYNTHETIC_SECRET");
    });
    const result = await f.run();
    expect(result.remaining).toHaveLength(1);
    expect(f.exec.execInteractive).not.toHaveBeenCalled();
    expect(output.mock.calls.flat().join("\n")).not.toContain(
      "SYNTHETIC_SECRET",
    );
  });
  for (const id of ["opencode", "kilo-code"])
    it(`${id} exit zero without signed-in recheck stays unresolved`, async () => {
      const f = fixture([id]);
      f.exec.execInteractive = mock(async () => ({
        exitCode: 0,
        signal: null,
      }));
      const result = await f.run();
      expect(result.authenticatedIds).toEqual([]);
      expect(result.remaining).toHaveLength(1);
      expect(f.exec.execInteractive).toHaveBeenCalledTimes(1);
    });
  it("accepts dedicated native help written to stderr", async () => {
    const f = fixture(["kilo-code"]);
    const original = f.exec.exec;
    f.exec.exec = mock(async (command, args, options) => {
      const result = await original(command, args, options);
      return args.includes("--help")
        ? { ...result, stdout: "", stderr: result.stdout }
        : result;
    });
    const result = await f.run();
    expect(result.authenticatedIds).toEqual(["kilo-code"]);
    expect(f.exec.execInteractive).toHaveBeenCalledTimes(1);
  });
  it("OpenCode 2.x help never triggers the ambiguous auth list command", async () => {
    const f = fixture(["opencode"]);
    f.exec.exec = mock(async () => ({
      exitCode: 0,
      stdout: "opencode mcp auth [name]",
      stderr: "",
    }));
    await f.run();
    expect(f.exec.exec).toHaveBeenCalledTimes(1);
    expect(f.exec.execInteractive).not.toHaveBeenCalled();
  });
  it("old Claude stays in-session without running get or login", async () => {
    const f = fixture(["claude-code"]);
    f.exec.exec = mock(async () => ({
      exitCode: 0,
      stdout: "  get <name>\n  list",
      stderr: "",
    }));
    const result = await f.run();
    expect(f.exec.exec).toHaveBeenCalledTimes(1);
    expect(f.exec.execInteractive).not.toHaveBeenCalled();
    expect(result.remaining[0]?.remoteInstructions?.join()).toContain("/mcp");
  });
  it("Claude user checks and login share isolated cwd instead of original project", async () => {
    const f = fixture(["claude-code"]);
    await f.run();
    expect(f.exec.execInteractive).toHaveBeenCalledWith(
      "claude",
      ["mcp", "login", "githits"],
      expect.objectContaining({ cwd: ISOLATED_CWD }),
    );
    expect(f.order.filter((line) => line.includes("get"))).toHaveLength(2);
  });
  it("Claude project and managed-exclusive cases remain manual", async () => {
    const project = fixture(["claude-code"]);
    await project.run("project");
    expect(project.exec.exec).not.toHaveBeenCalled();
    const managed = fixture(["claude-code"]);
    managed.fs.exists = mock(async () => true);
    await managed.run();
    expect(managed.exec.exec).not.toHaveBeenCalled();
  });
  for (const platform of ["linux", "win32"] as const)
    it(`normalizes relative home override for ${platform} without changing the parent`, async () => {
      const oldHome = process.env.CODEX_HOME;
      const descriptor = Object.getOwnPropertyDescriptor(process, "platform")!;
      process.env.CODEX_HOME = "codex-home";
      Object.defineProperty(process, "platform", {
        configurable: true,
        value: platform,
      });
      const nativePaths = platform === "win32" ? win32 : posix;
      const original =
        platform === "win32"
          ? win32.join("C:/", "original", "repo", "sub")
          : "/original/repo/sub";
      try {
        const f = fixture();
        f.fs.getCwd = () => original;
        f.fs.joinPath = nativePaths.join;
        f.fs.createTempDir = mock(async () =>
          platform === "win32"
            ? win32.join("C:/", "isolated", "auth")
            : "/isolated/auth",
        );
        await f.run();
        const expected = nativePaths.join(original, "codex-home");
        expect(f.exec.execInteractive).toHaveBeenCalledWith(
          "codex",
          expect.any(Array),
          expect.objectContaining({
            env: expect.objectContaining({ CODEX_HOME: expected }),
          }),
        );
        for (const call of (f.exec.exec as ReturnType<typeof mock>).mock.calls)
          expect(call[2]?.env?.CODEX_HOME).toBe(expected);
        expect(process.env.CODEX_HOME).toBe("codex-home");
      } finally {
        Object.defineProperty(process, "platform", descriptor);
        if (oldHome === undefined) delete process.env.CODEX_HOME;
        else process.env.CODEX_HOME = oldHome;
      }
    });
  it("signal cancellation stops later tools and preserves unresolved targets", async () => {
    const f = fixture(["claude-code", "codex-cli"], ["sign_in", "run"]);
    f.exec.execInteractive = mock(async () => ({
      exitCode: null,
      signal: "SIGINT" as const,
    }));
    const result = await f.run();
    expect(result.cancelled).toBe(true);
    expect(result.remaining).toHaveLength(2);
    expect(f.exec.execInteractive).toHaveBeenCalledTimes(1);
    expect(output.mock.calls.flat().join()).toContain("configuration is saved");
  });
  it("exit130 and cancelled selectors stop the sequence", async () => {
    for (const cancel of ["child", "prompt"]) {
      const f = fixture(
        undefined,
        cancel === "prompt" ? ["cancel"] : undefined,
      );
      f.exec.execInteractive = mock(async () => ({
        exitCode: 130,
        signal: null,
      }));
      const result = await f.run();
      expect(result.cancelled).toBe(true);
      expect(result.remaining).toHaveLength(1);
    }
  });
  it("skipping one host and failing another never bypasses per-command consent", async () => {
    const f = fixture(["claude-code", "codex-cli"], ["sign_in", "skip", "run"]);
    f.exec.execInteractive = mock(async () => ({ exitCode: 1, signal: null }));
    const result = await f.run();
    expect(f.prompts.select).toHaveBeenCalledTimes(3);
    expect(f.exec.execInteractive).toHaveBeenCalledTimes(1);
    expect(result.remaining).toHaveLength(2);
  });
  it("deduplicates targets and does not probe UI-only hosts", async () => {
    const f = fixture(["cursor"]);
    const result = await f.run();
    expect(result.remaining).toHaveLength(1);
    expect(f.fs.createTempDir).not.toHaveBeenCalled();
    expect(f.exec.exec).not.toHaveBeenCalled();
    const both = fixture();
    both.agents.push(both.agents[0]!);
    await both.run();
    expect(both.exec.execInteractive).toHaveBeenCalledTimes(1);
  });
});
