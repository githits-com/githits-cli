import { describe, expect, it, mock, spyOn } from "bun:test";
import {
  CodeNavigationFileNotFoundError,
  CodeNavigationIndexingError,
  CodeNavigationTargetNotFoundError,
} from "../../services/index.js";
import {
  createMockCodeNavigationService,
  defaultGrepRepoResult,
} from "../../services/test-helpers.js";
import { type PkgGrepCommandDependencies, pkgGrepAction } from "./grep.js";

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

    await pkgGrepAction(
      "npm:express",
      "middleware",
      undefined,
      {},
      createDeps(),
    );

    const output = writes.join("");
    expect(output).toContain(
      "src/index.js\n4:module.exports = require('./lib/express');",
    );
    expect(output).not.toContain(
      "src/index.js:4:module.exports = require('./lib/express');",
    );
    writeSpy.mockRestore();
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
    expect(output).toContain("src/index.js\n");
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
    expect(stderr).toBe(
      "More grep results available — rerun with --cursor 'cursor_abc123'\n",
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

  it("exits 1 on zero matches", async () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    const exitCalls: number[] = [];
    const exitSpy = spyOn(process, "exit").mockImplementation(((
      code?: number,
    ) => {
      exitCalls.push(code ?? 0);
      return undefined as never;
    }) as typeof process.exit);
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
    expect(exitCalls).toEqual([1]);
    logSpy.mockRestore();
    exitSpy.mockRestore();
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
    expect(errorSpy.mock.calls[0]?.[0]).toContain("indexingRef: ref_abc");
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
