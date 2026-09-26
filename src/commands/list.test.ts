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
      "-v, --verbose",
      "--json",
    ]) {
      expect(help).toContain(flag);
    }
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
        languages: ["TypeScript", "Rust"],
        includeDetailedFields: true,
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
          verbose: true,
        },
        createDeps({ listService: service }),
      );

      expect(list.mock.calls[0]?.[0]).toEqual({
        target: "  github:acme/service@main  ",
        paths: ["dir/", "**/*.md"],
        recursive: false,
        fileTypes: ["source", "doc"],
        languages: ["TypeScript", "rust"],
        intents: ["TEST", "PRODUCTION"],
        limit: 500,
        after: " cursor/%2F ",
        waitTimeoutMs: 0,
        includeDetailedFields: true,
      });
    } finally {
      log.mockRestore();
      write.mockRestore();
    }
  });

  it("uses compact fields by default and detailed fields for JSON", async () => {
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
      expect(
        list.mock.calls.map(([params]) => params.includeDetailedFields),
      ).toEqual([false, true]);
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

  it("renders backend actions and a continuation using the normalized request", async () => {
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
      const output = writes.join("");
      expect(output).toContain(
        "githits read 'npm:express@5.2.1' 'src/index.ts'",
      );
      expect(output).toContain("--recursive");
      expect(output).toContain("--file-type 'source'");
      expect(output).toContain("--limit 25");
      expect(output).toContain("--wait 0");
      expect(output).toContain("--after 'next/%2F cursor'");
      expect(output).not.toContain("total");
    } finally {
      write.mockRestore();
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
