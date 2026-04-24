import { describe, expect, it, mock } from "bun:test";
import {
  CodeNavigationIndexingError,
  CodeNavigationTargetNotFoundError,
} from "../services/index.js";
import {
  createMockCodeNavigationService,
  defaultGrepRepoResult,
} from "../services/test-helpers.js";
import { createGrepRepoTool } from "./grep-repo.js";

function parseText(result: { content: Array<{ text: string }> }): unknown {
  return JSON.parse(result.content[0]?.text ?? "");
}

describe("createGrepRepoTool — metadata", () => {
  it("registers the correct tool name and schema keys", () => {
    const tool = createGrepRepoTool(createMockCodeNavigationService());
    expect(tool.name).toBe("grep_repo");
    expect(tool.description).toContain("Deterministic text grep");
    expect(Object.keys(tool.schema).sort()).toEqual([
      "case_sensitive",
      "context_lines",
      "context_lines_after",
      "context_lines_before",
      "cursor",
      "exclude_doc_files",
      "exclude_test_files",
      "extensions",
      "globs",
      "max_matches",
      "max_matches_per_file",
      "path",
      "path_prefix",
      "pattern",
      "pattern_type",
      "symbol_fields",
      "target",
      "wait_timeout_ms",
    ]);
    expect(tool.annotations?.readOnlyHint).toBe(true);
  });
});

describe("createGrepRepoTool — happy path", () => {
  it("calls grepRepo with resolved target and grep params", async () => {
    const grepRepo = mock(() => Promise.resolve(defaultGrepRepoResult));
    const service = createMockCodeNavigationService({ grepRepo });
    const tool = createGrepRepoTool(service);

    await tool.handler(
      {
        target: { registry: "npm", package_name: "express" },
        pattern: "middleware",
        path_prefix: "src/",
        globs: ["src/**/*.js"],
        extensions: ["js"],
        pattern_type: "regex",
        case_sensitive: true,
        context_lines_before: 2,
        context_lines_after: 1,
      },
      {},
    );

    const calls = grepRepo.mock.calls as unknown as Array<
      [
        {
          target: { registry?: string };
          pattern: string;
          patternType?: string;
          pathSelectors?: Array<{ kind: string; value: string }>;
          extensions?: string[];
          caseSensitive?: boolean;
          contextLinesBefore?: number;
          contextLinesAfter?: number;
          symbolFields?: string[];
        },
      ]
    >;
    expect(calls[0]?.[0]?.target.registry).toBe("NPM");
    expect(calls[0]?.[0]?.pattern).toBe("middleware");
    expect(calls[0]?.[0]?.patternType).toBe("REGEX");
    expect(calls[0]?.[0]?.caseSensitive).toBe(true);
    expect(calls[0]?.[0]?.extensions).toEqual(["js"]);
    expect(calls[0]?.[0]?.pathSelectors).toEqual([
      { kind: "PREFIX", value: "src/" },
      { kind: "GLOB", value: "src/**/*.js" },
    ]);
  });

  it("passes symbol field hydration through to grepRepo", async () => {
    const grepRepo = mock(() => Promise.resolve(defaultGrepRepoResult));
    const tool = createGrepRepoTool(
      createMockCodeNavigationService({ grepRepo }),
    );

    await tool.handler(
      {
        target: { registry: "npm", package_name: "express" },
        pattern: "middleware",
        symbol_fields: ["name", "qualified_path", "kind"],
      },
      {},
    );

    expect(grepRepo).toHaveBeenCalledWith(
      expect.objectContaining({
        symbolFields: ["name", "qualified_path", "kind"],
      }),
    );
  });

  it("emits the new envelope shape", async () => {
    const tool = createGrepRepoTool(createMockCodeNavigationService());
    const result = await tool.handler(
      {
        target: { registry: "npm", package_name: "express" },
        pattern: "middleware",
      },
      {},
    );
    const payload = parseText(result) as {
      pattern: string;
      patternType: string;
      caseSensitive: boolean;
      totalMatches: number;
      matches: Array<{ filePath: string; line: number }>;
    };
    expect(payload.pattern).toBe("middleware");
    expect(payload.patternType).toBe("literal");
    expect(payload.caseSensitive).toBe(false);
    expect(payload.totalMatches).toBe(1);
    expect(payload.matches[0]).toMatchObject({
      filePath: "src/index.js",
      line: 4,
    });
  });
});

describe("createGrepRepoTool — validation errors", () => {
  it("returns INVALID_ARGUMENT for empty pattern", async () => {
    const tool = createGrepRepoTool(createMockCodeNavigationService());
    const result = await tool.handler(
      {
        target: { registry: "npm", package_name: "express" },
        pattern: "",
      },
      {},
    );
    expect(result.isError).toBe(true);
    expect((parseText(result) as { code: string }).code).toBe(
      "INVALID_ARGUMENT",
    );
  });
});

describe("createGrepRepoTool — service errors", () => {
  it("classifies CodeNavigationIndexingError as INDEXING", async () => {
    const service = createMockCodeNavigationService({
      grepRepo: mock(() =>
        Promise.reject(
          new CodeNavigationIndexingError("Indexing...", "ref_abc"),
        ),
      ),
    });
    const tool = createGrepRepoTool(service);
    const result = await tool.handler(
      {
        target: { registry: "npm", package_name: "express" },
        pattern: "middleware",
      },
      {},
    );
    expect(result.isError).toBe(true);
    expect((parseText(result) as { code: string }).code).toBe("INDEXING");
  });

  it("classifies CodeNavigationTargetNotFoundError as NOT_FOUND", async () => {
    const service = createMockCodeNavigationService({
      grepRepo: mock(() =>
        Promise.reject(
          new CodeNavigationTargetNotFoundError("Package not found"),
        ),
      ),
    });
    const tool = createGrepRepoTool(service);
    const result = await tool.handler(
      {
        target: { registry: "npm", package_name: "ghost" },
        pattern: "middleware",
      },
      {},
    );
    expect(result.isError).toBe(true);
    expect((parseText(result) as { code: string }).code).toBe("NOT_FOUND");
  });
});
