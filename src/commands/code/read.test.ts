import { describe, expect, it, mock, spyOn } from "bun:test";
import {
  CodeNavigationFileNotFoundError,
  CodeNavigationIndexingError,
} from "../../services/index.js";
import {
  createMockCodeNavigationService,
  defaultReadFileResult,
} from "../../services/test-helpers.js";
import { type PkgReadCommandDependencies, pkgReadAction } from "./read.js";

describe("pkgReadAction", () => {
  const mcpUrl = "https://mcp.githits.com";

  function createDeps(
    overrides: Partial<PkgReadCommandDependencies> = {},
  ): PkgReadCommandDependencies {
    return {
      codeNavigationService: createMockCodeNavigationService(),
      codeNavigationUrl: "https://pkgseer.dev",
      hasValidToken: true,
      mcpUrl,
      ...overrides,
    };
  }

  it("plain mode: emits raw content only — no header, no gutter", async () => {
    const writes: string[] = [];
    const writeSpy = spyOn(process.stdout, "write").mockImplementation(((
      chunk: string | Uint8Array,
    ) => {
      writes.push(
        typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk),
      );
      return true;
    }) as typeof process.stdout.write);

    await pkgReadAction("npm:express", "src/index.js", {}, createDeps());

    const combined = writes.join("");
    expect(combined).toContain("// Express entry point");
    // Plain mode excludes the contextual header and the gutter.
    expect(combined).not.toContain("src/index.js · javascript");
    expect(combined).not.toMatch(/^\s*1\s+\/\//m);
    writeSpy.mockRestore();
  });

  it("verbose mode: adds the header and line-number gutter", async () => {
    const writes: string[] = [];
    const writeSpy = spyOn(process.stdout, "write").mockImplementation(((
      chunk: string | Uint8Array,
    ) => {
      writes.push(
        typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk),
      );
      return true;
    }) as typeof process.stdout.write);

    await pkgReadAction(
      "npm:express",
      "src/index.js",
      { verbose: true },
      createDeps(),
    );

    const combined = writes.join("");
    expect(combined).toContain("src/index.js · javascript");
    expect(combined).toContain("1  // Express entry point");
    writeSpy.mockRestore();
  });

  it("emits the JSON envelope with --json", async () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    await pkgReadAction(
      "npm:express",
      "src/index.js",
      { json: true },
      createDeps(),
    );
    const payload = JSON.parse(logSpy.mock.calls[0]?.[0] as string);
    expect(payload.path).toBe("src/index.js");
    expect(payload.content).toContain("Express entry point");
    logSpy.mockRestore();
  });

  it("sends wait default of 20000 on the wire", async () => {
    const readFile = mock(() => Promise.resolve(defaultReadFileResult));
    const service = createMockCodeNavigationService({ readFile });
    const writeSpy = spyOn(process.stdout, "write").mockImplementation(
      (() => true) as typeof process.stdout.write,
    );
    await pkgReadAction(
      "npm:express",
      "src/index.js",
      {},
      createDeps({ codeNavigationService: service }),
    );
    const calls = readFile.mock.calls as unknown as Array<
      [{ waitTimeoutMs?: number }]
    >;
    expect(calls[0]?.[0]?.waitTimeoutMs).toBe(20000);
    writeSpy.mockRestore();
  });

  it("sends repo-url addressing — single positional as path", async () => {
    const readFile = mock(() => Promise.resolve(defaultReadFileResult));
    const service = createMockCodeNavigationService({ readFile });
    const writeSpy = spyOn(process.stdout, "write").mockImplementation(
      (() => true) as typeof process.stdout.write,
    );
    // Commander binds the single positional to the first argument.
    // The action must recognise repo-URL mode and treat it as the path.
    await pkgReadAction(
      "src/index.js",
      undefined,
      {
        repoUrl: "https://github.com/expressjs/express",
        gitRef: "main",
      },
      createDeps({ codeNavigationService: service }),
    );
    const calls = readFile.mock.calls as unknown as Array<
      [{ target: { registry?: string; repoUrl?: string; gitRef?: string } }]
    >;
    expect(calls[0]?.[0]?.target.registry).toBeUndefined();
    expect(calls[0]?.[0]?.target.repoUrl).toBe(
      "https://github.com/expressjs/express",
    );
    writeSpy.mockRestore();
  });

  it("sends start/end from --start --end", async () => {
    const readFile = mock(() => Promise.resolve(defaultReadFileResult));
    const writeSpy = spyOn(process.stdout, "write").mockImplementation(
      (() => true) as typeof process.stdout.write,
    );
    await pkgReadAction(
      "npm:express",
      "src/index.js",
      { start: "10", end: "40" },
      createDeps({
        codeNavigationService: createMockCodeNavigationService({ readFile }),
      }),
    );
    const calls = readFile.mock.calls as unknown as Array<
      [{ startLine?: number; endLine?: number }]
    >;
    expect(calls[0]?.[0]?.startLine).toBe(10);
    expect(calls[0]?.[0]?.endLine).toBe(40);
    writeSpy.mockRestore();
  });

  it.each([
    ["10-40", 10, 40],
    ["10-", 10, undefined],
    ["-40", 1, 40],
  ])("parses --lines '%s' into start=%s end=%s", async (lines, expectedStart, expectedEnd) => {
    const readFile = mock(() => Promise.resolve(defaultReadFileResult));
    const writeSpy = spyOn(process.stdout, "write").mockImplementation(
      (() => true) as typeof process.stdout.write,
    );
    await pkgReadAction(
      "npm:express",
      "src/index.js",
      { lines },
      createDeps({
        codeNavigationService: createMockCodeNavigationService({ readFile }),
      }),
    );
    const calls = readFile.mock.calls as unknown as Array<
      [{ startLine?: number; endLine?: number }]
    >;
    expect(calls[0]?.[0]?.startLine).toBe(expectedStart);
    expect(calls[0]?.[0]?.endLine).toBe(expectedEnd);
    writeSpy.mockRestore();
  });

  it.each([
    "10", // single line — ambiguous
    "40-10", // reversed
    "abc", // non-numeric
    "0-5", // zero isn't 1-indexed
    "-", // bare dash — no bounds
  ])("rejects --lines '%s'", async (lines) => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    try {
      await pkgReadAction(
        "npm:express",
        "src/index.js",
        { lines },
        createDeps(),
      );
    } catch {
      /* expected */
    }
    expect(errorSpy.mock.calls.length).toBeGreaterThan(0);
    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("rejects --lines combined with --start/--end", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    try {
      await pkgReadAction(
        "npm:express",
        "src/index.js",
        { lines: "10-40", start: "10" },
        createDeps(),
      );
    } catch {
      /* expected */
    }
    expect(errorSpy.mock.calls[0]?.[0]).toMatch(/Pick one/);
    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("rejects extra positional in repo-URL mode", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    try {
      await pkgReadAction(
        "src/index.js",
        "unexpected.js",
        {
          repoUrl: "https://github.com/expressjs/express",
          gitRef: "main",
        },
        createDeps(),
      );
    } catch {
      /* expected */
    }
    expect(errorSpy.mock.calls[0]?.[0]).toMatch(/--repo-url mode/);
    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("rejects missing <path>", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    try {
      await pkgReadAction("npm:express", undefined, {}, createDeps());
    } catch {
      /* expected */
    }
    expect(errorSpy.mock.calls[0]?.[0]).toMatch(/path/);
    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("renders the binary sentinel via stdout.write", async () => {
    const writes: string[] = [];
    const writeSpy = spyOn(process.stdout, "write").mockImplementation(((
      chunk: string | Uint8Array,
    ) => {
      writes.push(
        typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk),
      );
      return true;
    }) as typeof process.stdout.write);
    const service = createMockCodeNavigationService({
      readFile: mock(() =>
        Promise.resolve({
          filePath: "assets/logo.png",
          isBinary: true,
        }),
      ),
    });
    await pkgReadAction(
      "npm:express",
      "assets/logo.png",
      {},
      createDeps({ codeNavigationService: service }),
    );
    const combined = writes.join("");
    // Plain-mode binary output: sentinel only (no header).
    expect(combined).toContain("Binary file — cannot display as text.");
    expect(combined).not.toContain("assets/logo.png");
    writeSpy.mockRestore();
  });

  it("routes NOT_FOUND on missing path with a code-files hint (backend currently emits NOT_FOUND, not FILE_NOT_FOUND)", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    const { CodeNavigationTargetNotFoundError } = await import(
      "../../services/index.js"
    );
    const service = createMockCodeNavigationService({
      readFile: mock(() =>
        Promise.reject(
          new CodeNavigationTargetNotFoundError("File not found in repository"),
        ),
      ),
    });
    try {
      await pkgReadAction(
        "npm:express",
        "nope.js",
        {},
        createDeps({ codeNavigationService: service }),
      );
    } catch {
      /* expected */
    }
    const output = errorSpy.mock.calls[0]?.[0] as string;
    expect(output).toContain("File not found");
    expect(output).toContain("code files");
    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("routes FILE_NOT_FOUND with a code-files hint", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    const service = createMockCodeNavigationService({
      readFile: mock(() =>
        Promise.reject(
          new CodeNavigationFileNotFoundError(
            "File not found: nope.js",
            "nope.js",
          ),
        ),
      ),
    });
    try {
      await pkgReadAction(
        "npm:express",
        "nope.js",
        {},
        createDeps({ codeNavigationService: service }),
      );
    } catch {
      /* expected */
    }
    const output = errorSpy.mock.calls[0]?.[0] as string;
    expect(output).toContain("File not found");
    expect(output).toContain("code files");
    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("enriches INDEXING error", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    const service = createMockCodeNavigationService({
      readFile: mock(() =>
        Promise.reject(
          new CodeNavigationIndexingError("Indexing...", "ref_xyz", [
            { version: "4.21.0", ref: "v4.21.0" },
          ]),
        ),
      ),
    });
    try {
      await pkgReadAction(
        "npm:express",
        "src/index.js",
        {},
        createDeps({ codeNavigationService: service }),
      );
    } catch {
      /* expected */
    }
    const output = errorSpy.mock.calls[0]?.[0] as string;
    expect(output).toContain("indexingRef: ref_xyz");
    expect(output).toContain("already-indexed versions: 4.21.0");
    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });
});
