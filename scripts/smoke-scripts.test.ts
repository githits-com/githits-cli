import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { EXPECTED_MCP_TOOLS } from "@githits/mcp/smoke-test";
import {
  assertRootHelpStructure,
  buildMcpParityCommand,
  EXPECTED_EXPERIMENTAL_TOP_LEVEL_COMMANDS,
  EXPECTED_STABLE_TOP_LEVEL_COMMANDS,
  EXPECTED_TOP_LEVEL_COMMANDS,
  parseCliSmokeArgs,
  parseRootHelpCommands,
} from "./cli-smoke.ts";
import { parseMcpCallArgs } from "./mcp-call.ts";
import {
  EXPECTED_EXPERIMENTAL_MCP_TOOLS,
  parseMcpSmokeArgs,
} from "./mcp-smoke.ts";
import { toStdioLaunch } from "./smoke-launch-target.ts";

describe("smoke script options", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("parses CLI unauthenticated mode and a built target in either order", () => {
    const entry = createEntry("built output/cli.js");

    expect(
      parseCliSmokeArgs(["--mode", "unauthenticated", "--cli-entry", entry]),
    ).toMatchObject({ mode: "unauthenticated", target: { kind: "built" } });
    expect(
      parseCliSmokeArgs(["--cli-entry", entry, "--mode", "unauthenticated"])
        .target.argv,
    ).toEqual(["node", entry]);
  });

  it("rejects unknown and duplicate CLI smoke modes", () => {
    expect(() => parseCliSmokeArgs(["--wat"])).toThrow(
      "Unknown CLI smoke option",
    );
    expect(() =>
      parseCliSmokeArgs(["--mode", "live", "--mode", "unauthenticated"]),
    ).toThrow("--mode may only be specified once");
  });

  it("parses MCP registration mode with a built target", () => {
    const entry = createEntry("dist/cli.js");
    const options = parseMcpSmokeArgs([
      "--mode",
      "registration",
      "--cli-entry",
      entry,
    ]);

    expect(options.mode).toBe("registration");
    expect(toStdioLaunch(options.target, ["mcp", "start"])).toEqual({
      command: "node",
      args: [entry, "mcp", "start"],
    });
    expect(
      toStdioLaunch(options.target, ["mcp", "start", "--experimental-tools"]),
    ).toEqual({
      command: "node",
      args: [entry, "mcp", "start", "--experimental-tools"],
    });
  });

  it("forwards the absolute built target through CLI parity and mcp-call", () => {
    const entry = createEntry("path with spaces/cli.js");
    const target = parseCliSmokeArgs(["--cli-entry", entry]).target;
    const command = buildMcpParityCommand(target, "pkg_info", {
      registry: "npm",
      package_name: "express",
    });
    const scriptArgs = command.slice(3);

    expect(command).toEqual([
      "bun",
      "run",
      "scripts/mcp-call.ts",
      "--cli-entry",
      entry,
      "pkg_info",
      '{"registry":"npm","package_name":"express"}',
    ]);
    const nested = parseMcpCallArgs(scriptArgs);
    expect(toStdioLaunch(nested.target, ["mcp", "start"])).toEqual({
      command: "node",
      args: [entry, "mcp", "start"],
    });
    expect(nested.toolName).toBe("pkg_info");
  });

  it("parses the default mcp-call source target", () => {
    const options = parseMcpCallArgs(["search_language", '{"query":"go"}']);

    expect(toStdioLaunch(options.target, ["mcp", "start"])).toEqual({
      command: "bun",
      args: ["run", "dev", "mcp", "start"],
    });
    expect(options.args).toEqual({ query: "go" });
  });

  it("rejects invalid mcp-call positional and JSON arguments", () => {
    expect(() => parseMcpCallArgs(["pkg_info"])).toThrow("usage:");
    expect(() => parseMcpCallArgs(["pkg_info", "{}", "extra"])).toThrow(
      "usage:",
    );
    expect(() => parseMcpCallArgs(["pkg_info", "[]"])).toThrow(
      "must be a JSON object",
    );
  });

  function createEntry(relativePath: string): string {
    const dir = mkdtempSync(join(tmpdir(), "githits smoke script "));
    tempDirs.push(dir);
    const entry = resolve(dir, relativePath);
    mkdirSync(dirname(entry), { recursive: true });
    writeFileSync(entry, "export {};\n");
    return entry;
  }
});

describe("CLI root help smoke contract", () => {
  it("keeps stable and experimental command cohorts exact and separate", () => {
    expect(EXPECTED_TOP_LEVEL_COMMANDS).toEqual(
      EXPECTED_STABLE_TOP_LEVEL_COMMANDS,
    );
    expect(EXPECTED_STABLE_TOP_LEVEL_COMMANDS).not.toContain("resolve");
    expect(EXPECTED_EXPERIMENTAL_TOP_LEVEL_COMMANDS).toContain("resolve");
    expect(EXPECTED_EXPERIMENTAL_TOP_LEVEL_COMMANDS).toHaveLength(
      EXPECTED_STABLE_TOP_LEVEL_COMMANDS.length + 1,
    );
  });

  it("accepts the complete product command set and ignores generated help", () => {
    const help = rootHelpFixture(EXPECTED_TOP_LEVEL_COMMANDS);

    expect(parseRootHelpCommands(help)).toEqual([
      ...EXPECTED_TOP_LEVEL_COMMANDS,
    ]);
    expect(() => assertRootHelpStructure(help)).not.toThrow();
  });

  it("fails when a command disappears even if prose still mentions it", () => {
    const commands = EXPECTED_TOP_LEVEL_COMMANDS.filter(
      (command) => command !== "search",
    );
    const help = `${rootHelpFixture(commands)}\nGetting started: use githits search.`;

    expect(() => assertRootHelpStructure(help)).toThrow("missing: search");
  });

  it("fails when an unexpected product command appears", () => {
    const help = rootHelpFixture([
      ...EXPECTED_TOP_LEVEL_COMMANDS,
      "unexpected-command",
    ]);

    expect(() => assertRootHelpStructure(help)).toThrow(
      "unexpected: unexpected-command",
    );
  });

  function rootHelpFixture(commands: readonly string[]): string {
    const rows = commands.map(
      (command) => `  ${command} [options]  ${command} description`,
    );
    return [
      "Usage: githits [options] [command]",
      "",
      "Commands:",
      ...rows,
      "  help [command]  display help for command",
      "",
      "Examples:",
      "  githits example express",
    ].join("\n");
  }
});

describe("MCP smoke cohorts", () => {
  it("keeps experimental inventory local and additive to the stable baseline", () => {
    expect(EXPECTED_EXPERIMENTAL_MCP_TOOLS).toEqual([
      ...EXPECTED_MCP_TOOLS,
      "resolve_target",
      "code_diff",
    ]);
  });
});
