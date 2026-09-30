import { describe, expect, it, mock, spyOn } from "bun:test";
import type { ListParams, ListResult } from "@githits/core-internal";
import { ListGraphQLError } from "@githits/core-internal";
import { Command } from "commander";
import {
  createMockListService,
  defaultListResult,
} from "../services/test-helpers.js";
import {
  type ListCommandDependencies,
  type ListCommandOptions,
  listAction,
  registerListCommand,
} from "./list.js";

function createDeps(
  overrides: Partial<ListCommandDependencies> = {},
): ListCommandDependencies {
  return {
    listService: createMockListService(),
    hasValidToken: true,
    mcpUrl: "https://mcp.githits.com",
    ...overrides,
  };
}

function listResult(overrides: Partial<ListResult> = {}): ListResult {
  return { ...defaultListResult, ...overrides };
}

describe("unified list CLI", () => {
  it("registers the target, variadic selectors, and ls-style options", () => {
    const command = registerListCommand(new Command());
    const help = command.helpInformation();

    expect(command.name()).toBe("list");
    expect(help).toContain("<target> [paths...]");
    for (const flag of [
      "-R, --recursive",
      "--file-type <type>",
      "--language <language>",
      "--intent <intent>",
      "--limit <n>",
      "--after <cursor>",
      "--wait <ms>",
      "-s, --silent",
      "--json",
    ]) {
      expect(help).toContain(flag);
    }
    expect(help).not.toContain("--verbose");
  });

  it("parses paths interleaved with repeatable options through Commander", async () => {
    const list = mock((_params: ListParams) =>
      Promise.resolve(defaultListResult),
    );
    const service = createMockListService({ list });
    const log = spyOn(console, "log").mockImplementation(() => {});
    const stop = mock(() => {});
    const deps = createDeps({
      listService: service,
      createSpinner: () => ({ stop }),
    });
    const program = new Command("githits");
    registerListCommand(program, async () => deps);

    try {
      await program.parseAsync([
        "node",
        "githits",
        "list",
        "npm:express",
        "src/",
        "--file-type",
        "source",
        "lib/",
        "--language",
        "TypeScript",
        "**/*.md",
        "--file-type",
        "doc",
        "docs/",
        "--language",
        "Rust",
        "--recursive",
        "--json",
      ]);

      expect(list).toHaveBeenCalledTimes(1);
      expect(list.mock.calls[0]?.[0]).toEqual({
        target: "npm:express",
        paths: ["src/", "lib/", "**/*.md", "docs/"],
        recursive: true,
        fileTypes: ["source", "doc"],
        languages: ["typescript", "rust"],
        includeDetailedFields: true,
        includeReadActions: true,
      });
      expect(stop).toHaveBeenCalledTimes(1);
    } finally {
      log.mockRestore();
    }
  });

  it.each([
    [
      "dash-leading target",
      ["--json", "--", "-npm:express", "src/"],
      "-npm:express",
      ["src/"],
    ],
    [
      "dash-leading path",
      ["--json", "--limit", "5", "npm:express", "--", "-src/"],
      "npm:express",
      ["-src/"],
    ],
  ])(
    "parses a %s after the end-of-options marker",
    async (_label, args, target, paths) => {
      const list = mock((_params: ListParams) =>
        Promise.resolve(defaultListResult),
      );
      const service = createMockListService({ list });
      const log = spyOn(console, "log").mockImplementation(() => {});
      const program = new Command("githits");
      registerListCommand(program, async () =>
        createDeps({ listService: service }),
      );

      try {
        await program.parseAsync(["node", "githits", "list", ...args]);

        expect(list).toHaveBeenCalledTimes(1);
        expect(list.mock.calls[0]?.[0]).toMatchObject({ target, paths });
        if (args.includes("--limit")) {
          expect(list.mock.calls[0]?.[0].limit).toBe(5);
        }
      } finally {
        log.mockRestore();
      }
    },
  );

  it.each([
    ["npm:express@5.2.1", ["src/", "**/*.md"]],
    ["github:acme/service@main", ["packages/api/**"]],
    ["site:docs.example.test/guide", ["reference/**"]],
  ])(
    "sends target and path selectors unchanged for %s",
    async (target, paths) => {
      const list = mock((_params: ListParams) =>
        Promise.resolve(defaultListResult),
      );
      const service = createMockListService({ list });
      const log = spyOn(console, "log").mockImplementation(() => {});
      try {
        await listAction(
          target,
          paths,
          { json: true },
          createDeps({ listService: service }),
        );
        expect(list).toHaveBeenCalledTimes(1);
        expect(list.mock.calls[0]?.[0]).toMatchObject({
          target,
          paths,
          includeDetailedFields: true,
        });
        expect(list.mock.calls[0]?.[0]).not.toHaveProperty("limit");
        expect(list.mock.calls[0]?.[0]).not.toHaveProperty("waitTimeoutMs");
      } finally {
        log.mockRestore();
      }
    },
  );

  it("accepts a leading slash in a site selector", async () => {
    const list = mock((_params: ListParams) =>
      Promise.resolve(defaultListResult),
    );
    const log = spyOn(console, "log").mockImplementation(() => {});
    try {
      await listAction(
        "site:expressjs.com",
        ["/en/resources/"],
        { json: true },
        createDeps({ listService: createMockListService({ list }) }),
      );
      expect(list).toHaveBeenCalledWith(
        expect.objectContaining({
          target: "site:expressjs.com",
          paths: ["en/resources/"],
        }),
      );
    } finally {
      log.mockRestore();
    }
  });

  it("preserves explicit false, zero, repeated filters, and pagination inputs", async () => {
    const list = mock((_params: ListParams) =>
      Promise.resolve(defaultListResult),
    );
    const service = createMockListService({ list });
    const log = spyOn(console, "log").mockImplementation(() => {});
    const write = spyOn(process.stdout, "write").mockImplementation(
      (() => true) as typeof process.stdout.write,
    );
    try {
      await listAction(
        "  github:acme/service@main  ",
        ["dir/", "**/*.md"],
        {
          recursive: false,
          fileType: [" source ", "doc"],
          language: [" TypeScript ", "rust"],
          intent: ["test", "Production"],
          limit: "500",
          after: " cursor/%2F ",
          wait: "0",
        },
        createDeps({ listService: service }),
      );

      expect(list.mock.calls[0]?.[0]).toEqual({
        target: "  github:acme/service@main  ",
        paths: ["dir/", "**/*.md"],
        recursive: false,
        fileTypes: ["source", "doc"],
        languages: ["typescript", "rust"],
        intents: ["TEST", "PRODUCTION"],
        limit: 500,
        after: " cursor/%2F ",
        waitTimeoutMs: 0,
        includeDetailedFields: false,
        includeReadActions: false,
      });
    } finally {
      log.mockRestore();
      write.mockRestore();
    }
  });

  it("uses read actions only for JSON and compact site text", async () => {
    const list = mock((_params: ListParams) =>
      Promise.resolve(defaultListResult),
    );
    const service = createMockListService({ list });
    const write = spyOn(process.stdout, "write").mockImplementation(
      (() => true) as typeof process.stdout.write,
    );
    const log = spyOn(console, "log").mockImplementation(() => {});
    try {
      await listAction(
        "npm:express",
        undefined,
        {},
        createDeps({ listService: service }),
      );
      await listAction(
        "npm:express",
        undefined,
        { json: true },
        createDeps({ listService: service }),
      );
      await listAction(
        "site:docs.example.test",
        undefined,
        {},
        createDeps({ listService: service }),
      );
      expect(
        list.mock.calls.map(([params]) => params.includeDetailedFields),
      ).toEqual([false, true, false]);
      expect(
        list.mock.calls.map(([params]) => params.includeReadActions),
      ).toEqual([false, true, true]);
    } finally {
      write.mockRestore();
      log.mockRestore();
    }
  });

  it("omits empty selectors and blank cursors while retaining exact target", async () => {
    const list = mock((_params: ListParams) =>
      Promise.resolve(defaultListResult),
    );
    const service = createMockListService({ list });
    const log = spyOn(console, "log").mockImplementation(() => {});
    const write = spyOn(process.stdout, "write").mockImplementation(
      (() => true) as typeof process.stdout.write,
    );
    try {
      await listAction(
        "npm:express",
        [],
        {
          fileType: [],
          language: [],
          intent: [],
          after: " \t ",
        },
        createDeps({ listService: service }),
      );
      expect(list.mock.calls[0]?.[0]).toEqual({
        target: "npm:express",
        includeDetailedFields: false,
        includeReadActions: false,
      });
    } finally {
      log.mockRestore();
      write.mockRestore();
    }
  });

  it("rewrites shared validation fields to their CLI labels", async () => {
    const list = mock((_params: ListParams) =>
      Promise.resolve(defaultListResult),
    );
    const service = createMockListService({ list });
    const error = spyOn(console, "error").mockImplementation(() => {});
    const exit = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    try {
      const invalidRequests: Array<{
        target: string;
        options: ListCommandOptions;
        label: string;
        internalField: string;
      }> = [
        {
          target: "npm:express",
          options: { wait: "invalid", json: true },
          label: "--wait",
          internalField: "waitTimeoutMs",
        },
        {
          target: "site:docs.example.test",
          options: { fileType: ["source"], json: true },
          label: "--file-type",
          internalField: "fileTypes",
        },
      ];

      for (const request of invalidRequests) {
        await expect(
          listAction(
            request.target,
            undefined,
            request.options,
            createDeps({ listService: service }),
          ),
        ).rejects.toThrow("process.exit");
        const payload = JSON.parse(String(error.mock.calls.at(-1)?.[0])) as {
          code: string;
          error: string;
          retryable: boolean;
        };
        expect(payload).toMatchObject({
          code: "INVALID_ARGUMENT",
          retryable: false,
        });
        expect(payload.error).toContain(request.label);
        expect(payload.error).not.toContain(request.internalField);
      }
      expect(list).not.toHaveBeenCalled();
    } finally {
      error.mockRestore();
      exit.mockRestore();
    }
  });

  it("projects JSON without changing backend actions, nulls, or cursor bytes", async () => {
    const result = listResult({
      canonicalTarget: null,
      entries: [
        {
          kind: "FILE",
          path: "src/café%2F.ts",
          title: null,
          language: null,
          fileType: null,
          intent: null,
          byteSize: null,
          lineCount: null,
          contentHash: null,
          read: { target: "npm:express@5.2.1", path: "src/café%2F.ts" },
          browse: null,
        },
      ],
      hasMore: true,
      nextCursor: "opaque/%2F+cursor",
    });
    const service = createMockListService({
      list: mock(() => Promise.resolve(result)),
    });
    const log = spyOn(console, "log").mockImplementation(() => {});
    try {
      await listAction(
        "npm:express@5.2.1",
        undefined,
        { json: true },
        createDeps({ listService: service }),
      );
      expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toEqual(result);
    } finally {
      log.mockRestore();
    }
  });

  it("renders the shared path-only text format", async () => {
    const result = listResult({
      entries: [
        {
          kind: "FILE",
          path: "src/index.ts",
          title: null,
          read: { target: "npm:express@5.2.1", path: "src/index.ts" },
          browse: null,
        },
      ],
      hasMore: true,
      nextCursor: "next/%2F cursor",
    });
    const service = createMockListService({
      list: mock(() => Promise.resolve(result)),
    });
    const writes: string[] = [];
    const write = spyOn(process.stdout, "write").mockImplementation(((
      chunk: string | Uint8Array,
    ) => {
      writes.push(
        typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk),
      );
      return true;
    }) as typeof process.stdout.write);
    try {
      await listAction(
        "npm:express@5.2.1",
        ["src/"],
        { recursive: true, fileType: ["source"], limit: "25", wait: "0" },
        createDeps({ listService: service }),
      );
      expect(writes.join("")).toBe(
        `${[
          '# source npm:express@5.2.1 | follow up with "read npm:express@5.2.1 $path" | more results available',
          "src/index.ts",
          "",
          "More results: reuse the same target, paths, and options with:",
          "  --after 'next/%2F cursor'",
        ].join("\n")}\n`,
      );
    } finally {
      write.mockRestore();
    }
  });

  it("emits only paths in silent mode and writes nothing for an empty inventory", async () => {
    const results = [
      listResult({
        entries: [
          { kind: "FILE", path: "src/index.ts" },
          { kind: "DIRECTORY", path: "docs" },
        ],
        hasMore: true,
        nextCursor: "opaque-cursor",
      }),
      listResult({ entries: [] }),
    ];
    const service = createMockListService({
      list: mock(() => Promise.resolve(results.shift() ?? listResult())),
    });
    const writes: string[] = [];
    const write = spyOn(process.stdout, "write").mockImplementation(((
      chunk: string | Uint8Array,
    ) => {
      writes.push(
        typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk),
      );
      return true;
    }) as typeof process.stdout.write);
    try {
      await listAction(
        "npm:express@5.2.1",
        undefined,
        { silent: true },
        createDeps({ listService: service }),
      );
      expect(writes.join("")).toBe("src/index.ts\ndocs/\n");

      writes.length = 0;
      await listAction(
        "npm:express@5.2.1",
        undefined,
        { silent: true },
        createDeps({ listService: service }),
      );
      expect(writes).toEqual([]);
    } finally {
      write.mockRestore();
    }
  });

  it("renders site actions as reusable target and path operands", async () => {
    const result = listResult({
      inventoryKind: "SITE",
      requestedTarget: "site:expressjs.com",
      canonicalTarget: "site:expressjs.com",
      entries: [
        {
          kind: "PAGE",
          path: "en/resources/",
          read: { target: "site:expressjs.com", path: "en/resources" },
        },
        {
          kind: "DIRECTORY",
          path: "en/guide/",
          read: null,
        },
      ],
      inventoryState: "AVAILABLE",
      crawlStatus: "COMPLETE",
      coverageState: "COMPLETE",
    });
    const service = createMockListService({
      list: mock(() => Promise.resolve(result)),
    });
    const writes: string[] = [];
    const write = spyOn(process.stdout, "write").mockImplementation(((
      chunk: string | Uint8Array,
    ) => {
      writes.push(
        typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk),
      );
      return true;
    }) as typeof process.stdout.write);
    try {
      await listAction(
        "site:expressjs.com",
        undefined,
        {},
        createDeps({ listService: service }),
      );
      expect(writes.join("")).toBe(
        `${['# source site:expressjs.com | follow up with "read site:expressjs.com $path"', "en/resources", "en/guide/"].join("\n")}\n`,
      );
    } finally {
      write.mockRestore();
    }
  });

  it("preserves descendant-site directories and their request base in text and JSON", async () => {
    const target = "site:reference.langchain.com/python/langchain/agents";
    const paths = [
      "_subagent_transformer/",
      "factory/",
      "middleware/",
      "structured_output/",
    ];
    const result = listResult({
      inventoryKind: "SITE",
      requestedTarget: target,
      canonicalTarget: "site:reference.langchain.com/python/langchain",
      entries: paths.map((path) => ({
        kind: "DIRECTORY",
        path,
        read: null,
        browse: { target, paths: [path] },
      })),
    });
    const list = mock(() => Promise.resolve(result));
    const deps = createDeps({
      listService: createMockListService({ list }),
      createSpinner: () => ({ stop: mock(() => {}) }),
    });
    const writes: string[] = [];
    const write = spyOn(process.stdout, "write").mockImplementation(((
      chunk: string | Uint8Array,
    ) => {
      writes.push(
        typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk),
      );
      return true;
    }) as typeof process.stdout.write);
    const log = spyOn(console, "log").mockImplementation(() => {});
    try {
      await listAction(target, undefined, {}, deps);
      expect(writes.join("")).toBe(
        [`# source ${target}`, ...paths, ""].join("\n"),
      );
      writes.length = 0;
      await listAction(target, undefined, { silent: true }, deps);
      expect(writes.join("")).toBe([...paths, ""].join("\n"));
      await listAction(target, undefined, { json: true }, deps);
      expect(JSON.parse(log.mock.calls[0]?.[0] as string)).toMatchObject({
        requestedTarget: target,
        canonicalTarget: "site:reference.langchain.com/python/langchain",
        entries: result.entries,
      });
      expect(list.mock.calls).toHaveLength(3);
    } finally {
      write.mockRestore();
      log.mockRestore();
    }
  });

  it("maps cursor validation errors with restart guidance and never falls back", async () => {
    const list = mock((_params: ListParams) =>
      Promise.reject(new ListGraphQLError("bad cursor", "VALIDATION_ERROR")),
    );
    const service = createMockListService({ list });
    const error = spyOn(console, "error").mockImplementation(() => {});
    const exit = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    try {
      await expect(
        listAction(
          "github:acme/service",
          undefined,
          { after: "opaque", json: true },
          createDeps({ listService: service }),
        ),
      ).rejects.toThrow("process.exit");
      expect(list).toHaveBeenCalledTimes(1);
      expect(JSON.parse(String(error.mock.calls[0]?.[0])).error).toContain(
        "Retry once without `after`; if validation still fails, correct the request.",
      );
    } finally {
      error.mockRestore();
      exit.mockRestore();
    }
  });

  it("sanitizes terminal GraphQL errors while preserving JSON control bytes", async () => {
    const backendMessage = "\u001b[31mIndexing failed\u001b[0m";
    const backendHint = "\u001b[2JRefresh the index";
    const list = mock((_params: ListParams) =>
      Promise.reject(
        new ListGraphQLError(
          backendMessage,
          "PACKAGE_INDEXING",
          undefined,
          undefined,
          undefined,
          "main",
          backendHint,
        ),
      ),
    );
    const service = createMockListService({ list });
    const error = spyOn(console, "error").mockImplementation(() => {});
    const exit = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });

    try {
      await expect(
        listAction(
          "npm:express",
          undefined,
          {},
          createDeps({ listService: service }),
        ),
      ).rejects.toThrow("process.exit");
      const terminalOutput = String(error.mock.calls.at(-1)?.[0]);
      expect(terminalOutput).not.toContain("\u001b");
      expect(terminalOutput).toContain("Indexing failed");
      expect(terminalOutput).toContain("Refresh the index");

      error.mockClear();
      await expect(
        listAction(
          "npm:express",
          undefined,
          { json: true },
          createDeps({ listService: service }),
        ),
      ).rejects.toThrow("process.exit");
      const payload = JSON.parse(String(error.mock.calls.at(-1)?.[0])) as {
        error: string;
        details: { hint: string; indexingRef: string };
      };
      expect(payload.error).toContain(backendMessage);
      expect(payload.details.hint).toBe(backendHint);
      expect(payload.details.indexingRef).toBe("main");
      expect(list).toHaveBeenCalledTimes(2);
    } finally {
      error.mockRestore();
      exit.mockRestore();
    }
  });

  it("stops the spinner after service completion", async () => {
    const stop = mock(() => {});
    const log = spyOn(console, "log").mockImplementation(() => {});
    try {
      await listAction(
        "site:docs.example.test",
        undefined,
        { json: true },
        createDeps({ createSpinner: () => ({ stop }) }),
      );
      expect(stop).toHaveBeenCalledTimes(1);
    } finally {
      log.mockRestore();
    }
  });

  it("stops the spinner once when the service rejects", async () => {
    const list = mock((_params: ListParams) =>
      Promise.reject(new Error("failed")),
    );
    const service = createMockListService({ list });
    const stop = mock(() => {});
    const error = spyOn(console, "error").mockImplementation(() => {});
    const exit = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });

    try {
      await expect(
        listAction(
          "npm:express",
          undefined,
          { json: true },
          createDeps({
            listService: service,
            createSpinner: () => ({ stop }),
          }),
        ),
      ).rejects.toThrow("process.exit");
      expect(stop).toHaveBeenCalledTimes(1);
    } finally {
      error.mockRestore();
      exit.mockRestore();
    }
  });
});
