import { afterEach, describe, expect, it } from "bun:test";
import {
  brandColors,
  colorize,
  colorizeBrand,
  colorizeTerminal,
  colors,
  dim,
  error,
  highlight,
  highlightMatch,
  highlightRanges,
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

describe("colorizeTerminal", () => {
  it("uses truecolor when terminal color depth supports it", () => {
    const result = colorizeTerminal("GitHits", brandColors.primary, true, {
      colorDepth: 24,
    });
    expect(result).toBe("\x1b[38;2;255;114;190mGitHits\x1b[0m");
  });

  it("falls back to 256-color when truecolor is unavailable", () => {
    const result = colorizeTerminal("GitHits", brandColors.primary, true, {
      colorDepth: 8,
    });
    expect(result).toBe("\x1b[38;5;205mGitHits\x1b[0m");
  });

  it("falls back to 16-color when only basic color is available", () => {
    const result = colorizeTerminal("GitHits", brandColors.primary, true, {
      colorDepth: 4,
    });
    expect(result).toBe(`${colors.magenta}GitHits${colors.reset}`);
  });

  it("returns plain text when the terminal reports no color support", () => {
    const result = colorizeTerminal("GitHits", brandColors.primary, true, {
      colorDepth: 1,
    });
    expect(result).toBe("GitHits");
  });

  it("combines style and terminal color", () => {
    const result = colorizeBrand("GitHits", "secondary", true, {
      bold: true,
      colorDepth: 8,
    });
    expect(result).toBe(`${colors.bold}\x1b[38;5;208mGitHits${colors.reset}`);
  });

  it("returns plain text when disabled", () => {
    expect(colorizeBrand("GitHits", "primary", false)).toBe("GitHits");
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

describe("highlightMatch", () => {
  it("wraps with bold yellow when enabled", () => {
    const result = highlightMatch("match", true);
    expect(result).toBe(`${colors.bold}${colors.yellow}match${colors.reset}`);
  });

  it("returns plain text when disabled", () => {
    expect(highlightMatch("match", false)).toBe("match");
  });
});

describe("highlightRanges", () => {
  it("renders matched spans with the search-match color", () => {
    const result = highlightRanges("router middleware", [[7, 17]], true);
    expect(result).toBe(
      `router ${colors.bold}${colors.yellow}middleware${colors.reset}`,
    );
  });
});
