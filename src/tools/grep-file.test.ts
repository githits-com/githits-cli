import { describe, expect, it, mock } from "bun:test";
import {
  CodeNavigationIndexingError,
  CodeNavigationTargetNotFoundError,
} from "../services/index.js";
import {
  createMockCodeNavigationService,
  defaultGrepFileResult,
} from "../services/test-helpers.js";
import { createGrepFileTool } from "./grep-file.js";

function parseText(result: { content: Array<{ text: string }> }): unknown {
  return JSON.parse(result.content[0]?.text ?? "");
}

describe("createGrepFileTool — metadata", () => {
  it("registers the correct tool name, description, and schema keys", () => {
    const tool = createGrepFileTool(createMockCodeNavigationService());
    expect(tool.name).toBe("grep_file");
    expect(tool.description).toContain("case-insensitive substring");
    expect(tool.description).toContain("not regex");
    expect(Object.keys(tool.schema).sort()).toEqual([
      "context_lines",
      "max_matches",
      "path",
      "pattern",
      "target",
      "wait_timeout_ms",
    ]);
    expect(tool.annotations?.readOnlyHint).toBe(true);
  });
});

describe("createGrepFileTool — happy path", () => {
  it("calls grepFile with the resolved target, path, pattern", async () => {
    const grepFile = mock(() => Promise.resolve(defaultGrepFileResult));
    const service = createMockCodeNavigationService({ grepFile });
    const tool = createGrepFileTool(service);

    await tool.handler(
      {
        target: { registry: "npm", package_name: "express" },
        path: "src/index.js",
        pattern: "middleware",
      },
      {},
    );

    const calls = grepFile.mock.calls as unknown as Array<
      [{ target: { registry?: string }; path: string; pattern: string }]
    >;
    expect(calls[0]?.[0]?.target?.registry).toBe("NPM");
    expect(calls[0]?.[0]?.path).toBe("src/index.js");
    expect(calls[0]?.[0]?.pattern).toBe("middleware");
  });

  it("emits envelope with matches + metadata", async () => {
    const tool = createGrepFileTool(createMockCodeNavigationService());
    const result = await tool.handler(
      {
        target: { registry: "npm", package_name: "express" },
        path: "src/index.js",
        pattern: "express();",
      },
      {},
    );
    const payload = parseText(result) as {
      registry: string;
      pattern: string;
      path: string;
      totalMatches: number;
      matches: Array<{ lineNumber: number }>;
    };
    expect(payload.registry).toBe("npm");
    expect(payload.pattern).toBe("express();");
    expect(payload.path).toBe("src/index.js");
    expect(payload.totalMatches).toBe(1);
    expect(payload.matches[0]?.lineNumber).toBe(4);
  });

  it("emits filter.contextLines + filter.maxMatches when explicit", async () => {
    const tool = createGrepFileTool(createMockCodeNavigationService());
    const result = await tool.handler(
      {
        target: { registry: "npm", package_name: "express" },
        path: "src/index.js",
        pattern: "middleware",
        context_lines: 5,
        max_matches: 100,
      },
      {},
    );
    const payload = parseText(result) as {
      filter?: { contextLines?: number; maxMatches?: number };
    };
    expect(payload.filter).toEqual({ contextLines: 5, maxMatches: 100 });
  });
});

describe("createGrepFileTool — validation errors", () => {
  it("returns INVALID_ARGUMENT for empty pattern", async () => {
    const tool = createGrepFileTool(createMockCodeNavigationService());
    const result = await tool.handler(
      {
        target: { registry: "npm", package_name: "express" },
        path: "src/index.js",
        pattern: "",
      },
      {},
    );
    expect(result.isError).toBe(true);
    expect((parseText(result) as { code: string }).code).toBe(
      "INVALID_ARGUMENT",
    );
  });

  it("returns INVALID_ARGUMENT for empty path", async () => {
    const tool = createGrepFileTool(createMockCodeNavigationService());
    const result = await tool.handler(
      {
        target: { registry: "npm", package_name: "express" },
        path: "   ",
        pattern: "middleware",
      },
      {},
    );
    expect(result.isError).toBe(true);
    expect((parseText(result) as { code: string }).code).toBe(
      "INVALID_ARGUMENT",
    );
  });

  it("returns INVALID_ARGUMENT for pattern > 200 chars", async () => {
    const tool = createGrepFileTool(createMockCodeNavigationService());
    const result = await tool.handler(
      {
        target: { registry: "npm", package_name: "express" },
        path: "src/index.js",
        pattern: "a".repeat(201),
      },
      {},
    );
    expect(result.isError).toBe(true);
    const payload = parseText(result) as { code: string; error: string };
    expect(payload.code).toBe("INVALID_ARGUMENT");
    expect(payload.error).toContain("200");
  });

  it("returns INVALID_ARGUMENT for context_lines out of range", async () => {
    const tool = createGrepFileTool(createMockCodeNavigationService());
    const result = await tool.handler(
      {
        target: { registry: "npm", package_name: "express" },
        path: "src/index.js",
        pattern: "middleware",
        context_lines: 11,
      },
      {},
    );
    expect(result.isError).toBe(true);
    expect((parseText(result) as { code: string }).code).toBe(
      "INVALID_ARGUMENT",
    );
  });
});

describe("createGrepFileTool — service errors", () => {
  it("classifies CodeNavigationIndexingError as INDEXING", async () => {
    const service = createMockCodeNavigationService({
      grepFile: mock(() =>
        Promise.reject(
          new CodeNavigationIndexingError("Indexing...", "ref_abc"),
        ),
      ),
    });
    const tool = createGrepFileTool(service);
    const result = await tool.handler(
      {
        target: { registry: "npm", package_name: "express" },
        path: "src/index.js",
        pattern: "middleware",
      },
      {},
    );
    expect(result.isError).toBe(true);
    expect((parseText(result) as { code: string }).code).toBe("INDEXING");
  });

  it("classifies CodeNavigationTargetNotFoundError as NOT_FOUND", async () => {
    const service = createMockCodeNavigationService({
      grepFile: mock(() =>
        Promise.reject(
          new CodeNavigationTargetNotFoundError("Package not found"),
        ),
      ),
    });
    const tool = createGrepFileTool(service);
    const result = await tool.handler(
      {
        target: { registry: "npm", package_name: "ghost" },
        path: "src/index.js",
        pattern: "middleware",
      },
      {},
    );
    expect(result.isError).toBe(true);
    expect((parseText(result) as { code: string }).code).toBe("NOT_FOUND");
  });
});
