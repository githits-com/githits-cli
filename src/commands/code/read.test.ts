import { describe, expect, it, mock, spyOn } from "bun:test";
import {
  CodeNavigationBackendError,
  CodeNavigationFileNotFoundError,
  CodeNavigationIndexingError,
  CodeNavigationTargetNotFoundError,
} from "@githits/core-internal";
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

  it("accepts github shorthand positional targets", async () => {
    const readFile = mock(() => Promise.resolve(defaultReadFileResult));
    const service = createMockCodeNavigationService({ readFile });
    const writeSpy = spyOn(process.stdout, "write").mockImplementation(
      (() => true) as typeof process.stdout.write,
    );
    await pkgReadAction(
      "github:expressjs/express",
      "src/index.js",
      {},
      createDeps({ codeNavigationService: service }),
    );
    const calls = readFile.mock.calls as unknown as Array<
      [{ target: { repoUrl?: string }; filePath: string }]
    >;
    expect(calls[0]?.[0]?.target.repoUrl).toBe(
      "https://github.com/expressjs/express",
    );
    expect(calls[0]?.[0]?.filePath).toBe("src/index.js");
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
  ])(
    "parses --lines '%s' into start=%s end=%s",
    async (lines, expectedStart, expectedEnd) => {
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
    },
  );

  it("parses trailing :start-end range from the path", async () => {
    const readFile = mock(() => Promise.resolve(defaultReadFileResult));
    const writeSpy = spyOn(process.stdout, "write").mockImplementation(
      (() => true) as typeof process.stdout.write,
    );

    await pkgReadAction(
      "npm:express",
      "src/index.js:10-40",
      {},
      createDeps({
        codeNavigationService: createMockCodeNavigationService({ readFile }),
      }),
    );

    const calls = readFile.mock.calls as unknown as Array<
      [{ filePath?: string; startLine?: number; endLine?: number }]
    >;
    expect(calls[0]?.[0]?.filePath).toBe("src/index.js");
    expect(calls[0]?.[0]?.startLine).toBe(10);
    expect(calls[0]?.[0]?.endLine).toBe(40);
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

  it("rejects path range combined with --lines", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    try {
      await pkgReadAction(
        "npm:express",
        "src/index.js:10-40",
        { lines: "10-40" },
        createDeps(),
      );
    } catch {
      /* expected */
    }
    expect(errorSpy.mock.calls[0]?.[0]).toMatch(/path:start-end or --lines/);
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

  it("uses CLI syntax when a directory is passed to code read", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });

    try {
      try {
        await pkgReadAction(
          "npm:express",
          "lib/",
          { json: true },
          createDeps(),
        );
      } catch {
        /* expected */
      }

      const payload = JSON.parse(errorSpy.mock.calls[0]?.[0] as string) as {
        code: string;
        error: string;
      };
      expect(payload.code).toBe("INVALID_ARGUMENT");
      expect(payload.error).toContain("`githits code files`");
      expect(payload.error).toContain('path prefix "lib/"');
      expect(payload.error).toContain("`githits code read`");
      expect(payload.error).not.toContain("code_files");
      expect(payload.error).not.toContain("code_read");
      expect(payload.error).not.toContain("path_prefix");
    } finally {
      errorSpy.mockRestore();
      exitSpy.mockRestore();
    }
  });

  it("preserves backticks in a directory path suggestion", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });

    try {
      try {
        await pkgReadAction(
          "npm:express",
          "li`b/",
          { json: true },
          createDeps(),
        );
      } catch {
        /* expected */
      }

      const payload = JSON.parse(errorSpy.mock.calls[0]?.[0] as string) as {
        code: string;
        error: string;
      };
      expect(payload.code).toBe("INVALID_ARGUMENT");
      expect(payload.error).toContain('path prefix "li`b/"');
      expect(payload.error).not.toContain('path prefix "lib/"');
    } finally {
      errorSpy.mockRestore();
      exitSpy.mockRestore();
    }
  });

  it("uses CLI option names for a reversed explicit line range", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });

    try {
      try {
        await pkgReadAction(
          "npm:express",
          "src/index.js",
          { start: "40", end: "10", json: true },
          createDeps(),
        );
      } catch {
        /* expected */
      }

      const payload = JSON.parse(errorSpy.mock.calls[0]?.[0] as string) as {
        code: string;
        error: string;
      };
      expect(payload.code).toBe("INVALID_ARGUMENT");
      expect(payload.error).toContain("--start (40)");
      expect(payload.error).toContain("--end (10)");
      expect(payload.error).not.toContain("start_line");
      expect(payload.error).not.toContain("end_line");
    } finally {
      errorSpy.mockRestore();
      exitSpy.mockRestore();
    }
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

  it("uses CLI command names in structured FILE_NOT_FOUND recovery", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });

    try {
      try {
        await pkgReadAction(
          "npm:express",
          "docs/missing.md",
          { json: true },
          createDeps({
            codeNavigationService: createMockCodeNavigationService({
              readFile: mock(() =>
                Promise.reject(
                  new CodeNavigationFileNotFoundError(
                    "File not found: docs/missing.md",
                    "docs/missing.md",
                  ),
                ),
              ),
            }),
          }),
        );
      } catch {
        /* expected */
      }

      const payload = JSON.parse(errorSpy.mock.calls[0]?.[0] as string) as {
        details?: { action?: string };
      };
      expect(payload.details?.action).toContain("`githits code files`");
      expect(payload.details?.action).toContain('path prefix "docs/"');
      expect(payload.details?.action).toContain("`githits code read`");
      expect(payload.details?.action).not.toContain("code_files");
      expect(payload.details?.action).not.toContain("code_read");
    } finally {
      errorSpy.mockRestore();
      exitSpy.mockRestore();
    }
  });

  it("uses the normalized containing directory for extensionless FILE_NOT_FOUND recovery", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });

    try {
      try {
        await pkgReadAction(
          "npm:express",
          "./lib/internal",
          { json: true },
          createDeps({
            codeNavigationService: createMockCodeNavigationService({
              readFile: mock(() =>
                Promise.reject(
                  new CodeNavigationFileNotFoundError(
                    "File not found: lib/internal",
                    "lib/internal",
                  ),
                ),
              ),
            }),
          }),
        );
      } catch {
        /* expected */
      }

      const payload = JSON.parse(errorSpy.mock.calls[0]?.[0] as string) as {
        details?: { action?: string };
      };
      expect(payload.details?.action).toContain('path prefix "lib/"');
      expect(payload.details?.action).not.toContain("./lib/");
      expect(payload.details?.action).not.toContain("lib/internal/");
    } finally {
      errorSpy.mockRestore();
      exitSpy.mockRestore();
    }
  });

  it("uses CLI names for legacy missing-file NOT_FOUND recovery", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });

    try {
      try {
        await pkgReadAction(
          "npm:express",
          "lib",
          { json: true },
          createDeps({
            codeNavigationService: createMockCodeNavigationService({
              readFile: mock(() =>
                Promise.reject(
                  new CodeNavigationTargetNotFoundError(
                    "File not found in repository",
                  ),
                ),
              ),
            }),
          }),
        );
      } catch {
        /* expected */
      }

      const payload = JSON.parse(errorSpy.mock.calls[0]?.[0] as string) as {
        details?: { action?: string };
      };
      expect(payload.details?.action).toContain("`githits code read`");
      expect(payload.details?.action).toContain('path prefix "lib/"');
      expect(payload.details?.action).not.toContain("code_read");
    } finally {
      errorSpy.mockRestore();
      exitSpy.mockRestore();
    }
  });

  it("does not add file recovery to unrelated JSON NOT_FOUND errors", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });

    try {
      try {
        await pkgReadAction(
          "npm:ghost",
          "src/index.js",
          { json: true },
          createDeps({
            codeNavigationService: createMockCodeNavigationService({
              readFile: mock(() =>
                Promise.reject(
                  new CodeNavigationTargetNotFoundError("Package not found"),
                ),
              ),
            }),
          }),
        );
      } catch {
        /* expected */
      }

      const payload = JSON.parse(errorSpy.mock.calls[0]?.[0] as string) as {
        details?: { action?: string };
      };
      expect(payload.details?.action).toBeUndefined();
    } finally {
      errorSpy.mockRestore();
      exitSpy.mockRestore();
    }
  });

  it("routes REF_NOT_FOUND with a repo/ref hint instead of path narrowing", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    const service = createMockCodeNavigationService({
      readFile: mock(() =>
        Promise.reject(
          new CodeNavigationBackendError(
            "Git ref not found: HEAD for repository https://github.com/acme/missing.",
            undefined,
            "REF_NOT_FOUND",
            false,
          ),
        ),
      ),
    });

    try {
      await pkgReadAction(
        "README.md",
        undefined,
        { repoUrl: "https://github.com/acme/missing" },
        createDeps({ codeNavigationService: service }),
      );
    } catch {
      /* expected */
    }

    const output = errorSpy.mock.calls[0]?.[0] as string;
    expect(output).toContain("Git ref not found: HEAD");
    expect(output).toContain("repository URL and git ref");
    expect(output).not.toContain("Narrow the target");
    expect(output).not.toContain("code files");
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
    expect(output).toContain("indexing ref: ref_xyz");
    expect(output).toContain("indexed refs/versions: 4.21.0");
    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });
});
