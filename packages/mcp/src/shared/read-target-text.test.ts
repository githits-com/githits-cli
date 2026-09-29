import { describe, expect, it } from "bun:test";
import type { ReadTarget } from "@githits/core-internal";
import { renderReadTarget } from "./read-target-text.js";

describe("renderReadTarget", () => {
  it("renders the target alone with MCP syntax by default", () => {
    const action: ReadTarget = { target: "opaque-target" };

    expect(renderReadTarget(action)).toBe('read target="opaque-target"');
    expect(parseMcpAssignments(renderReadTarget(action))).toEqual({
      target: "opaque-target",
    });
    expect(parseCliArguments(renderReadTarget(action, "cli"))).toEqual([
      "githits",
      "read",
      "opaque-target",
    ]);
  });

  it("round-trips opaque text arguments in both syntaxes", () => {
    const action = {
      target: 'https://例え.test/guide?q=O\'Reilly%2F&note="two words"',
      path: 'src/目录/file name.ts?raw="yes"&value=%25',
      selector: "Heading: “it's quoted” / symbol%2Fname?x=a b",
    } satisfies ReadTarget;
    const mcp = renderReadTarget(action);
    const cli = renderReadTarget(action, "cli");

    expect(parseMcpAssignments(mcp)).toEqual({
      target: action.target,
      path: action.path,
      selector: action.selector,
    });
    expect(parseCliArguments(cli)).toEqual([
      "githits",
      "read",
      action.target,
      action.path,
      "--selector",
      action.selector,
    ]);
  });

  it("renders either half of a line range", () => {
    expect(
      parseMcpAssignments(renderReadTarget({ target: "t", startLine: 12 })),
    ).toEqual({ target: "t", start_line: 12 });
    expect(
      parseCliArguments(
        renderReadTarget({ target: "t", startLine: 12 }, "cli"),
      ),
    ).toEqual(["githits", "read", "t", "--lines", "12-"]);

    expect(
      parseMcpAssignments(renderReadTarget({ target: "t", endLine: 29 })),
    ).toEqual({ target: "t", end_line: 29 });
    expect(
      parseCliArguments(renderReadTarget({ target: "t", endLine: 29 }, "cli")),
    ).toEqual(["githits", "read", "t", "--lines", "-29"]);
  });

  it("renders a full range and all optional arguments", () => {
    const action: ReadTarget = {
      target: "t",
      path: "src/file.ts",
      selector: "function f",
      startLine: 4,
      endLine: 17,
    };

    expect(parseMcpAssignments(renderReadTarget(action))).toEqual({
      target: "t",
      path: "src/file.ts",
      selector: "function f",
      start_line: 4,
      end_line: 17,
    });
    expect(parseCliArguments(renderReadTarget(action, "cli"))).toEqual([
      "githits",
      "read",
      "t",
      "src/file.ts",
      "--selector",
      "function f",
      "--lines",
      "4-17",
    ]);
  });

  it("preserves explicitly supplied empty strings", () => {
    const action: ReadTarget = { target: "t", path: "", selector: "" };

    expect(renderReadTarget(action)).toBe(
      'read target="t" path="" selector=""',
    );
    expect(parseMcpAssignments(renderReadTarget(action))).toEqual({
      target: "t",
      path: "",
      selector: "",
    });
    expect(parseCliArguments(renderReadTarget(action, "cli"))).toEqual([
      "githits",
      "read",
      "t",
      "",
      "--selector",
      "",
    ]);
  });
});

function parseMcpAssignments(command: string): Record<string, string | number> {
  const assignments: Record<string, string | number> = {};
  const pattern = /(?:^| )(\w+)=((?:"(?:\\.|[^"\\])*"|-?\d+))/g;
  for (const match of command.matchAll(pattern)) {
    assignments[match[1]!] = JSON.parse(match[2]!) as string | number;
  }
  return assignments;
}

function parseCliArguments(command: string): string[] {
  const args: string[] = [];
  let value = "";
  let quote: "'" | '"' | undefined;
  let started = false;

  for (const character of command) {
    if (quote === "'") {
      if (character === "'") quote = undefined;
      else value += character;
      continue;
    }
    if (quote === '"') {
      if (character === '"') quote = undefined;
      else value += character;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      started = true;
    } else if (/\s/.test(character)) {
      if (started) {
        args.push(value);
        value = "";
        started = false;
      }
    } else {
      value += character;
      started = true;
    }
  }

  if (started) args.push(value);
  return args;
}
