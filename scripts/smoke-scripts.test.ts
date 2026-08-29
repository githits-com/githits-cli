import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { EXPECTED_MCP_TOOLS } from "@githits/mcp/smoke-test";
import {
  assertExperimentalCliResolveText,
  assertRootHelpStructure,
  assertSearchTerminalText,
  buildMcpParityCommand,
  EXPECTED_EXPERIMENTAL_TOP_LEVEL_COMMANDS,
  EXPECTED_STABLE_TOP_LEVEL_COMMANDS,
  EXPECTED_TOP_LEVEL_COMMANDS,
  formatCliLiveCohortSummary,
  parseCliSmokeArgs,
  parseRootHelpCommands,
} from "./cli-smoke.ts";
import { parseMcpCallArgs } from "./mcp-call.ts";
import {
  assertExperimentalMcpResolveText,
  EXPECTED_EXPERIMENTAL_MCP_TOOLS,
  parseMcpSmokeArgs,
  STABLE_MCP_SMOKE_CONFIG,
} from "./mcp-smoke.ts";
import { toStdioLaunch } from "./smoke-launch-target.ts";

describe("CLI search smoke contract", () => {
  const valid = `No results yet | indexing | 0/1 ready

- npm:n8n
  indexing: code, repository docs; available: n8n.io docs (1,480 pages; capped);
  indexed: versions 2.26.9, 2.26.5, 2.23.2 +2, refs HEAD, master

Next: githits search-status smoke-ref --wait 20`;
  const completedWithTargetReadiness = `No results

- npm:express@4.18.2
  searched: repository docs

Next: shorten or broaden query; use githits code grep.`;
  const completed = `1 result | 1 repo code hit | next_offset=10

[1] npm:express@5.2.1 lib/application.js [repo code]`;
  const completedDocs = `1 result | 1 docs page

[1] page-1 [docs page] npm:express - docs.example.com/getting-started - Getting started | API - section`;

  it("accepts outcome-first text with CLI-native actions", () => {
    expect(valid.split("\n")[0]).toBe("No results yet | indexing | 0/1 ready");
    expect(valid).toContain("- npm:n8n");
    expect(valid).toContain("  indexing: code, repository docs; available:");
    expect(valid).not.toContain("Search smoke-ref");
    expect(valid).toContain("Next: githits search-status smoke-ref --wait 20");
    expect(() => assertSearchTerminalText(valid, "search")).not.toThrow();
    expect(() =>
      assertSearchTerminalText(
        "No results\nNext: shorten or broaden query; use githits code grep.",
        "search",
      ),
    ).not.toThrow();
    expect(() =>
      assertSearchTerminalText(
        "No result snapshot | failed | 0/1 ready\nNext: rerun search later.",
        "search",
      ),
    ).not.toThrow();
  });

  it.each([
    [`Warning: indexing\n${valid}`, "non-outcome text"],
    [`${completed}\nstatus: indexing`, "lifecycle status"],
    [
      completed.replace(" lib/application.js [repo code]", ""),
      "missing result follow-up",
    ],
    ["1 result from npm:express@5.2.1", "missing result follow-up"],
  ])("rejects invalid search text", (text, message) => {
    expect(() => assertSearchTerminalText(text, "search")).toThrow(message);
  });

  it("accepts completed hit text without a target group", () => {
    expect(() => assertSearchTerminalText(completed, "search")).not.toThrow();
  });

  it("accepts completed documentation hit text without a target group", () => {
    expect(() =>
      assertSearchTerminalText(completedDocs, "search"),
    ).not.toThrow();
  });

  it("accepts documentation hits that disclose a missing source URL", () => {
    expect(() =>
      assertSearchTerminalText(
        "1 result | 1 docs page\n\n[1] page-1 [docs page] npm:express - source URL unavailable - README",
        "search",
      ),
    ).not.toThrow();
  });

  it("accepts wrapped documentation and repository title tails", () => {
    expect(() =>
      assertSearchTerminalText(
        "2 results | 1 repo code hit, 1 docs page\n\n" +
          "[1] page-1 [docs page] npm:express - docs.example.com/getting-started -\n" +
          "  A long documentation title\n\n" +
          "[2] npm:express@5.2.1 lib/application.js [repo code] -\n" +
          "  A long repository title",
        "search",
      ),
    ).not.toThrow();
  });

  it("accepts a wrapped repository title without a documentation hit", () => {
    expect(() =>
      assertSearchTerminalText(
        "1 result | 1 repo code hit\n\n" +
          "[1] npm:express@5.2.1 lib/application.js [repo code] -\n" +
          "  A long repository title",
        "search",
      ),
    ).not.toThrow();
  });

  it.each([
    [
      "1 result\n\n[1] npm:express@5.2.1 location unavailable [repo code]\n  This payload mentions githits code read but has no locator",
    ],
    [
      "1 result\n\n[1] npm:express@5.2.1 location unavailable [repo code]\n  githits code read 'npm:express@5.2.1' --lines 1-10",
    ],
    [
      "1 result\n\n[1] npm:express@5.2.1 location unavailable [repo code]\n  ordinary title\n  githits code read 'npm:express@5.2.1' 'index.js'",
    ],
    [
      "1 result\n\n[1] page-1 [docs page] npm:express - README\n" +
        "  githits docs read --lines 1-10",
    ],
    [
      "1 result\n\n[1] page-1 [docs page] npm:express -\n" +
        "  README without a source locator",
    ],
    [
      "1 result\n\n[1] page ID unavailable [docs page] npm:express - docs.example.com/readme -\n" +
        "  Wrapped title without a page locator",
    ],
    [
      "1 result\n\n[1] npm:express@5.2.1 location unavailable [repo code] -\n" +
        "  Wrapped title without a locator",
    ],
    ["1 result\n\n[1] npm:express@5.2.1 lib/application.js [repo code] -"],
  ])("rejects incomplete or prose-only hit follow-ups", (text) => {
    expect(() => assertSearchTerminalText(text, "search")).toThrow(
      "missing result follow-up or next action",
    );
  });

  it.each([
    [
      "Fix",
      "No results\n\n- npm:missing@1.0.0\n  Fix: verify the package coordinate.",
    ],
    ["Try", "No results\n\n- npm:missing latest\n  Try: npm:missing@1.0.0"],
  ])(
    "accepts target-local %s recovery without a hit or Next",
    (_kind, text) => {
      expect(() => assertSearchTerminalText(text, "search")).not.toThrow();
    },
  );

  it("accepts completed target readiness without a search session", () => {
    expect(() =>
      assertSearchTerminalText(completedWithTargetReadiness, "search"),
    ).not.toThrow();
  });

  it("requires using details to remain grouped under a target", () => {
    expect(() =>
      assertSearchTerminalText(
        valid.replace(
          "- npm:n8n\n  indexing: code, repository docs; available: n8n.io docs (1,480 pages;",
          "  using: 2.26.9 while 2.36.7 indexes",
        ),
        "search",
      ),
    ).toThrow("readiness details must be grouped under a target");
  });

  it("rejects a separate search session summary", () => {
    expect(() =>
      assertSearchTerminalText(
        `${valid}\nSearch another-ref | 0/1 target ready`,
        "search",
      ),
    ).toThrow("separate Search <ref> session summary");
  });

  it.each([
    ["Ready:", "legacy flat section Ready:"],
    ["Waiting:", "legacy flat section Waiting:"],
    [
      "Available but not searched:",
      "legacy flat section Available but not searched:",
    ],
    ["Indexed alternatives:", "legacy flat section Indexed alternatives:"],
    ["Evidence may change.", "vague evidence policy prose"],
    ["Do not repeat search.", "repeat policy prose"],
    ["Do not poll this session.", "poll policy prose"],
  ])("rejects superseded top-level search text %s", (line, message) => {
    expect(() =>
      assertSearchTerminalText(`${valid}\n${line}`, "search"),
    ).toThrow(message);
  });

  it("rejects duplicate lifecycle, status, and Next lines", () => {
    expect(() =>
      assertSearchTerminalText(
        `${valid}\nNo results yet | indexing | 0/1 ready`,
        "search",
      ),
    ).toThrow("duplicate lifecycle outcome lines");
    expect(() =>
      assertSearchTerminalText(`${valid}\nstatus: indexing`, "search"),
    ).toThrow("duplicated lifecycle status line");
    expect(() =>
      assertSearchTerminalText(
        `${valid}\nNext: githits search-status other --wait 20`,
        "search",
      ),
    ).toThrow("multiple Next actions");
  });

  it("rejects target diagnostics and missing target grouping", () => {
    expect(() =>
      assertSearchTerminalText(`${valid}\nsearchRef=leaked`, "search"),
    ).toThrow("leaked searchRef detail");
    expect(() =>
      assertSearchTerminalText(`${valid}\nindexingRef=leaked`, "search"),
    ).toThrow("leaked indexingRef");
    expect(() =>
      assertSearchTerminalText(
        valid.replace(
          "  indexing: code, repository docs; available: n8n.io docs (1,480 pages;",
          "  available: versions 2.36.7",
        ),
        "search",
      ),
    ).not.toThrow();
    expect(() =>
      assertSearchTerminalText(valid.replace("- npm:n8n\n", ""), "search"),
    ).toThrow("readiness details must be grouped under a target");
  });

  it.each([
    ["status: payload", "duplicated lifecycle status line"],
    ["searchRef=payload", "leaked searchRef detail"],
    ["indexingRef payload", "leaked indexingRef"],
    ["search_ref=payload", "MCP search_ref syntax leaked into CLI output"],
  ])("rejects target-detail diagnostic %s", (diagnostic, message) => {
    const readinessLine =
      "  indexing: code, repository docs; available: n8n.io docs (1,480 pages;";
    const targetDetail = valid.replace(readinessLine, `  ${diagnostic}`);

    expect(() => assertSearchTerminalText(targetDetail, "search")).toThrow(
      message,
    );
  });

  it("ignores formatter-like words and diagnostics in indented hit content", () => {
    const hitText = `1 result

[1] npm:express@5.2.1 lib/application.js [repo code]
  Ready: payload text
  Waiting: payload text
  Available but not searched: payload text
  Indexed alternatives: payload text
  Evidence may change.
  Do not repeat this payload.
  Do not poll this payload.
  Next: payload text
  Indexing: payload text
  status: payload text
  searchRef=payload text
  indexingRef payload text
  search_ref=payload text`;

    expect(() => assertSearchTerminalText(hitText, "search")).not.toThrow();
  });

  it("keeps multiline hit-body diagnostics opaque after a blank line", () => {
    const hitText =
      "1 result | 1 repo code hit\n\n[1] npm:express@5.2.1 index.js [repo code]\n" +
      "  First summary paragraph.\n\n" +
      "  status: payload text\n" +
      "  searchRef=payload text\n" +
      "  indexingRef payload text\n" +
      "  search_ref=payload text";

    expect(() => assertSearchTerminalText(hitText, "search")).not.toThrow();
  });
});

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
    expect(EXPECTED_STABLE_TOP_LEVEL_COMMANDS).toContain("uninstall");
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

  it("pins every stable cohort to an explicit disabled experimental config", () => {
    expect(STABLE_MCP_SMOKE_CONFIG).toBe("[experimental]\ntools = false\n");
  });
});

describe("resolve smoke guidance", () => {
  const cliMixed = `Candidates:
  1. npm:express [exact] · package
  2. npm:express-lookalike [high] · package
     Warning: Malicious content affects the latest version. Do not use this target.

Next: githits search '<query>' --in 'npm:express'
`;
  const mcpMixed = `Best match: npm:express [exact; package].
Candidates:
  1. npm:express [exact; package]
  2. npm:express-lookalike [high; package]
     Warning: Malicious content affects the latest version. Do not use this target.
Next: pass the canonical target "npm:express" to the next MCP tool.
`;

  it("allows a verified best action when only an alternative is warned", () => {
    expect(() => assertExperimentalCliResolveText(cliMixed)).not.toThrow();
    expect(() => assertExperimentalMcpResolveText(mcpMixed)).not.toThrow();
  });

  it("accepts a warning-only blocked result with no normal action", () => {
    const cliBlocked = cliMixed.replace(/\nNext: githits search[^\n]+\n/, "\n");
    const mcpBlocked = mcpMixed.replace(
      /Next: pass the canonical target[^\n]+\n/,
      "",
    );

    expect(() => assertExperimentalCliResolveText(cliBlocked)).not.toThrow();
    expect(() => assertExperimentalMcpResolveText(mcpBlocked)).not.toThrow();
  });

  it("rejects a direct action for the warned candidate", () => {
    const cliWarnedBest = cliMixed.replace(
      "  1. npm:express [exact] · package\n",
      "  1. npm:express [exact] · package\n     Warning: Malicious content affects the latest version. Do not use this target.\n",
    );
    const mcpWarnedBest = mcpMixed.replace(
      "  1. npm:express [exact; package]\n",
      "  1. npm:express [exact; package]\n     Warning: Malicious content affects the latest version. Do not use this target.\n",
    );

    expect(() => assertExperimentalCliResolveText(cliWarnedBest)).toThrow(
      "without a warning",
    );
    expect(() => assertExperimentalMcpResolveText(mcpWarnedBest)).toThrow(
      "without a warning",
    );
  });

  it("rejects aggregate restrictions and ambiguous actions with warnings", () => {
    const aggregate =
      "Warning: Some candidates are not actionable. Narrow the result before continuing.\n";
    expect(() =>
      assertExperimentalCliResolveText(`${cliMixed}${aggregate}`),
    ).toThrow("without a warning");
    expect(() =>
      assertExperimentalMcpResolveText(`${mcpMixed}${aggregate}`),
    ).toThrow("without a warning");

    const cliAmbiguous = `${cliMixed.replace(
      /\nNext: githits search[^\n]+\n/,
      "\n",
    )}Next after choosing: githits search '<query>' --in '<target>'\n`;
    expect(() => assertExperimentalCliResolveText(cliAmbiguous)).toThrow(
      "omit the normal next action",
    );
  });
});

describe("CLI live smoke cohort reporting", () => {
  it("distinguishes both passed, partial, and both skipped outcomes", () => {
    expect(formatCliLiveCohortSummary("passed", "passed")).toContain(
      "stable and experimental live cohorts passed",
    );
    expect(formatCliLiveCohortSummary("passed", "skipped")).toContain(
      "partial pass",
    );
    expect(formatCliLiveCohortSummary("skipped", "passed")).toContain(
      "partial pass",
    );
    expect(formatCliLiveCohortSummary("skipped", "skipped")).toContain(
      "CLI smoke skipped",
    );
    expect(formatCliLiveCohortSummary("skipped", "skipped")).not.toContain(
      "CLI smoke passed",
    );
  });
});
