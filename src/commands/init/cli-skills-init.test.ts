import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  mock,
  spyOn,
} from "bun:test";
import { readFileSync } from "node:fs";
import { posix, resolve } from "node:path";
import { ExitPromptError } from "@inquirer/core";
import type { PromptService } from "../../services/prompt-service.js";
import {
  createMockAuthService,
  createMockAuthStorage,
  createMockBrowserService,
  createMockExecService,
  createMockFileSystemService,
  createMockPromptService,
} from "../../services/test-helpers.js";
import { agentDefinitions } from "./agent-definitions.js";
import { GITHITS_SKILL_SOURCE_PATHS } from "./guidance-assets.js";
import {
  type InitDependencies,
  type InitOptions,
  initAction,
  initUninstallAction,
} from "./init.js";

let log: ReturnType<typeof spyOn>;
let error: ReturnType<typeof spyOn>;
let oldExit: typeof process.exitCode;
let oldPlatform: NodeJS.Platform;
beforeEach(() => {
  oldExit = process.exitCode;
  oldPlatform = process.platform;
  Object.defineProperty(process, "platform", {
    configurable: true,
    value: "linux",
  });
  process.exitCode = 0;
  log = spyOn(console, "log").mockImplementation(() => {});
  error = spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  log.mockRestore();
  error.mockRestore();
  process.exitCode = oldExit;
  Object.defineProperty(process, "platform", {
    configurable: true,
    value: oldPlatform,
  });
});

const HOME = "/home/cli-test";
function fixture(ids = ["cline"], seed: Record<string, string> = {}) {
  const files = { ...seed };
  const sources = new Map(
    Object.values(GITHITS_SKILL_SOURCE_PATHS).flatMap((skill) =>
      skill.files.map(
        (file) =>
          [
            resolve(file.sourcePath),
            readFileSync(file.sourcePath, "utf8"),
          ] as const,
      ),
    ),
  );
  const dirs = new Set(["/repo"]);
  const fs = createMockFileSystemService({
    getHomeDir: () => HOME,
    getCwd: () => "/repo",
    joinPath: posix.join,
    getDirname: posix.dirname,
  });
  for (const agent of agentDefinitions.filter((agent) =>
    ids.includes(agent.id),
  ))
    for (const path of agent.detectPaths?.(fs) ?? []) dirs.add(path);
  fs.isDirectory = mock(async (path) => dirs.has(path));
  fs.exists = mock(async (path) => path in files || dirs.has(path));
  fs.readFile = mock(async (path) => {
    const value = files[path] ?? sources.get(resolve(path));
    if (value !== undefined) return value;
    throw Object.assign(new Error("Not found"), { code: "ENOENT" });
  });
  fs.atomicWriteFile = mock(async (path, content) => {
    files[path] = content;
  });
  fs.deleteFile = mock(async (path) => {
    delete files[path];
  });
  const exec = createMockExecService({
    exec: mock(async (command, args) => {
      if (
        (command === "which" || command === "where") &&
        ids.includes("codex-cli") &&
        args[0] === "codex"
      )
        return { exitCode: 0, stdout: "/bin/codex", stderr: "" };
      return { exitCode: 1, stdout: "", stderr: "" };
    }),
  });
  const prompts = createMockPromptService({
    select: mock(
      async <T>(message: string, choices: { value: T }[], defaultValue?: T) =>
        message.includes("How would")
          ? ("skills" as T)
          : (defaultValue ?? choices[0]!.value),
    ) as PromptService["select"],
  });
  const auth = mock(async () => ({
    hasValidToken: true,
    authService: createMockAuthService(),
    authStorage: createMockAuthStorage(),
    browserService: createMockBrowserService(),
    mcpUrl: "https://mcp.githits.com",
  }));
  const deps: InitDependencies = {
    fileSystemService: fs,
    execService: exec,
    promptService: prompts,
    createLoginDeps: auth,
    isInteractive: true,
  };
  return {
    files,
    fs,
    exec,
    prompts,
    auth,
    deps,
    run: async (options: InitOptions = {}) => {
      log.mockClear();
      await initAction(options, deps);
      return log.mock.calls
        .map((call: unknown[]) => String(call[0] ?? ""))
        .join("\n")
        .replace(/\s+/g, " ");
    },
  };
}
function expectedFiles(root: string): string[] {
  return [
    "githits-code/references/code-and-docs.md",
    "githits-code/SKILL.md",
    "githits-package/references/package.md",
    "githits-package/SKILL.md",
  ]
    .map((file) => `${root}/${file}`)
    .sort();
}
function assertNoMcpCalls(f: ReturnType<typeof fixture>): void {
  const calls = (f.exec.exec as ReturnType<typeof mock>).mock.calls;
  const availability = [
    "npm prefix -g",
    "pnpm bin -g",
    "bun pm bin -g",
    "codex --version",
  ];
  expect(
    calls.filter(
      ([command, args]) =>
        !["which", "where"].includes(String(command)) &&
        !availability.includes(`${command} ${(args as string[]).join(" ")}`),
    ),
  ).toEqual([]);
  expect(
    (f.fs.readFile as ReturnType<typeof mock>).mock.calls.filter(([path]) =>
      /(?:mcp[.]json|config[.]toml|settings[.]json)$/.test(String(path)),
    ),
  ).toEqual([]);
}

describe("direct CLI setup", () => {
  for (const project of [false, true])
    it(`installs exactly two complete skills in ${project ? "project" : "user"} scope without MCP probes`, async () => {
      const mcp = `${HOME}/.cline/data/settings/cline_mcp_settings.json`;
      const other = `${HOME}/.agents/skills/unrelated/SKILL.md`;
      const f = fixture(["cline", "codex-cli"], {
        [mcp]: "keep exact MCP bytes",
        [other]: "keep other skill",
      });
      const output = await f.run({ project });
      const first = (f.prompts.select as ReturnType<typeof mock>).mock
        .calls[0]!;
      expect(
        (first[1] as { name: string }[]).map((choice) => choice.name),
      ).toEqual([
        "Connect via remote MCP (recommended)",
        "Run MCP locally (supports experimental features)",
        "Use the CLI with supporting skills",
        "Exit",
      ]);
      expect(first[2]).toBe("remote-guided");

      const root = `${project ? "/repo" : HOME}/.agents/skills`;
      expect(
        Object.keys(f.files)
          .filter((path) => !(path in { [mcp]: 1, [other]: 1 }))
          .sort(),
      ).toEqual(expectedFiles(root));
      expect(f.files[mcp]).toBe("keep exact MCP bytes");
      expect(f.files[other]).toBe("keep other skill");
      expect(f.fs.atomicWriteFile).toHaveBeenCalledTimes(4);
      expect(f.auth).toHaveBeenCalledTimes(1);
      expect(output).toContain("GitHits CLI is ready");
      expect(output).not.toContain("MCP server configured");
      expect(output).toContain("global CLI install is not required");
      if (project) expect(output).toContain("may be committed");
      assertNoMcpCalls(f);
      expect(
        (f.prompts.select as ReturnType<typeof mock>).mock.calls.some(
          ([message]) => String(message).includes("Install supporting"),
        ),
      ).toBe(false);
      for (const path of expectedFiles(root))
        expect(
          output.replaceAll("~", HOME).replaceAll("./.agents", "/repo/.agents"),
        ).toContain(path);
    });
  it("uses skill support for project agents even when their MCP project setup is unsupported", async () => {
    const f = fixture(["google-antigravity"]);
    await f.run({ project: true, skipLogin: true });
    expect(Object.keys(f.files).sort()).toEqual(
      expectedFiles("/repo/.agents/skills"),
    );
    assertNoMcpCalls(f);
  });
  it("checks auth again on an unchanged repeat without review or writes", async () => {
    const f = fixture();
    await f.run();
    (f.fs.atomicWriteFile as ReturnType<typeof mock>).mockClear();
    (f.prompts.confirm as ReturnType<typeof mock>).mockClear();
    f.auth.mockClear();
    f.deps.createLoginDeps = mock(async () => ({
      ...(await f.auth()),
      hasValidToken: false,
    }));
    f.prompts.select = mock(
      async <T>(message: string, choices: { value: T }[], defaultValue?: T) =>
        message.includes("How would")
          ? ("skills" as T)
          : message.includes("sign-in")
            ? ("skip" as T)
            : (defaultValue ?? choices[0]!.value),
    ) as PromptService["select"];
    const output = await f.run();
    expect(f.auth).toHaveBeenCalledTimes(1);
    expect(f.fs.atomicWriteFile).not.toHaveBeenCalled();
    expect(f.prompts.confirm).not.toHaveBeenCalled();
    expect(output).toContain("sign-in is still required");
    expect(output).not.toContain("CLI is ready");
    assertNoMcpCalls(f);
  });
  it("repairs a missing skill reference", async () => {
    const f = fixture();
    await f.run();
    delete f.files[
      `${HOME}/.agents/skills/githits-code/references/code-and-docs.md`
    ];
    (f.fs.atomicWriteFile as ReturnType<typeof mock>).mockClear();
    await f.run();
    expect(f.fs.atomicWriteFile).toHaveBeenCalledTimes(1);
    expect(
      f.files[
        `${HOME}/.agents/skills/githits-code/references/code-and-docs.md`
      ],
    ).toContain("GitHits");
  });
  for (const choice of ["cancel", "skip"])
    it(`${choice} auth respects the write boundary`, async () => {
      const f = fixture();
      f.deps.createLoginDeps = mock(async () => ({
        ...(await f.auth()),
        hasValidToken: false,
      }));
      f.prompts.select = mock(
        async <T>(
          message: string,
          choices: { value: T }[],
          defaultValue?: T,
        ) =>
          message.includes("How would")
            ? ("skills" as T)
            : message.includes("sign-in")
              ? (choice as T)
              : (defaultValue ?? choices[0]!.value),
      ) as PromptService["select"];
      const output = await f.run();
      expect(Object.keys(f.files)).toHaveLength(choice === "cancel" ? 0 : 4);
      expect(output).not.toContain("CLI is ready");
      assertNoMcpCalls(f);
    });
  it("allows continuing after auth failure without claiming readiness", async () => {
    const f = fixture();
    f.deps.createLoginDeps = mock(async () => {
      throw new Error("Sign-in unavailable");
    });
    f.prompts.select = mock(
      async <T>(message: string, choices: { value: T }[], defaultValue?: T) =>
        message.includes("How would")
          ? ("skills" as T)
          : message.includes("Authentication failed")
            ? ("continue_without_auth" as T)
            : (defaultValue ?? choices[0]!.value),
    ) as PromptService["select"];
    const output = await f.run();
    expect(Object.keys(f.files)).toHaveLength(4);
    expect(output).not.toContain("CLI is ready");
  });
  it("installs without an auth factory and reports sign-in unavailable", async () => {
    const f = fixture();
    delete f.deps.createLoginDeps;
    const output = await f.run();
    expect(Object.keys(f.files)).toHaveLength(4);
    expect(output).toContain("Sign-in unavailable");
    expect(output).not.toContain("CLI is ready");
  });
  for (const failure of ["write", "verification"])
    it(`fails ${failure} without claiming readiness`, async () => {
      const f = fixture();
      f.fs.atomicWriteFile = mock(async () => {
        if (failure === "write") throw new Error("Read-only folder");
      });
      const output = await f.run();
      expect(process.exitCode).toBe(1);
      expect(output).not.toContain("CLI is ready");
      expect(output).toContain(
        failure === "write" ? "Read-only folder" : "verification failed",
      );
    });
  it("rejects contradictory no-guidance immediately before scope or detection", async () => {
    const f = fixture();
    await f.run({ guidance: false });
    expect(process.exitCode).toBe(1);
    expect(f.prompts.select).toHaveBeenCalledTimes(1);
    expect(f.fs.isDirectory).not.toHaveBeenCalled();
    expect(f.exec.exec).not.toHaveBeenCalled();
    expect(f.auth).not.toHaveBeenCalled();
    expect(f.fs.atomicWriteFile).not.toHaveBeenCalled();
  });
  for (const mode of ["empty", "unsupported", "cancel"])
    it(`does not authenticate or write for ${mode} selection`, async () => {
      const f = fixture(mode === "unsupported" ? ["amazon-q-cli"] : ["cline"]);
      if (mode === "empty")
        f.prompts.checkbox = mock(async () => []) as PromptService["checkbox"];
      if (mode === "cancel")
        f.prompts.confirm = mock(async () => {
          throw new ExitPromptError();
        });
      const output = await f.run();
      expect(f.auth).not.toHaveBeenCalled();
      expect(f.fs.atomicWriteFile).not.toHaveBeenCalled();
      if (mode === "unsupported") {
        expect(output).toContain("npx skills add");
        expect(output).toContain("githits-code and githits-package");
      }
    });
  it("uninstalls CLI-only files when no MCP remains", async () => {
    const f = fixture();
    await f.run({ skipLogin: true });
    await initUninstallAction({ yes: true }, f.deps);
    expect(Object.keys(f.files)).toEqual([]);
    expect(f.fs.deleteDirIfEmpty).toHaveBeenCalledWith(
      `${HOME}/.agents/skills/githits-code/references`,
    );
    expect(f.fs.deleteDirIfEmpty).toHaveBeenCalledWith(
      `${HOME}/.agents/skills/githits-code`,
    );
  });
  it("preserves CLI skills shared with unselected agents during mixed MCP uninstall", async () => {
    const config = `${HOME}/.cursor/mcp.json`;
    const f = fixture(["cline", "cursor"], {
      [config]: JSON.stringify({
        mcpServers: { GitHits: { url: "https://mcp.githits.com" } },
      }),
    });
    await f.run({ skipLogin: true });
    f.prompts.checkbox = mock(
      async <T>(_message: string, choices: { value: T }[]) =>
        choices
          .filter((choice) => (choice.value as { id?: string }).id === "cursor")
          .map((choice) => choice.value),
    ) as PromptService["checkbox"];
    await initUninstallAction({}, f.deps);
    expect(
      Object.keys(f.files)
        .filter((path) => path !== config)
        .sort(),
    ).toEqual(expectedFiles(`${HOME}/.agents/skills`));
    expect(JSON.parse(f.files[config]!).mcpServers).toEqual({});
  });
  it("installs, repairs and removes all local MCP skill reference files", async () => {
    const f = fixture();
    await f.run({ local: true, skipLogin: true, guidance: true });
    const root = `${HOME}/.agents/skills`;
    const reference = `${root}/githits-onboarding/references/troubleshooting.md`;
    expect(
      Object.keys(f.files).filter((path) => path.startsWith(root)),
    ).toHaveLength(7);
    expect(f.files[reference]).toContain("GitHits");
    delete f.files[reference];
    (f.fs.atomicWriteFile as ReturnType<typeof mock>).mockClear();
    await f.run({ local: true, skipLogin: true, guidance: true });
    expect(f.files[reference]).toContain("GitHits");
    expect(f.fs.atomicWriteFile).toHaveBeenCalledTimes(1);
    await initUninstallAction({ yes: true }, f.deps);
    expect(
      Object.keys(f.files).filter((path) => path.startsWith(root)),
    ).toEqual([]);
    const deletes = (f.fs.deleteFile as ReturnType<typeof mock>).mock.calls.map(
      ([path]) => path,
    );
    expect(deletes.indexOf(reference)).toBeLessThan(
      deletes.indexOf(`${root}/githits-onboarding/SKILL.md`),
    );
  });
});
