import { describe, expect, it, mock, spyOn } from "bun:test";
import {
  CodeNavigationIndexingError,
  CodeNavigationTargetNotFoundError,
} from "../../services/code-navigation-service.js";
import { AuthenticationError } from "../../services/githits-service.js";
import {
  createMockCodeNavigationService,
  defaultListFilesResult,
} from "../../services/test-helpers.js";
import { type PkgFilesCommandDependencies, pkgFilesAction } from "./files.js";

describe("pkgFilesAction", () => {
  const mcpUrl = "https://mcp.githits.com";

  function createDeps(
    overrides: Partial<PkgFilesCommandDependencies> = {},
  ): PkgFilesCommandDependencies {
    return {
      codeNavigationService: createMockCodeNavigationService(),
      codeNavigationUrl: "https://pkgseer.dev",
      hasValidToken: true,
      mcpUrl,
      ...overrides,
    };
  }

  it("renders default plain stdout = bare paths only", async () => {
    const writes: string[] = [];
    const writeSpy = spyOn(process.stdout, "write").mockImplementation(((
      chunk: string | Uint8Array,
    ) => {
      writes.push(
        typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk),
      );
      return true;
    }) as typeof process.stdout.write);

    await pkgFilesAction("npm:express", undefined, {}, createDeps());

    const combined = writes.join("");
    expect(combined).toContain("src/index.js");
    expect(combined).toContain("src/lib/app.js");
    // Plain mode: no header on stdout — pipes stay clean.
    expect(combined).not.toContain("express · npm");
    expect(combined).not.toContain("2 files");
    writeSpy.mockRestore();
  });

  it("default plain output has paths only — no classification", async () => {
    const writes: string[] = [];
    const writeSpy = spyOn(process.stdout, "write").mockImplementation(((
      chunk: string | Uint8Array,
    ) => {
      writes.push(
        typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk),
      );
      return true;
    }) as typeof process.stdout.write);

    await pkgFilesAction("npm:express", undefined, {}, createDeps());

    const combined = writes.join("");
    // Classification labels (language/fileType/byteSize) are
    // verbose-only — absent from the default output.
    expect(combined).not.toMatch(/javascript/i);
    expect(combined).not.toContain("KB");
    writeSpy.mockRestore();
  });

  it("verbose output includes classification annotations", async () => {
    const writes: string[] = [];
    const writeSpy = spyOn(process.stdout, "write").mockImplementation(((
      chunk: string | Uint8Array,
    ) => {
      writes.push(
        typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk),
      );
      return true;
    }) as typeof process.stdout.write);

    await pkgFilesAction(
      "npm:express",
      undefined,
      { verbose: true },
      createDeps(),
    );

    const combined = writes.join("");
    // `defaultListFilesResult` includes language metadata; verbose
    // mode surfaces it inline.
    expect(combined).toMatch(/javascript/i);
    writeSpy.mockRestore();
  });

  it("forwards positional path-prefix to the service", async () => {
    const listFiles = mock(() => Promise.resolve(defaultListFilesResult));
    const service = createMockCodeNavigationService({ listFiles });
    const writeSpy = spyOn(process.stdout, "write").mockImplementation(
      (() => true) as typeof process.stdout.write,
    );
    await pkgFilesAction(
      "npm:express",
      "src/middleware",
      {},
      createDeps({ codeNavigationService: service }),
    );
    const calls = listFiles.mock.calls as unknown as Array<
      [{ pathPrefix?: string }]
    >;
    expect(calls[0]?.[0]?.pathPrefix).toBe("src/middleware");
    writeSpy.mockRestore();
  });

  it("forwards positional path-prefix in --repo-url mode", async () => {
    const listFiles = mock(() => Promise.resolve(defaultListFilesResult));
    const service = createMockCodeNavigationService({ listFiles });
    const writeSpy = spyOn(process.stdout, "write").mockImplementation(
      (() => true) as typeof process.stdout.write,
    );
    await pkgFilesAction(
      "lib/",
      undefined,
      {
        repoUrl: "https://github.com/expressjs/express",
        gitRef: "main",
      },
      createDeps({ codeNavigationService: service }),
    );
    const calls = listFiles.mock.calls as unknown as Array<
      [{ pathPrefix?: string; target: { repoUrl?: string } }]
    >;
    expect(calls[0]?.[0]?.pathPrefix).toBe("lib/");
    expect(calls[0]?.[0]?.target.repoUrl).toBe(
      "https://github.com/expressjs/express",
    );
    writeSpy.mockRestore();
  });

  it("forwards advanced file filters to the service", async () => {
    const listFiles = mock(() => Promise.resolve(defaultListFilesResult));
    const service = createMockCodeNavigationService({ listFiles });
    const writeSpy = spyOn(process.stdout, "write").mockImplementation(
      (() => true) as typeof process.stdout.write,
    );
    await pkgFilesAction(
      "npm:express",
      "src/",
      {
        path: "README.md",
        glob: ["test/**/*.js"],
        ext: ["js"],
        fileType: ["source"],
        language: ["JavaScript"],
        fileIntent: ["production", "test"],
        excludeIntent: ["generated"],
        excludeDocs: true,
        excludeTests: false,
        hidden: true,
      },
      createDeps({ codeNavigationService: service }),
    );
    const calls = listFiles.mock.calls as unknown as Array<
      [
        {
          pathSelectors?: Array<{ kind: string; value: string }>;
          pathPrefix?: string;
          extensions?: string[];
          fileTypes?: string[];
          languages?: string[];
          fileIntents?: string[];
          excludeFileIntents?: string[];
          excludeDocFiles?: boolean;
          excludeTestFiles?: boolean;
          includeHidden?: boolean;
        },
      ]
    >;
    expect(calls[0]?.[0]).toMatchObject({
      pathSelectors: [
        { kind: "EXACT", value: "README.md" },
        { kind: "GLOB", value: "test/**/*.js" },
      ],
      pathPrefix: "src/",
      extensions: ["js"],
      fileTypes: ["source"],
      languages: ["JavaScript"],
      fileIntents: ["PRODUCTION", "TEST"],
      excludeFileIntents: ["GENERATED"],
      excludeDocFiles: true,
      excludeTestFiles: false,
      includeHidden: true,
    });
    writeSpy.mockRestore();
  });

  it("rejects a second positional in --repo-url mode", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    try {
      await pkgFilesAction(
        "lib/",
        "extra",
        { repoUrl: "https://github.com/x/y", gitRef: "main" },
        createDeps(),
      );
    } catch {
      /* expected */
    }
    expect(errorSpy.mock.calls[0]?.[0]).toMatch(/--repo-url mode/);
    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it.each([
    "rubygems:rails",
    "go:golang.org/x/text",
  ])("rejects package spec %s in --repo-url mode", async (spec) => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    try {
      await pkgFilesAction(
        spec,
        undefined,
        { repoUrl: "https://github.com/x/y", gitRef: "main" },
        createDeps(),
      );
    } catch {
      /* expected */
    }
    expect(errorSpy.mock.calls[0]?.[0]).toContain("looks like a package spec");
    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("emits the JSON envelope with --json", async () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    await pkgFilesAction(
      "npm:express",
      undefined,
      { json: true },
      createDeps(),
    );
    const payload = JSON.parse(logSpy.mock.calls[0]?.[0] as string);
    expect(payload.registry).toBe("npm");
    expect(payload.name).toBe("express");
    expect(payload.total).toBe(2);
    expect(payload.files[0].path).toBe("src/index.js");
    logSpy.mockRestore();
  });

  it("preserves CLI auth remediation for service auth failures", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    const service = createMockCodeNavigationService({
      listFiles: mock(() => Promise.reject(new AuthenticationError())),
    });

    try {
      await pkgFilesAction(
        "npm:express",
        undefined,
        {},
        createDeps({ codeNavigationService: service }),
      );
    } catch {
      // expected
    }

    expect(errorSpy.mock.calls[0]?.[0]).toBe(
      "Authentication required. Run `githits login` to authenticate or set GITHITS_API_TOKEN.",
    );
    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("preserves CLI auth remediation in JSON service auth failures", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    const service = createMockCodeNavigationService({
      listFiles: mock(() => Promise.reject(new AuthenticationError())),
    });

    try {
      await pkgFilesAction(
        "npm:express",
        undefined,
        { json: true },
        createDeps({ codeNavigationService: service }),
      );
    } catch {
      // expected
    }

    expect(JSON.parse(errorSpy.mock.calls[0]?.[0] as string)).toEqual({
      error: "Authentication required.",
      code: "AUTH_REQUIRED",
      retryable: false,
      details: { authSource: "local" },
    });
    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("echoes advanced filters in the JSON envelope", async () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    await pkgFilesAction(
      "npm:express",
      "src/",
      {
        path: "README.md",
        glob: ["test/**/*.js"],
        ext: ["js"],
        fileType: ["source"],
        language: ["JavaScript"],
        fileIntent: ["production", "test"],
        excludeIntent: ["generated"],
        excludeDocs: true,
        hidden: true,
        json: true,
      },
      createDeps(),
    );
    const payload = JSON.parse(logSpy.mock.calls[0]?.[0] as string);
    expect(payload.filter).toEqual({
      path: "README.md",
      pathPrefix: "src/",
      globs: ["test/**/*.js"],
      extensions: ["js"],
      fileTypes: ["source"],
      languages: ["JavaScript"],
      fileIntents: ["production", "test"],
      excludeFileIntents: ["generated"],
      excludeDocFiles: true,
      includeHidden: true,
    });
    logSpy.mockRestore();
  });

  it("sends waitTimeoutMs defaulting to DEFAULT_WAIT_TIMEOUT_MS (20000)", async () => {
    const listFiles = mock(() => Promise.resolve(defaultListFilesResult));
    const service = createMockCodeNavigationService({ listFiles });
    const writeSpy = spyOn(process.stdout, "write").mockImplementation(
      (() => true) as typeof process.stdout.write,
    );
    await pkgFilesAction(
      "npm:express",
      undefined,
      {},
      createDeps({ codeNavigationService: service }),
    );
    const calls = listFiles.mock.calls as unknown as Array<
      [{ waitTimeoutMs?: number }]
    >;
    expect(calls[0]?.[0]?.waitTimeoutMs).toBe(20000);
    writeSpy.mockRestore();
  });

  it("sends an explicit --wait value on the wire", async () => {
    const listFiles = mock(() => Promise.resolve(defaultListFilesResult));
    const service = createMockCodeNavigationService({ listFiles });
    const writeSpy = spyOn(process.stdout, "write").mockImplementation(
      (() => true) as typeof process.stdout.write,
    );
    await pkgFilesAction(
      "npm:express",
      undefined,
      { wait: "5000" },
      createDeps({ codeNavigationService: service }),
    );
    const calls = listFiles.mock.calls as unknown as Array<
      [{ waitTimeoutMs?: number }]
    >;
    expect(calls[0]?.[0]?.waitTimeoutMs).toBe(5000);
    writeSpy.mockRestore();
  });

  it("sends repo-url addressing when --repo-url + --git-ref are set", async () => {
    const listFiles = mock(() => Promise.resolve(defaultListFilesResult));
    const service = createMockCodeNavigationService({ listFiles });
    const writeSpy = spyOn(process.stdout, "write").mockImplementation(
      (() => true) as typeof process.stdout.write,
    );
    await pkgFilesAction(
      undefined,
      undefined,
      {
        repoUrl: "https://github.com/expressjs/express",
        gitRef: "main",
      },
      createDeps({ codeNavigationService: service }),
    );
    const calls = listFiles.mock.calls as unknown as Array<
      [{ target: { registry?: string; repoUrl?: string; gitRef?: string } }]
    >;
    expect(calls[0]?.[0]?.target.registry).toBeUndefined();
    expect(calls[0]?.[0]?.target.repoUrl).toBe(
      "https://github.com/expressjs/express",
    );
    expect(calls[0]?.[0]?.target.gitRef).toBe("main");
    writeSpy.mockRestore();
  });

  it("rejects spec + --repo-url together", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    try {
      await pkgFilesAction(
        "npm:express",
        undefined,
        { repoUrl: "https://github.com/x/y", gitRef: "main" },
        createDeps(),
      );
    } catch {
      /* expected */
    }
    expect(errorSpy.mock.calls[0]?.[0]).toMatch(/not both/);
    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("allows --repo-url without --git-ref for default-branch intent", async () => {
    const listFiles = mock(() => Promise.resolve(defaultListFilesResult));
    const service = createMockCodeNavigationService({ listFiles });
    const writeSpy = spyOn(process.stdout, "write").mockImplementation(
      (() => true) as typeof process.stdout.write,
    );

    await pkgFilesAction(
      undefined,
      undefined,
      { repoUrl: "https://github.com/x/y" },
      createDeps({ codeNavigationService: service }),
    );

    const calls = listFiles.mock.calls as unknown as Array<
      [{ target: { repoUrl?: string; gitRef?: string } }]
    >;
    expect(calls[0]?.[0]?.target.repoUrl).toBe("https://github.com/x/y");
    expect(calls[0]?.[0]?.target.gitRef).toBeUndefined();
    writeSpy.mockRestore();
  });

  it("rejects missing addressing entirely", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    try {
      await pkgFilesAction(undefined, undefined, {}, createDeps());
    } catch {
      /* expected */
    }
    expect(errorSpy.mock.calls[0]?.[0]).toMatch(/required/);
    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("rejects --limit out of range", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    try {
      await pkgFilesAction(
        "npm:express",
        undefined,
        { limit: "1001" },
        createDeps(),
      );
    } catch {
      /* expected */
    }
    expect(errorSpy.mock.calls[0]?.[0]).toMatch(/1 and 1000/);
    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("enriches INDEXING error with indexingRef + already-indexed versions", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    const service = createMockCodeNavigationService({
      listFiles: mock(() =>
        Promise.reject(
          new CodeNavigationIndexingError(
            "Target is still indexing.",
            "ref_xyz",
            [
              { version: "4.21.0", ref: "v4.21.0" },
              { version: "4.20.1", ref: "v4.20.1" },
            ],
          ),
        ),
      ),
    });
    try {
      await pkgFilesAction(
        "npm:express",
        undefined,
        {},
        createDeps({ codeNavigationService: service }),
      );
    } catch {
      /* expected */
    }
    const output = errorSpy.mock.calls[0]?.[0] as string;
    expect(output).toContain("indexing");
    expect(output).toContain("indexingRef: ref_xyz");
    expect(output).toContain("already-indexed versions: 4.21.0, 4.20.1");
    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("routes NOT_FOUND through --json error envelope", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    const service = createMockCodeNavigationService({
      listFiles: mock(() =>
        Promise.reject(
          new CodeNavigationTargetNotFoundError("Package not found"),
        ),
      ),
    });
    try {
      await pkgFilesAction(
        "npm:ghost",
        undefined,
        { json: true },
        createDeps({ codeNavigationService: service }),
      );
    } catch {
      /* expected */
    }
    const payload = JSON.parse(errorSpy.mock.calls[0]?.[0] as string);
    expect(payload.code).toBe("NOT_FOUND");
    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });
});
