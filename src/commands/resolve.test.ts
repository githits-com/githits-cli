import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  mock,
  spyOn,
} from "bun:test";
import { PackageIntelligenceFeatureFlagRequiredError } from "@githits/core-internal";
import { Command } from "commander";
import {
  createMockResolveTargetService,
  defaultResolveTargetResult,
} from "../services/test-helpers.js";
import {
  type ResolveCommandDependencies,
  registerResolveCommand,
  resolveAction,
} from "./resolve.js";

function deps(
  overrides: Partial<ResolveCommandDependencies> = {},
): ResolveCommandDependencies {
  return {
    resolveTargetService: createMockResolveTargetService(),
    hasValidToken: true,
    mcpUrl: "https://mcp.githits.com",
    ...overrides,
  };
}

let originalExitCode: typeof process.exitCode;

beforeEach(() => {
  originalExitCode = process.exitCode;
});

afterEach(() => {
  process.exitCode = originalExitCode;
  mock.restore();
});

describe("resolveAction", () => {
  it("normalizes options, requests compact data, and renders terminal output", async () => {
    const resolveTarget = mock(() =>
      Promise.resolve(defaultResolveTargetResult),
    );
    const writeSpy = spyOn(process.stdout, "write").mockImplementation(
      () => true,
    );

    await resolveAction(
      " express ",
      {
        query: " web framework ",
        registry: "npm,pypi",
        preferKind: "package",
        intentHint: ["server"],
        limit: "3",
      },
      deps({
        resolveTargetService: createMockResolveTargetService({ resolveTarget }),
      }),
    );

    expect(resolveTarget).toHaveBeenCalledWith({
      name: "express",
      query: "web framework",
      registries: ["NPM", "PYPI"],
      preferredKinds: ["PACKAGE"],
      intentHints: ["server"],
      limit: 3,
      includeDetailedFields: false,
    });
    expect(String(writeSpy.mock.calls[0]?.[0])).toContain(
      "Candidates:\n  1. npm:express",
    );
  });

  it("requests detailed data and prints clean JSON", async () => {
    const resolveTarget = mock(() =>
      Promise.resolve(defaultResolveTargetResult),
    );
    const logSpy = spyOn(console, "log").mockImplementation(() => {});

    await resolveAction(
      "express",
      { json: true },
      deps({
        resolveTargetService: createMockResolveTargetService({ resolveTarget }),
      }),
    );

    expect(resolveTarget).toHaveBeenCalledWith({
      name: "express",
      limit: 8,
      includeDetailedFields: true,
    });
    expect(JSON.parse(String(logSpy.mock.calls[0]?.[0]))).toMatchObject({
      best: "npm:express",
      ambiguous: false,
    });
  });

  it("prints the empty JSON envelope and sets exit code 1", async () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    const empty = {
      ...defaultResolveTargetResult,
      best: undefined,
      candidates: [],
      protectedMatches: [],
    };

    await resolveAction(
      "missing",
      { json: true },
      deps({
        resolveTargetService: createMockResolveTargetService({
          resolveTarget: mock(() => Promise.resolve(empty)),
        }),
      }),
    );

    expect(JSON.parse(String(logSpy.mock.calls[0]?.[0]))).toEqual({
      ambiguous: false,
      candidates: [],
      protectedMatches: [],
    });
    expect(process.exitCode).toBe(1);
  });

  it("prints text for no result and sets exit code 1", async () => {
    const writeSpy = spyOn(process.stdout, "write").mockImplementation(
      () => true,
    );
    const empty = {
      ...defaultResolveTargetResult,
      best: undefined,
      candidates: [],
      protectedMatches: [],
    };

    await resolveAction(
      "missing",
      {},
      deps({
        resolveTargetService: createMockResolveTargetService({
          resolveTarget: mock(() => Promise.resolve(empty)),
        }),
      }),
    );

    expect(String(writeSpy.mock.calls[0]?.[0])).toBe(
      "No targets found for 'missing'.\n",
    );
    expect(process.exitCode).toBe(1);
  });

  it("validates before calling the service and emits JSON errors on stderr", async () => {
    const resolveTarget = mock(() =>
      Promise.resolve(defaultResolveTargetResult),
    );
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });

    await expect(
      resolveAction(
        " ",
        { json: true },
        deps({
          resolveTargetService: createMockResolveTargetService({
            resolveTarget,
          }),
        }),
      ),
    ).rejects.toThrow("process.exit");

    expect(resolveTarget).not.toHaveBeenCalled();
    expect(JSON.parse(String(errorSpy.mock.calls[0]?.[0])).code).toBe(
      "INVALID_ARGUMENT",
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("rejects partial numeric limits before calling the service", async () => {
    const resolveTarget = mock(() =>
      Promise.resolve(defaultResolveTargetResult),
    );
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });

    await expect(
      resolveAction(
        "express",
        { json: true, limit: "3x" },
        deps({
          resolveTargetService: createMockResolveTargetService({
            resolveTarget,
          }),
        }),
      ),
    ).rejects.toThrow("process.exit");

    expect(resolveTarget).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
    expect(JSON.parse(String(errorSpy.mock.calls[0]?.[0])).code).toBe(
      "INVALID_ARGUMENT",
    );
  });

  it("requires authentication before calling the service", async () => {
    const resolveTarget = mock(() =>
      Promise.resolve(defaultResolveTargetResult),
    );
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });

    await expect(
      resolveAction(
        "express",
        { json: true },
        deps({
          hasValidToken: false,
          resolveTargetService: createMockResolveTargetService({
            resolveTarget,
          }),
        }),
      ),
    ).rejects.toThrow("process.exit");

    expect(resolveTarget).not.toHaveBeenCalled();
    expect(JSON.parse(String(errorSpy.mock.calls[0]?.[0])).code).toBe(
      "AUTH_REQUIRED",
    );
  });

  it("maps feature-gate errors to ACCESS_DENIED", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const writeSpy = spyOn(process.stdout, "write").mockImplementation(
      () => true,
    );
    spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });

    await expect(
      resolveAction(
        "express",
        { json: true },
        deps({
          resolveTargetService: createMockResolveTargetService({
            resolveTarget: mock(() =>
              Promise.reject(
                new PackageIntelligenceFeatureFlagRequiredError("not enabled"),
              ),
            ),
          }),
        }),
      ),
    ).rejects.toThrow("process.exit");

    expect(JSON.parse(String(errorSpy.mock.calls[0]?.[0])).code).toBe(
      "ACCESS_DENIED",
    );
    expect(writeSpy).not.toHaveBeenCalled();
  });

  it("renders mapped terminal errors on stderr only", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const writeSpy = spyOn(process.stdout, "write").mockImplementation(
      () => true,
    );
    spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });

    await expect(
      resolveAction(
        "express",
        {},
        deps({
          resolveTargetService: createMockResolveTargetService({
            resolveTarget: mock(() =>
              Promise.reject(
                new PackageIntelligenceFeatureFlagRequiredError("not enabled"),
              ),
            ),
          }),
        }),
      ),
    ).rejects.toThrow("process.exit");

    expect(errorSpy).toHaveBeenCalledWith("not enabled");
    expect(writeSpy).not.toHaveBeenCalled();
  });
});

describe("registerResolveCommand", () => {
  it("documents every option and the query privacy warning", () => {
    const program = new Command();
    registerResolveCommand(program);
    const help = program.commands[0]?.helpInformation() ?? "";

    for (const value of [
      "--query",
      "--registry",
      "--prefer-kind",
      "--intent-hint",
      "--limit",
      "--json",
      "--query and --intent-hint values are sent",
      "include credentials, personal data, private code",
    ]) {
      expect(help).toContain(value);
    }
  });
});
