// PARITY TEST — enforces PARITY-EXPERIMENTAL-LOCAL, PARITY-JSON-KEYS, and
// PARITY-ERROR-ENVELOPE from docs/implementation/mcp-cli-parity.md.
// The CLI/MCP pair is config-gated and local-only; explicit JSON requests
// must normalize to the same service params and success/error envelopes.

import { describe, expect, it, mock, spyOn } from "bun:test";
import {
  PackageIntelligenceBackendError,
  type ResolveTargetParams,
  type ResolveTargetResult,
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

function unreadySiteResult(): ResolveTargetResult {
  return {
    best: {
      kind: "SITE",
      canonicalKey: "site:ai.pydantic.dev",
      confidence: "EXACT",
    },
    targets: [
      {
        kind: "SITE",
        canonicalKey: "site:ai.pydantic.dev",
        displayName: "Pydantic AI",
        latestVersionMaliciousStatus: "NOT_APPLICABLE",
        docsAvailable: false,
        docsPageCount: 12,
        codeAvailable: false,
        match: { confidence: "EXACT", nameSimilarity: 1 },
      },
    ],
    ambiguous: false,
    ambiguousReason: "NOT_AMBIGUOUS",
    protectedMatches: [],
    targetsTruncated: false,
  };
}

async function readinessText(
  resolved: ResolveTargetResult,
  verbose: boolean,
): Promise<string[]> {
  const resolveTarget = mock((_params: ResolveTargetParams) =>
    Promise.resolve(resolved),
  );
  const service = createMockResolveTargetService({ resolveTarget });
  const stdout = spyOn(process.stdout, "write").mockImplementation(() => true);
  const previousExitCode = process.exitCode;
  let cli: string;
  try {
    process.exitCode = 0;
    await resolveAction(
      "Pydantic AI",
      { verbose },
      cliDeps({ resolveTargetService: service }),
    );
    cli = String(stdout.mock.calls[0]?.[0]);
    expect(process.exitCode).toBe(resolved.best ? 0 : 1);
  } finally {
    stdout.mockRestore();
    process.exitCode = previousExitCode;
  }
  const tool = createParityExperimentalMcpTool("resolve_target", {
    resolveTargetService: service,
  });
  const mcp = await tool.handler({ name: "Pydantic AI", verbose }, {});
  expect(mcp.isError).toBeUndefined();
  expect(resolveTarget).toHaveBeenCalledTimes(2);
  for (const call of resolveTarget.mock.calls) {
    expect(call[0]).toMatchObject({
      includeDetailedFields: false,
      includeNameSimilarity: verbose,
    });
  }
  return [cli, mcp.content[0]?.text ?? ""];
}

describe("S2b readiness", () => {
  const cases = [
    "EXACT singleton",
    "HIGH singleton",
    "mixed alternatives",
    "all-unready ambiguity",
    "unknown empty",
    "MEDIUM unready",
    "LOW unready",
    "readable stale",
    "AFFECTED unready",
    "UNKNOWN unready",
    "missing full best",
  ];
  for (const scenario of cases) {
    for (const verbose of [false, true]) {
      it(`${scenario} preserves CLI/MCP identity and continuation with verbose=${verbose}`, async () => {
        const resolved = unreadySiteResult();
        const first = resolved.targets[0]!;
        if (
          scenario === "HIGH singleton" ||
          scenario.startsWith("MEDIUM") ||
          scenario.startsWith("LOW")
        ) {
          const confidence = scenario.split(" ")[0]!;
          resolved.best!.confidence = confidence;
          first.match!.confidence = confidence;
        }
        if (
          scenario === "mixed alternatives" ||
          scenario === "all-unready ambiguity"
        ) {
          resolved.targets.push(
            {
              kind: "PACKAGE",
              canonicalKey: "pypi:pydantic-ai",
              docsAvailable: true,
              codeAvailable: false,
              latestVersionMaliciousStatus: "CLEAR",
            },
            {
              kind: "SITE",
              canonicalKey: "site:docs.pydantic.dev",
              docsAvailable: true,
              codeAvailable: false,
              latestVersionMaliciousStatus: "NOT_APPLICABLE",
            },
          );
        }
        if (scenario === "all-unready ambiguity") {
          resolved.targets.splice(1, 1);
          resolved.targets[1]!.docsAvailable = false;
          resolved.targets[1]!.match = { confidence: "EXACT" };
          resolved.ambiguous = true;
          resolved.ambiguousReason = "CLOSE_CANDIDATES";
        }
        if (scenario === "unknown empty") {
          resolved.best = undefined;
          resolved.targets = [];
        }
        if (scenario === "missing full best") resolved.targets = [];
        if (scenario === "readable stale") first.docsAvailable = true;
        if (scenario.startsWith("AFFECTED") || scenario.startsWith("UNKNOWN"))
          first.latestVersionMaliciousStatus = scenario.split(" ")[0]!;
        const before = structuredClone(resolved);
        const texts = await readinessText(resolved, verbose);
        const direct = [
          "EXACT singleton",
          "HIGH singleton",
          "mixed alternatives",
          "readable stale",
        ].includes(scenario);
        for (const [index, text] of texts.entries()) {
          expect(text).not.toMatch(/queued|preparing|retry time/i);
          if (resolved.targets.length && scenario !== "readable stale")
            expect(text).toContain("docs: crawled on demand");
          if (scenario === "readable stale") {
            expect(text).toContain("docs 12 pages");
            expect(text).not.toContain("docs: crawled on demand");
          } else expect(text).not.toContain("docs 12 pages");
          if (scenario === "unknown empty") {
            expect(text).toContain("No targets found");
            expect(text).not.toContain("docs: crawled on demand");
          } else expect(text).not.toContain("No targets found");
          if (resolved.ambiguous) expect(text).toContain("Ambiguous:");
          if (scenario.startsWith("MEDIUM") || scenario.startsWith("LOW")) {
            expect(text).toContain("narrow");
            expect(text).not.toMatch(/Best (identity )?match:/);
          }
          const continuation =
            index === 0
              ? "--in 'site:ai.pydantic.dev' --source docs"
              : 'Next: call search with target "site:ai.pydantic.dev" and source "docs"';
          if (direct) {
            expect(text).toContain(continuation);
            expect(text).not.toContain("Warning:");
          } else expect(text).not.toContain(continuation);
          if (scenario.startsWith("AFFECTED"))
            expect(text).toContain(
              "Warning: Malicious content affects the latest version",
            );
          if (scenario.startsWith("UNKNOWN"))
            expect(text).toContain(
              "Warning: Malicious-content status is uncertain",
            );
          if (scenario === "missing full best")
            expect(text).toContain(
              "Malicious-content status is unavailable for the best match",
            );
          for (let i = 1; i < resolved.targets.length; i++)
            expect(
              text.indexOf(resolved.targets[i - 1]!.canonicalKey),
            ).toBeLessThan(text.indexOf(resolved.targets[i]!.canonicalKey));
          expect(text).not.toContain("--in 'pypi:pydantic-ai'");
          expect(text).not.toContain(
            'Next: call search with target "site:docs.pydantic.dev"',
          );
        }
        const service = createMockResolveTargetService({
          resolveTarget: mock(() => Promise.resolve(resolved)),
        });
        const cli = await cliJson(
          "Pydantic AI",
          { verbose },
          cliDeps({ resolveTargetService: service }),
        );
        const tool = createParityExperimentalMcpTool("resolve_target", {
          resolveTargetService: service,
        });
        const raw = await tool.handler(
          { name: "Pydantic AI", verbose, format: "json" },
          {},
        );
        const json = JSON.parse(raw.content[0]?.text ?? "{}");
        expect(cli).toEqual(json);
        expect(json.best).toBe(resolved.best?.canonicalKey);
        expect(json.ambiguous).toBe(resolved.ambiguous);
        expect(
          json.candidates.map((entry: { target: string }) => entry.target),
        ).toEqual(resolved.targets.map((target) => target.canonicalKey));
        if (resolved.targets.length)
          expect(json.candidates[0]).toMatchObject({
            confidence: resolved.best!.confidence.toLowerCase(),
            docsAvailable: first.docsAvailable,
            docsPageCount: 12,
          });
        expect(resolved).toEqual(before);
      });
    }
  }
});
