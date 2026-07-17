import { describe, expect, it, mock } from "bun:test";
import {
  CodeNavigationFileNotFoundError,
  CodeNavigationIndexingError,
  CodeNavigationTargetNotFoundError,
} from "@githits/core-internal";
import {
  createMockCodeNavigationService,
  defaultReadFileResult,
} from "../services/test-helpers.js";
import { createReadFileTool } from "./read-file.js";

function parseText(result: { content: Array<{ text: string }> }): unknown {
  return JSON.parse(result.content[0]?.text ?? "");
}

describe("createReadFileTool — metadata", () => {
  it("registers the correct tool name, description, and schema keys", () => {
    const tool = createReadFileTool(createMockCodeNavigationService());
    expect(tool.name).toBe("code_read");
    expect(tool.description).toContain(
      "Read one exact file from an indexed dependency",
    );
    expect(tool.description).toContain("does not list directories");
    expect(tool.description).toContain("NOT_FOUND");
    expect(Object.keys(tool.schema).sort()).toEqual([
      "end_line",
      "format",
      "path",
      "start_line",
      "target",
      "wait_timeout_ms",
    ]);
    expect(tool.annotations).toEqual({
      readOnlyHint: false,
      openWorldHint: false,
      destructiveHint: false,
    });
  });
});

describe("createReadFileTool — happy path", () => {
  it("calls readFile with the resolved target and file_path", async () => {
    const readFile = mock(() => Promise.resolve(defaultReadFileResult));
    const service = createMockCodeNavigationService({ readFile });
    const tool = createReadFileTool(service);

    await tool.handler(
      {
        target: { registry: "npm", package_name: "express" },
        path: "src/index.js",
      },
      {},
    );

    const calls = readFile.mock.calls as unknown as Array<
      [{ target: { registry?: string }; filePath: string }]
    >;
    expect(calls[0]?.[0]?.target?.registry).toBe("NPM");
    expect(calls[0]?.[0]?.filePath).toBe("src/index.js");
  });

  it("returns invalid argument for whitespace-only package registry", async () => {
    const readFile = mock(() => Promise.resolve(defaultReadFileResult));
    const service = createMockCodeNavigationService({ readFile });
    const tool = createReadFileTool(service);

    const result = await tool.handler(
      {
        target: { registry: " " as never, package_name: "express" },
        path: "src/index.js",
      },
      {},
    );

    expect(result.isError).toBe(true);
    expect(readFile).not.toHaveBeenCalled();
    expect(parseText(result)).toMatchObject({ code: "INVALID_ARGUMENT" });
  });

  it("accepts compact package string targets", async () => {
    const readFile = mock(() => Promise.resolve(defaultReadFileResult));
    const service = createMockCodeNavigationService({ readFile });
    const tool = createReadFileTool(service);

    await tool.handler(
      {
        target: "npm:express@4.18.2",
        path: "src/index.js",
      },
      {},
    );

    const calls = readFile.mock.calls as unknown as Array<
      [
        {
          target: { registry?: string; packageName?: string; version?: string };
        },
      ]
    >;
    expect(calls[0]?.[0]?.target).toMatchObject({
      registry: "NPM",
      packageName: "express",
      version: "4.18.2",
    });
  });

  it("emits the envelope with content + line range when format=json", async () => {
    const tool = createReadFileTool(createMockCodeNavigationService());
    const result = await tool.handler(
      {
        target: { registry: "npm", package_name: "express" },
        path: "src/index.js",
        format: "json",
      },
      {},
    );
    expect(result.isError).toBeUndefined();
    const payload = parseText(result) as {
      path: string;
      language: string;
      totalLines: number;
      startLine: number;
      endLine: number;
      content: string;
      isBinary?: boolean;
    };
    expect(payload.path).toBe("src/index.js");
    expect(payload.language).toBe("javascript");
    expect(payload.totalLines).toBe(5);
    expect(payload.content).toContain("Express entry point");
    expect(payload.isBinary).toBeUndefined();
  });

  it("defaults to line-numbered text output", async () => {
    const tool = createReadFileTool(createMockCodeNavigationService());
    const result = await tool.handler(
      {
        target: { registry: "npm", package_name: "express" },
        path: "src/index.js",
      },
      {},
    );
    const text = result.content[0]?.text ?? "";
    expect(text).toContain("code_read | src/index.js | javascript");
    expect(text).toContain("1  // Express entry point");
    expect(() => JSON.parse(text)).toThrow();
  });

  it("passes start_line / end_line through to the wire", async () => {
    const readFile = mock(() => Promise.resolve(defaultReadFileResult));
    const service = createMockCodeNavigationService({ readFile });
    const tool = createReadFileTool(service);

    await tool.handler(
      {
        target: { registry: "npm", package_name: "express" },
        path: "src/index.js",
        start_line: 10,
        end_line: 20,
      },
      {},
    );

    const calls = readFile.mock.calls as unknown as Array<
      [{ startLine?: number; endLine?: number }]
    >;
    expect(calls[0]?.[0]?.startLine).toBe(10);
    expect(calls[0]?.[0]?.endLine).toBe(20);
  });

  it("emits isBinary + omits content for binary files", async () => {
    const tool = createReadFileTool(
      createMockCodeNavigationService({
        readFile: mock(() =>
          Promise.resolve({
            filePath: "assets/logo.png",
            isBinary: true,
          }),
        ),
      }),
    );
    const result = await tool.handler(
      {
        target: { registry: "npm", package_name: "express" },
        path: "assets/logo.png",
        format: "json",
      },
      {},
    );
    const payload = parseText(result) as {
      isBinary?: boolean;
      content?: string;
    };
    expect(payload.isBinary).toBe(true);
    expect(payload.content).toBeUndefined();
  });

  it("emits targetResolution provenance and retry candidates", async () => {
    const tool = createReadFileTool(
      createMockCodeNavigationService({
        readFile: mock(() =>
          Promise.resolve({
            ...defaultReadFileResult,
            targetResolution: {
              requested: {
                repoUrl: "https://github.com/expressjs/express",
                gitRef: "HEAD",
              },
              resolvedRequested: {
                repoUrl: "https://github.com/expressjs/express",
                gitRef: "main",
                commitSha: "def456789abc",
              },
              served: {
                repoUrl: "https://github.com/expressjs/express",
                gitRef: "main",
                commitSha: "abc123789def",
              },
              freshness: "fallback_recent",
              freshnessReason: "ref_resolution_deferred",
              availableVersions: [],
              availableRefs: [{ ref: "main" }],
            },
          }),
        ),
      }),
    );
    const result = await tool.handler(
      {
        target: "https://github.com/expressjs/express#HEAD",
        path: "src/index.js",
      },
      {},
    );

    const text = result.content[0]?.text ?? "";
    expect(text).toContain(
      "Using recent indexed snapshot while branch resolution is deferred",
    );
    expect(text).toContain("queryable now: refs=main");
  });
});

describe("createReadFileTool — validation errors", () => {
  it("returns INVALID_ARGUMENT when file_path is missing", async () => {
    const tool = createReadFileTool(createMockCodeNavigationService());
    const result = await tool.handler(
      {
        target: { registry: "npm", package_name: "express" },
        path: "   ",
      },
      {},
    );
    expect(result.isError).toBe(true);
    expect((parseText(result) as { code: string }).code).toBe(
      "INVALID_ARGUMENT",
    );
  });

  it("returns INVALID_ARGUMENT for a reversed range", async () => {
    const tool = createReadFileTool(createMockCodeNavigationService());
    const result = await tool.handler(
      {
        target: { registry: "npm", package_name: "express" },
        path: "src/index.js",
        start_line: 40,
        end_line: 10,
      },
      {},
    );
    expect(result.isError).toBe(true);
    const payload = parseText(result) as { code: string; error: string };
    expect(payload.code).toBe("INVALID_ARGUMENT");
    expect(payload.error).toContain("reversed");
  });

  it("returns INVALID_ARGUMENT for start_line=0 via envelope (not raw Zod)", async () => {
    const tool = createReadFileTool(createMockCodeNavigationService());
    const result = await tool.handler(
      {
        target: { registry: "npm", package_name: "express" },
        path: "src/index.js",
        start_line: 0,
      },
      {},
    );
    expect(result.isError).toBe(true);
    expect((parseText(result) as { code: string }).code).toBe(
      "INVALID_ARGUMENT",
    );
  });

  it("returns INVALID_ARGUMENT for directory prefixes without calling readFile", async () => {
    const readFile = mock(() => Promise.resolve(defaultReadFileResult));
    const tool = createReadFileTool(
      createMockCodeNavigationService({ readFile }),
    );
    const result = await tool.handler(
      {
        target: { registry: "npm", package_name: "express" },
        path: "lib/",
      },
      {},
    );
    expect(result.isError).toBe(true);
    const payload = parseText(result) as { code: string; error: string };
    expect(payload.code).toBe("INVALID_ARGUMENT");
    expect(payload.error).toContain("exact file path");
    expect(payload.error).toContain('path_prefix: "lib/"');
    expect(readFile).not.toHaveBeenCalled();
  });
});

describe("createReadFileTool — service errors", () => {
  it("classifies CodeNavigationFileNotFoundError as FILE_NOT_FOUND", async () => {
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
    const tool = createReadFileTool(service);
    const result = await tool.handler(
      {
        target: { registry: "npm", package_name: "express" },
        path: "nope.js",
      },
      {},
    );
    expect(result.isError).toBe(true);
    const payload = parseText(result) as {
      code: string;
      details?: { action?: string; filePath?: string };
    };
    expect(payload.code).toBe("FILE_NOT_FOUND");
    expect(payload.details?.filePath).toBe("nope.js");
    expect(payload.details?.action).toContain("`code_files`");
    expect(payload.details?.action).toContain('path_prefix: ""');
    expect(payload.details?.action).toContain("emitted `path`");
  });

  it("points directory-looking NOT_FOUND errors at code_files path_prefix", async () => {
    const service = createMockCodeNavigationService({
      readFile: mock(() =>
        Promise.reject(
          new CodeNavigationTargetNotFoundError("File not found in repository"),
        ),
      ),
    });
    const tool = createReadFileTool(service);
    const result = await tool.handler(
      {
        target: { registry: "npm", package_name: "express" },
        path: "lib",
      },
      {},
    );
    expect(result.isError).toBe(true);
    const payload = parseText(result) as {
      code: string;
      details?: { action?: string };
    };
    expect(payload.code).toBe("NOT_FOUND");
    expect(payload.details?.action).toContain("reads files only");
    expect(payload.details?.action).toContain('path_prefix: "lib/"');
  });

  it("classifies CodeNavigationIndexingError as INDEXING", async () => {
    const service = createMockCodeNavigationService({
      readFile: mock(() =>
        Promise.reject(
          new CodeNavigationIndexingError("Indexing...", "ref_abc"),
        ),
      ),
    });
    const tool = createReadFileTool(service);
    const result = await tool.handler(
      {
        target: { registry: "npm", package_name: "express" },
        path: "src/index.js",
      },
      {},
    );
    expect(result.isError).toBe(true);
    expect((parseText(result) as { code: string }).code).toBe("INDEXING");
  });
});

describe("createReadFileTool — span cap", () => {
  it("clamps no-range request to 1..MCP_READ_MAX_SPAN before calling backend", async () => {
    const readFile = mock(() => Promise.resolve(defaultReadFileResult));
    const tool = createReadFileTool(
      createMockCodeNavigationService({ readFile }),
    );
    await tool.handler(
      {
        target: { registry: "npm", package_name: "express" },
        path: "src/index.js",
      },
      {},
    );
    const calls = readFile.mock.calls as unknown as Array<
      [{ startLine?: number; endLine?: number }]
    >;
    expect(calls[0]?.[0]?.startLine).toBe(1);
    expect(calls[0]?.[0]?.endLine).toBe(150);
  });

  it("clamps a wide explicit range to start..start+149", async () => {
    const readFile = mock(() => Promise.resolve(defaultReadFileResult));
    const tool = createReadFileTool(
      createMockCodeNavigationService({ readFile }),
    );
    await tool.handler(
      {
        target: { registry: "npm", package_name: "express" },
        path: "src/index.js",
        start_line: 200,
        end_line: 600,
      },
      {},
    );
    const calls = readFile.mock.calls as unknown as Array<
      [{ startLine?: number; endLine?: number }]
    >;
    expect(calls[0]?.[0]?.startLine).toBe(200);
    expect(calls[0]?.[0]?.endLine).toBe(349);
  });

  it("clamps start-only request to start..start+149", async () => {
    const readFile = mock(() => Promise.resolve(defaultReadFileResult));
    const tool = createReadFileTool(
      createMockCodeNavigationService({ readFile }),
    );
    await tool.handler(
      {
        target: { registry: "npm", package_name: "express" },
        path: "src/index.js",
        start_line: 100,
      },
      {},
    );
    const calls = readFile.mock.calls as unknown as Array<
      [{ startLine?: number; endLine?: number }]
    >;
    expect(calls[0]?.[0]?.startLine).toBe(100);
    expect(calls[0]?.[0]?.endLine).toBe(249);
  });

  it("does not clamp ranges within the cap", async () => {
    const readFile = mock(() => Promise.resolve(defaultReadFileResult));
    const tool = createReadFileTool(
      createMockCodeNavigationService({ readFile }),
    );
    await tool.handler(
      {
        target: { registry: "npm", package_name: "express" },
        path: "src/index.js",
        start_line: 10,
        end_line: 80,
      },
      {},
    );
    const calls = readFile.mock.calls as unknown as Array<
      [{ startLine?: number; endLine?: number }]
    >;
    expect(calls[0]?.[0]?.startLine).toBe(10);
    expect(calls[0]?.[0]?.endLine).toBe(80);
  });

  // Hint tests need a backend that actually returns a >150-line span;
  // the default 5-line mock would make the cap a no-op and the hint
  // would (correctly) be suppressed.
  function wideFileMock(
    overrides: {
      startLine?: number;
      endLine?: number;
      totalLines?: number;
    } = {},
  ) {
    const start = overrides.startLine ?? 1;
    const end = overrides.endLine ?? 150;
    const total = overrides.totalLines ?? 5000;
    return mock(() =>
      Promise.resolve({
        filePath: "src/index.js",
        language: "javascript",
        totalLines: total,
        startLine: start,
        endLine: end,
        content: "// big file\n".repeat(end - start + 1),
        isBinary: false,
      }),
    );
  }

  it("emits hint with actual returned range and original request when capping", async () => {
    const tool = createReadFileTool(
      createMockCodeNavigationService({
        readFile: wideFileMock({
          startLine: 1,
          endLine: 150,
          totalLines: 5000,
        }),
      }),
    );
    const result = await tool.handler(
      {
        target: { registry: "npm", package_name: "express" },
        path: "src/index.js",
        start_line: 1,
        end_line: 600,
        format: "json",
      },
      {},
    );
    const payload = parseText(result) as { hint?: string };
    expect(payload.hint).toBeDefined();
    // Returned range comes from the payload (1-150/5000), not the
    // pre-clamp request — pre-Codex-fix this rendered the impossible
    // "1-150/5" against the 5-line mock.
    expect(payload.hint).toContain("Returned lines 1-150/5000");
    expect(payload.hint).toContain("MCP cap: 150 lines");
    expect(payload.hint).toContain("you requested lines 1-600");
    // Concrete next-call suggestion removes the math-on-the-agent.
    expect(payload.hint).toContain("retry with start_line=151");
    expect(payload.hint).toContain("80-150 lines");
    expect(payload.hint).toContain("retry also costs context");
  });

  it("emits hint with 'no range' wording when caller passed nothing", async () => {
    const tool = createReadFileTool(
      createMockCodeNavigationService({
        readFile: wideFileMock(),
      }),
    );
    const result = await tool.handler(
      {
        target: { registry: "npm", package_name: "express" },
        path: "src/index.js",
        format: "json",
      },
      {},
    );
    const payload = parseText(result) as { hint?: string };
    expect(payload.hint).toContain("you requested no range");
  });

  it("does not emit hint when range is within the cap", async () => {
    const tool = createReadFileTool(createMockCodeNavigationService());
    const result = await tool.handler(
      {
        target: { registry: "npm", package_name: "express" },
        path: "src/index.js",
        start_line: 10,
        end_line: 80,
        format: "json",
      },
      {},
    );
    const payload = parseText(result) as { hint?: string };
    expect(payload.hint).toBeUndefined();
  });

  it("does not emit hint when the cap was a no-op (file fits within cap)", async () => {
    // Default 5-line mock: caller passed no range, cap clamped the
    // request to 1..150 but the backend returned the whole 5-line
    // file. No actual truncation happened — hint would point at
    // nonexistent lines (Codex review P2).
    const tool = createReadFileTool(createMockCodeNavigationService());
    const result = await tool.handler(
      {
        target: { registry: "npm", package_name: "express" },
        path: "src/index.js",
        format: "json",
      },
      {},
    );
    const payload = parseText(result) as { hint?: string };
    expect(payload.hint).toBeUndefined();
  });

  it("does not emit hint when the returned range reaches end of file", async () => {
    // Caller asked 100-600 against a 200-line file. Cap clamped the
    // request to 100..249, backend returned 100..200 (EOF). The
    // agent has all the available content already; hint would just
    // suggest narrower windows that wouldn't help.
    const tool = createReadFileTool(
      createMockCodeNavigationService({
        readFile: wideFileMock({
          startLine: 100,
          endLine: 200,
          totalLines: 200,
        }),
      }),
    );
    const result = await tool.handler(
      {
        target: { registry: "npm", package_name: "express" },
        path: "src/index.js",
        start_line: 100,
        end_line: 600,
        format: "json",
      },
      {},
    );
    const payload = parseText(result) as { hint?: string };
    expect(payload.hint).toBeUndefined();
  });

  it("does not emit hint for binary files even when no range was supplied", async () => {
    const tool = createReadFileTool(
      createMockCodeNavigationService({
        readFile: mock(() =>
          Promise.resolve({
            filePath: "assets/logo.png",
            isBinary: true,
          }),
        ),
      }),
    );
    const result = await tool.handler(
      {
        target: { registry: "npm", package_name: "express" },
        path: "assets/logo.png",
        format: "json",
      },
      {},
    );
    const payload = parseText(result) as { hint?: string };
    expect(payload.hint).toBeUndefined();
  });
});
