import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import { Command } from "commander";
import {
  registerCodeCommandGroup,
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
  overrideEnabled?: boolean;
  capability?: "enabled" | "disabled" | "unknown";
}): Promise<Command> {
  const program = new Command();
  program.name("githits");

  registerExampleCommand(program);
  registerLanguagesCommand(program);
  registerFeedbackCommand(program);
  await registerUnifiedSearchCommands(program, options);
  await registerCodeCommandGroup(program, options);
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
      "Run `githits login` to try again.",
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
  it("keeps gated commands out of root help when capability is closed", async () => {
    const program = await createProgramForHelpSurface({
      codeNavigationUrl: "https://pkgseer.dev",
      overrideEnabled: false,
      capability: "disabled",
    });

    const help = program.helpInformation();

    expect(help).toMatch(/^\s{2}example\b/m);
    expect(help).toMatch(/^\s{2}languages\b/m);
    expect(help).toMatch(/^\s{2}feedback\b/m);
    expect(help).not.toMatch(/^\s{2}search\b/m);
    expect(help).not.toMatch(/^\s{2}code\b/m);
    expect(help).not.toMatch(/^\s{2}pkg\b/m);
  });

  it("shows gated commands in root help when capability is enabled", async () => {
    const program = await createProgramForHelpSurface({
      codeNavigationUrl: "https://pkgseer.dev",
      overrideEnabled: false,
      capability: "enabled",
    });

    const help = program.helpInformation();

    expect(help).toMatch(/^\s{2}search\b/m);
    expect(help).toMatch(/^\s{2}code\b/m);
    expect(help).toMatch(/^\s{2}pkg\b/m);
  });
});
