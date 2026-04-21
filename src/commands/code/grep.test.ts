import { describe, expect, it, mock, spyOn } from "bun:test";
import {
  CodeNavigationIndexingError,
  CodeNavigationTargetNotFoundError,
} from "../../services/index.js";
import {
  createMockCodeNavigationService,
  defaultGrepFileResult,
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

  it("plain mode: emits matching line(s) only — no header, no gutter", async () => {
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
      "src/index.js",
      {},
      createDeps(),
    );

    const combined = writes.join("");
    expect(combined).not.toContain("express · npm");
    expect(combined).not.toContain("1 match in src/index.js");
    expect(combined).not.toMatch(/^>/m);
    // `defaultGrepFileResult` has one match line — plain mode emits
    // its content.
    expect(combined.trim().length).toBeGreaterThan(0);
    writeSpy.mockRestore();
  });

  it("verbose mode: renders the full match block with header and `>` marker", async () => {
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
      "src/index.js",
      { verbose: true },
      createDeps(),
    );

    const combined = writes.join("");
    expect(combined).toContain("express · npm");
    expect(combined).toContain("1 match in src/index.js");
    expect(combined).toContain(">");
    writeSpy.mockRestore();
  });

  it("default contextLines is 0 on the wire (matches-only)", async () => {
    const grepFile = mock(() => Promise.resolve(defaultGrepFileResult));
    const writeSpy = spyOn(process.stdout, "write").mockImplementation(
      (() => true) as typeof process.stdout.write,
    );
    await pkgGrepAction(
      "npm:express",
      "middleware",
      "src/index.js",
      {},
      createDeps({
        codeNavigationService: createMockCodeNavigationService({ grepFile }),
      }),
    );
    const calls = grepFile.mock.calls as unknown as Array<
      [{ contextLines?: number }]
    >;
    expect(calls[0]?.[0]?.contextLines).toBe(0);
    writeSpy.mockRestore();
  });

  it("emits the JSON envelope with --json", async () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    await pkgGrepAction(
      "npm:express",
      "middleware",
      "src/index.js",
      { json: true },
      createDeps(),
    );
    const payload = JSON.parse(logSpy.mock.calls[0]?.[0] as string);
    expect(payload.pattern).toBe("middleware");
    expect(payload.path).toBe("src/index.js");
    expect(payload.matches.length).toBe(1);
    logSpy.mockRestore();
  });

  it("sends wait default of 20000 on the wire", async () => {
    const grepFile = mock(() => Promise.resolve(defaultGrepFileResult));
    const writeSpy = spyOn(process.stdout, "write").mockImplementation(
      (() => true) as typeof process.stdout.write,
    );
    await pkgGrepAction(
      "npm:express",
      "middleware",
      "src/index.js",
      {},
      createDeps({
        codeNavigationService: createMockCodeNavigationService({ grepFile }),
      }),
    );
    const calls = grepFile.mock.calls as unknown as Array<
      [{ waitTimeoutMs?: number }]
    >;
    expect(calls[0]?.[0]?.waitTimeoutMs).toBe(20000);
    writeSpy.mockRestore();
  });

  it("sends repo-URL addressing with two positionals (pattern, path)", async () => {
    const grepFile = mock(() => Promise.resolve(defaultGrepFileResult));
    const writeSpy = spyOn(process.stdout, "write").mockImplementation(
      (() => true) as typeof process.stdout.write,
    );
    await pkgGrepAction(
      "middleware",
      "src/index.js",
      undefined,
      {
        repoUrl: "https://github.com/expressjs/express",
        gitRef: "main",
      },
      createDeps({
        codeNavigationService: createMockCodeNavigationService({ grepFile }),
      }),
    );
    const calls = grepFile.mock.calls as unknown as Array<
      [{ target: { repoUrl?: string }; pattern: string; path: string }]
    >;
    expect(calls[0]?.[0]?.target.repoUrl).toBe(
      "https://github.com/expressjs/express",
    );
    expect(calls[0]?.[0]?.pattern).toBe("middleware");
    expect(calls[0]?.[0]?.path).toBe("src/index.js");
    writeSpy.mockRestore();
  });

  it("rejects extra positional in repo-URL mode", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    try {
      await pkgGrepAction(
        "middleware",
        "src/index.js",
        "extra-arg",
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

  it("gives a targeted error when caller passes two positionals without --repo-url", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    // `code grep middleware src/index.js` with no spec + no --repo-url.
    // Commander binds these as first=middleware, second=src/index.js.
    // The action must recognise this as a missing-spec mistake, not
    // a "missing <path>" mistake.
    try {
      await pkgGrepAction(
        "middleware",
        "src/index.js",
        undefined,
        {},
        createDeps(),
      );
    } catch {
      /* expected */
    }
    const msg = errorSpy.mock.calls[0]?.[0] as string;
    expect(msg).toContain("all three positionals are required");
    expect(msg).toContain("--repo-url");
    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("rejects missing path", async () => {
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
        createDeps(),
      );
    } catch {
      /* expected */
    }
    expect(errorSpy.mock.calls[0]?.[0]).toMatch(/path/);
    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("rejects --context out of range", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    try {
      await pkgGrepAction(
        "npm:express",
        "middleware",
        "src/index.js",
        { context: "11" },
        createDeps(),
      );
    } catch {
      /* expected */
    }
    expect(errorSpy.mock.calls[0]?.[0]).toMatch(/0 and 10/);
    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("rejects --limit out of range", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    try {
      await pkgGrepAction(
        "npm:express",
        "middleware",
        "src/index.js",
        { limit: "201" },
        createDeps(),
      );
    } catch {
      /* expected */
    }
    expect(errorSpy.mock.calls[0]?.[0]).toMatch(/1 and 200/);
    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("routes NOT_FOUND with a code-files hint", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    const service = createMockCodeNavigationService({
      grepFile: mock(() =>
        Promise.reject(
          new CodeNavigationTargetNotFoundError("File not found in repository"),
        ),
      ),
    });
    try {
      await pkgGrepAction(
        "npm:express",
        "middleware",
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
      grepFile: mock(() =>
        Promise.reject(
          new CodeNavigationIndexingError("Indexing...", "ref_abc"),
        ),
      ),
    });
    try {
      await pkgGrepAction(
        "npm:express",
        "middleware",
        "src/index.js",
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

  // ------------------------------------------------------------------
  // Exit-code contract (grep-style: 0 match / 1 no-match / 2 error)
  // ------------------------------------------------------------------

  it("exits 0 when there is at least one match", async () => {
    const writeSpy = spyOn(process.stdout, "write").mockImplementation(
      (() => true) as typeof process.stdout.write,
    );
    const exitSpy = spyOn(process, "exit").mockImplementation((() => {
      return undefined as never;
    }) as typeof process.exit);
    await pkgGrepAction(
      "npm:express",
      "middleware",
      "src/index.js",
      {},
      createDeps(),
    );
    // `defaultGrepFileResult` has one match — exit 0 means `process.exit`
    // was not called at all (happy path returns normally).
    expect(exitSpy.mock.calls.length).toBe(0);
    writeSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("exits 1 when there are zero matches (plain mode)", async () => {
    const writeSpy = spyOn(process.stdout, "write").mockImplementation(
      (() => true) as typeof process.stdout.write,
    );
    const exitCalls: number[] = [];
    // Intentionally non-throwing — `process.exit(1)` on zero matches
    // is the last statement in the happy path, so letting the mock
    // return keeps the action function's control flow clean.
    const exitSpy = spyOn(process, "exit").mockImplementation(((
      code?: number,
    ) => {
      exitCalls.push(code ?? 0);
      return undefined as never;
    }) as typeof process.exit);
    const service = createMockCodeNavigationService({
      grepFile: mock(() =>
        Promise.resolve({
          matches: [],
          totalMatches: 0,
          hasMore: false,
          filePath: "src/index.js",
          language: "javascript",
        }),
      ),
    });
    await pkgGrepAction(
      "npm:express",
      "nonexistent-pattern",
      "src/index.js",
      {},
      createDeps({ codeNavigationService: service }),
    );
    expect(exitCalls).toEqual([1]);
    writeSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("exits 1 when there are zero matches (--json mode)", async () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    const exitCalls: number[] = [];
    const exitSpy = spyOn(process, "exit").mockImplementation(((
      code?: number,
    ) => {
      exitCalls.push(code ?? 0);
      return undefined as never;
    }) as typeof process.exit);
    const service = createMockCodeNavigationService({
      grepFile: mock(() =>
        Promise.resolve({
          matches: [],
          totalMatches: 0,
          hasMore: false,
          filePath: "src/index.js",
        }),
      ),
    });
    await pkgGrepAction(
      "npm:express",
      "nonexistent",
      "src/index.js",
      { json: true },
      createDeps({ codeNavigationService: service }),
    );
    // JSON is logged BEFORE the exit-1 fires, so callers can still
    // parse it via `jq` even under `pipefail`.
    expect(logSpy.mock.calls.length).toBe(1);
    const payload = JSON.parse(logSpy.mock.calls[0]?.[0] as string);
    expect(payload.totalMatches).toBe(0);
    expect(exitCalls).toEqual([1]);
    logSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("exits 2 on error paths (distinct from 'no match' = 1)", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const exitCalls: number[] = [];
    const exitSpy = spyOn(process, "exit").mockImplementation(((
      code?: number,
    ) => {
      exitCalls.push(code ?? 0);
      throw new Error("process.exit");
    }) as typeof process.exit);
    const service = createMockCodeNavigationService({
      grepFile: mock(() =>
        Promise.reject(
          new CodeNavigationTargetNotFoundError("File not found in repository"),
        ),
      ),
    });
    try {
      await pkgGrepAction(
        "npm:express",
        "middleware",
        "nope.js",
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

  // ------------------------------------------------------------------
  // stdout vs stderr routing (plain mode)
  // ------------------------------------------------------------------

  it("plain mode hasMore: truncation warning goes to stderr, not stdout", async () => {
    const stdoutWrites: string[] = [];
    const stderrWrites: string[] = [];
    const stdoutSpy = spyOn(process.stdout, "write").mockImplementation(((
      chunk: string | Uint8Array,
    ) => {
      stdoutWrites.push(
        typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk),
      );
      return true;
    }) as typeof process.stdout.write);
    const stderrSpy = spyOn(process.stderr, "write").mockImplementation(((
      chunk: string | Uint8Array,
    ) => {
      stderrWrites.push(
        typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk),
      );
      return true;
    }) as typeof process.stderr.write);
    const service = createMockCodeNavigationService({
      grepFile: mock(() =>
        Promise.resolve({
          matches: [
            {
              lineNumber: 1,
              lineContent: "export const foo = 1;",
            },
          ],
          totalMatches: 50,
          hasMore: true,
          filePath: "src/index.js",
        }),
      ),
    });
    await pkgGrepAction(
      "npm:express",
      "foo",
      "src/index.js",
      {},
      createDeps({ codeNavigationService: service }),
    );
    const stdout = stdoutWrites.join("");
    const stderr = stderrWrites.join("");
    expect(stdout).toContain("export const foo");
    expect(stdout).not.toContain("More matches available");
    expect(stderr).toContain("More matches available");
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  it("plain mode zero-match with regex-shaped pattern: nudge goes to stderr", async () => {
    const stdoutWrites: string[] = [];
    const stderrWrites: string[] = [];
    const stdoutSpy = spyOn(process.stdout, "write").mockImplementation(((
      chunk: string | Uint8Array,
    ) => {
      stdoutWrites.push(
        typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk),
      );
      return true;
    }) as typeof process.stdout.write);
    const stderrSpy = spyOn(process.stderr, "write").mockImplementation(((
      chunk: string | Uint8Array,
    ) => {
      stderrWrites.push(
        typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk),
      );
      return true;
    }) as typeof process.stderr.write);
    const exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    const service = createMockCodeNavigationService({
      grepFile: mock(() =>
        Promise.resolve({
          matches: [],
          totalMatches: 0,
          hasMore: false,
          filePath: "src/index.js",
        }),
      ),
    });
    try {
      await pkgGrepAction(
        "npm:express",
        "\\bfoo\\b",
        "src/index.js",
        {},
        createDeps({ codeNavigationService: service }),
      );
    } catch {
      /* expected — exit 1 */
    }
    const stdout = stdoutWrites.join("");
    const stderr = stderrWrites.join("");
    // Plain mode stdout stays empty on zero matches.
    expect(stdout).toBe("");
    // Regex-hint nudge visible on stderr.
    expect(stderr).toContain("substring");
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
    exitSpy.mockRestore();
  });
});
