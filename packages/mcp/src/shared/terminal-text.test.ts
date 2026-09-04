import { describe, expect, it } from "bun:test";
import { sanitizeTerminalText } from "./terminal-text.js";

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
