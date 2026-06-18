import { describe, expect, it, mock } from "bun:test";
import { createMockFileSystemService } from "../../services/test-helpers.js";
import type {
  CliSetup,
  CompositeSetup,
  ConfigFileSetup,
} from "./agent-definitions.js";
import {
  CHANGE_VERB_WIDTH,
  type ChangeRow,
  changeRowColumnWidths,
  describeConfigAsUnchanged,
  formatCliCommand,
  formatConfigPath,
  renderChangeRows,
} from "./setup-format.js";

function fsWith(home: string, cwd: string) {
  return createMockFileSystemService({
    getHomeDir: mock(() => home),
    getCwd: mock(() => cwd),
  });
}

describe("formatConfigPath", () => {
  it("collapses the home directory to ~", () => {
    const fs = fsWith("/home/user", "/elsewhere");
    expect(formatConfigPath("/home/user/.cursor/mcp.json", fs)).toBe(
      "~/.cursor/mcp.json",
    );
  });

  it("collapses the cwd to .", () => {
    const fs = fsWith("/home/user", "/work/repo");
    expect(formatConfigPath("/work/repo/.mcp.json", fs)).toBe("./.mcp.json");
  });

  it("prefers the longest matching prefix when cwd is under home", () => {
    const fs = fsWith("/home/user", "/home/user/repo");
    // Both home and cwd match; cwd is longer, so it wins.
    expect(formatConfigPath("/home/user/repo/.mcp.json", fs)).toBe(
      "./.mcp.json",
    );
  });

  it("returns the path unchanged when no prefix matches", () => {
    const fs = fsWith("/home/user", "/work/repo");
    expect(formatConfigPath("/etc/app/config.json", fs)).toBe(
      "/etc/app/config.json",
    );
  });

  it("does not treat a sibling directory as being under a prefix", () => {
    const fs = fsWith("/home/user", "/work/repo");
    // /home/user2 must not collapse against /home/user.
    expect(formatConfigPath("/home/user2/.cursor/mcp.json", fs)).toBe(
      "/home/user2/.cursor/mcp.json",
    );
  });

  it("collapses Windows-style paths", () => {
    const fs = fsWith("C:\\Users\\me", "C:\\Users\\me\\repo");
    expect(
      formatConfigPath("C:\\Users\\me\\AppData\\Roaming\\Code\\mcp.json", fs),
    ).toBe("~\\AppData\\Roaming\\Code\\mcp.json");
    expect(formatConfigPath("C:\\Users\\me\\repo\\.mcp.json", fs)).toBe(
      ".\\.mcp.json",
    );
  });

  it("matches Windows paths case-insensitively while preserving casing", () => {
    const fs = fsWith("C:\\Users\\Me", "D:\\nope");
    // Drive/dir casing differs from the prefix but should still collapse, and
    // the original casing of the remainder is preserved.
    expect(
      formatConfigPath("c:\\users\\me\\AppData\\Roaming\\Code\\mcp.json", fs),
    ).toBe("~\\AppData\\Roaming\\Code\\mcp.json");
  });

  it("ignores empty home/cwd prefixes", () => {
    const fs = fsWith("", "");
    expect(formatConfigPath("/home/user/.cursor/mcp.json", fs)).toBe(
      "/home/user/.cursor/mcp.json",
    );
  });
});

describe("formatCliCommand", () => {
  it("joins command and args", () => {
    expect(
      formatCliCommand({ command: "claude", args: ["plugin", "install", "x"] }),
    ).toBe("claude plugin install x");
  });

  it("returns the bare command when there are no args", () => {
    expect(formatCliCommand({ command: "claude", args: [] })).toBe("claude");
  });
});

describe("describeConfigAsUnchanged", () => {
  it("maps a config-file setup to one unchanged path change", () => {
    const config: ConfigFileSetup = {
      method: "config-file",
      configPath: "/home/user/.cursor/mcp.json",
      serversKey: "mcpServers",
      serverName: "GitHits",
      serverConfig: {},
    };
    expect(describeConfigAsUnchanged(config)).toEqual([
      {
        kind: "config-file",
        path: "/home/user/.cursor/mcp.json",
        change: "unchanged",
      },
    ]);
  });

  it("maps a CLI setup to one unchanged change per command", () => {
    const config: CliSetup = {
      method: "cli",
      commands: [
        { command: "claude", args: ["plugin", "marketplace", "add", "x"] },
        { command: "claude", args: ["plugin", "install", "y"] },
      ],
    };
    expect(describeConfigAsUnchanged(config)).toEqual([
      {
        kind: "command",
        command: "claude plugin marketplace add x",
        change: "unchanged",
      },
      {
        kind: "command",
        command: "claude plugin install y",
        change: "unchanged",
      },
    ]);
  });

  it("recurses into composite steps", () => {
    const config: CompositeSetup = {
      method: "composite",
      steps: [
        {
          method: "cli",
          commands: [{ command: "pi", args: ["install", "x"] }],
        },
        {
          method: "config-file",
          configPath: "/home/user/.pi/agent/mcp.json",
          serversKey: "mcpServers",
          serverName: "GitHits",
          serverConfig: {},
        },
      ],
    };
    expect(describeConfigAsUnchanged(config)).toEqual([
      { kind: "command", command: "pi install x", change: "unchanged" },
      {
        kind: "config-file",
        path: "/home/user/.pi/agent/mcp.json",
        change: "unchanged",
      },
    ]);
  });
});

describe("renderChangeRows", () => {
  const rows: ChangeRow[] = [
    {
      tone: "ok",
      label: "Claude Code",
      verb: "ran",
      detail: "claude plugin install x",
    },
    {
      tone: "ok",
      label: "VS Code",
      verb: "updated",
      detail: "~/.config/Code/User/mcp.json",
    },
    { tone: "error", label: "Cline", verb: "failed", detail: "boom" },
  ];

  it("aligns the detail column across rows of differing label/verb lengths", () => {
    const widths = changeRowColumnWidths(rows);
    const lines = renderChangeRows(rows, {
      useColors: false,
      labelWidth: widths.labelWidth,
      verbWidth: widths.verbWidth,
    });
    // The label column width equals the longest label ("Claude Code" = 11).
    expect(widths.labelWidth).toBe("Claude Code".length);
    // Each row's detail begins at the exact same column despite different
    // label and verb lengths.
    const detailOffsets = rows.map((row, i) => lines[i]!.indexOf(row.detail));
    expect(detailOffsets.every((offset) => offset > 0)).toBe(true);
    expect(new Set(detailOffsets).size).toBe(1);
    // Glyphs reflect tone.
    expect(lines[0]).toContain("✓");
    expect(lines[2]).toContain("✗");
  });

  it("produces equal visible column widths regardless of color", () => {
    const opts = { labelWidth: 11, verbWidth: CHANGE_VERB_WIDTH };
    const plain = renderChangeRows(rows, { ...opts, useColors: false });
    const colored = renderChangeRows(rows, { ...opts, useColors: true });
    // Colored output contains ANSI escapes...
    expect(colored.join("")).toContain("\x1b[");
    // ...but stripping them yields identical text to the plain render.
    // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping ANSI.
    const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
    expect(colored.map(strip)).toEqual(plain);
  });
});
