import { describe, expect, it, mock, spyOn } from "bun:test";
import {
  AuthRequiredError,
  InvalidPackageSpecError,
} from "@githits/mcp/internal";
import { Command } from "commander";
import {
  createMockCodeNavigationService,
  createMockReadService,
  defaultReadFileResult,
} from "../services/test-helpers.js";
import { registerCodeReadCommand } from "./code/read.js";
import { registerDocsReadCommand } from "./docs/read.js";
import {
  type ReadCommandDependencies,
  readAction,
  registerReadCommand,
} from "./read.js";

function deps(): ReadCommandDependencies {
  return {
    codeNavigationService: createMockCodeNavigationService(),
    readService: createMockReadService(),
    codeNavigationUrl: "https://pkgseer.dev",
    hasValidToken: true,
    mcpUrl: "https://mcp.githits.com",
  };
}

describe("top-level read", () => {
  it.each([undefined, "index.js"])(
    "reads a compact symbol fragment with optional exact path %s",
    async (path) => {
      const services = deps();
      services.readService.read = mock(() =>
        Promise.resolve({
          source: "code" as const,
          result: defaultReadFileResult,
        }),
      );
      const log = spyOn(console, "log").mockImplementation(() => {});
      try {
        const target = "npm:express@5.2.1#create%41pplication";
        await readAction(target, path, { json: true, wait: "0" }, services);
        expect(services.readService.read).toHaveBeenCalledWith({
          target,
          ...(path ? { path } : {}),
          waitTimeoutMs: 0,
        });
        expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toHaveProperty(
          "content",
        );
      } finally {
        log.mockRestore();
      }
    },
  );

  it.each([
    { target: "npm:express@5.2.1#", selector: undefined },
    { target: "npm:express@5.2.1#createApplication", selector: "other" },
  ])(
    "surfaces a fragment error without a docs retry: %j",
    async ({ target, selector }) => {
      const services = deps();
      services.readService.read = mock(() =>
        Promise.reject(new InvalidPackageSpecError("Invalid code fragment.")),
      );
      const error = spyOn(console, "error").mockImplementation(() => {});
      const exit = spyOn(process, "exit").mockImplementation((() => {
        throw new Error("exit");
      }) as never);
      try {
        await expect(
          readAction(target, undefined, { selector, json: true }, services),
        ).rejects.toThrow("exit");
        expect(services.readService.read).toHaveBeenCalledWith(
          expect.objectContaining({
            target,
            ...(selector ? { selector } : {}),
          }),
        );
        expect(services.readService.read).toHaveBeenCalledTimes(1);
        expect(JSON.parse(String(error.mock.calls[0]?.[0]))).toMatchObject({
          code: "INVALID_ARGUMENT",
        });
      } finally {
        error.mockRestore();
        exit.mockRestore();
      }
    },
  );

  it.each([
    {
      target: "github:githits-com/githits-cli@abc",
      selector: "main",
    },
    {
      target: "github:githits-com/githits-cli@release/v1#main",
      selector: undefined,
    },
  ])(
    "renders typed symbol misses and forwards an exact path: %j",
    async ({ target, selector }) => {
      const services = deps();
      services.readService.read = mock(() =>
        Promise.resolve({
          source: "symbol_resolution" as const,
          result: {
            status: "NOT_FOUND" as const,
            candidates: [],
            suggestions: [],
            hasMore: false,
            repoUrl: "https://github.com/githits-com/githits-cli",
            gitRef: "abc",
            message: null,
            codeIndexState: "CURRENT",
          },
        }),
      );
      const log = spyOn(console, "log").mockImplementation(() => {});
      try {
        await readAction(
          target,
          "src/container.ts",
          { selector, json: true },
          services,
        );
        expect(services.readService.read).toHaveBeenCalledWith(
          expect.objectContaining({
            path: "src/container.ts",
            ...(selector ? { selector } : {}),
          }),
        );
        if (selector === undefined) {
          expect(
            (services.readService.read as ReturnType<typeof mock>).mock
              .calls[0]?.[0],
          ).not.toHaveProperty("selector");
        }
        expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toMatchObject({
          status: "NOT_FOUND",
          selector: "main",
        });
        if (selector === undefined) {
          const payload = JSON.parse(String(log.mock.calls[0]?.[0]));
          expect(payload.action).toContain(
            '--in "github:githits-com/githits-cli@release/v1"',
          );
          expect(payload.action).not.toContain("#main");
        }
      } finally {
        log.mockRestore();
      }
    },
  );

  it("rejects --git-ref with a positional selector target", async () => {
    const services = deps();
    const error = spyOn(console, "error").mockImplementation(() => {});
    const exit = spyOn(process, "exit").mockImplementation((() => {
      throw new Error("exit");
    }) as never);
    try {
      await expect(
        readAction(
          "github:owner/repo",
          undefined,
          {
            selector: "main",
            gitRef: "release/v1",
            json: true,
          },
          services,
        ),
      ).rejects.toThrow("exit");
      expect(JSON.parse(String(error.mock.calls[0]?.[0]))).toMatchObject({
        code: "INVALID_ARGUMENT",
      });
      expect(services.readService.read).not.toHaveBeenCalled();
    } finally {
      error.mockRestore();
      exit.mockRestore();
    }
  });

  it("rejects two paths in selector --repo-url mode", async () => {
    const services = deps();
    const error = spyOn(console, "error").mockImplementation(() => {});
    const exit = spyOn(process, "exit").mockImplementation((() => {
      throw new Error("exit");
    }) as never);
    try {
      await expect(
        readAction(
          "first.ts",
          "second.ts",
          {
            repoUrl: "https://github.com/owner/repo",
            selector: "main",
            json: true,
          },
          services,
        ),
      ).rejects.toThrow("exit");
      expect(JSON.parse(String(error.mock.calls[0]?.[0]))).toMatchObject({
        code: "INVALID_ARGUMENT",
      });
      expect(services.readService.read).not.toHaveBeenCalled();
    } finally {
      error.mockRestore();
      exit.mockRestore();
    }
  });

  it("keeps complete selected code in CLI JSON output", async () => {
    const services = deps();
    const content = Array.from(
      { length: 400 },
      (_, index) => `line ${index + 1}`,
    ).join("\n");
    services.readService.read = mock(() =>
      Promise.resolve({
        source: "code" as const,
        result: {
          filePath: "src/big.ts",
          startLine: 1,
          endLine: 400,
          totalLines: 400,
          content,
          isBinary: false,
        },
      }),
    );
    const log = spyOn(console, "log").mockImplementation(() => {});
    try {
      await readAction(
        "github:owner/repo@abc",
        undefined,
        { selector: "BigClass", json: true },
        services,
      );
      const payload = JSON.parse(String(log.mock.calls[0]?.[0]));
      expect(payload.content).toContain("line 400");
      expect(payload.endLine).toBe(400);
      expect(payload.hint).toBeUndefined();
    } finally {
      log.mockRestore();
    }
  });
  it("registers new syntax and marks legacy commands deprecated in help", () => {
    const root = new Command();
    const read = registerReadCommand(root);
    const readHelp = read.helpInformation();
    expect(read.name()).toBe("read");
    expect(readHelp).toContain("--lines");
    expect(readHelp).toMatch(/mutable\s+current content/);
    expect(readHelp).toMatch(/--selector\s+selects a code symbol/);
    expect(readHelp).toContain("<target>#symbol");
    expect(readHelp).toContain("Starting line (alternative to --lines)");
    expect(readHelp).toMatch(/resolved target\s+determines code or docs/);
    expect(readHelp).toMatch(/repository\s+docs are snapshot-addressed/);
    expect(readHelp).toContain("full subtree");
    expect(
      registerCodeReadCommand(new Command("code")).helpInformation(),
    ).toContain("Deprecated: use githits read");
    const docsReadHelp = registerDocsReadCommand(
      new Command("docs"),
    ).helpInformation();
    expect(docsReadHelp).toContain("Deprecated: use githits read");
    expect(docsReadHelp).toMatch(/mutable\s+current\s+content/);
    expect(docsReadHelp).toMatch(/repository\s+docs are snapshot-addressed/);
    expect(docsReadHelp).toContain("full subtree");
  });

  it.each([
    "https://docs.example.test/guide#routing",
    "https://github.com/owner/repo#readme",
    "github:owner/repo@abc/docs/guide.md#routing",
    "github:owner/repo/README.md#routing",
  ])(
    "reads docs fragment %s unchanged through the unified service",
    async (target) => {
      const services = deps();
      const log = spyOn(console, "log").mockImplementation(() => {});
      try {
        await readAction(
          target,
          undefined,
          { json: true, wait: "0" },
          services,
        );
        expect(services.readService.read).toHaveBeenCalledWith({
          target,
          waitTimeoutMs: 0,
        });
        expect(services.readService.read).toHaveBeenCalledTimes(1);
        expect(services.codeNavigationService!.readFile).not.toHaveBeenCalled();
        expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toHaveProperty(
          "content",
        );
      } finally {
        log.mockRestore();
      }
    },
  );

  it("overrides a docs fragment with a one-sided range", async () => {
    const services = deps();
    const log = spyOn(console, "log").mockImplementation(() => {});
    try {
      await readAction(
        "https://docs.example.test/guide#routing",
        "",
        { json: true, lines: "10-" },
        services,
      );
      expect(services.readService.read).toHaveBeenCalledWith({
        target: "https://docs.example.test/guide#routing",
        startLine: 10,
        waitTimeoutMs: 30_000,
      });
      expect(services.readService.read).toHaveBeenCalledTimes(1);
    } finally {
      log.mockRestore();
    }
  });

  it("presents backend code for a docs-shaped pathless target with --start", async () => {
    const services = deps();
    services.readService.read = mock(() =>
      Promise.resolve({
        source: "code" as const,
        result: defaultReadFileResult,
      }),
    );
    const log = spyOn(console, "log").mockImplementation(() => {});
    try {
      const target = "github:owner/repo@release/v1#makeApp";
      await readAction(target, undefined, { start: "5", json: true }, services);
      expect(services.readService.read).toHaveBeenCalledWith({
        target,
        startLine: 5,
        waitTimeoutMs: 30_000,
      });
      expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toHaveProperty(
        "content",
      );
    } finally {
      log.mockRestore();
    }
  });

  it("presents backend docs for a code-shaped pathless target", async () => {
    const services = deps();
    const log = spyOn(console, "log").mockImplementation(() => {});
    try {
      const target = "npm:express@5.2.1#routing";
      await readAction(target, undefined, { json: true }, services);
      expect(services.readService.read).toHaveBeenCalledWith({
        target,
        waitTimeoutMs: 30_000,
      });
      expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toHaveProperty(
        "pageId",
      );
    } finally {
      log.mockRestore();
    }
  });

  it("reads code with no MCP cap, preserving explicit zero wait", async () => {
    const services = deps();
    const log = spyOn(console, "log").mockImplementation(() => {});
    try {
      await readAction(
        "npm:example",
        "src/index.ts",
        { json: true, wait: "0" },
        services,
      );
      expect(services.readService.read).toHaveBeenCalledWith({
        target: "npm:example",
        path: "src/index.ts",
        startLine: undefined,
        endLine: undefined,
        waitTimeoutMs: 0,
      });
      expect(services.readService.read).toHaveBeenCalledTimes(1);
      expect(services.codeNavigationService!.readFile).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });

  it("retains repo-url addressing and path-suffix line ranges", async () => {
    const services = deps();
    const log = spyOn(console, "log").mockImplementation(() => {});
    try {
      await readAction(
        "src/index.ts:3-8",
        undefined,
        {
          json: true,
          repoUrl: "https://github.com/owner/repo",
          gitRef: "abc123",
        },
        services,
      );
      expect(services.codeNavigationService!.readFile).toHaveBeenCalledWith(
        expect.objectContaining({
          target: {
            repoUrl: "https://github.com/owner/repo",
            gitRef: "abc123",
          },
          filePath: "src/index.ts",
          startLine: 3,
          endLine: 8,
        }),
      );
      expect(services.readService.read).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });

  it("keeps a #-bearing file path in legacy --repo-url mode", async () => {
    const services = deps();
    const log = spyOn(console, "log").mockImplementation(() => {});
    try {
      await readAction(
        "npm:foo#bar",
        undefined,
        { repoUrl: "https://github.com/owner/repo", json: true },
        services,
      );
      expect(services.codeNavigationService!.readFile).toHaveBeenCalledWith(
        expect.objectContaining({ filePath: "npm:foo#bar" }),
      );
      expect(services.readService.read).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });

  it("does not treat a #-bearing --repo-url path as a target fragment with --selector", async () => {
    const services = deps();
    services.readService.read = mock(() =>
      Promise.resolve({
        source: "symbol_resolution" as const,
        result: {
          status: "NOT_FOUND" as const,
          candidates: [],
          suggestions: [],
          hasMore: false,
          repoUrl: "https://github.com/owner/repo",
          gitRef: "main",
          message: null,
          codeIndexState: "CURRENT",
        },
      }),
    );
    const log = spyOn(console, "log").mockImplementation(() => {});
    try {
      await readAction(
        "npm:foo#bar",
        undefined,
        {
          repoUrl: "https://github.com/owner/repo",
          gitRef: "main",
          selector: "missing",
          json: true,
        },
        services,
      );
      expect(services.readService.read).toHaveBeenCalledWith(
        expect.objectContaining({
          target: "https://github.com/owner/repo@main",
          path: "npm:foo#bar",
          selector: "missing",
        }),
      );
      const payload = JSON.parse(String(log.mock.calls[0]?.[0]));
      expect(payload.action).toContain(
        '--in "https://github.com/owner/repo@main"',
      );
    } finally {
      log.mockRestore();
    }
  });

  it("keeps default stdout content-only", async () => {
    const output: string[] = [];
    const write = spyOn(process.stdout, "write").mockImplementation(((
      chunk: string,
    ) => {
      output.push(chunk);
      return true;
    }) as typeof process.stdout.write);
    try {
      await readAction("npm:example", "src/index.ts", {}, deps());
      expect(output.join("")).toStartWith("// Express entry point");
      expect(output.join("")).not.toContain("Deprecated");
    } finally {
      write.mockRestore();
    }
  });

  it.each([{ gitRef: "main" }, { wait: "-1" }, { wait: "60001" }])(
    "rejects invalid pathless options before a service call: %j",
    async (options) => {
      const services = deps();
      const error = spyOn(console, "error").mockImplementation(() => {});
      const exit = spyOn(process, "exit").mockImplementation((() => {
        throw new Error("exit");
      }) as never);
      try {
        await expect(
          readAction(
            "docs-id",
            undefined,
            { ...options, json: true },
            services,
          ),
        ).rejects.toThrow("exit");
        expect(JSON.parse(String(error.mock.calls[0]?.[0]))).toHaveProperty(
          "code",
          "INVALID_ARGUMENT",
        );
        expect(services.readService.read).not.toHaveBeenCalled();
        expect(services.codeNavigationService!.readFile).not.toHaveBeenCalled();
      } finally {
        error.mockRestore();
        exit.mockRestore();
      }
    },
  );

  it("requires authentication before interpreting targets", async () => {
    await expect(
      readAction(undefined, undefined, {}, { ...deps(), hasValidToken: false }),
    ).rejects.toBeInstanceOf(AuthRequiredError);
  });
});
