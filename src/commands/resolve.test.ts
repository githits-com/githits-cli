import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  mock,
  spyOn,
} from "bun:test";
import {
  PackageIntelligenceFeatureFlagRequiredError,
  PKGSEER_REGISTRY_ARGS,
  PKGSEER_REGISTRY_LIST,
} from "@githits/core-internal";
import { AuthRequiredError } from "@githits/mcp/internal";
import { Command } from "commander";
import {
  createMockResolveTargetService,
  defaultResolveTargetResult,
} from "../services/test-helpers.js";
import {
  type ResolveCommandDependencies,
  type ResolveCommandOptions,
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

let originalExitCode: string | number | null | undefined;

beforeEach(() => {
  originalExitCode = process.exitCode;
  process.exitCode = 0;
});

afterEach(() => {
  process.exitCode = originalExitCode;
  mock.restore();
});

describe("resolveAction", () => {
  it("uses the CLI option name for invalid preferred kinds", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });

    await expect(
      resolveAction("express", { preferKind: "workspace" }, deps()),
    ).rejects.toThrow("process.exit");

    expect(errorSpy).toHaveBeenCalledWith(
      "`--prefer-kind` expects package, repository, or site. Got 'workspace'.",
    );
  });

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
    expect(String(writeSpy.mock.calls[0]?.[0])).not.toContain("Warning:");
    expect(String(writeSpy.mock.calls[0]?.[0])).not.toContain("malicious");
  });

  it("requests detailed data and prints clean JSON", async () => {
    const affected = structuredClone(defaultResolveTargetResult);
    const candidate = affected.candidates[0];
    if (!candidate) throw new Error("fixture missing resolve candidate");
    affected.candidates[0] = {
      ...candidate,
      nameSimilarity: 0.4,
      latestVersionMaliciousStatus: "AFFECTED",
      latestVersionMaliciousEvidence: {
        advisories: [
          {
            osvId: "MAL-2026-1234",
            classificationReasons: ["AFFECTED_VERSION_RANGE_MATCH"],
          },
        ],
        totalCount: 1,
        truncated: false,
      },
    };
    const resolveTarget = mock(() => Promise.resolve(affected));
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
      candidates: [
        {
          target: "npm:express",
          nameSimilarity: 0.4,
          latestVersionMaliciousStatus: "affected",
          latestVersionMaliciousEvidence: {
            advisories: [
              {
                osvId: "MAL-2026-1234",
                classificationReasons: ["affected_version_range_match"],
              },
            ],
            totalCount: 1,
            truncated: false,
          },
        },
      ],
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
      "No targets found for 'missing'.\nCheck the spelling or adjust --registry filters; --query, --prefer-kind, and --intent-hint only rank existing candidates.\n",
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

  it("requires authentication before calling the service in JSON mode", async () => {
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

  it("rethrows terminal authentication failures for shared CLI rendering", async () => {
    const resolveTarget = mock(() =>
      Promise.resolve(defaultResolveTargetResult),
    );
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});

    await expect(
      resolveAction(
        "express",
        {},
        deps({
          hasValidToken: false,
          resolveTargetService: createMockResolveTargetService({
            resolveTarget,
          }),
        }),
      ),
    ).rejects.toThrow(AuthRequiredError);

    expect(resolveTarget).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
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

  it("sanitizes invalid option values in terminal errors but preserves JSON", async () => {
    const hostileOptions: ResolveCommandOptions[] = [
      { registry: "npm,\u001b]2;owned\u0007" },
      { preferKind: "package\u001b[31m" },
    ];
    const terminalErrorSpy = spyOn(console, "error").mockImplementation(
      () => {},
    );
    spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });

    for (const options of hostileOptions) {
      await expect(resolveAction("express", options, deps())).rejects.toThrow(
        "process.exit",
      );

      const terminalError = String(terminalErrorSpy.mock.calls[0]?.[0]);
      expect(terminalError).not.toContain("\u001b");
      expect(terminalError).not.toContain("\u0007");

      terminalErrorSpy.mockClear();
      await expect(
        resolveAction("express", { ...options, json: true }, deps()),
      ).rejects.toThrow("process.exit");

      const payload = JSON.parse(String(terminalErrorSpy.mock.calls[0]?.[0]));
      expect(payload.error).toContain("\u001b");
      terminalErrorSpy.mockClear();
    }
  });
});

describe("registerResolveCommand", () => {
  it("documents every option and the query privacy warning", () => {
    const program = new Command();
    registerResolveCommand(program);
    const resolveCommand = program.commands[0];
    const help = resolveCommand?.helpInformation() ?? "";

    for (const value of [
      "--query",
      "--registry",
      "--prefer-kind",
      "--intent-hint",
      "--limit",
      "--json",
    ]) {
      expect(help).toContain(value);
    }
    expect(resolveCommand?.description()).toContain(
      "--query and --intent-hint values are sent",
    );
    expect(resolveCommand?.description()).toContain(
      "include credentials, personal data, private code",
    );
    expect(resolveCommand?.description()).toContain(
      "rank retrieved candidates and do not expand candidate retrieval",
    );
    expect(resolveCommand?.description()).toContain(
      "Pass canonical registry:name, github:owner/repo, or site:<host[/path]> targets",
    );
    expect(resolveCommand?.description()).toContain(
      "standalone documentation-site targets",
    );
    expect(
      resolveCommand?.options.find((option) => option.long === "--prefer-kind")
        ?.description,
    ).toContain("package, repository, or site");
    for (const registry of PKGSEER_REGISTRY_ARGS) {
      expect(help).toContain(registry);
    }
    expect(
      resolveCommand?.options.find((option) => option.long === "--registry")
        ?.description,
    ).toBe(
      `Comma-separated filter that constrains package candidates only: ${PKGSEER_REGISTRY_LIST}`,
    );
  });

  it("collects repeated intent hints in command-line order", () => {
    const program = new Command();
    registerResolveCommand(program);
    const option = program.commands[0]?.options.find(
      (candidate) => candidate.long === "--intent-hint",
    );
    const parseArg = option?.parseArg as
      | ((value: string, previous?: string[]) => string[])
      | undefined;
    if (!parseArg) throw new Error("intent-hint parser is missing");

    expect(parseArg("api", parseArg("server"))).toEqual(["server", "api"]);
  });
});
