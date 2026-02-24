import { afterEach, describe, expect, it } from "bun:test";
import {
  colorize,
  colors,
  dim,
  error,
  highlight,
  shouldUseColors,
  success,
  warning,
} from "./colors.js";

describe("shouldUseColors", () => {
  const origNoColor = process.env.NO_COLOR;

  afterEach(() => {
    if (origNoColor === undefined) {
      delete process.env.NO_COLOR;
    } else {
      process.env.NO_COLOR = origNoColor;
    }
  });

  it("returns false when noColor parameter is true", () => {
    expect(shouldUseColors(true)).toBe(false);
  });

  it("returns false when NO_COLOR env var is set", () => {
    process.env.NO_COLOR = "1";
    expect(shouldUseColors()).toBe(false);
  });

  it("returns false when NO_COLOR is empty string", () => {
    process.env.NO_COLOR = "";
    expect(shouldUseColors()).toBe(false);
  });

  it("noColor parameter takes precedence over env", () => {
    delete process.env.NO_COLOR;
    expect(shouldUseColors(true)).toBe(false);
  });
});

describe("colorize", () => {
  it("wraps text with color codes when enabled", () => {
    const result = colorize("hello", "cyan", true);
    expect(result).toBe(`${colors.cyan}hello${colors.reset}`);
  });

  it("returns plain text when disabled", () => {
    expect(colorize("hello", "cyan", false)).toBe("hello");
  });
});

describe("dim", () => {
  it("wraps text with dim code when enabled", () => {
    const result = dim("faded", true);
    expect(result).toBe(`${colors.dim}faded${colors.reset}`);
  });

  it("returns plain text when disabled", () => {
    expect(dim("faded", false)).toBe("faded");
  });
});

describe("success", () => {
  it("prepends green checkmark when enabled", () => {
    const result = success("done", true);
    expect(result).toContain("✓");
    expect(result).toContain(colors.green);
    expect(result).toContain("done");
  });

  it("prepends plain checkmark when disabled", () => {
    const result = success("done", false);
    expect(result).toBe("✓ done");
  });
});

describe("error", () => {
  it("prepends red cross when enabled", () => {
    const result = error("fail", true);
    expect(result).toContain("✗");
    expect(result).toContain(colors.red);
    expect(result).toContain("fail");
  });

  it("prepends plain cross when disabled", () => {
    expect(error("fail", false)).toBe("✗ fail");
  });
});

describe("warning", () => {
  it("prepends yellow warning when enabled", () => {
    const result = warning("caution", true);
    expect(result).toContain("⚠");
    expect(result).toContain(colors.yellow);
    expect(result).toContain("caution");
  });

  it("prepends plain warning when disabled", () => {
    expect(warning("caution", false)).toBe("⚠ caution");
  });
});

describe("highlight", () => {
  it("wraps with bold cyan when enabled", () => {
    const result = highlight("important", true);
    expect(result).toBe(`${colors.bold}${colors.cyan}important${colors.reset}`);
  });

  it("returns plain text when disabled", () => {
    expect(highlight("important", false)).toBe("important");
  });
});
