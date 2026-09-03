import { describe, expect, it, mock, spyOn } from "bun:test";
import {
  CodeNavigationBackendError,
  CodeNavigationFileNotFoundError,
  CodeNavigationIndexingError,
  CodeNavigationTargetNotFoundError,
} from "@githits/core-internal";
import { Command } from "commander";
import {
  createMockCodeNavigationService,
  defaultGrepRepoResult,
} from "../../services/test-helpers.js";
import {
  type PkgGrepCommandDependencies,
  pkgGrepAction,
  registerCodeGrepCommand,
} from "./grep.js";

describe("code grep help", () => {
  it("lists only backend-supported symbol fields", () => {
    const command = registerCodeGrepCommand(new Command().command("code"));
    const help = command.helpInformation().replace(/\s+/g, " ");

    expect(help).toContain(
      "Valid values: symbol_ref, name, qualified_path, kind, category, arity, is_public, file_path, start_line, end_line, content_hash, parent_path.",
    );
    expect(help).not.toContain("code, caller_count");
    expect(help).not.toContain("parent_symbol_ref");
  });
});

describe("pkgGrepAction", () => {
  const mcpUrl = "https://mcp.githits.com";

  function createDeps(
    overrides: Partial<PkgGrepCommandDependencies> = {},
  ): PkgGrepCommandDependencies {
    return {
      codeNavigationService: createMockCodeNavigationService(),
      codeNavigationUrl: "https://pkgseer.dev",
      hasValidToken: true,
      mcpUrl,
      ...overrides,
    };
  }

  it("plain mode emits file:line:text", async () => {
    const writes: string[] = [];
    const writeSpy = spyOn(process.stdout, "write").mockImplementation(((
      chunk: string | Uint8Array,
    ) => {
      writes.push(
        typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk),
      );
      return true;
    }) as typeof process.stdout.write);
    const stdoutDescriptor = Object.getOwnPropertyDescriptor(
      process.stdout,
      "isTTY",
    );
    Object.defineProperty(process.stdout, "isTTY", {
      value: false,
      configurable: true,
    });

    await pkgGrepAction(
      "npm:express",
      "middleware",
      undefined,
      {},
      createDeps(),
    );

    expect(writes.join("")).toContain("src/index.js:4:");
    writeSpy.mockRestore();
    if (stdoutDescriptor) {
      Object.defineProperty(process.stdout, "isTTY", stdoutDescriptor);
    }
  });

  it("tty mode emits file heading plus compact line matches", async () => {
    const writes: string[] = [];
    const writeSpy = spyOn(process.stdout, "write").mockImplementation(((
      chunk: string | Uint8Array,
    ) => {
      writes.push(
        typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk),
      );
      return true;
    }) as typeof process.stdout.write);
    const stdoutDescriptor = Object.getOwnPropertyDescriptor(
      process.stdout,
      "isTTY",
    );
    Object.defineProperty(process.stdout, "isTTY", {
      value: true,
      configurable: true,
    });
    const noColor = process.env.NO_COLOR;
    delete process.env.NO_COLOR;

    await pkgGrepAction(
      "npm:express",
      "middleware",
      undefined,
      {},
      createDeps(),
    );

    const output = writes.join("");
    expect(output).toContain("src/index.js\n4:module.exports = ");
    expect(output).toContain(
      "\u001b[1m\u001b[33mrequire\u001b[0m('./lib/express');",
    );
    expect(output).not.toContain(
      "src/index.js:4:module.exports = require('./lib/express');",
    );
    writeSpy.mockRestore();
    if (noColor === undefined) {
      delete process.env.NO_COLOR;
    } else {
      process.env.NO_COLOR = noColor;
    }
    if (stdoutDescriptor) {
      Object.defineProperty(process.stdout, "isTTY", stdoutDescriptor);
    }
  });

  it("verbose mode renders grouped output", async () => {
    const writes: string[] = [];
    const writeSpy = spyOn(process.stdout, "write").mockImplementation(((
      chunk: string | Uint8Array,
    ) => {
      writes.push(
        typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk),
      );
      return true;
    }) as typeof process.stdout.write);

    await pkgGrepAction(
      "npm:express",
      "middleware",
      undefined,
      { verbose: true },
      createDeps(),
    );

    const output = writes.join("");
    expect(output).toContain("1 match in 1 file");
    expect(output).toContain("src/index.js");
    expect(output).toContain("> 4  module.exports = require('./lib/express');");
    writeSpy.mockRestore();
  });

  it("prints the actual nextCursor in terminal pagination hints", async () => {
    const stderrWrites: string[] = [];
    const stdoutSpy = spyOn(process.stdout, "write").mockImplementation(
      (() => true) as typeof process.stdout.write,
    );
    const stderrSpy = spyOn(process.stderr, "write").mockImplementation(((
      chunk: string | Uint8Array,
    ) => {
      stderrWrites.push(
        typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk),
      );
      return true;
    }) as typeof process.stderr.write);

    await pkgGrepAction(
      "npm:express",
      "middleware",
      undefined,
      {},
      createDeps({
        codeNavigationService: createMockCodeNavigationService({
          grepRepo: mock(() =>
            Promise.resolve({
              ...defaultGrepRepoResult,
              hasMore: true,
              nextCursor: "cursor_abc123",
              truncatedReason: "MAX_MATCHES" as const,
            }),
          ),
        }),
      }),
    );

    const stderr = stderrWrites.join("");
    expect(stderr).toContain(
      "More matches available — rerun with --cursor 'cursor_abc123'",
    );
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  it("adds a narrow-scope hint for noisy broad terminal output", async () => {
    const stderrWrites: string[] = [];
    const stdoutSpy = spyOn(process.stdout, "write").mockImplementation(
      (() => true) as typeof process.stdout.write,
    );
    const stderrSpy = spyOn(process.stderr, "write").mockImplementation(((
      chunk: string | Uint8Array,
    ) => {
      stderrWrites.push(
        typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk),
      );
      return true;
    }) as typeof process.stderr.write);

    await pkgGrepAction(
      "npm:express",
      "foo",
      undefined,
      {},
      createDeps({
        codeNavigationService: createMockCodeNavigationService({
          grepRepo: mock(() =>
            Promise.resolve({
              ...defaultGrepRepoResult,
              totalMatches: 6,
              uniqueFilesMatched: 6,
              matches: [
                {
                  ...defaultGrepRepoResult.matches[0]!,
                  filePath: "History.md",
                  line: 1,
                },
                {
                  ...defaultGrepRepoResult.matches[0]!,
                  filePath: "Readme.md",
                  line: 2,
                },
                {
                  ...defaultGrepRepoResult.matches[0]!,
                  filePath: "benchmarks/run",
                  line: 3,
                },
                {
                  ...defaultGrepRepoResult.matches[0]!,
                  filePath: "examples/a.js",
                  line: 4,
                },
                {
                  ...defaultGrepRepoResult.matches[0]!,
                  filePath: "test/a.js",
                  line: 5,
                },
                {
                  ...defaultGrepRepoResult.matches[0]!,
                  filePath: "lib/app.js",
                  line: 6,
                },
              ],
            }),
          ),
        }),
      }),
    );

    expect(stderrWrites.join("")).toContain("Broad results");
    expect(stderrWrites.join("")).toContain("--exclude-tests");
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  it("JSON mode emits the new envelope", async () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    await pkgGrepAction(
      "npm:express",
      "middleware",
      "src/",
      { json: true },
      createDeps(),
    );
    const payload = JSON.parse(logSpy.mock.calls[0]?.[0] as string);
    expect(payload.pattern).toBe("middleware");
    expect(payload.filter.pathPrefix).toBe("src/");
    expect(payload.matches[0].filePath).toBe("src/index.js");
    logSpy.mockRestore();
  });

  it("uses repo grep defaults on the wire", async () => {
    const grepRepo = mock(() => Promise.resolve(defaultGrepRepoResult));
    const writeSpy = spyOn(process.stdout, "write").mockImplementation(
      (() => true) as typeof process.stdout.write,
    );
    await pkgGrepAction(
      "npm:express",
      "middleware",
      undefined,
      {},
      createDeps({
        codeNavigationService: createMockCodeNavigationService({ grepRepo }),
      }),
    );
    const calls = grepRepo.mock.calls as unknown as Array<
      [
        {
          allowUnscoped?: boolean;
          contextLinesBefore?: number;
          contextLinesAfter?: number;
          maxMatches?: number;
          waitTimeoutMs?: number;
        },
      ]
    >;
    expect(calls[0]?.[0]?.allowUnscoped).toBe(true);
    expect(calls[0]?.[0]?.contextLinesBefore).toBe(0);
    expect(calls[0]?.[0]?.contextLinesAfter).toBe(0);
    expect(calls[0]?.[0]?.maxMatches).toBe(50);
    expect(calls[0]?.[0]?.waitTimeoutMs).toBe(20000);
    writeSpy.mockRestore();
  });

  it("maps path prefix, exact path, globs, extensions, regex, and context options", async () => {
    const grepRepo = mock(() => Promise.resolve(defaultGrepRepoResult));
    const writeSpy = spyOn(process.stdout, "write").mockImplementation(
      (() => true) as typeof process.stdout.write,
    );
    await pkgGrepAction(
      "npm:express",
      "middleware",
      "src/",
      {
        path: "src/index.js",
        glob: ["src/**/*.js"],
        ext: ["js"],
        regex: true,
        caseSensitive: true,
        beforeContext: "2",
        afterContext: "1",
        limit: "100",
        perFileLimit: "3",
        excludeDocs: true,
        excludeTests: true,
        cursor: "cursor-123",
        symbolField: ["name", "qualified_path"],
      },
      createDeps({
        codeNavigationService: createMockCodeNavigationService({ grepRepo }),
      }),
    );
    const calls = grepRepo.mock.calls as unknown as Array<
      [
        {
          patternType?: string;
          caseSensitive?: boolean;
          pathSelectors?: Array<{ kind: string; value: string }>;
          extensions?: string[];
          contextLinesBefore?: number;
          contextLinesAfter?: number;
          maxMatches?: number;
          maxMatchesPerFile?: number;
          excludeDocFiles?: boolean;
          excludeTestFiles?: boolean;
          cursor?: string;
          symbolFields?: string[];
        },
      ]
    >;
    expect(calls[0]?.[0]).toMatchObject({
      patternType: "REGEX",
      caseSensitive: true,
      extensions: ["js"],
      contextLinesBefore: 2,
      contextLinesAfter: 1,
      maxMatches: 100,
      maxMatchesPerFile: 3,
      excludeDocFiles: true,
      excludeTestFiles: true,
      cursor: "cursor-123",
      symbolFields: ["name", "qualified_path"],
    });
    expect(calls[0]?.[0]?.pathSelectors).toEqual([
      { kind: "EXACT", value: "src/index.js" },
      { kind: "PREFIX", value: "src/" },
      { kind: "GLOB", value: "src/**/*.js" },
    ]);
    writeSpy.mockRestore();
  });

  it("repo-url mode uses <pattern> [path-prefix]", async () => {
    const grepRepo = mock(() => Promise.resolve(defaultGrepRepoResult));
    const writeSpy = spyOn(process.stdout, "write").mockImplementation(
      (() => true) as typeof process.stdout.write,
    );
    await pkgGrepAction(
      "middleware",
      "src/",
      undefined,
      {
        repoUrl: "https://github.com/expressjs/express",
        gitRef: "main",
      },
      createDeps({
        codeNavigationService: createMockCodeNavigationService({ grepRepo }),
      }),
    );
    const calls = grepRepo.mock.calls as unknown as Array<
      [
        {
          target: { repoUrl?: string };
          pathSelectors?: Array<{ value: string }>;
        },
      ]
    >;
    expect(calls[0]?.[0]?.target.repoUrl).toBe(
      "https://github.com/expressjs/express",
    );
    expect(calls[0]?.[0]?.pathSelectors?.[0]?.value).toBe("src/");
    writeSpy.mockRestore();
  });

  it("accepts github shorthand positional targets", async () => {
    const grepRepo = mock(() => Promise.resolve(defaultGrepRepoResult));
    const writeSpy = spyOn(process.stdout, "write").mockImplementation(
      (() => true) as typeof process.stdout.write,
    );
    await pkgGrepAction(
      "github:expressjs/express",
      "middleware",
      "src/",
      {},
      createDeps({
        codeNavigationService: createMockCodeNavigationService({ grepRepo }),
      }),
    );
    const calls = grepRepo.mock.calls as unknown as Array<
      [
        {
          target: { repoUrl?: string };
          pattern: string;
          pathSelectors?: Array<{ value: string }>;
        },
      ]
    >;
    expect(calls[0]?.[0]?.target.repoUrl).toBe(
      "https://github.com/expressjs/express",
    );
    expect(calls[0]?.[0]?.pattern).toBe("middleware");
    expect(calls[0]?.[0]?.pathSelectors?.[0]?.value).toBe("src/");
    writeSpy.mockRestore();
  });

  it("rejects extra positional in repo-url mode", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    try {
      await pkgGrepAction(
        "middleware",
        "src/",
        "extra",
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

  it("rejects missing pattern", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    try {
      await pkgGrepAction(
        "npm:express",
        undefined,
        undefined,
        {},
        createDeps(),
      );
    } catch {
      /* expected */
    }
    expect(errorSpy.mock.calls[0]?.[0]).toMatch(/pattern/);
    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("uses CLI syntax when a blank pattern suggests listing files", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });

    try {
      try {
        await pkgGrepAction(
          "npm:express",
          "   ",
          undefined,
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
      expect(payload.error).toContain("`<pattern>` is required");
      expect(payload.error).toContain("`githits code files`");
      expect(payload.error).not.toContain("code_files");
    } finally {
      errorSpy.mockRestore();
      exitSpy.mockRestore();
    }
  });

  it("uses CLI option names for shared grep validation", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });

    try {
      try {
        await pkgGrepAction(
          "npm:express",
          "middleware",
          undefined,
          { ext: [".js"], json: true },
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
      expect(payload.error).toContain("`--ext` values");
      expect(payload.error).not.toContain("`extensions`");
    } finally {
      errorSpy.mockRestore();
      exitSpy.mockRestore();
    }
  });

  it("uses --glob for empty shared glob validation", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });

    try {
      try {
        await pkgGrepAction(
          "npm:express",
          "middleware",
          undefined,
          { glob: [" "], json: true },
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
      expect(payload.error).toContain("`--glob` entries cannot be empty");
      expect(payload.error).not.toContain("`globs`");
    } finally {
      errorSpy.mockRestore();
      exitSpy.mockRestore();
    }
  });

  it("keeps API field names in the --symbol-field validation message", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });

    try {
      try {
        await pkgGrepAction(
          "npm:express",
          "middleware",
          undefined,
          { symbolField: ["invalid"], json: true },
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
      expect(payload.error).toContain("`--symbol-field` value must be one of:");
      expect(payload.error).toContain("file_path");
      expect(payload.error).toContain("start_line");
      expect(payload.error).toContain("end_line");
      expect(payload.error).not.toContain("`symbol_fields`");
    } finally {
      errorSpy.mockRestore();
      exitSpy.mockRestore();
    }
  });

  it("does not rewrite MCP-like text echoed from a symbol-field value", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });

    try {
      try {
        await pkgGrepAction(
          "npm:express",
          "middleware",
          undefined,
          { symbolField: ["`symbol_fields`"], json: true },
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
      expect(payload.error).toContain("`--symbol-field` value must be one of:");
      expect(payload.error).toContain("Got: `symbol_fields`.");
      expect(payload.error).not.toContain("Got: `--symbol-field`.");
    } finally {
      errorSpy.mockRestore();
      exitSpy.mockRestore();
    }
  });

  it("sets exit code 1 on zero-match JSON while preserving output", async () => {
    const originalExitCode = process.exitCode;
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    try {
      const service = createMockCodeNavigationService({
        grepRepo: mock(() =>
          Promise.resolve({
            ...defaultGrepRepoResult,
            matches: [],
            totalMatches: 0,
            uniqueFilesMatched: 0,
          }),
        ),
      });
      await pkgGrepAction(
        "npm:express",
        "nothing",
        undefined,
        { json: true },
        createDeps({ codeNavigationService: service }),
      );
      expect(logSpy.mock.calls.length).toBe(1);
      expect(process.exitCode).toBe(1);
    } finally {
      logSpy.mockRestore();
      process.exitCode = originalExitCode ?? 0;
    }
  });

  it("prints zero-match guidance before setting exit code 1", async () => {
    const originalExitCode = process.exitCode;
    const writes: string[] = [];
    const errorWrites: string[] = [];
    const writeSpy = spyOn(process.stdout, "write").mockImplementation(((
      chunk: string | Uint8Array,
    ) => {
      writes.push(
        typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk),
      );
      return true;
    }) as typeof process.stdout.write);
    const errorWriteSpy = spyOn(process.stderr, "write").mockImplementation(((
      chunk: string | Uint8Array,
    ) => {
      errorWrites.push(
        typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk),
      );
      return true;
    }) as typeof process.stderr.write);
    try {
      const service = createMockCodeNavigationService({
        grepRepo: mock(() =>
          Promise.resolve({
            ...defaultGrepRepoResult,
            matches: [],
            totalMatches: 0,
            uniqueFilesMatched: 0,
          }),
        ),
      });

      await pkgGrepAction(
        "npm:express",
        "nothing",
        undefined,
        { verbose: true },
        createDeps({ codeNavigationService: service }),
      );

      expect(writes.join("")).toContain("No matches.");
      expect(errorWrites.join("")).toContain(
        "Do not repeat this grep unchanged.",
      );
      expect(errorWrites.join("")).toContain(
        "use githits search for conceptual intent",
      );
      expect(process.exitCode).toBe(1);
    } finally {
      writeSpy.mockRestore();
      errorWriteSpy.mockRestore();
      process.exitCode = originalExitCode ?? 0;
    }
  });

  it("exits 2 on error paths", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const exitCalls: number[] = [];
    const exitSpy = spyOn(process, "exit").mockImplementation(((
      code?: number,
    ) => {
      exitCalls.push(code ?? 0);
      throw new Error("process.exit");
    }) as typeof process.exit);
    const service = createMockCodeNavigationService({
      grepRepo: mock(() =>
        Promise.reject(
          new CodeNavigationTargetNotFoundError("Package not found"),
        ),
      ),
    });
    try {
      await pkgGrepAction(
        "npm:ghost",
        "middleware",
        undefined,
        {},
        createDeps({ codeNavigationService: service }),
      );
    } catch {
      /* expected */
    }
    expect(exitCalls).toEqual([2]);
    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("enriches INDEXING error", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    const service = createMockCodeNavigationService({
      grepRepo: mock(() =>
        Promise.reject(
          new CodeNavigationIndexingError("Indexing...", "ref_abc"),
        ),
      ),
    });
    try {
      await pkgGrepAction(
        "npm:express",
        "middleware",
        undefined,
        {},
        createDeps({ codeNavigationService: service }),
      );
    } catch {
      /* expected */
    }
    expect(errorSpy.mock.calls[0]?.[0]).toContain("indexing ref: ref_abc");
    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("adds file listing hint only for file-path failures", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });

    try {
      await pkgGrepAction(
        "npm:express",
        "middleware",
        undefined,
        {},
        createDeps({
          codeNavigationService: createMockCodeNavigationService({
            grepRepo: mock(() =>
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

    expect(errorSpy.mock.calls[0]?.[0]).not.toContain("Use `code files`");

    errorSpy.mockReset();

    try {
      await pkgGrepAction(
        "npm:express",
        "middleware",
        undefined,
        {},
        createDeps({
          codeNavigationService: createMockCodeNavigationService({
            grepRepo: mock(() =>
              Promise.reject(
                new CodeNavigationFileNotFoundError(
                  "File not found: nope.js",
                  "nope.js",
                ),
              ),
            ),
          }),
        }),
      );
    } catch {
      /* expected */
    }

    expect(errorSpy.mock.calls[0]?.[0]).toContain("Use `code files`");
    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it.each([
    ["FILE_PATH_EXCLUDED", "excluded from the indexed source"],
    ["SOURCE_FILE_INVENTORY_UNKNOWN", "cannot verify this path"],
  ] as const)(
    "renders indexed-path guidance for %s",
    async (code, expectedGuidance) => {
      const errorSpy = spyOn(console, "error").mockImplementation(() => {});
      const exitSpy = spyOn(process, "exit").mockImplementation(() => {
        throw new Error("process.exit");
      });

      try {
        await pkgGrepAction(
          "hex:jason@1.4.4",
          "{",
          undefined,
          { path: "bench/data/issue-90.json" },
          createDeps({
            codeNavigationService: createMockCodeNavigationService({
              grepRepo: mock(() =>
                Promise.reject(
                  new CodeNavigationBackendError(
                    "Exact path is not queryable.",
                    undefined,
                    code,
                    false,
                    { filePath: "bench/data/issue-90.json" },
                  ),
                ),
              ),
            }),
          }),
        );
      } catch {
        /* expected */
      }

      try {
        const output = String(errorSpy.mock.calls[0]?.[0]);
        expect(output).toContain(expectedGuidance);
        expect(output).toContain("`code files`");
      } finally {
        errorSpy.mockRestore();
        exitSpy.mockRestore();
      }
    },
  );

  it("adds CLI recovery details to exact-path JSON errors", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });

    try {
      try {
        await pkgGrepAction(
          "npm:express",
          "middleware",
          undefined,
          { json: true, path: "docs/missing.md" },
          createDeps({
            codeNavigationService: createMockCodeNavigationService({
              grepRepo: mock(() =>
                Promise.reject(
                  new CodeNavigationFileNotFoundError(
                    "Path not found in the index: docs/missing.md.",
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
        code: string;
        details?: { action?: string; filePath?: string };
      };
      expect(payload.code).toBe("FILE_NOT_FOUND");
      expect(payload.details?.filePath).toBe("docs/missing.md");
      expect(payload.details?.action).toContain("`githits code files`");
      expect(payload.details?.action).toContain('path prefix "docs/"');
      expect(payload.details?.action).toContain("`--path <path>`");
      expect(payload.details?.action).toContain("`githits code grep`");
      expect(payload.details?.action).not.toContain("code_files");
      expect(payload.details?.action).not.toContain("code_grep");
    } finally {
      errorSpy.mockRestore();
      exitSpy.mockRestore();
    }
  });

  it("uses the containing directory for extensionless exact-path JSON errors", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });

    try {
      try {
        await pkgGrepAction(
          "npm:express",
          "benchmark",
          undefined,
          { json: true, path: "benchmarks/run" },
          createDeps({
            codeNavigationService: createMockCodeNavigationService({
              grepRepo: mock(() =>
                Promise.reject(
                  new CodeNavigationFileNotFoundError(
                    "Path not found in the index: benchmarks/run.",
                    "benchmarks/run",
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
      expect(payload.details?.action).toContain('path prefix "benchmarks/"');
      expect(payload.details?.action).not.toContain("benchmarks/run/");
    } finally {
      errorSpy.mockRestore();
      exitSpy.mockRestore();
    }
  });

  it("rewrites navpack backend failures into actionable CLI guidance", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });

    try {
      await pkgGrepAction(
        "npm:express",
        "middleware",
        undefined,
        {},
        createDeps({
          codeNavigationService: createMockCodeNavigationService({
            grepRepo: mock(() =>
              Promise.reject(
                new CodeNavigationTargetNotFoundError(
                  "aigrep has no navpack for this ref and the repository is not marked as stale on any known artifact axis.",
                ),
              ),
            ),
          }),
        }),
      );
    } catch {
      /* expected */
    }

    expect(errorSpy.mock.calls[0]?.[0]).toContain(
      "Source index for this target is temporarily unavailable.",
    );
    expect(errorSpy.mock.calls[0]?.[0]).toContain("--wait 60000");
    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });
});
