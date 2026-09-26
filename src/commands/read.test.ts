import { describe, expect, it, mock, spyOn } from "bun:test";
import {
  CodeNavigationBackendError,
  CodeNavigationFileNotFoundError,
} from "@githits/core-internal";
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
  it.each([
    ["npm:express@5.2.1", "npm", "express", undefined, undefined],
    [
      "github:owner/repo@abc123",
      undefined,
      undefined,
      "https://github.com/owner/repo",
      "abc123",
    ],
  ])(
    "preserves exact-file JSON identity for %s",
    async (target, registry, name, repoUrl, gitRef) => {
      const services = deps();
      const log = spyOn(console, "log").mockImplementation(() => {});
      try {
        await readAction(target, "src/index.ts", { json: true }, services);
        expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toMatchObject({
          ...(registry ? { registry, name } : { repoUrl, gitRef }),
          path: defaultReadFileResult.filePath,
          content: defaultReadFileResult.content,
        });
      } finally {
        log.mockRestore();
      }
    },
  );

  it("uses the served SHA for a snapshot page ID plus matching path", async () => {
    const services = deps();
    const sha = "0123456789abcdef0123456789abcdef01234567";
    const target = `github:owner/repo@${sha}/docs/guide.md`;
    services.readService.read = mock(() =>
      Promise.resolve({
        source: "code" as const,
        result: {
          ...defaultReadFileResult,
          filePath: "docs/guide.md",
          targetResolution: {
            served: { commitSha: sha },
            availableVersions: [],
            availableRefs: [],
          },
        },
      }),
    );
    const log = spyOn(console, "log").mockImplementation(() => {});
    try {
      await readAction(target, "docs/guide.md", { json: true }, services);
      expect(services.readService.read).toHaveBeenCalledWith({
        target,
        path: "docs/guide.md",
        waitTimeoutMs: 30_000,
      });
      expect(services.readService.read).toHaveBeenCalledTimes(1);
      expect(services.codeNavigationService!.readFile).not.toHaveBeenCalled();
      expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toMatchObject({
        repoUrl: "https://github.com/owner/repo",
        gitRef: sha,
        path: "docs/guide.md",
      });
    } finally {
      log.mockRestore();
    }
  });

  it.each([
    ["", {}],
    ["#overview", {}],
    ["", { start: "5", end: "9" }],
  ])(
    "forwards a snapshot page ID%s unchanged as an indexed file",
    async (suffix, options) => {
      const services = deps();
      services.readService.read = mock(() =>
        Promise.resolve({
          source: "code" as const,
          result: defaultReadFileResult,
        }),
      );
      const target = `github:owner/repo@0123456789abcdef0123456789abcdef01234567/docs/guide.md${suffix}`;
      const log = spyOn(console, "log").mockImplementation(() => {});
      try {
        await readAction(
          target,
          undefined,
          { ...options, json: true },
          services,
        );
        expect(services.readService.read).toHaveBeenCalledWith(
          expect.objectContaining({
            target,
            ...("start" in options ? { startLine: 5, endLine: 9 } : {}),
          }),
        );
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

  it("rejects an invalid compact exact-file target locally", async () => {
    const services = deps();
    const error = spyOn(console, "error").mockImplementation(() => {});
    const exit = spyOn(process, "exit").mockImplementation((() => {
      throw new Error("exit");
    }) as never);
    try {
      await expect(
        readAction(
          "site:example.com",
          "src/index.ts",
          { json: true },
          services,
        ),
      ).rejects.toThrow("exit");
      expect(JSON.parse(String(error.mock.calls[0]?.[0])).code).toBe(
        "INVALID_ARGUMENT",
      );
      expect(services.readService.read).not.toHaveBeenCalled();
    } finally {
      error.mockRestore();
      exit.mockRestore();
    }
  });

  it("preserves the exact-file verbose header", async () => {
    const write = spyOn(process.stdout, "write").mockImplementation(
      (() => true) as typeof process.stdout.write,
    );
    try {
      await readAction(
        "npm:express",
        "src/index.ts",
        { verbose: true },
        deps(),
      );
      expect(String(write.mock.calls[0]?.[0])).toContain(
        "src/index.js · javascript · lines 1-5 of 5",
      );
    } finally {
      write.mockRestore();
    }
  });

  it.each([
    ["src/index.ts:3-8", {}, 3, 8],
    ["src/index.ts", { lines: "-40" }, 1, 40],
    ["src/index.ts", { start: "3", end: "8" }, 3, 8],
  ])(
    "preserves exact-file range %s %j",
    async (path, options, startLine, endLine) => {
      const services = deps();
      const log = spyOn(console, "log").mockImplementation(() => {});
      try {
        await readAction(
          "npm:express",
          path,
          { ...options, json: true },
          services,
        );
        expect(services.readService.read).toHaveBeenCalledWith(
          expect.objectContaining({
            target: "npm:express",
            path: "src/index.ts",
            startLine,
            endLine,
          }),
        );
      } finally {
        log.mockRestore();
      }
    },
  );

  it.each([
    ["src/index.ts:3-8", { lines: "4-5" }, "Use one line-range form only"],
    [
      "src/index.ts",
      { lines: "4-5", start: "3" },
      "Use one line-range form only",
    ],
    [
      "src/index.ts",
      { start: "8", end: "3" },
      "--start (8) must be ≤ --end (3)",
    ],
    ["src/", {}, "`<path>` must be an exact file path"],
  ])(
    "rejects invalid exact-file input before transport: %s %j",
    async (path, options, message) => {
      const services = deps();
      const error = spyOn(console, "error").mockImplementation(() => {});
      const exit = spyOn(process, "exit").mockImplementation((() => {
        throw new Error("exit");
      }) as never);
      try {
        await expect(
          readAction("npm:express", path, { ...options, json: true }, services),
        ).rejects.toThrow("exit");
        expect(String(error.mock.calls[0]?.[0])).toContain(message);
        expect(services.readService.read).not.toHaveBeenCalled();
      } finally {
        error.mockRestore();
        exit.mockRestore();
      }
    },
  );

  it("does not parse a path range on a symbol read", async () => {
    const services = deps();
    const log = spyOn(console, "log").mockImplementation(() => {});
    try {
      await readAction(
        "npm:express#createApp",
        "src/index.ts:3-8",
        { json: true },
        services,
      );
      expect(services.readService.read).toHaveBeenCalledWith({
        target: "npm:express#createApp",
        path: "src/index.ts:3-8",
        waitTimeoutMs: 30_000,
      });
    } finally {
      log.mockRestore();
    }
  });

  it.each([
    new CodeNavigationFileNotFoundError(
      "File not found: docs/missing.md",
      "docs/missing.md",
    ),
    new CodeNavigationBackendError(
      "Exact path is not queryable.",
      undefined,
      "FILE_PATH_EXCLUDED",
      false,
      { filePath: "docs/missing.md" },
    ),
    new CodeNavigationBackendError(
      "Exact path is not queryable.",
      undefined,
      "SOURCE_FILE_INVENTORY_UNKNOWN",
      false,
      { filePath: "docs/missing.md" },
    ),
  ])("preserves exact-file JSON recovery for %s", async (failure) => {
    const services = deps();
    services.readService.read = mock(() => Promise.reject(failure));
    const error = spyOn(console, "error").mockImplementation(() => {});
    const exit = spyOn(process, "exit").mockImplementation((() => {
      throw new Error("exit");
    }) as never);
    try {
      await expect(
        readAction("npm:express", "docs/missing.md", { json: true }, services),
      ).rejects.toThrow("exit");
      const payload = JSON.parse(String(error.mock.calls[0]?.[0]));
      expect(payload.details.action).toContain("`githits code files`");
      expect(payload.details.action).toContain("`githits read`");
    } finally {
      error.mockRestore();
      exit.mockRestore();
    }
  });

  it("preserves the exact-file text recovery hint", async () => {
    const services = deps();
    services.readService.read = mock(() =>
      Promise.reject(
        new CodeNavigationFileNotFoundError(
          "File not found: docs/missing.md",
          "docs/missing.md",
        ),
      ),
    );
    const error = spyOn(console, "error").mockImplementation(() => {});
    const exit = spyOn(process, "exit").mockImplementation((() => {
      throw new Error("exit");
    }) as never);
    try {
      await expect(
        readAction("npm:express", "docs/missing.md", {}, services),
      ).rejects.toThrow("exit");
      expect(String(error.mock.calls[0]?.[0])).toContain(
        "Use `code files` to list available paths.",
      );
    } finally {
      error.mockRestore();
      exit.mockRestore();
    }
  });
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
