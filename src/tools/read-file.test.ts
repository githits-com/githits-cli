import { describe, expect, it, mock } from "bun:test";
import {
  CodeNavigationFileNotFoundError,
  CodeNavigationIndexingError,
} from "../services/index.js";
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
    expect(tool.name).toBe("read_file");
    expect(tool.description).toContain(
      "Read a file from an indexed dependency",
    );
    expect(tool.description).toContain("NOT_FOUND");
    expect(Object.keys(tool.schema).sort()).toEqual([
      "end_line",
      "path",
      "start_line",
      "target",
      "wait_timeout_ms",
    ]);
    expect(tool.annotations?.readOnlyHint).toBe(true);
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

  it("emits the envelope with content + line range", async () => {
    const tool = createReadFileTool(createMockCodeNavigationService());
    const result = await tool.handler(
      {
        target: { registry: "npm", package_name: "express" },
        path: "src/index.js",
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
      details?: { filePath?: string };
    };
    expect(payload.code).toBe("FILE_NOT_FOUND");
    expect(payload.details?.filePath).toBe("nope.js");
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
