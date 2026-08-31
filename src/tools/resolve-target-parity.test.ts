// PARITY TEST — enforces PARITY-EXPERIMENTAL-LOCAL, PARITY-JSON-KEYS, and
// PARITY-ERROR-ENVELOPE from docs/implementation/mcp-cli-parity.md.
// The CLI/MCP pair is config-gated and local-only; explicit JSON requests
// must normalize to the same service params and success/error envelopes.

import { describe, expect, it, mock, spyOn } from "bun:test";
import {
  PackageIntelligenceBackendError,
  type ResolveTargetParams,
} from "@githits/core-internal";
import {
  type ResolveCommandDependencies,
  resolveAction,
} from "../commands/resolve.js";
import {
  createMockResolveTargetService,
  defaultResolveTargetResult,
} from "../services/test-helpers.js";
import {
  createParityExperimentalMcpTool,
  isProcessExitSentinel,
} from "./parity-test-helpers.js";

function cliDeps(
  overrides: Partial<ResolveCommandDependencies> = {},
): ResolveCommandDependencies {
  return {
    resolveTargetService: createMockResolveTargetService(),
    hasValidToken: true,
    mcpUrl: "https://mcp.githits.com",
    ...overrides,
  };
}

async function cliJson(
  name: string,
  options: Parameters<typeof resolveAction>[1],
  deps: ResolveCommandDependencies,
): Promise<unknown> {
  const logSpy = spyOn(console, "log").mockImplementation(() => {});
  const errorSpy = spyOn(console, "error").mockImplementation(() => {});
  const exitSpy = spyOn(process, "exit").mockImplementation(() => {
    throw new Error("process.exit");
  });
  const originalExitCode = process.exitCode;
  process.exitCode = 0;
  try {
    try {
      await resolveAction(name, { ...options, json: true }, deps);
    } catch (error) {
      if (!isProcessExitSentinel(error)) throw error;
    }
    const raw =
      (logSpy.mock.calls[0]?.[0] as string | undefined) ??
      (errorSpy.mock.calls[0]?.[0] as string | undefined);
    return raw ? JSON.parse(raw) : undefined;
  } finally {
    process.exitCode = originalExitCode;
    logSpy.mockRestore();
    errorSpy.mockRestore();
    exitSpy.mockRestore();
  }
}

describe("resolve_target parity", () => {
  it("PARITY-EXPERIMENTAL-LOCAL: explicit CLI/MCP requests share service params", async () => {
    const cliResolveTarget = mock((_params: ResolveTargetParams) =>
      Promise.resolve(defaultResolveTargetResult),
    );
    const mcpResolveTarget = mock((_params: ResolveTargetParams) =>
      Promise.resolve(defaultResolveTargetResult),
    );
    const cli = await cliJson(
      " express ",
      {
        query: " web framework ",
        registry: "npm, pypi, npm",
        preferKind: " package ",
        intentHint: [" server ", "SERVER", "web"],
        limit: "8",
      },
      cliDeps({
        resolveTargetService: createMockResolveTargetService({
          resolveTarget: cliResolveTarget,
        }),
      }),
    );
    const tool = createParityExperimentalMcpTool("resolve_target", {
      resolveTargetService: createMockResolveTargetService({
        resolveTarget: mcpResolveTarget,
      }),
    });
    await tool.handler(
      {
        name: "express",
        query: "web framework",
        registries: ["npm", "pypi", "npm"],
        preferred_kind: "package",
        intent_hints: ["server", "SERVER", "web"],
        limit: 8,
        format: "json",
      },
      {},
    );

    expect(cliResolveTarget).toHaveBeenCalledTimes(1);
    expect(mcpResolveTarget).toHaveBeenCalledTimes(1);
    expect(cliResolveTarget.mock.calls[0]?.[0]).toEqual(
      mcpResolveTarget.mock.calls[0]?.[0],
    );
    expect(cliResolveTarget.mock.calls[0]?.[0]).toEqual({
      name: "express",
      query: "web framework",
      registries: ["NPM", "PYPI"],
      preferredKinds: ["PACKAGE"],
      intentHints: ["server", "web"],
      limit: 8,
      includeDetailedFields: true,
      includeNameSimilarity: true,
    });
    expect(cli).toBeDefined();
  });

  it("PARITY-JSON-KEYS: shared success result is CLI JSON === MCP JSON", async () => {
    const result = structuredClone(defaultResolveTargetResult);
    result.targets[0]!.groupKey = "github:expressjs/express";
    if (!result.targets[0]!.match) {
      throw new Error("fixture missing resolve target match");
    }
    result.targets[0]!.match.nameSimilarity = 0.4;
    result.targets[0]!.docsPageCount = 128;
    result.targets[0]!.license = "MIT";
    result.targets.push({
      kind: "SITE",
      canonicalKey: "site:expressjs.com",
      latestVersionMaliciousStatus: "NOT_APPLICABLE",
      docsAvailable: true,
      codeAvailable: false,
      groupKey: "github:expressjs/express",
      docsPageCount: 128,
    });
    result.targetsTruncated = true;
    const cli = await cliJson(
      "express",
      {},
      cliDeps({
        resolveTargetService: createMockResolveTargetService({
          resolveTarget: mock(() => Promise.resolve(result)),
        }),
      }),
    );
    const tool = createParityExperimentalMcpTool("resolve_target", {
      resolveTargetService: createMockResolveTargetService({
        resolveTarget: mock(() => Promise.resolve(result)),
      }),
    });
    const mcpResult = await tool.handler(
      { name: "express", format: "json" },
      {},
    );

    expect(mcpResult.isError).toBeUndefined();
    const mcp = JSON.parse(mcpResult.content[0]?.text ?? "{}");
    expect(cli).toEqual(mcp);
    expect(mcp).toMatchObject({
      targetsTruncated: true,
      candidates: [
        {
          target: "npm:express",
          direct: true,
          groupKey: "github:expressjs/express",
          nameSimilarity: 0.4,
          docsPageCount: 128,
          license: "MIT",
        },
        {
          target: "site:expressjs.com",
          direct: false,
          groupKey: "github:expressjs/express",
          docsPageCount: 128,
        },
      ],
    });
  });

  it("PARITY-ERROR-ENVELOPE: typed service error is CLI JSON === MCP JSON", async () => {
    const error = new PackageIntelligenceBackendError(
      "Resolver upstream timed out",
      504,
      "TIMEOUT",
      true,
    );
    const cli = await cliJson(
      "express",
      {},
      cliDeps({
        resolveTargetService: createMockResolveTargetService({
          resolveTarget: mock(() => Promise.reject(error)),
        }),
      }),
    );
    const tool = createParityExperimentalMcpTool("resolve_target", {
      resolveTargetService: createMockResolveTargetService({
        resolveTarget: mock(() => Promise.reject(error)),
      }),
    });
    const mcpResult = await tool.handler(
      { name: "express", format: "json" },
      {},
    );

    expect(mcpResult.isError).toBe(true);
    expect(cli).toEqual(JSON.parse(mcpResult.content[0]?.text ?? "{}"));
    expect(cli).toMatchObject({
      code: "TIMEOUT",
      retryable: true,
      details: { status: 504, graphqlCode: "TIMEOUT" },
    });
  });

  it("PARITY-ERROR-ENVELOPE: invalid explicit input shares classification and envelope shape", async () => {
    const cli = await cliJson(
      "express",
      { registry: "not-a-registry" },
      cliDeps(),
    );
    const tool = createParityExperimentalMcpTool("resolve_target");
    const mcpResult = await tool.handler(
      {
        name: "express",
        registries: ["not-a-registry"],
        format: "json",
      },
      {},
    );
    const mcp = JSON.parse(mcpResult.content[0]?.text ?? "{}");

    expect(mcpResult.isError).toBe(true);
    expect(cli).toMatchObject({
      code: "INVALID_ARGUMENT",
      retryable: false,
      error:
        "Unsupported registry 'not-a-registry'. Supported: npm, pypi, hex, crates, nuget, maven, zig, vcpkg, packagist, rubygems, go, swift.",
    });
    expect(mcp).toMatchObject({
      code: "INVALID_ARGUMENT",
      retryable: false,
      error:
        "Unsupported registry 'not-a-registry'. Supported: npm, pypi, hex, crates, nuget, maven, zig, vcpkg, packagist, rubygems, go, swift.",
    });
    expect(Object.keys(cli as object).sort()).toEqual(
      Object.keys(mcp as object).sort(),
    );
  });

  it.each(["npm:react", "github:facebook/react"])(
    "PARITY-ERROR-ENVELOPE: canonical target %s is rejected before service calls",
    async (name) => {
      const cliResolveTarget = mock((_params: ResolveTargetParams) =>
        Promise.resolve(defaultResolveTargetResult),
      );
      const mcpResolveTarget = mock((_params: ResolveTargetParams) =>
        Promise.resolve(defaultResolveTargetResult),
      );
      const cli = await cliJson(
        name,
        {},
        cliDeps({
          resolveTargetService: createMockResolveTargetService({
            resolveTarget: cliResolveTarget,
          }),
        }),
      );
      const tool = createParityExperimentalMcpTool("resolve_target", {
        resolveTargetService: createMockResolveTargetService({
          resolveTarget: mcpResolveTarget,
        }),
      });
      const mcpResult = await tool.handler({ name, format: "json" }, {});
      const mcp = JSON.parse(mcpResult.content[0]?.text ?? "{}");

      expect(cliResolveTarget).not.toHaveBeenCalled();
      expect(mcpResolveTarget).not.toHaveBeenCalled();
      expect(mcpResult.isError).toBe(true);
      expect(cli).toEqual(mcp);
      expect(cli).toEqual({
        error: `Canonical target ${JSON.stringify(name)} does not need resolution. Pass it directly to the next GitHits tool.`,
        code: "INVALID_ARGUMENT",
        retryable: false,
      });
    },
  );

  it.each(["@scope/package", "react-native", "owner/repository"])(
    "PARITY-EXPERIMENTAL-LOCAL: human name %s reaches both services",
    async (name) => {
      const cliResolveTarget = mock((_params: ResolveTargetParams) =>
        Promise.resolve(defaultResolveTargetResult),
      );
      const mcpResolveTarget = mock((_params: ResolveTargetParams) =>
        Promise.resolve(defaultResolveTargetResult),
      );

      await cliJson(
        name,
        {},
        cliDeps({
          resolveTargetService: createMockResolveTargetService({
            resolveTarget: cliResolveTarget,
          }),
        }),
      );
      const tool = createParityExperimentalMcpTool("resolve_target", {
        resolveTargetService: createMockResolveTargetService({
          resolveTarget: mcpResolveTarget,
        }),
      });
      await tool.handler({ name, format: "json" }, {});

      expect(cliResolveTarget).toHaveBeenCalledTimes(1);
      expect(mcpResolveTarget).toHaveBeenCalledTimes(1);
      expect(cliResolveTarget.mock.calls[0]?.[0]).toEqual(
        mcpResolveTarget.mock.calls[0]?.[0],
      );
      expect(cliResolveTarget.mock.calls[0]?.[0]).toMatchObject({ name });
    },
  );
});
