import { describe, expect, it, mock, spyOn } from "bun:test";
import { GitHitsServiceImpl, type ReadParams } from "@githits/core-internal";
import { $ } from "bun";
import { Command } from "commander";
import fixture from "../../packages/core-internal/src/services/fixtures/example-display-contract.json";
import edgeCalls from "../../packages/core-internal/src/services/fixtures/example-read-calls.json";
import { createGetExampleTool } from "../../packages/mcp/src/tools/get-example.js";
import {
  createReadTool,
  type ReadArgs,
} from "../../packages/mcp/src/tools/read.js";
import { exampleAction } from "../commands/example.js";
import { readAction, registerReadCommand } from "../commands/read.js";
import {
  createMockCodeNavigationService,
  defaultReadFileResult,
} from "../services/test-helpers.js";

describe("example source output contract", () => {
  for (const json of [false, true]) {
    it(`selects source syntax through the real transport in ${json ? "JSON" : "text"} output`, async () => {
      const bodies: unknown[] = [];
      const fetchFn = mock(
        async (_input: string | URL | Request, init?: RequestInit) => {
          const body = JSON.parse(String(init?.body));
          bodies.push(body);
          expect(init?.method).toBe("POST");
          // This double serves the frozen public API bodies; it does not format citations.
          return new Response(
            body.source_format === "cli" ? fixture.cli : fixture.mcp,
            {
              headers: { "content-type": "text/markdown" },
            },
          );
        },
      );
      const service = new GitHitsServiceImpl(
        "https://api.example.test",
        "test-token",
        Object.assign(fetchFn, { preconnect: fetch.preconnect }),
      );
      const log = spyOn(console, "log").mockImplementation(() => {});
      try {
        await exampleAction(
          fixture.response.query,
          { json },
          {
            githitsService: service,
            hasValidToken: true,
            mcpUrl: "https://mcp.example.test",
          },
        );
        const cliOutput = String(log.mock.calls[0]?.[0]);
        const mcpResult = await createGetExampleTool(service).handler(
          {
            query: fixture.response.query,
            format: json ? "json" : "text",
          },
          {},
        );
        expect(mcpResult.isError).not.toBe(true);
        const mcpOutput = mcpResult.content[0]?.text ?? "";
        expect(bodies).toEqual(
          ["cli", "mcp"].map((source_format) => ({
            query: fixture.response.query,
            source_format,
            license_mode: "strict",
            include_explanation: false,
          })),
        );
        if (json) {
          const cliPayload = JSON.parse(cliOutput);
          const mcpPayload = JSON.parse(mcpOutput);
          expect(cliPayload).toEqual({
            result: fixture.cli,
            solution_id: fixture.response.solution_id,
          });
          expect(mcpPayload).toEqual({
            result: fixture.mcp,
            solution_id: fixture.response.solution_id,
          });
          expect(Object.keys(cliPayload)).toEqual(Object.keys(mcpPayload));
        } else {
          expect(cliOutput).toBe(fixture.cli);
          expect(mcpOutput).toBe(
            `${fixture.mcp.trimEnd()}\n\nsolution_id: ${fixture.response.solution_id}`,
          );
        }
      } finally {
        log.mockRestore();
      }
    });
  }
});

function sourceLine(markdown: string, prefix: string): string {
  const line = markdown
    .split("\n")
    .find((line) => line.trimStart().startsWith(prefix));
  if (!line) throw new Error(`Missing ${prefix} source call`);
  return line.trim();
}

const replayCases = [
  {
    name: "commit and space-containing path",
    cli: sourceLine(fixture.cli, "npx "),
    mcp: sourceLine(fixture.mcp, "read("),
    expected: fixture.read,
  },
  ...edgeCalls,
];

describe("example source read replay", () => {
  for (const entry of replayCases) {
    it(`preserves the exact locator through shell, Commander and MCP: ${entry.name}`, async () => {
      expect(entry.cli.startsWith("npx githits@latest read ")).toBe(true);
      // Execute the fixture's quoting in Bun's cross-platform shell, replacing
      // npx with an argv recorder so the test never installs or contacts anything.
      const command = entry.cli.replace(
        /^npx githits@latest /,
        "bun -e 'console.log(JSON.stringify(process.argv.slice(1)))' -- ",
      );
      const argv: string[] = JSON.parse(await $`${{ raw: command }}`.text());
      const args: ReadArgs = JSON.parse(entry.mcp.slice("read(".length, -1));
      const read = mock(async (params: ReadParams) => ({
        source: "code" as const,
        result: {
          ...defaultReadFileResult,
          filePath: params.path ?? "",
          startLine: params.startLine ?? 1,
          endLine: params.endLine ?? 150,
        },
      }));
      const deps = {
        readService: { read },
        codeNavigationService: createMockCodeNavigationService(),
        codeNavigationUrl: "https://code.example.test",
        hasValidToken: true,
        mcpUrl: "https://mcp.example.test",
      };
      const log = spyOn(console, "log").mockImplementation(() => {});
      try {
        const root = new Command().exitOverride();
        registerReadCommand(root).action(async (target, path, options) =>
          readAction(target, path, { ...options, json: true }, deps),
        );
        await root.parseAsync(argv, { from: "user" });
        const result = await createReadTool({ readService: { read } }).handler(
          args,
        );
        expect(result.isError).not.toBe(true);
        expect(read).toHaveBeenCalledTimes(2);
        for (const [params] of read.mock.calls) {
          expect(params).toMatchObject({
            target: entry.expected.target,
            path: entry.expected.path,
            startLine: entry.expected.start_line,
            endLine: entry.expected.end_line,
          });
        }
      } finally {
        log.mockRestore();
      }
    });
  }
});
