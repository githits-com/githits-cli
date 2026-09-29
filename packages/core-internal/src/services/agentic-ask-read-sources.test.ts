import { describe, expect, it } from "bun:test";
import {
  AgenticAskServiceImpl,
  MalformedAgenticAskResponseError,
} from "./agentic-ask-service.js";
import { createMockTokenProvider } from "./test-helpers.js";

const target = `https://github.com/earendil-works/pi@${"a".repeat(40)}`;

interface ReadSourceCase {
  label: string;
  cli: string[];
  mcp: {
    target: string;
    path?: string;
    selector?: string;
    start_line?: number;
    end_line?: number;
  };
}

const cases: ReadSourceCase[] = [
  {
    label: "served commit and exact repository path",
    cli: ["--lines", "34-44", "--", target, "packages/a b/%file.ts"],
    mcp: {
      target,
      path: "packages/a b/%file.ts",
      start_line: 34,
      end_line: 44,
    },
  },
  {
    label: "whole file with option-like path",
    cli: ["--", target, "--json"],
    mcp: { target, path: "--json" },
  },
  {
    label: "whole documentation page",
    cli: ["--", "https://docs.example/page?q=a%20b"],
    mcp: { target: "https://docs.example/page?q=a%20b" },
  },
  {
    label: "documentation heading",
    cli: ["--selector", "usage notes", "--", "https://docs.example/page"],
    mcp: { target: "https://docs.example/page", selector: "usage notes" },
  },
  {
    label: "site path and selector",
    cli: ["--selector", "usage", "--", "site:docs.example", "guide/a%2Fb"],
    mcp: {
      target: "site:docs.example",
      path: "guide/a%2Fb",
      selector: "usage",
    },
  },
  {
    label: "selector and explicit window",
    cli: [
      "--selector",
      "execute",
      "--lines",
      "10-20",
      "--",
      target,
      "src/main.ts",
    ],
    mcp: {
      target,
      path: "src/main.ts",
      selector: "execute",
      start_line: 10,
      end_line: 20,
    },
  },
  {
    label: "start-only window",
    cli: ["--lines", "20-", "--", target, "src/main.ts"],
    mcp: { target, path: "src/main.ts", start_line: 20 },
  },
  {
    label: "end-only window",
    cli: ["--lines", "-20", "--", target, "src/main.ts"],
    mcp: { target, path: "src/main.ts", end_line: 20 },
  },
];

function response(sourceFormat: "cli" | "mcp", source: unknown): object {
  return {
    source_format: sourceFormat,
    tool_call_id: "018f47a6-7b32-7a1e-8f45-6a2d39c81720",
    thread_id: "018f47a6-7b32-7b1e-8f45-6a2d39c81720",
    answer_markdown: "Use the documented API.",
    sources: [source],
  };
}

function service(body: object): AgenticAskServiceImpl {
  return new AgenticAskServiceImpl(
    "https://api.githits.test",
    createMockTokenProvider(),
    Object.assign(async () => Response.json(body), {
      preconnect: () => undefined,
    }),
  );
}

describe("Ask unified read source contract", () => {
  it.each(cases)("preserves CLI $label", async ({ cli }) => {
    const body = response("cli", {
      command: "npx",
      arguments: ["githits@latest", "read", ...cli],
    });
    expect(body).toEqual(await service(body).ask({ question: "How?" }));
  });

  it.each(cases)("preserves MCP $label", async ({ mcp }) => {
    const body = response("mcp", { name: "read", arguments: mcp });
    expect(body).toEqual(
      await service(body).ask({ question: "How?", sourceFormat: "mcp" }),
    );
  });

  it.each([
    [
      "githits@latest",
      "code",
      "read",
      "--lines",
      "1-2",
      "--",
      target,
      "file.ts",
    ],
    ["githits@latest", "docs", "read", "--lines", "1-2", "--", "page"],
    ["other-package", "read", "--", "page"],
    ["githits@latest", "exec", "--", "page"],
    ["githits@latest", "read", "page"],
    ["githits@latest", "read", "--"],
    ["githits@latest", "read", "--", ""],
    ["githits@latest", "read", "--", "page", "path", "extra"],
    ["githits@latest", "read", "--unknown", "value", "--", "page"],
    ["githits@latest", "read", "--selector", "", "--", "page"],
    [
      "githits@latest",
      "read",
      "--selector",
      "one",
      "--selector",
      "two",
      "--",
      "page",
    ],
    ...["0-2", "3-2", "-", "a-b", "1-2;echo", "1-9007199254740992"].map(
      (range) => ["githits@latest", "read", "--lines", range, "--", "page"],
    ),
  ])("rejects invalid CLI argv %j", async (...args: string[]) => {
    const body = response("cli", { command: "npx", arguments: args });
    await expect(
      service(body).ask({ question: "How?" }),
    ).rejects.toBeInstanceOf(MalformedAgenticAskResponseError);
  });

  it.each([
    {
      name: "code_read",
      arguments: { target, path: "file.ts", start_line: 1, end_line: 2 },
    },
    {
      name: "docs_read",
      arguments: { page_id: "page", start_line: 1, end_line: 2 },
    },
    ...[
      { target: "" },
      { page_id: "page" },
      { target, path: "" },
      { target, selector: "" },
      { target, start_line: 0 },
      { target, start_line: 1.5 },
      { target, start_line: 3, end_line: 2 },
      { target, selector: null },
      { target, startLine: 1 },
    ].map((args) => ({ name: "read", arguments: args })),
  ])("rejects invalid MCP source %j", async (source) => {
    await expect(
      service(response("mcp", source)).ask({
        question: "How?",
        sourceFormat: "mcp",
      }),
    ).rejects.toBeInstanceOf(MalformedAgenticAskResponseError);
  });
});
