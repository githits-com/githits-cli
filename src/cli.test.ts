import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import { Command } from "commander";
import {
  registerCodeCommandGroup,
  registerDocsCommandGroup,
  registerExampleCommand,
  registerFeedbackCommand,
  registerLanguagesCommand,
  registerPkgCommandGroup,
  registerUnifiedSearchCommands,
} from "./commands/index.js";
import type { LoginDependencies } from "./commands/login.js";
import {
  createMockAuthService,
  createMockAuthStorage,
  createMockBrowserService,
} from "./services/test-helpers.js";
import { createRootCliPreAction } from "./shared/root-cli-pre-action.js";

describe("--no-color flag", () => {
  const origNoColor = process.env.NO_COLOR;

  afterEach(() => {
    if (origNoColor === undefined) {
      delete process.env.NO_COLOR;
    } else {
      process.env.NO_COLOR = origNoColor;
    }
  });

  it("sets NO_COLOR env var when --no-color is passed", async () => {
    delete process.env.NO_COLOR;

    const program = new Command();
    program
      .option("--no-color", "Disable colored output")
      .hook("preAction", (thisCommand) => {
        if (thisCommand.opts().color === false) {
          process.env.NO_COLOR = "1";
        }
      });

    let captured: string | undefined;
    program.command("test-cmd").action(() => {
      captured = process.env.NO_COLOR;
    });

    await program.parseAsync(["node", "githits", "--no-color", "test-cmd"]);

    expect(captured).toBe("1");
  });

  it("does not set NO_COLOR when flag is omitted", async () => {
    delete process.env.NO_COLOR;

    const program = new Command();
    program
      .option("--no-color", "Disable colored output")
      .hook("preAction", (thisCommand) => {
        if (thisCommand.opts().color === false) {
          process.env.NO_COLOR = "1";
        }
      });

    let captured: string | undefined;
    program.command("test-cmd").action(() => {
      captured = process.env.NO_COLOR;
    });

    await program.parseAsync(["node", "githits", "test-cmd"]);

    expect(captured).toBeUndefined();
  });
});

function createLoginDeps(
  overrides: Partial<LoginDependencies & { hasValidToken: boolean }> = {},
): LoginDependencies & { hasValidToken: boolean } {
  return {
    authService: createMockAuthService(),
    authStorage: createMockAuthStorage(),
    browserService: createMockBrowserService(),
    mcpUrl: "https://mcp.githits.com",
    hasValidToken: false,
    ...overrides,
  };
}

function createProgramWithRootPreAction(
  dependencies: Parameters<typeof createRootCliPreAction>[0],
): Command {
  const program = new Command();
  program
    .name("githits")
    .option("--no-color", "Disable colored output")
    .hook(
      "preAction",
      createRootCliPreAction({
        stdinIsTTY: true,
        stdoutIsTTY: true,
        ...dependencies,
      }),
    );
  return program;
}

async function createProgramForHelpSurface(options: {
  codeNavigationUrl?: string;
}): Promise<Command> {
  const program = new Command();
  program.name("githits");

  registerExampleCommand(program);
  registerLanguagesCommand(program);
  registerFeedbackCommand(program);
  await registerUnifiedSearchCommands(program, options);
  await registerCodeCommandGroup(program, options);
  await registerDocsCommandGroup(program, options);
  await registerPkgCommandGroup(program, options);

  return program;
}

describe("root CLI preAction", () => {
  it("does not trigger auto-login for exempt commands", async () => {
    const createContainer = mock(() => Promise.resolve(createLoginDeps()));
    const loginFlow = mock(() =>
      Promise.resolve({
        status: "success" as const,
        message: "Logged in successfully.",
      }),
    );
    const program = createProgramWithRootPreAction({
      createContainer,
      loginFlow,
    });

    let ran = false;
    program.command("logout").action(() => {
      ran = true;
    });

    await program.parseAsync(["node", "githits", "logout"]);

    expect(ran).toBe(true);
    expect(createContainer).not.toHaveBeenCalled();
    expect(loginFlow).not.toHaveBeenCalled();
  });

  it("triggers auto-login for eligible commands before the action runs", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const container = createLoginDeps({ hasValidToken: false });
    const createContainer = mock(() => Promise.resolve(container));
    const loginFlow = mock(() =>
      Promise.resolve({
        status: "success" as const,
        message: "Logged in successfully.",
      }),
    );
    const program = createProgramWithRootPreAction({
      createContainer,
      loginFlow,
    });

    let ran = false;
    program.command("example").action(() => {
      ran = true;
    });

    await program.parseAsync(["node", "githits", "example"]);

    expect(ran).toBe(true);
    expect(createContainer).toHaveBeenCalledTimes(1);
    expect(loginFlow).toHaveBeenCalledWith({}, container);
    expect(errorSpy.mock.calls.map((call) => call[0])).toEqual([
      "Authentication complete. Running example search...",
    ]);
    errorSpy.mockRestore();
  });

  it("uses auth metadata to avoid startup container creation", async () => {
    const createContainer = mock(() => Promise.resolve(createLoginDeps()));
    const loginFlow = mock(() =>
      Promise.resolve({
        status: "success" as const,
        message: "Logged in successfully.",
      }),
    );
    const loadAuthSessionMetadata = mock(() =>
      Promise.resolve({
        createdAt: "2026-01-01T00:00:00Z",
        expiresAt: "2999-01-01T00:00:00Z",
        updatedAt: new Date().toISOString(),
      }),
    );
    const program = createProgramWithRootPreAction({
      createContainer,
      loadAuthSessionMetadata,
      loginFlow,
    });

    let ran = false;
    program.command("example").action(() => {
      ran = true;
    });

    await program.parseAsync(["node", "githits", "example"]);

    expect(ran).toBe(true);
    expect(loadAuthSessionMetadata).toHaveBeenCalledTimes(1);
    expect(createContainer).not.toHaveBeenCalled();
    expect(loginFlow).not.toHaveBeenCalled();
  });

  it("clears stale metadata when stored credentials are missing", async () => {
    const createContainer = mock(() =>
      Promise.resolve(createLoginDeps({ hasValidToken: false })),
    );
    const clearAuthSessionMetadata = mock(() => Promise.resolve());
    const loginFlow = mock(() =>
      Promise.resolve({
        status: "success" as const,
        message: "Logged in successfully.",
      }),
    );
    const program = createProgramWithRootPreAction({
      createContainer,
      clearAuthSessionMetadata,
      loginFlow,
    });

    program.command("example").action(() => {});

    await program.parseAsync(["node", "githits", "example"]);

    expect(clearAuthSessionMetadata).toHaveBeenCalledTimes(1);
  });

  it("prints the languages continuation message after successful auto-login", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const container = createLoginDeps({ hasValidToken: false });
    const createContainer = mock(() => Promise.resolve(container));
    const loginFlow = mock(() =>
      Promise.resolve({
        status: "success" as const,
        message: "Logged in successfully.",
      }),
    );
    const program = createProgramWithRootPreAction({
      createContainer,
      loginFlow,
    });

    let ran = false;
    program.command("languages").action(() => {
      ran = true;
    });

    await program.parseAsync(["node", "githits", "languages"]);

    expect(ran).toBe(true);
    expect(errorSpy.mock.calls.map((call) => call[0])).toEqual([
      "Authentication complete. Loading supported languages...",
    ]);
    errorSpy.mockRestore();
  });

  it("prints the feedback continuation message after successful auto-login", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const container = createLoginDeps({ hasValidToken: false });
    const createContainer = mock(() => Promise.resolve(container));
    const loginFlow = mock(() =>
      Promise.resolve({
        status: "success" as const,
        message: "Logged in successfully.",
      }),
    );
    const program = createProgramWithRootPreAction({
      createContainer,
      loginFlow,
    });

    let ran = false;
    program.command("feedback").action(() => {
      ran = true;
    });

    await program.parseAsync(["node", "githits", "feedback"]);

    expect(ran).toBe(true);
    expect(errorSpy.mock.calls.map((call) => call[0])).toEqual([
      "Authentication complete. Submitting feedback...",
    ]);
    errorSpy.mockRestore();
  });

  it("leaves init auth handling to the init command", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const container = createLoginDeps({ hasValidToken: false });
    const createContainer = mock(() => Promise.resolve(container));
    const loginFlow = mock(() =>
      Promise.resolve({
        status: "success" as const,
        message: "Logged in successfully.",
      }),
    );
    const program = createProgramWithRootPreAction({
      createContainer,
      loginFlow,
    });

    let ran = false;
    program.command("init").action(() => {
      ran = true;
    });

    await program.parseAsync(["node", "githits", "init"]);

    expect(ran).toBe(true);
    expect(createContainer).not.toHaveBeenCalled();
    expect(loginFlow).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("triggers auto-login for nested package/source commands", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const container = createLoginDeps({ hasValidToken: false });
    const createContainer = mock(() => Promise.resolve(container));
    const loginFlow = mock(() =>
      Promise.resolve({
        status: "success" as const,
        message: "Logged in successfully.",
      }),
    );
    const program = createProgramWithRootPreAction({
      createContainer,
      loginFlow,
    });

    let ran = false;
    const pkgCommand = program.command("pkg");
    pkgCommand.command("info").action(() => {
      ran = true;
    });

    await program.parseAsync(["node", "githits", "pkg", "info"]);

    expect(ran).toBe(true);
    expect(createContainer).toHaveBeenCalledTimes(1);
    expect(loginFlow).toHaveBeenCalledWith({}, container);
    expect(errorSpy.mock.calls.map((call) => call[0])).toEqual([
      "Authentication complete. Running command...",
    ]);
    errorSpy.mockRestore();
  });

  it("preserves a clear failure path when auto-login fails", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const createContainer = mock(() => Promise.resolve(createLoginDeps()));
    const loginFlow = mock(() =>
      Promise.resolve({
        status: "failed" as const,
        message: "Authentication timed out.",
      }),
    );
    const exit = mock(() => {
      throw new Error("process.exit");
    });
    const program = createProgramWithRootPreAction({
      createContainer,
      loginFlow,
      exit,
    });

    let ran = false;
    program.command("example").action(() => {
      ran = true;
    });

    await expect(
      program.parseAsync(["node", "githits", "example"]),
    ).rejects.toThrow("process.exit");

    expect(ran).toBe(false);
    expect(errorSpy.mock.calls.map((call) => call[0])).toEqual([
      "Authentication timed out.\n",
      "Run the same command again to open a fresh sign-in link.",
      "If the browser did not open, run `githits login --no-browser` and follow the printed link.",
      "If sign-in keeps failing after a retry, run `githits logout` and then run your command again.",
    ]);
    errorSpy.mockRestore();
  });

  it("keeps stdout clean for interactive --json auto-login flows", async () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const createContainer = mock(() => Promise.resolve(createLoginDeps()));
    const loginFlow = mock(() => {
      console.error("Opening browser...");
      console.error("Waiting for authentication...\n");
      return Promise.resolve({
        status: "success" as const,
        message: "Logged in successfully.",
      });
    });
    const program = createProgramWithRootPreAction({
      createContainer,
      loginFlow,
    });

    program
      .command("example")
      .option("--json", "Output JSON")
      .action((options: { json?: boolean }) => {
        console.log(JSON.stringify({ ok: options.json === true }));
      });

    await program.parseAsync(["node", "githits", "example", "--json"]);

    expect(logSpy.mock.calls.map((call) => call[0])).toEqual([
      JSON.stringify({ ok: true }),
    ]);
    expect(errorSpy.mock.calls.map((call) => call[0])).toEqual([
      "Opening browser...",
      "Waiting for authentication...\n",
      "Authentication complete. Running example search...",
    ]);
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });
});

describe("CLI help surface", () => {
  it("keeps package/source commands out of root help when URL is disabled", async () => {
    const program = await createProgramForHelpSurface({
      codeNavigationUrl: "",
    });

    const help = program.helpInformation();

    expect(help).toMatch(/^\s{2}example\b/m);
    expect(help).toMatch(/^\s{2}languages\b/m);
    expect(help).toMatch(/^\s{2}feedback\b/m);
    expect(help).not.toMatch(/^\s{2}search\b/m);
    expect(help).not.toMatch(/^\s{2}code\b/m);
    expect(help).not.toMatch(/^\s{2}docs\b/m);
    expect(help).not.toMatch(/^\s{2}pkg\b/m);
  });

  it("shows package/source commands in root help when URL is configured", async () => {
    const program = await createProgramForHelpSurface({
      codeNavigationUrl: "https://pkgseer.dev",
    });

    const help = program.helpInformation();

    expect(help).toMatch(/^\s{2}search\b/m);
    expect(help).toMatch(/^\s{2}code\b/m);
    expect(help).toMatch(/^\s{2}docs\b/m);
    expect(help).toMatch(/^\s{2}pkg\b/m);
  });
});
