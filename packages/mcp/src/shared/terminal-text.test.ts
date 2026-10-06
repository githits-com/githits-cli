import { describe, expect, it } from "bun:test";
import { sanitizeTerminalText, wrapTerminalProse } from "./terminal-text.js";

describe("sanitizeTerminalText", () => {
  it("strips complete CSI sequences", () => {
    expect(sanitizeTerminalText("before\u001b[31mred\u001b[0mafter")).toBe(
      "beforeredafter",
    );
  });

  it("strips OSC sequences terminated by BEL", () => {
    expect(
      sanitizeTerminalText(
        "before\u001b]8;;https://evil.test\u0007click\u001b]8;;\u0007after",
      ),
    ).toBe("beforeclickafter");
  });

  it("strips OSC sequences terminated by ST", () => {
    expect(
      sanitizeTerminalText("before\u001b]0;owned title\u001b\\after"),
    ).toBe("beforeafter");
  });

  it("strips two-byte escape sequences", () => {
    expect(sanitizeTerminalText("before\u001bMsaved\u001bNafter")).toBe(
      "beforesavedafter",
    );
  });

  it("strips residual C0, C1, and DEL controls", () => {
    expect(sanitizeTerminalText("a\u0000b\u001fb\u007fc\u0080d\u009fe")).toBe(
      "abbcde",
    );
  });

  it("preserves normal Unicode and printable text", () => {
    const value = "Zażółć gęślą jaźń — 日本語 🚀";
    expect(sanitizeTerminalText(value)).toBe(value);
  });

  it.each([
    ["a\nb", "ab"],
    ["a\tb", "ab"],
    ["a \u0007 b", "a  b"],
  ])("preserves the control-stripping order for %j", (value, expected) => {
    expect(sanitizeTerminalText(value)).toBe(expected);
  });
});

describe("hanging provenance prose", () => {
  it("keeps the first label at column zero and indents continuation text", () => {
    const text =
      "Requested: github:example/project@abcdef12 (committed 2026-10-05, observed HEAD)";
    const lines = wrapTerminalProse(text, 55, "  ");
    expect(lines[0]).toStartWith("Requested:");
    expect(lines.slice(1).every((line) => line.startsWith("  "))).toBe(true);
    expect(lines.every((line) => line.length <= 55)).toBe(true);
    expect(lines.join(" ").replace(/\s+/g, " ")).toBe(text);
    expect(
      wrapTerminalProse(
        "plain prose still wraps without added indentation",
        20,
      )[1],
    ).not.toStartWith(" ");
    expect(
      wrapTerminalProse("  - source with several qualifiers and a date", 25)[1],
    ).toStartWith("    ");
  });
});
